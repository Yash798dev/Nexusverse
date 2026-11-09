"""
agents/image_generation.py — Local, GPU-generated scene art (Stage 3 rebuild).

The old version of this file didn't generate anything — it searched Unsplash/Pexels
stock photos for each prompt. That's replaced here with a local Diffusers text-to-image
pipeline sized for a 6GB card (RTX 4050): SD-Turbo by default (single-step, ~2GB VRAM),
SDXL-Turbo optionally for higher quality (with CPU offload to fit the VRAM budget).

Consistency: every image in a job shares the same seed and the same art-direction
prefix (already baked into each prompt by agents.script_writer.generate_image_prompts),
so the scene set reads as one coherent production instead of unrelated images.

Quality gate: each image is scored against its prompt with CLIP; a low-scoring image
is regenerated once with a different seed (the first real agentic QA loop in this stage).

If torch/diffusers/CUDA aren't available at all, falls back to the old Unsplash/Pexels
stock-photo search so the pipeline still produces *something* on a machine without a GPU.
"""

import os
import re
import time
import hashlib
from io import BytesIO
from typing import List

import requests
from PIL import Image

IMAGE_QUALITY = os.getenv("IMAGE_QUALITY", "high").lower()  # fast|high
CLIP_SCORE_THRESHOLD = float(os.getenv("IMAGE_CLIP_THRESHOLD", "0.20"))
NEGATIVE_PROMPT = (
    "blurry, distorted, extra limbs, watermark, text, letters, low quality, deformed, "
    "ugly, oversaturated, jpeg artifacts, low contrast, flat lighting, amateur"
)
# Appended to every prompt: pushes the model toward the polished, high-production
# look short-form audiences expect, rather than flat default-diffusion output.
# Kept deliberately short — CLIP's text encoder truncates at 77 tokens, and the
# prompt already carries a shared art-direction sentence plus the scene description,
# so a long suffix would just be silently cut off.
QUALITY_SUFFIX = os.getenv(
    "IMAGE_QUALITY_SUFFIX",
    "cinematic lighting, highly detailed, sharp focus, 8k",
)
CLIP_TOKEN_LIMIT = 77

FAST_MODEL = os.getenv("SD_FAST_MODEL", "stabilityai/sd-turbo")
HIGH_MODEL = os.getenv("SD_HIGH_MODEL", "stabilityai/sdxl-turbo")


def _generation_size() -> tuple[int, int]:
    """
    Diffusion resolution matched to the output canvas aspect (portrait for Shorts),
    snapped to each model's trained bucket — generating at the target aspect avoids
    the heavy centre-cropping that throws away the subject in a landscape render.
    """
    from agents.video_effects import get_canvas

    canvas_w, canvas_h = get_canvas()
    portrait = canvas_h >= canvas_w
    if IMAGE_QUALITY == "high":
        return (768, 1344) if portrait else (1344, 768)   # SDXL 9:16 bucket
    return (512, 896) if portrait else (896, 512)          # SD1.5/SD-Turbo 9:16 bucket

_pipe = None
_pipe_model_id = None


def unload_pipeline():
    """Free the resident diffusion pipeline's VRAM once image generation is done for
    this job — on a 6GB card it can't stay loaded alongside XTTS/Whisper/CLIP."""
    global _pipe, _pipe_model_id
    if _pipe is None:
        return
    import gc

    import torch

    try:
        # cpu-offload installs accelerate hooks that keep the modules referenced;
        # drop them explicitly or the weights stay pinned after `del`.
        from accelerate.hooks import remove_hook_from_module

        for attr in ("unet", "vae", "text_encoder", "text_encoder_2"):
            module = getattr(_pipe, attr, None)
            if module is not None:
                remove_hook_from_module(module, recurse=True)
    except Exception:
        pass

    del _pipe
    _pipe, _pipe_model_id = None, None
    gc.collect()
    torch.cuda.empty_cache()


def pymsg(s: str):
    print("PYMSG:", s, flush=True)


def _job_seed(prompts: List[str]) -> int:
    """Deterministic per-job seed so every scene in the same job shares style/lighting
    continuity, derived from the (shared) art-direction prefix of the first prompt."""
    basis = prompts[0] if prompts else "default"
    return int(hashlib.sha256(basis.encode("utf-8")).hexdigest()[:8], 16)


