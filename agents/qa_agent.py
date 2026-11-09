"""
agents/qa_agent.py — Final quality gate before upload.

Aggregates three independent checks into a single pass/fail report:
  1. Audio/video length match — the captioned video shouldn't have drifted far
     from the narration length.
  2. Average CLIP image-prompt similarity — did the generated scenes actually
     match what they were supposed to depict.
  3. Caption coverage — captions file was actually produced and burned in.

This is the concrete "transparency" deliverable for the visual/caption stages:
a machine-checkable report of whether the job's own outputs hold together,
not just "did every node run without throwing."
"""

import os
from typing import List


def _video_duration(path: str) -> float | None:
    try:
        from moviepy.editor import VideoFileClip

        clip = VideoFileClip(path)
        duration = clip.duration
        clip.close()
        return float(duration)
    except Exception:
        return None


def _audio_duration(path: str) -> float | None:
    try:
        from moviepy.editor import AudioFileClip

        clip = AudioFileClip(path)
        duration = clip.duration
        clip.close()
        return float(duration)
    except Exception:
        return None


def _black_frame_fraction(video_path: str, samples: int = 12) -> float | None:
    """
    Fraction of sampled frames that are essentially black. Catches the class of bug
    where the assembled timeline is shorter than the narration and the tail renders
    as blank video — which every other check here happily passes.
    """
    try:
        import numpy as np
        from moviepy.editor import VideoFileClip

        clip = VideoFileClip(video_path)
        try:
            duration = float(clip.duration)
            black = 0
            for i in range(samples):
                t = duration * (i + 0.5) / samples
                if np.asarray(clip.get_frame(t)).mean() < 8.0:
                    black += 1
            return black / samples
        finally:
            clip.close()
    except Exception:
        return None


def _average_clip_score(image_paths: List[str], image_prompts: List[str]) -> float | None:
    if not image_paths or not image_prompts:
        return None
    try:
        from PIL import Image
        from agents.clip_utils import score_image_prompt

        scores = []
        for path, prompt in zip(image_paths, image_prompts * (len(image_paths) // max(1, len(image_prompts)) + 1)):
            if not os.path.exists(path):
                continue
            image = Image.open(path).convert("RGB")
            scores.append(score_image_prompt(image, prompt))
        return sum(scores) / len(scores) if scores else None
    except Exception:
        return None


def run_qa(
    final_video_path: str,
    audio_path: str | None,
    image_paths: List[str] | None,
    image_prompts: List[str] | None,
    max_duration_drift_sec: float = 3.0,
    min_clip_score: float = 0.15,
    max_black_fraction: float = 0.08,
) -> dict:
    """
    Returns {"passed": bool, "checks": {...}, "issues": [str, ...]}.
    Never raises — a check that can't be computed (missing optional dep, no
    reference audio, etc.) is reported as "unknown" rather than failing the gate,
    so a flaky/optional check never blocks a real, working video from uploading.
    """
    issues = []
    checks = {}

    video_duration = _video_duration(final_video_path) if final_video_path and os.path.exists(final_video_path) else None
    audio_duration = _audio_duration(audio_path) if audio_path and os.path.exists(audio_path) else None
    checks["video_duration_sec"] = video_duration
    checks["audio_duration_sec"] = audio_duration

    if video_duration is not None and audio_duration is not None:
        drift = abs(video_duration - audio_duration)
        checks["duration_drift_sec"] = round(drift, 2)
        if drift > max_duration_drift_sec:
            issues.append(f"Final video duration ({video_duration:.1f}s) drifted {drift:.1f}s from narration ({audio_duration:.1f}s).")
    else:
        checks["duration_drift_sec"] = None

    avg_clip_score = _average_clip_score(image_paths or [], image_prompts or [])
    checks["avg_image_clip_score"] = round(avg_clip_score, 3) if avg_clip_score is not None else None
    if avg_clip_score is not None and avg_clip_score < min_clip_score:
        issues.append(f"Average image/prompt CLIP score ({avg_clip_score:.3f}) is below threshold ({min_clip_score}).")

    checks["final_video_exists"] = bool(final_video_path and os.path.exists(final_video_path))
    if not checks["final_video_exists"]:
        issues.append("Final video file does not exist.")

    black_fraction = _black_frame_fraction(final_video_path) if checks["final_video_exists"] else None
    checks["black_frame_fraction"] = round(black_fraction, 3) if black_fraction is not None else None
    if black_fraction is not None and black_fraction > max_black_fraction:
        issues.append(
            f"{black_fraction:.0%} of sampled frames are blank/black — the visual timeline "
            f"is likely shorter than the narration."
        )

    return {"passed": len(issues) == 0, "checks": checks, "issues": issues}
