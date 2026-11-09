#!/usr/bin/env python3
"""
main_new.py — LangGraph workflow runner for Agentic YouTube (Node-friendly).

- Started only by the Node server (Workflow page -> server -> this script) with
  --prompt and --job-id; it has no prompt of its own.
- Emits STAGE: markers for each pipeline stage.
- Uses safe UTF-8 printing on stdout/stderr to avoid Windows cp1252 issues.
- Emits structured lines PythonShell can be parsed for by Node: JOB_ID, PROGRESS, VIDEO_PATH, YOUTUBE_ID, COMPLETED, FAILED.
- Added a Captioning node (calls agents.captioned_video.burn_subtitles_with_ffmpeg).
"""

import os
import sys
import sqlite3
import traceback
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel
from langgraph.checkpoint.sqlite import SqliteSaver

# --- ensure stdout/stderr use utf-8 if possible (helps avoid Windows cp1252 errors) ---
try:
    # available in Python 3.7+
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    # fallback: we'll use safe_print which writes bytes to stdout.buffer
    pass

def safe_print(*args, **kwargs):
    """
    Print safely using utf-8 bytes write to stdout.buffer if normal print raises encoding issues.
    Keeps behaviour of print (sep, end).
    """
    sep = kwargs.get("sep", " ")
    end = kwargs.get("end", "\n")
    try:
        # Try normal print first
        print(*args, **kwargs)
    except UnicodeEncodeError:
        try:
            s = sep.join(str(a) for a in args) + end
            sys.stdout.buffer.write(s.encode("utf-8", errors="replace"))
            sys.stdout.buffer.flush()
        except Exception:
            # ultimate fallback: ascii with replacements
            s = sep.join(str(a) for a in args) + end
            sys.stdout.buffer.write(s.encode("ascii", errors="replace"))
            sys.stdout.buffer.flush()

# --- Launch contract ---------------------------------------------------------
# A run starts when a signed-in user submits a prompt on the Workflow page. The
# server validates the prompt, charges the video's credits, creates the VideoJob
# and only then spawns:
#     main_new.py --prompt=<user prompt> --job-id=<VideoJob id>
# with AGENTIC_YT_LAUNCHER=server in the environment. There is no default prompt,
# and running this file by hand refuses to start.
def _parse_launch_args():
    import argparse

    parser = argparse.ArgumentParser(
        description="Agentic YouTube pipeline runner. Started by the server from the Workflow page."
    )
    parser.add_argument("--prompt", required=True, help="the user's prompt from the Workflow page")
    parser.add_argument("--job-id", required=True, help="the VideoJob id the server created")
    # Optional: a Knowledge Hub run. The server writes the selected notes to this
    # file and passes the path. Absent for an ordinary prompt-only run, which
    # behaves exactly as it always has.
    parser.add_argument(
        "--knowledge-file",
        default=None,
        help="JSON file of NexusNotes sources to ground this video in",
    )
    # Per-video settings from the Studio. All optional: omitted means the
    # long-standing defaults, so an old-style launch behaves exactly as before.
    parser.add_argument("--tone", default=None, help="educational | conversational | punchy | storytelling | professional")
    parser.add_argument("--duration", type=int, default=None, help="target video length in seconds")
    parser.add_argument("--voice", default=None, help="narration voice name (Edge-TTS)")
    parser.add_argument(
        "--review-script",
        action="store_true",
        help="pause once the script is final and wait for the user's edit on stdin",
    )
    try:
        args = parser.parse_args()
    except SystemExit:
        safe_print("FAILED:main_new.py must be started by the server with --prompt and --job-id", flush=True)
        raise

    if os.getenv("AGENTIC_YT_LAUNCHER") != "server":
        safe_print(
            "FAILED:main_new.py is not run directly. Start the server and submit a prompt on the Workflow page.",
            flush=True,
        )
        sys.exit(2)

    prompt = (args.prompt or "").strip()
    job_id = (args.job_id or "").strip()
    knowledge_file = (args.knowledge_file or "").strip() or None
    if not prompt or not job_id:
        safe_print("FAILED:The server sent an empty prompt or job id", flush=True)
        sys.exit(2)

    config = _derive_config(args.duration, args.tone, args.voice, args.review_script)
    return prompt, job_id, knowledge_file, config


# Spoken delivery runs at roughly 2.5 words a second, and a shot that holds
# longer than ~9 seconds reads as a slideshow — so both the script budget and
# the number of scenes follow from the requested length.
WORDS_PER_SECOND = 2.5
SECONDS_PER_SCENE = 9
DEFAULT_DURATION_SECONDS = 50


def _derive_config(duration, tone, voice, review_script) -> dict:
    seconds = duration if isinstance(duration, int) and duration > 0 else DEFAULT_DURATION_SECONDS
    seconds = max(15, min(seconds, 900))  # 15s to 15 minutes
    return {
        "duration_seconds": seconds,
        "target_words": int(round(seconds * WORDS_PER_SECOND)),
        "scene_count": max(4, min(14, round(seconds / SECONDS_PER_SCENE))),
        "tone": (tone or "").strip() or None,
        "voice": (voice or "").strip() or None,
        "review_script": bool(review_script),
    }


# Module-level default so the graph can be built even when this file is imported
# rather than launched (the LAUNCH_* globals only exist under __main__).
LAUNCH_CONFIG = _derive_config(None, None, None, False)


if __name__ == "__main__":
    # Check the launch before loading models or building the graph.
    LAUNCH_PROMPT, LAUNCH_JOB_ID, LAUNCH_KNOWLEDGE_FILE, LAUNCH_CONFIG = _parse_launch_args()