def _load_pipeline():
    global _pipe, _pipe_model_id
    import torch
    from diffusers import AutoPipelineForText2Image

    model_id = HIGH_MODEL if IMAGE_QUALITY == "high" else FAST_MODEL
    if _pipe is not None and _pipe_model_id == model_id:
        return _pipe

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA not available; skipping local diffusion pipeline.")

    pymsg(f"[image_generation] Loading {model_id} (quality={IMAGE_QUALITY})...")
    pipe = AutoPipelineForText2Image.from_pretrained(model_id, torch_dtype=torch.float16, variant="fp16")

    if IMAGE_QUALITY == "high":
        # SDXL-Turbo doesn't fit comfortably resident alongside everything else on 6GB;
        # offload layers to CPU between steps instead of keeping the whole model on GPU.
        pipe.enable_model_cpu_offload()
        # Decoding a 768x1344 latent in one go is the peak-memory moment of the whole
        # render and will OOM a 6GB card; slice/tile the VAE so it decodes in chunks.
        pipe.enable_vae_slicing()
        pipe.enable_vae_tiling()
    else:
        pipe = pipe.to("cuda")
    pipe.enable_attention_slicing()

    _pipe, _pipe_model_id = pipe, model_id
    return pipe


def _fit_prompt(pipe, scene_prompt: str) -> str:
    """
    Combine the scene prompt with the quality suffix, trimming the *scene* text if
    needed so the whole thing fits CLIP's 77-token window. Without this the encoder
    silently drops the tail — which is exactly where the quality terms live, so the
    suffix would have no effect on the longest (most detailed) prompts.
    """
    tokenizer = getattr(pipe, "tokenizer", None)
    combined = f"{scene_prompt}, {QUALITY_SUFFIX}"
    if tokenizer is None:
        return combined

    def n_tokens(text: str) -> int:
        return len(tokenizer(text).input_ids)

    if n_tokens(combined) <= CLIP_TOKEN_LIMIT:
        return combined

    words = scene_prompt.split()
    while words and n_tokens(f"{' '.join(words)}, {QUALITY_SUFFIX}") > CLIP_TOKEN_LIMIT:
        words.pop()
    trimmed = f"{' '.join(words)}, {QUALITY_SUFFIX}"
    pymsg(f"[image_generation] prompt trimmed to fit {CLIP_TOKEN_LIMIT}-token limit")
    return trimmed


def _generate_locally(prompts: List[str], output_dir: str, num_images_per_prompt: int) -> List[str]:
    import torch

    pipe = _load_pipeline()
    steps = 8 if IMAGE_QUALITY == "high" else 3  # more steps over the turbo minimum meaningfully improves prompt adherence, not just sharpness
    guidance = 0.0  # turbo models are distilled for CFG-free single/few-step sampling
    width, height = _generation_size()
    seed = _job_seed(prompts)
    pymsg(f"[image_generation] rendering at {width}x{height} (quality={IMAGE_QUALITY}, steps={steps})")

    saved_files = []
    for i, prompt in enumerate(prompts):
        full_prompt = _fit_prompt(pipe, prompt)
        for j in range(num_images_per_prompt):
            final_path = os.path.join(output_dir, f"scene_{i+1:02d}_{j+1:02d}.jpg")
            best_image, best_score = None, -1.0
            for attempt in range(3):  # agentic QA loop: regenerate if CLIP score is low
                generator = torch.Generator(device="cuda").manual_seed(seed + i * 100 + j + attempt * 7919)
                image = pipe(
                    prompt=full_prompt,
                    negative_prompt=NEGATIVE_PROMPT,
                    num_inference_steps=steps,
                    guidance_scale=guidance,
                    width=width,
                    height=height,
                    generator=generator,
                ).images[0]

                score = None
                try:
                    from agents.clip_utils import score_image_prompt
                    score = score_image_prompt(image, prompt)
                except Exception as e:
                    pymsg(f"[image_generation] CLIP scoring unavailable ({e}); accepting image as-is.")

                if score is None:
                    best_image = image
                    break
                pymsg(f"[image_generation] scene {i+1}.{j+1} attempt {attempt+1}: CLIP score={score:.3f}")
                # hold the winning image in memory; only the best attempt gets written,
                # so a worse retry can't overwrite a better first render
                if score > best_score:
                    best_score, best_image = score, image
                if score >= CLIP_SCORE_THRESHOLD:
                    break

            if best_image is not None:
                best_image.convert("RGB").save(final_path, format="JPEG", quality=95)
                saved_files.append(final_path)

    return saved_files


# --- Stock-photo fallback path (used only if no local GPU pipeline is available) ---

UNSPLASH_ACCESS_KEY = os.getenv("UNSPLASH_ACCESS_KEY")
PEXELS_API_KEY = os.getenv("PEXELS_API_KEY")
LOCAL_FALLBACK_DIR = os.path.join(os.path.dirname(__file__), "assets", "fallback_images")
os.makedirs(LOCAL_FALLBACK_DIR, exist_ok=True)
DEFAULT_LOCAL_IMAGES = [
    os.path.join(LOCAL_FALLBACK_DIR, f)
    for f in os.listdir(LOCAL_FALLBACK_DIR)
    if f.lower().endswith((".jpg", ".jpeg", ".png"))
]


