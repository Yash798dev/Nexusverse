"""
agents/stock_videos.py — Semantic (CLIP) b-roll matching, replacing plain keyword search.

The old version sent the raw topic string straight to Pexels' text search and took
whatever came back first. This version:
  1. Pulls a wider candidate pool from Pexels per scene description (not just the topic).
  2. Extracts a representative frame from each candidate and embeds it with CLIP.
  3. Ranks candidates by cosine similarity to the scene's CLIP text embedding and keeps
     the best matches — actual visual relevance, not just keyword overlap.
  4. Downloaded clips accumulate in `stock_videos/` as a growing local library that gets
     reused/matched locally on later runs (candidates already on disk are scored too).
"""

import os
import re
import glob
import hashlib
from pathlib import Path
from typing import List
from dotenv import load_dotenv
import requests

load_dotenv()
PEXELS_KEY = os.getenv("PEXELS_API_KEY")


def extract_video_id(path: str) -> str | None:
    """Pulls the Pexels video ID back out of a locally-cached filename
    (cand_<queryhash>_<id>.mp4) — used to check/mark cross-video reuse without
    needing a separate lookup table mapping local paths to remote IDs."""
    m = re.search(r"_(\d+)\.mp4$", os.path.basename(path))
    return m.group(1) if m else None


def _embed_video_frame(video_path: str):
    from moviepy.editor import VideoFileClip
    from PIL import Image
    from agents.clip_utils import embed_image

    clip = VideoFileClip(video_path)
    try:
        frame = clip.get_frame(min(1.0, clip.duration / 2))
    finally:
        clip.close()
    image = Image.fromarray(frame).convert("RGB")
    return embed_image(image)


def _download(url: str, dst_path: str) -> bool:
    try:
        r = requests.get(url, stream=True, timeout=30)
        r.raise_for_status()
        with open(dst_path, "wb") as f:
            for chunk in r.iter_content(1024 * 64):
                f.write(chunk)
        return True
    except Exception:
        return False


def _fetch_candidates(query: str, output_dir: str, per_query: int = 5) -> List[str]:
    if not PEXELS_KEY:
        return []
    url = "https://api.pexels.com/videos/search"
    headers = {"Authorization": PEXELS_KEY}
    # Ask Pexels for footage already shot in the output orientation — cropping a
    # landscape clip to 9:16 throws away most of the frame and usually the subject.
    from agents.video_effects import get_canvas

    canvas_w, canvas_h = get_canvas()
    orientation = "portrait" if canvas_h >= canvas_w else "landscape"
    params = {
        "query": query,
        "per_page": per_query,
        "min_width": 640,
        "min_height": 360,
        "orientation": orientation,
    }
    try:
        resp = requests.get(url, headers=headers, params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return []

    paths = []
    for video in data.get("videos", []):
        file_url = video["video_files"][-1]["link"]
        query_hash = hashlib.sha1(query.encode("utf-8")).hexdigest()[:8]
        out_path = Path(output_dir) / f"cand_{query_hash}_{video['id']}.mp4"
        if out_path.exists() or _download(file_url, str(out_path)):
            paths.append(str(out_path))
    return paths


def fetch_stock_videos(
    query: str,
    max_clips: int = 2,
    scene_descriptions: List[str] | None = None,
    output_dir: str = "stock_videos",
) -> List[str]:
    """
    Returns up to `max_clips` local video paths best matching `query` (and, if given,
    the individual `scene_descriptions`) by CLIP similarity rather than raw keyword search.
    Falls back to the first Pexels results (old behavior) if CLIP/torch isn't available.
    """
    os.makedirs(output_dir, exist_ok=True)
    search_terms = scene_descriptions[:max_clips] if scene_descriptions else [query]

    candidates = list(glob.glob(os.path.join(output_dir, "*.mp4")))  # reuse local library
    for term in search_terms:
        candidates.extend(_fetch_candidates(term, output_dir, per_query=max(3, max_clips)))
    candidates = list(dict.fromkeys(candidates))  # dedupe, keep order

    if not candidates:
        return []

    try:
        from agents.clip_utils import embed_text

        text_feats = embed_text(query)
        scored = []
        for path in candidates:
            try:
                video_feats = _embed_video_frame(path)
                score = (video_feats @ text_feats.T).item()
                scored.append((score, path))
            except Exception:
                continue
        scored.sort(key=lambda x: x[0], reverse=True)
        return [p for _, p in scored[:max_clips]]
    except Exception:
        return candidates[:max_clips]


def fetch_stock_videos_per_scene(
    scene_descriptions: List[str],
    output_dir: str = "stock_videos",
    per_query: int = 4,
    exclude_ids: set[str] | None = None,
) -> List[str | None]:
    """
    Returns one clip path per entry in `scene_descriptions` (same order/length),
    each independently matched to *that* scene's own description via CLIP —
    instead of picking N globally-best clips for the whole topic, which tends to
    cluster on whichever single scene Pexels covers best and starve the rest.
    Entries are None where no good match exists (caller should skip/pad those slots).

    `exclude_ids` (Pexels video IDs, see extract_video_id) filters out clips
    already used in an earlier video — agents.used_media_registry tracks these
    across the whole channel, not just within one job.
    """
    os.makedirs(output_dir, exist_ok=True)
    if not scene_descriptions:
        return []
    exclude_ids = exclude_ids or set()

    def _not_excluded(path: str) -> bool:
        vid = extract_video_id(path)
        return vid is None or vid not in exclude_ids

    try:
        from agents.clip_utils import embed_text
    except Exception:
        # No CLIP available: fall back to one Pexels top-hit per scene, no ranking.
        results = []
        for desc in scene_descriptions:
            candidates = [c for c in _fetch_candidates(desc, output_dir, per_query=per_query) if _not_excluded(c)]
            results.append(candidates[0] if candidates else None)
        return results

    used = set()
    results: List[str | None] = []
    for desc in scene_descriptions:
        candidates = _fetch_candidates(desc, output_dir, per_query=per_query)
        candidates = [c for c in candidates if c not in used and _not_excluded(c)]
        if not candidates:
            results.append(None)
            continue
        text_feats = embed_text(desc)
        scored = []
        for path in candidates:
            try:
                video_feats = _embed_video_frame(path)
                scored.append(((video_feats @ text_feats.T).item(), path))
            except Exception:
                continue
        if not scored:
            results.append(None)
            continue
        scored.sort(key=lambda x: x[0], reverse=True)
        best_path = scored[0][1]
        used.add(best_path)
        results.append(best_path)

    return results