# --- Project-relative asset paths ----------------------------------------------
# The project .env lists voice and music assets relative to this folder
# (e.g. XTTS_SPEAKER_WAV=agents/assets/voices/creator), but the server starts this
# script with its own folder as the working directory, where those paths don't
# exist. Make them absolute before any agent reads them. (uploads/... paths are
# meant to live under the server and are left alone.)
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))


def _anchor_project_paths(*keys):
    try:
        from dotenv import dotenv_values

        file_values = dotenv_values(os.path.join(PROJECT_ROOT, ".env"))
    except Exception:
        file_values = {}
    for key in keys:
        value = os.environ.get(key) or file_values.get(key)
        if value and not os.path.isabs(value):
            os.environ[key] = os.path.join(PROJECT_ROOT, value)


_anchor_project_paths("XTTS_SPEAKER_WAV", "PIPER_MODEL_PATH", "MUSIC_LIBRARY_DIR")

# Allow configuration via environment
UPLOAD_DIR = os.getenv("UPLOAD_DIR", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Helper to show timestamps in logs
def timestamp():
    return datetime.utcnow().isoformat() + "Z"

def emit_progress(pct: int):
    try:
        pct_i = int(max(0, min(100, pct)))
    except Exception:
        pct_i = pct
    safe_print(f"PROGRESS:{pct_i}", flush=True)

def emit_kv(key: str, value: str):
    # Generic key:value emitter (JOB_ID, VIDEO_PATH, YOUTUBE_ID, COMPLETED, FAILED, etc)
    safe_print(f"{key}:{value}", flush=True)

def emit_artifact(kind: str, **data):
    """
    Behind-the-scenes update for the Workflow page: one `ARTIFACT:{json}` line per
    thing the pipeline has produced (research, script, scenes, an image, narration,
    a cut, the QA report). File paths are sent as `path`; the server turns them
    into /uploads URLs. Reporting must never break the pipeline.
    """
    try:
        import json

        safe_print("ARTIFACT:" + json.dumps({"kind": kind, **data}, ensure_ascii=False, default=str), flush=True)
    except Exception as e:
        safe_print(f"[{timestamp()}] [artifact] could not report {kind}: {e}")


# Dump top-level environment and runtime info for debugging
safe_print(f"[{timestamp()}] DEBUG: Starting workflow runner")
safe_print(f"[{timestamp()}] DEBUG: CWD={os.getcwd()}")
safe_print(f"[{timestamp()}] DEBUG: sys.executable={sys.executable}")
safe_print(f"[{timestamp()}] DEBUG: PYTHON PATH env PYTHONPATH={os.getenv('PYTHONPATH')}")
safe_print(f"[{timestamp()}] DEBUG: UPLOAD_DIR={os.path.abspath(UPLOAD_DIR)}")
safe_print(f"[{timestamp()}] DEBUG: GROQ_MODEL={os.getenv('GROQ_MODEL')}")
safe_print(f"[{timestamp()}] DEBUG: LANGCHAIN_VERBOSE={os.getenv('LANGCHAIN_VERBOSE')}")

# --- LangGraph state & nodes (adapted to emit progress and extra debugging) ---
MAX_SCRIPT_REVISIONS = int(os.getenv("MAX_SCRIPT_REVISIONS", "2"))


class VideoState(BaseModel):
    user_prompt: str
    # Knowledge Hub runs: the notes this video must be grounded in, and the
    # document titles behind them (kept for attribution on the finished video).
    knowledge_sources: List[dict] = []
    knowledge_titles: List[str] = []
    knowledge_grounded: bool = False
    research_facts: List[str] = []
    research_sources: List[str] = []
    news_date: Optional[str] = None
    news_is_stale: bool = True
    # Per-video settings chosen in the Studio (see _derive_config).
    tone: Optional[str] = None
    target_words: Optional[int] = None
    scene_count: Optional[int] = None
    voice: Optional[str] = None
    script: Optional[str] = None
    hook_text: Optional[str] = None
    critic_issues: List[str] = []
    script_revisions: int = 0
    image_prompts: Optional[List[str]] = None
    image_entities: Optional[List[Optional[str]]] = None
    image_paths: Optional[List[str]] = None
    image_sources: Optional[List[str]] = None  # "real" | "ai", parallel to image_paths
    image_attributions: List[str] = []
    audio_file: Optional[str] = None
    video_path: Optional[str] = None
    video_with_music: Optional[str] = None
    video_with_captions: Optional[str] = None
    qa_report: Optional[dict] = None
    # Packaging the video is published with. Generated from the finished script
    # rather than reusing the raw prompt.
    yt_title: Optional[str] = None
    yt_description: Optional[str] = None
    yt_tags: List[str] = []
    youtube_video_id: Optional[str] = None


NEWS_MODE = os.getenv("NEWS_MODE", "auto").lower()  # auto|always|off


def research_node(state: VideoState) -> dict:
    safe_print("STAGE:Research")
    safe_print(f"[{timestamp()}] ENTER research_node - prompt={state.user_prompt!r}")
    emit_progress(3)

    # --- Knowledge Hub run -------------------------------------------------
    # The user picked their own documents, so those ARE the research. Web search
    # is deliberately skipped: mixing in outside claims would dilute the grounding
    # and make "created from Document A" untrue. Everything downstream is
    # unchanged — the facts use the same format research produces.
    if state.knowledge_sources:
        try:
            from agents.knowledge_grounding import build_grounded_facts

            grounded = build_grounded_facts(state.user_prompt, state.knowledge_sources)
            if grounded["facts"]:
                safe_print(
                    f"[{timestamp()}] [research] Grounded in {len(grounded['sources'])} "
                    f"document(s): {grounded['sources']} ({len(grounded['facts'])} facts)"
                )
                emit_artifact(
                    "research",
                    facts=grounded["facts"],
                    sources=grounded["sources"],
                    newsDate=None,
                    grounded=True,
                )
                emit_progress(8)
                safe_print(f"[{timestamp()}] EXIT research_node - grounded in user knowledge")
                return {
                    "research_facts": grounded["facts"],
                    "research_sources": grounded["sources"],
                    "knowledge_titles": grounded["sources"],
                    "knowledge_grounded": True,
                    "news_date": None,
                    "news_is_stale": True,
                }

            # Nothing usable in the notes: fall through to normal web research
            # rather than handing the script writer an empty fact set.
            safe_print(
                f"[{timestamp()}] [research] WARNING: selected notes yielded no facts; "
                f"falling back to web research."
            )
        except Exception as e:
            safe_print(f"[{timestamp()}] [research] knowledge grounding failed ({e}); falling back to web research.")

    # Try dedicated news search first (real publish dates, actual recency) — the
    # general research_agent below leans on Wikipedia, which skews toward settled,
    # months/years-old information and is the wrong tool for "what happened this week".
    news_facts, news_sources, news_date, is_stale = [], [], None, True
    if NEWS_MODE != "off":
        try:
            from agents.news_agent import research_latest_news

            news_result = research_latest_news(state.user_prompt)
            news_facts = news_result["facts"]
            news_sources = news_result["sources"]
            news_date = news_result["most_recent_date"]
            is_stale = news_result["is_stale"]
        except Exception as e:
            safe_print(f"[{timestamp()}] [research] news_agent failed, continuing without it: {e}")

    try:
        from agents.research_agent import research_topic

        # Skip the slower general ReAct research pass entirely once dedicated news
        # search already found real, dated coverage — nothing left for it to add.
        if news_facts and NEWS_MODE != "always":
            facts, sources = news_facts, news_sources
        else:
            result = research_topic(state.user_prompt)
            facts = news_facts + result["facts"]
            sources = news_sources + result["sources"]

        safe_print(f"[{timestamp()}] [research] Gathered {len(facts)} facts (news_date={news_date}, stale={is_stale}) from sources: {sources}")

        emit_artifact("research", facts=facts, sources=sources, newsDate=None if is_stale else news_date)
        emit_progress(8)
        safe_print(f"[{timestamp()}] EXIT research_node - success")
        return {
            "research_facts": facts,
            "research_sources": sources,
            "news_date": news_date,
            "news_is_stale": is_stale,
        }

    except Exception as e:
        tb = traceback.format_exc()
        safe_print(f"[{timestamp()}] [research] WARNING: research failed, continuing without facts: {e}")
        safe_print(tb)
        return {"research_facts": [], "research_sources": []}


def script_writer_node(state: VideoState) -> dict:
    safe_print("STAGE:Script Writing")
    safe_print(f"[{timestamp()}] ENTER script_writer_node - revision={state.script_revisions}")
    emit_progress(10)
    try:
        from agents.script_writer import write_script

        feedback = "; ".join(state.critic_issues) if state.critic_issues else None
        script = write_script(
            state.user_prompt,
            facts=state.research_facts,
            feedback=feedback,
            news_date=None if state.news_is_stale else state.news_date,
            tone=state.tone,
            target_words=state.target_words,
        )
        safe_print(f"[{timestamp()}] [script_writer] Script length: {len(script) if script else 0}")
        safe_print(f"[{timestamp()}] [script_writer] Script preview: {repr((script or '')[:200])}")

        emit_artifact("script", text=script or "", revision=state.script_revisions + 1)
        emit_progress(13)
        safe_print(f"[{timestamp()}] EXIT script_writer_node - success")
        return {"script": script}

    except Exception as e:
        tb = traceback.format_exc()
        err_msg = f"script_writer_node failed: {type(e).__name__}: {e}"
        safe_print(f"[{timestamp()}] [ERROR] {err_msg}")
        safe_print(f"[{timestamp()}] FAILED:{err_msg}")
        safe_print(tb)
        raise


def critic_node(state: VideoState) -> dict:
    safe_print("STAGE:Script Review")
    safe_print(f"[{timestamp()}] ENTER critic_node - revision={state.script_revisions}")
    emit_progress(14)
    try:
        from agents.critic import critique_script

        verdict = critique_script(state.user_prompt, state.research_facts, state.script or "")
        safe_print(f"[{timestamp()}] [critic] passed={verdict['passed']} issues={verdict['issues']}")
        emit_artifact("critic", passed=bool(verdict["passed"]), issues=list(verdict["issues"] or []), revision=state.script_revisions + 1)
        safe_print(f"[{timestamp()}] EXIT critic_node - success")
        return {"critic_issues": verdict["issues"] if not verdict["passed"] else [], "script_revisions": state.script_revisions + 1}

    except Exception as e:
        safe_print(f"[{timestamp()}] [critic] WARNING: critic failed, accepting script as-is: {e}")
        return {"critic_issues": [], "script_revisions": state.script_revisions + 1}


def route_after_critic(state: VideoState) -> str:
    if state.critic_issues and state.script_revisions < MAX_SCRIPT_REVISIONS:
        safe_print(f"[{timestamp()}] [critic] Requesting revision {state.script_revisions + 1}/{MAX_SCRIPT_REVISIONS}: {state.critic_issues}")
        return "script_writer"
    return "image_prompts"


def image_prompts_node(state: VideoState) -> dict:
    safe_print("STAGE:Image Prompt Planning")
    safe_print(f"[{timestamp()}] ENTER image_prompts_node")
    emit_progress(16)
    try:
        from agents.script_writer import generate_image_prompts, generate_hook_text

        scenes = generate_image_prompts(
            state.user_prompt, script=state.script, scene_count=state.scene_count
        )
        prompts = [s["prompt"] for s in scenes]
        entities = [s["entity"] for s in scenes]
        safe_print(f"[{timestamp()}] [image_prompts] Parsed {len(prompts)} image prompts: {prompts}")
        if not prompts:
            raise RuntimeError("The scene planner returned no image prompts, so there is nothing to generate visuals from.")
        tagged = [(i, e) for i, e in enumerate(entities) if e]
        if tagged:
            safe_print(f"[{timestamp()}] [image_prompts] Real-photo entities tagged: {tagged}")

        hook_text = generate_hook_text(state.user_prompt, state.script or "")
        safe_print(f"[{timestamp()}] [image_prompts] On-screen hook: {hook_text!r}")

        emit_artifact("scenes", prompts=prompts, hook=hook_text)
        emit_progress(18)
        safe_print(f"[{timestamp()}] EXIT image_prompts_node - success")
        return {"image_prompts": prompts, "image_entities": entities, "hook_text": hook_text}

    except Exception as e:
        tb = traceback.format_exc()
        err_msg = f"image_prompts_node failed: {type(e).__name__}: {e}"
        safe_print(f"[{timestamp()}] [ERROR] {err_msg}")
        safe_print(f"[{timestamp()}] FAILED:{err_msg}")
        safe_print(tb)
        raise

def image_generation_node(state: VideoState) -> dict:
    safe_print("STAGE:Image Generation")
    safe_print(f"[{timestamp()}] ENTER image_generation_node - prompts={state.image_prompts}")
    emit_progress(20)
    try:
        from agents.image_generation import generate_images, unload_pipeline
        out_dir = os.path.join(UPLOAD_DIR, "generated_images")
        safe_print(f"[{timestamp()}] [image_generation] saving to out_dir={out_dir}")

        prompts = state.image_prompts or []
        entities = state.image_entities or [None] * len(prompts)

        # Try a real, properly-licensed photo for EVERY scene, not just ones the
        # script writer explicitly tagged with a named product — an LLM-tagged
        # entity is a strong hit ("NVIDIA H200"), but a real, relevant photo often
        # exists for a scene's general subject too. Falls back to AI generation
        # per-scene wherever no suitably licensed (and not-already-used-in-an-
        # earlier-video) photo is found.
        slots: list[str | None] = [None] * len(prompts)
        sources: list[str] = ["ai"] * len(prompts)
        attributions: list[str] = []
        try:
            from agents.real_image_agent import fetch_real_entity_image
            from agents.used_media_registry import get_used_photo_urls, mark_photos_used

            used_urls = get_used_photo_urls()
            newly_used = []
            for i, prompt in enumerate(prompts):
                query = entities[i] or prompt
                real_path = os.path.join(out_dir, f"real_{i+1:02d}.jpg")
                result = fetch_real_entity_image(query, real_path, exclude_urls=used_urls)
                if result:
                    slots[i] = os.path.abspath(real_path)
                    sources[i] = "real"
                    emit_artifact("image", index=i, path=slots[i], source="real", prompt=prompts[i])
                    newly_used.append(result["url"])
                    attributions.append(f"Scene {i+1} ({query}): {result['attribution']} — {result['source_page']}")
                else:
                    safe_print(f"[{timestamp()}] [image_generation] No usable licensed photo for {query!r}; scene {i+1} will be AI-generated")
            mark_photos_used(newly_used)
        except Exception as e:
            safe_print(f"[{timestamp()}] [image_generation] real-photo sourcing unavailable ({e}); all scenes will be AI-generated")

        remaining_indices = [i for i, p in enumerate(slots) if p is None]
        if remaining_indices:
            remaining_prompts = [prompts[i] for i in remaining_indices]
            generated = generate_images(remaining_prompts, num_images_per_prompt=1, output_dir=out_dir)
            for idx, path in zip(remaining_indices, generated):
                slots[idx] = os.path.abspath(path)
                emit_artifact("image", index=idx, path=slots[idx], source="ai", prompt=prompts[idx])
            unload_pipeline()  # free VRAM for the next GPU-heavy stage (6GB card)

        paths = [p for p in slots if p]
        real_count = sources.count("real")
        safe_print(f"[{timestamp()}] [image_generation] Final {len(paths)} images ({real_count} real, {len(paths) - real_count} AI-generated): {paths}")

        emit_progress(45)
        safe_print(f"[{timestamp()}] EXIT image_generation_node - success")
        return {"image_paths": paths, "image_sources": sources, "image_attributions": attributions}

    except Exception as e:
        tb = traceback.format_exc()
        err_msg = f"image_generation_node failed: {type(e).__name__}: {e}"
        safe_print(f"[{timestamp()}] [ERROR] {err_msg}")
        safe_print(f"[{timestamp()}] FAILED:{err_msg}")
        safe_print(tb)
        raise

def text_to_speech_node(state: VideoState) -> dict:
    safe_print("STAGE:Text to Speech")
    safe_print(f"[{timestamp()}] ENTER text_to_speech_node")
    emit_progress(48)
    try:
        from agents.text_to_speech import generate_audio, unload_engine
        audio_local = os.path.join(UPLOAD_DIR, "script_audio.mp3")
        safe_print(f"[{timestamp()}] [text_to_speech] generating audio to {audio_local}")
        # A named voice routes to Edge-TTS, the only engine that can honour one.
        audio = generate_audio(state.script, output_path=audio_local, voice=state.voice)
        audio = os.path.abspath(audio)
        # Every engine can "succeed" with an empty or corrupt file (e.g. Edge-TTS given no text);
        # catch it here instead of minutes later when the video step can't read it.
        if not os.path.exists(audio) or os.path.getsize(audio) < 2048:
            raise RuntimeError(f"Narration audio is missing or empty: {audio}")
        safe_print(f"[{timestamp()}] [text_to_speech] Audio file saved at: {audio}")
        unload_engine()  # free VRAM for the next GPU-heavy stage (6GB card)

        emit_artifact("audio", path=audio)
        emit_progress(65)
        safe_print(f"[{timestamp()}] EXIT text_to_speech_node - success")
        return {"audio_file": audio}

    except Exception as e:
        tb = traceback.format_exc()
        err_msg = f"text_to_speech_node failed: {type(e).__name__}: {e}"
        safe_print(f"[{timestamp()}] [MSG] {err_msg}")
        safe_print(f"[{timestamp()}] FAILED:{err_msg}")
        safe_print(tb)
        raise

def video_generation_node(state: VideoState) -> dict:
    safe_print("STAGE:Video Generation")
    safe_print(f"[{timestamp()}] ENTER video_generation_node - images={state.image_paths} audio={state.audio_file}")
    emit_progress(68)
    try:
        from agents.video_generation import generate_animated_video_with_stock
        out_video = os.path.join(UPLOAD_DIR, "final_video.mp4")
        safe_print(f"[{timestamp()}] [video_generation] calling generate_animated_video_with_stock -> output={out_video}")
        path = generate_animated_video_with_stock(
            topic=state.user_prompt,
            image_paths=state.image_paths or [],
            audio_path=state.audio_file,
            output_path=out_video,
            scene_descriptions=state.image_prompts or None,
            image_sources=state.image_sources or None,
            hook_text=state.hook_text or state.user_prompt,
        )
        path = os.path.abspath(path)
        safe_print(f"[{timestamp()}] [video_generation] Video generated at: {path}")

        emit_kv("VIDEO_PATH", path)
        emit_artifact("video", path=path, variant="draft")
        emit_progress(82)
        safe_print(f"[{timestamp()}] EXIT video_generation_node - success")
        return {"video_path": path}

    except Exception as e:
        tb = traceback.format_exc()
        err_msg = f"video_generation_node failed: {type(e).__name__}: {e}"
        safe_print(f"[{timestamp()}] [MSG] {err_msg}")
        safe_print(f"[{timestamp()}] FAILED:{err_msg}")
        safe_print(tb)
        raise

def bg_music_node(state: VideoState) -> dict:
    safe_print("STAGE:Adding Background Music")
    input_vid = state.video_path
    safe_print(f"[{timestamp()}] ENTER bg_music_node - video_path={input_vid}")
    emit_progress(84)
    try:
        from agents.bg_music import add_background_music_to_video, pick_music_for_script

        bg_asset = pick_music_for_script(state.script or "")
        if bg_asset:
            safe_print(f"[{timestamp()}] [bg_music] Mood-matched track selected: {bg_asset}")

        # Fall back to a single static asset if no mood library is configured
        if not bg_asset:
            possible_assets = [
                os.path.join(os.path.dirname(__file__), "assets", "bg_music_1.mp3"),
                os.path.join("assets", "bg_music_1.mp3"),
                os.path.join(os.path.dirname(__file__), "agents", "assets", "bg_music_1.mp3"),
            ]
            for p in possible_assets:
                if os.path.exists(p):
                    bg_asset = p
                    break

        if not bg_asset:
            safe_print(f"[{timestamp()}] [bg_music] WARNING: bg_music_1.mp3 not found. Skipping background music mixing.")
            emit_progress(93)
            return {"video_with_music": input_vid}

        safe_print(f"[{timestamp()}] [bg_music] Using bg_asset: {bg_asset}")
        out_with_music = os.path.join(UPLOAD_DIR, "video_with_music.mp4")
        safe_print(f"[{timestamp()}] [bg_music] calling add_background_music_to_video -> output={out_with_music}")
        
        path = add_background_music_to_video(
            video_path=input_vid,
            bg_music_path=bg_asset,
            output_path=out_with_music
        )
        path = os.path.abspath(path)
        safe_print(f"[{timestamp()}] [bg_music] Music-mixed video at: {path}")

        emit_kv("VIDEO_PATH", path)
        emit_artifact("video", path=path, variant="music")
        emit_progress(93)
        safe_print(f"[{timestamp()}] EXIT bg_music_node - success")
        return {"video_with_music": path}

    except Exception as e:
        safe_print(f"[{timestamp()}] [bg_music] ERROR during mixing: {e}. Skipping music step to avoid workflow failure.")
        # If music fails, we still want to proceed with the original video
        return {"video_with_music": input_vid}

# ---- Captioning node: faster-whisper word-level transcription -> karaoke ASS captions ----
def captioning_node(state: VideoState) -> dict:
    """
    Transcribes the actual narration audio with faster-whisper to get real word-level
    timestamps, then burns karaoke-style captions via agents.captioned_video.burn_word_level_captions.
    Replaces the old approach of guessing caption timing from sentence splitting + a
    chars-per-second heuristic — captions are now synced to what was actually said.
    """
    safe_print("STAGE:Captioning")
    safe_print(f"[{timestamp()}] ENTER captioning_node - input video={state.video_with_music} audio={state.audio_file}")
    emit_progress(94)
    try:
        input_video = state.video_with_music or state.video_path
        if not input_video or not os.path.exists(input_video):
            raise FileNotFoundError("No input video available for captioning")
        if not state.audio_file or not os.path.exists(state.audio_file):
            raise FileNotFoundError("No narration audio available for caption transcription")

        from agents.captioned_video import burn_word_level_captions

        out_captioned = os.path.join(UPLOAD_DIR, "video_with_captions.mp4")
        safe_print(f"[{timestamp()}] captioning: transcribing {state.audio_file} and burning karaoke captions -> {out_captioned}")
        result_path = burn_word_level_captions(
            video_path=input_video,
            audio_path=state.audio_file,
            output_path=out_captioned,
        )
        result_path = os.path.abspath(result_path)
        safe_print(f"[{timestamp()}] captioning: captioned video created at: {result_path}")

        # update state to point to captioned file so uploader picks it
        emit_kv("VIDEO_PATH", result_path)
        emit_artifact("video", path=result_path, variant="captions")
        emit_progress(96)
        safe_print(f"[{timestamp()}] EXIT captioning_node - success")
        return {"video_with_captions": result_path, "video_with_music": result_path}

    except Exception as e:
        tb = traceback.format_exc()
        err_msg = f"captioning_node failed: {type(e).__name__}: {e}"
        safe_print(f"[{timestamp()}] [ERROR] {err_msg}")
        safe_print(tb)
        safe_print(f"[{timestamp()}] Captioning failed. Continuing with original video.")
        # Proceed without captions if it fails
        return {"video_with_captions": state.video_with_music or state.video_path}


QA_MIN_CLIP_SCORE = float(os.getenv("QA_MIN_CLIP_SCORE", "0.15"))
QA_MAX_DURATION_DRIFT = float(os.getenv("QA_MAX_DURATION_DRIFT_SEC", "3.0"))


def qa_node(state: VideoState) -> dict:
    """
    Final quality gate: aggregates audio/video length match, average image/prompt
    CLIP score, and output-file presence into one pass/fail report. This is the
    concrete "transparency" deliverable — a machine-checkable record of whether the
    job's own outputs hold together, persisted in the job's checkpoint state.
    """
    safe_print("STAGE:Quality Review")
    final_video = state.video_with_captions or state.video_with_music or state.video_path
    safe_print(f"[{timestamp()}] ENTER qa_node - final_video={final_video}")
    emit_progress(97)
    try:
        from agents.qa_agent import run_qa

        report = run_qa(
            final_video_path=final_video,
            audio_path=state.audio_file,
            image_paths=state.image_paths,
            image_prompts=state.image_prompts,
            max_duration_drift_sec=QA_MAX_DURATION_DRIFT,
            min_clip_score=QA_MIN_CLIP_SCORE,
        )
        safe_print(f"[{timestamp()}] [qa] passed={report['passed']} checks={report['checks']} issues={report['issues']}")
        emit_artifact("qa", passed=bool(report["passed"]), checks=report.get("checks", {}), issues=list(report.get("issues") or []))
        emit_progress(98)
        safe_print(f"[{timestamp()}] EXIT qa_node - success")
        return {"qa_report": report}
    except Exception as e:
        safe_print(f"[{timestamp()}] [qa] WARNING: QA check failed to run, allowing upload: {e}")
        return {"qa_report": {"passed": True, "checks": {}, "issues": [f"qa_unavailable: {e}"]}}


def youtube_metadata_node(state: VideoState) -> dict:
    """
    Write the title, description and tags the video is published with.

    This used to be skipped entirely: every upload went out titled with the raw
    prompt, described by the first 200 characters of the script, and tagged
    ["AI", "autogen", "youtube"]. Runs just before upload so it can use the
    finished script and the facts that actually made it into the video.
    """
    safe_print("STAGE:Packaging")
    safe_print(f"[{timestamp()}] ENTER youtube_metadata_node")
    emit_progress(99)
    try:
        from agents.youtube_metadata import build_metadata

        meta = build_metadata(
            topic=state.user_prompt,
            script=state.script or "",
            facts=state.research_facts,
            knowledge_titles=state.knowledge_titles,
        )
        safe_print(f"[{timestamp()}] [packaging] title={meta['title']!r} tags={meta['tags']}")
        emit_artifact("metadata", title=meta["title"], description=meta["description"], tags=meta["tags"])
        safe_print(f"[{timestamp()}] EXIT youtube_metadata_node - success")
        return {"yt_title": meta["title"], "yt_description": meta["description"], "yt_tags": meta["tags"]}

    except Exception as e:
        # Packaging must never block a finished video: the uploader falls back
        # to the old behaviour if these stay unset.
        safe_print(f"[{timestamp()}] [packaging] WARNING: could not build metadata: {e}")
        return {}


def upload_to_YT_node(state: VideoState) -> dict:
    safe_print("STAGE:Upload to YouTube")
    file_to_upload = state.video_with_captions or state.video_with_music or state.video_path
    safe_print(f"[{timestamp()}] ENTER upload_to_YT_node - file={file_to_upload}")
    emit_progress(95)
    try:
        if state.qa_report and not state.qa_report.get("passed", True):
            safe_print(f"[{timestamp()}] [upload_to_YT] BLOCKED: QA gate failed: {state.qa_report.get('issues')}")
            emit_kv("COMPLETED", os.path.abspath(file_to_upload) if file_to_upload else "")
            return {"youtube_video_id": None}

        # Check for credentials presence to avoid interactive hang
        creds_path = "youtube_credentials.pkl"
        if not os.path.exists(creds_path):
            safe_print(f"[{timestamp()}] [upload_to_YT] ERROR: {creds_path} not found. Skipping upload to avoid interactive hang.")
            safe_print(f"[{timestamp()}] [upload_to_YT] Please run authentication manually before using server-side upload.")
            emit_kv("COMPLETED", os.path.abspath(file_to_upload))
            return {"youtube_video_id": None}

        from agents.upload_to_YT import upload_video

        # Prefer captioned video if present
        file_to_upload = state.video_with_captions or state.video_with_music or state.video_path
        if not file_to_upload or not os.path.exists(file_to_upload):
            raise FileNotFoundError("No final video file found for upload")

        # Generated packaging when the metadata node produced it; the old
        # prompt/script-slice behaviour only as a fallback.
        response = upload_video(
            file_path=file_to_upload,
            title=state.yt_title or state.user_prompt,
            description=state.yt_description or (state.script or "")[:200],
            tags=state.yt_tags or ["AI", "autogen", "youtube"],
            privacy_status="public"
        )
        safe_print(f"[{timestamp()}] [upload_to_YT] uploader response type={type(response)}")

        youtube_id = None
        try:
            if isinstance(response, dict):
                youtube_id = response.get("id") or response.get("youtubeVideoId") or response.get("videoId")
            elif isinstance(response, str):
                youtube_id = response
            else:
                youtube_id = getattr(response, "id", None)
        except Exception:
            youtube_id = None

        if youtube_id:
            emit_kv("YOUTUBE_ID", str(youtube_id))
            safe_print(f"[{timestamp()}] [upload_to_YT] Uploaded video ID: {youtube_id}")
        else:
            safe_print(f"[{timestamp()}] [upload_to_YT] Uploader returned (summary): {str(response)[:200]}")

        emit_progress(100)
        final_path = file_to_upload
        if final_path:
            emit_kv("COMPLETED", os.path.abspath(final_path))

        safe_print(f"[{timestamp()}] EXIT upload_to_YT_node - success")
        return {"youtube_video_id": youtube_id}

    except Exception as e:
        tb = traceback.format_exc()
        err_msg = f"upload_to_YT_node failed: {type(e).__name__}: {e}"
        safe_print(f"[{timestamp()}] [MSG] {err_msg}")
        safe_print(f"[{timestamp()}] FAILED:{err_msg}")
        safe_print(tb)
        raise

# --- LangGraph setup: research -> script -> critic (loop) -> image prompts -> [images || tts] -> video -> music -> captions -> upload ---
from langgraph.graph import StateGraph, END

builder = StateGraph(VideoState)

builder.add_node("research", research_node)
builder.add_node("script_writer", script_writer_node)
builder.add_node("critic", critic_node)
builder.add_node("image_prompts", image_prompts_node)
builder.add_node("image_generation", image_generation_node)
builder.add_node("text_to_speech", text_to_speech_node)
builder.add_node("video_generation", video_generation_node)
builder.add_node("bg_music", bg_music_node)
builder.add_node("captioning", captioning_node)
builder.add_node("qa", qa_node)
builder.add_node("youtube_metadata", youtube_metadata_node)
builder.add_node("upload_to_YT", upload_to_YT_node)

builder.set_entry_point("research")

builder.add_edge("research", "script_writer")
builder.add_edge("script_writer", "critic")
builder.add_conditional_edges(
    "critic",
    route_after_critic,
    {"script_writer": "script_writer", "image_prompts": "image_prompts"},
)
# image_generation and text_to_speech are deliberately SEQUENTIAL, not parallel:
# LangGraph runs same-superstep nodes concurrently, and SDXL-Turbo + XTTS-v2 loaded
# at the same time exhausts a 6GB card. Running them back-to-back lets each unload
# before the next loads.
builder.add_edge("image_prompts", "image_generation")
builder.add_edge("image_generation", "text_to_speech")
builder.add_edge("text_to_speech", "video_generation")
builder.add_edge("video_generation", "bg_music")
builder.add_edge("bg_music", "captioning")
builder.add_edge("captioning", "qa")
builder.add_edge("qa", "youtube_metadata")
builder.add_edge("youtube_metadata", "upload_to_YT")
builder.add_edge("upload_to_YT", END)

# Persist full state history per job for auditability/transparency (Stage 1 goal).
CHECKPOINT_DB = os.getenv("CHECKPOINT_DB", os.path.join(UPLOAD_DIR, "job_checkpoints.sqlite"))
_checkpoint_conn = sqlite3.connect(CHECKPOINT_DB, check_same_thread=False)
_checkpointer = SqliteSaver(_checkpoint_conn)

# Opt-in script review: stop once the script is settled so the user can edit it
# before any GPU time is spent on visuals, narration and video. Off by default,
# so an ordinary run is untouched.
_INTERRUPT_AFTER = ["critic"] if LAUNCH_CONFIG.get("review_script") else []
graph = builder.compile(checkpointer=_checkpointer, interrupt_after=_INTERRUPT_AFTER)

# --- Entrypoint / CLI handling ---
def _load_knowledge(path: str | None) -> list:
    """
    Read the sources the server selected for a Knowledge Hub run.
    Returns [] for an ordinary run, or if the file is unreadable — in which case
    the pipeline simply researches the topic on the web as it always did.
    """
    if not path:
        return []
    try:
        import json

        with open(path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        sources = payload.get("sources") or []
        safe_print(f"[{timestamp()}] DEBUG: Loaded {len(sources)} knowledge source(s) from {path}")
        return sources
    except Exception as e:
        safe_print(f"[{timestamp()}] [knowledge] Could not read {path}: {e}. Continuing without it.")
        return []


def _await_script_edit(draft: str) -> Optional[str]:
    """
    Hand the finished draft to the Studio and wait for what comes back.

    The server keeps this process's stdin open and writes a single JSON line:
      {"script": "<edited text>"}   use this instead of the draft
      {"script": null}              accept the draft as written
      {"cancel": true}              abandon the run

    Returns the script to use, or None to cancel. Closed stdin (a server that
    died, or a launch without the handshake) means proceeding with the draft —
    the pipeline must never hang forever waiting for an editor that is not there.
    """
    import json

    emit_artifact("script_review", text=draft or "")
    safe_print(f"SCRIPT_REVIEW:{len(draft or '')}", flush=True)
    safe_print(f"[{timestamp()}] [review] Waiting for the edited script…")

    try:
        line = sys.stdin.readline()
    except Exception as e:
        safe_print(f"[{timestamp()}] [review] Could not read the reply ({e}); using the draft.")
        return draft

    if not line:
        safe_print(f"[{timestamp()}] [review] No reply (stdin closed); using the draft.")
        return draft

    try:
        reply = json.loads(line.strip() or "{}")
    except Exception:
        safe_print(f"[{timestamp()}] [review] Unreadable reply; using the draft.")
        return draft

    if reply.get("cancel"):
        return None

    edited = reply.get("script")
    if isinstance(edited, str) and edited.strip():
        safe_print(f"[{timestamp()}] [review] Using the edited script ({len(edited)} chars).")
        return edited.strip()

    safe_print(f"[{timestamp()}] [review] Draft accepted unchanged.")
    return draft


def _run_graph(initial_state, run_config):
    """
    Run the pipeline, honouring an opt-in pause for script review.

    The critic loops, so the graph stops after every critic pass. Only the pass
    that is about to move on to the visuals represents a final script — earlier
    stops are just revisions and are resumed without troubling the user.
    """
    result = graph.invoke(initial_state, config=run_config)

    while True:
        snapshot = graph.get_state(run_config)
        pending = list(snapshot.next or ())
        if not pending:
            return result  # the run finished

        if "image_prompts" in pending:
            draft = (snapshot.values or {}).get("script") or ""
            edited = _await_script_edit(draft)
            if edited is None:
                safe_print(f"[{timestamp()}] [review] Cancelled by the user.")
                emit_kv("FAILED", "Cancelled during script review")
                sys.exit(1)
            if edited != draft:
                graph.update_state(run_config, {"script": edited})
                emit_artifact("script", text=edited, revision=0)

        result = graph.invoke(None, config=run_config)


def _main():
    # All come from the server (see _parse_launch_args) — there is no default prompt.
    prompt, job_id = LAUNCH_PROMPT, LAUNCH_JOB_ID
    emit_kv("JOB_ID", job_id)
    safe_print(f"[{timestamp()}] DEBUG: Emitted JOB_ID={job_id}")
    safe_print(f"[{timestamp()}] DEBUG: config={LAUNCH_CONFIG}")

    from agents.observability import get_langfuse_callbacks

    knowledge_sources = _load_knowledge(LAUNCH_KNOWLEDGE_FILE)
    initial_state = VideoState(
        user_prompt=prompt,
        knowledge_sources=knowledge_sources,
        tone=LAUNCH_CONFIG.get("tone"),
        target_words=LAUNCH_CONFIG.get("target_words"),
        scene_count=LAUNCH_CONFIG.get("scene_count"),
        voice=LAUNCH_CONFIG.get("voice"),
    )
    run_config = {
        "configurable": {"thread_id": job_id},
        "callbacks": get_langfuse_callbacks(),
    }

    try:
        emit_progress(0)
        safe_print(f"[{timestamp()}] Invoking workflow now... (prompt={prompt!r})")
        result = _run_graph(initial_state, run_config)

        # result may contain youtube_video_id and final paths
        final_vid = result.get("video_with_captions") or result.get("video_with_music") or result.get("video_path")
        if final_vid:
            emit_kv("VIDEO_PATH", os.path.abspath(final_vid))
            emit_kv("COMPLETED", os.path.abspath(final_vid))
            safe_print(f"[{timestamp()}] DEBUG: Emitted final paths: {final_vid}")
        if result.get("youtube_video_id"):
            emit_kv("YOUTUBE_ID", str(result["youtube_video_id"]))
            safe_print(f"[{timestamp()}] DEBUG: Emitted YOUTUBE_ID={result['youtube_video_id']}")
        if result.get("qa_report"):
            safe_print(f"[{timestamp()}] QA_REPORT:{result['qa_report']}")
        if result.get("image_attributions"):
            safe_print(f"[{timestamp()}] IMAGE_ATTRIBUTIONS:{result['image_attributions']}")
        if not result.get("news_is_stale", True) and result.get("news_date"):
            safe_print(f"[{timestamp()}] NEWS_DATE:{result['news_date']}")

        safe_print(f"[{timestamp()}] Workflow finished. Summary keys: {list(result.keys())}")
    except Exception as e:
        tb = traceback.format_exc()
        safe_print(f"[{timestamp()}] [ERROR] Workflow failed: {str(e)}")
        emit_kv("FAILED", str(e))
        # print traceback separately
        safe_print(tb)
        # non-zero exit for Node to detect
        sys.exit(1)

if __name__ == "__main__":
    _main()