def sanitize_prompt(prompt: str, max_len: int = 80) -> str:
    if not prompt:
        return "abstract background"
    p = re.sub(r"[\r\n]+", " ", prompt)
    p = "".join(ch for ch in p if ord(ch) >= 32)
    p = re.sub(r"\s+", " ", p).strip()
    if len(p) > max_len:
        p = p[:max_len].rsplit(" ", 1)[0]
    p = re.sub(r"[^\w\s\-,.()]+", " ", p)
    return re.sub(r"\s+", " ", p).strip() or "abstract background"


def _search(url, headers, params, results_key, retries=2, timeout=8):
    attempt = 0
    while attempt <= retries:
        try:
            r = requests.get(url, headers=headers, params=params, timeout=timeout)
            if r.status_code == 200:
                return r.json().get(results_key, [])
            if r.status_code in (429, 500, 502, 503, 504):
                attempt += 1
                time.sleep(1.5 ** attempt)
                continue
            return []
        except requests.RequestException:
            attempt += 1
            time.sleep(1.5 ** attempt)
    return []


def _download(url: str, dst_path: str) -> bool:
    try:
        r = requests.get(url, stream=True, timeout=15)
        r.raise_for_status()
        Image.open(BytesIO(r.content)).convert("RGB").save(dst_path, format="JPEG", quality=85)
        return True
    except Exception as e:
        pymsg(f"[image_generation] Failed to download {url}: {e}")
        return False


def _generate_via_stock_fallback(prompts: List[str], output_dir: str, num_images_per_prompt: int) -> List[str]:
    pymsg("[image_generation] No local GPU pipeline available; falling back to stock photo search.")
    saved_files = []
    for i, raw_prompt in enumerate(prompts):
        prompt = sanitize_prompt(raw_prompt)
        used = False

        if UNSPLASH_ACCESS_KEY:
            results = _search(
                "https://api.unsplash.com/search/photos",
                {"Authorization": f"Client-ID {UNSPLASH_ACCESS_KEY}", "Accept-Version": "v1"},
                {"query": prompt, "per_page": num_images_per_prompt},
                "results",
            )
            for j, item in enumerate(results[:num_images_per_prompt]):
                image_url = item.get("urls", {}).get("regular")
                if image_url and _download(image_url, os.path.join(output_dir, f"unsplash_{i+1:02d}_{j+1:02d}.jpg")):
                    saved_files.append(os.path.join(output_dir, f"unsplash_{i+1:02d}_{j+1:02d}.jpg"))
                    used = True

        if not used and PEXELS_API_KEY:
            results = _search(
                "https://api.pexels.com/v1/search",
                {"Authorization": PEXELS_API_KEY},
                {"query": prompt, "per_page": num_images_per_prompt},
                "photos",
            )
            for j, item in enumerate(results[:num_images_per_prompt]):
                image_url = item.get("src", {}).get("large") or item.get("src", {}).get("original")
                if image_url and _download(image_url, os.path.join(output_dir, f"pexels_{i+1:02d}_{j+1:02d}.jpg")):
                    saved_files.append(os.path.join(output_dir, f"pexels_{i+1:02d}_{j+1:02d}.jpg"))
                    used = True

        if not used:
            for j in range(num_images_per_prompt):
                dst = os.path.join(output_dir, f"placeholder_{i+1:02d}_{j+1:02d}.jpg")
                if DEFAULT_LOCAL_IMAGES:
                    src = DEFAULT_LOCAL_IMAGES[j % len(DEFAULT_LOCAL_IMAGES)]
                    with open(src, "rb") as rf, open(dst, "wb") as wf:
                        wf.write(rf.read())
                else:
                    Image.new("RGB", (1920, 1080), (40, 40, 40)).save(dst, format="JPEG", quality=80)
                saved_files.append(dst)

    return saved_files


def generate_images(
    prompts: List[str],
    output_dir: str = "generated_images",
    num_images_per_prompt: int = 1,
) -> List[str]:
    os.makedirs(output_dir, exist_ok=True)
    pymsg(f"[image_generation] Starting generate_images for {len(prompts)} prompts (quality={IMAGE_QUALITY})")

    try:
        import torch  # noqa: F401
        import diffusers  # noqa: F401

        saved_files = _generate_locally(prompts, output_dir, num_images_per_prompt)
    except Exception as e:
        pymsg(f"[image_generation] Local diffusion unavailable ({e}); using stock-photo fallback.")
        saved_files = _generate_via_stock_fallback(prompts, output_dir, num_images_per_prompt)

    pymsg(f"[image_generation] Finished. Saved {len(saved_files)} images: {saved_files}")
    return saved_files
