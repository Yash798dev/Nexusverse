"""
agents/used_media_registry.py — Cross-video "don't repeat this clip/photo" memory.

Without this, two different videos on the channel could easily pull the same
Pexels stock clip or the same Commons photo for a similar topic — a real
audience-facing problem for a channel publishing multiple videos on adjacent
subjects (e.g. several AI-chip videos). This persists used source URLs across
ALL jobs (not per-job — a JSON file on disk, not pipeline state) so later videos
exclude anything already used in an earlier one.

Note: this is about cross-VIDEO repetition. Within a single video, the same
asset legitimately reappears across several fast cuts (agents.video_generation's
shot cycling) when the asset pool is smaller than the shot count — that's a
separate, intentional design already in place, not what this guards against.
"""

import json
import os
import threading

REGISTRY_PATH = os.getenv(
    "USED_MEDIA_REGISTRY_PATH",
    os.path.join(os.path.dirname(__file__), "..", "uploads", "used_media_registry.json"),
)
_lock = threading.Lock()


def _load() -> dict:
    if not os.path.exists(REGISTRY_PATH):
        return {"photos": [], "videos": []}
    try:
        with open(REGISTRY_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        data.setdefault("photos", [])
        data.setdefault("videos", [])
        return data
    except Exception:
        return {"photos": [], "videos": []}


def _save(data: dict):
    os.makedirs(os.path.dirname(REGISTRY_PATH), exist_ok=True)
    with open(REGISTRY_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1)


def get_used_photo_urls() -> set:
    with _lock:
        return set(_load()["photos"])


def get_used_video_urls() -> set:
    with _lock:
        return set(_load()["videos"])


def mark_photos_used(urls: list[str]):
    if not urls:
        return
    with _lock:
        data = _load()
        data["photos"] = list(set(data["photos"]) | set(urls))
        _save(data)


def mark_videos_used(urls: list[str]):
    if not urls:
        return
    with _lock:
        data = _load()
        data["videos"] = list(set(data["videos"]) | set(urls))
        _save(data)
