# agents/video_generation.py

import os
import random
from typing import List, Optional
from pathlib import Path

from PIL import Image
# Monkey-patch for MoviePy 1.x compatibility with Pillow 10+
if not hasattr(Image, "ANTIALIAS"):
    setattr(Image, "ANTIALIAS", Image.Resampling.LANCZOS)

from moviepy.config import change_settings
from moviepy.editor import (
    AudioFileClip,
    VideoFileClip,
    CompositeVideoClip,
    concatenate_videoclips,
)

from agents.stock_videos import fetch_stock_videos, fetch_stock_videos_per_scene, extract_video_id
from agents.used_media_registry import get_used_video_urls, mark_videos_used
from agents.video_effects import (
    get_canvas,
    fill_frame,
    ken_burns,
    punch_in,
    apply_transition,
    transition_cycle,
    hook_overlay,
)


change_settings({
    "IMAGEMAGICK_BINARY": os.getenv("IMAGEMAGICK_BINARY", "magick")
})

# Rhythm of the final cut: a comma-separated cycle of "v" (stock video clip) and
# "i" (generated image slide), repeated until the narration is covered. Used only
# when per-source media-mix targets below can't be computed (e.g. no image_sources
# info available) — otherwise _build_media_sequence drives the ratio directly.
VIDEO_IMAGE_PATTERN = os.getenv("VIDEO_IMAGE_PATTERN", "v,i")
# Target share of the final cut's shots, by source: real licensed photos, stock
# b-roll video, and freshly AI-generated images. Whichever pool comes up empty
# (e.g. no licensed photo existed for this topic) has its share redistributed
# proportionally across the remaining pools rather than leaving gaps.
MEDIA_REAL_PHOTO_SHARE = float(os.getenv("MEDIA_REAL_PHOTO_SHARE", "0.5"))
MEDIA_STOCK_VIDEO_SHARE = float(os.getenv("MEDIA_STOCK_VIDEO_SHARE", "0.4"))
MEDIA_AI_IMAGE_SHARE = float(os.getenv("MEDIA_AI_IMAGE_SHARE", "0.1"))
# Short-form pacing: how long any single shot may hold before we cut away.
MAX_SEGMENT_SECONDS = float(os.getenv("MAX_SEGMENT_SECONDS", "3.2"))
TRANSITION_SECONDS = float(os.getenv("TRANSITION_SECONDS", "0.45"))
OUTPUT_FPS = int(os.getenv("OUTPUT_FPS", "24"))
ENCODE_PRESET = os.getenv("ENCODE_PRESET", "veryfast")
# Colour grade + vignette, run as ffmpeg filters during the encode rather than as
# per-frame numpy passes (which profiled at ~227 ms/frame on 1080x1920).
GRADE_FILTER = os.getenv(
    "VIDEO_GRADE_FILTER",
    "eq=saturation=1.20:contrast=1.06,vignette=angle=PI/5",
)


def resize_images(image_paths: List[str], size) -> List[str]:
    out = Path("resized_images")
    out.mkdir(exist_ok=True)
    resized = []
    for i, p in enumerate(image_paths):
        img = Image.open(p).convert("RGB")
        # cover-crop to the canvas aspect so nothing is squashed
        target_w, target_h = size
        target_ratio = target_w / target_h
        src_ratio = img.width / img.height
        if src_ratio > target_ratio:
            new_w = int(img.height * target_ratio)
            left = (img.width - new_w) // 2
            img = img.crop((left, 0, left + new_w, img.height))
        else:
            new_h = int(img.width / target_ratio)
            top = (img.height - new_h) // 2
            img = img.crop((0, top, img.width, top + new_h))
        img = img.resize(size, Image.Resampling.LANCZOS)
        dst = out / f"slide_{i:02d}.jpg"
        img.save(dst, format="JPEG", quality=95)
        resized.append(str(dst))
    return resized


def _interleave(video_paths: List[str], image_paths: List[str], pattern: str) -> List[tuple[str, str]]:
    """
    Walks `pattern` (e.g. ["v","i"] or ["v","v","i"]) repeatedly, pulling the next
    item from the matching queue each time, until both queues are empty. A token
    with an empty queue is skipped that cycle rather than stalling the pattern.
    """
    tokens = [t.strip().lower() for t in pattern.split(",") if t.strip()]
    if not tokens:
        tokens = ["v", "i"]

    video_queue = list(video_paths)
    image_queue = list(image_paths)
    ordered: List[tuple[str, str]] = []

    while video_queue or image_queue:
        progressed = False
        for tok in tokens:
            if tok == "v" and video_queue:
                ordered.append(("video", video_queue.pop(0)))
                progressed = True
            elif tok == "i" and image_queue:
                ordered.append(("image", image_queue.pop(0)))
                progressed = True
        if not progressed:
            break

    ordered.extend(("video", p) for p in video_queue)
    ordered.extend(("image", p) for p in image_queue)
    return ordered


def _compute_shot_count(total_duration: float) -> int:
    return max(1, int(round(total_duration / MAX_SEGMENT_SECONDS)))


def _build_media_sequence(
    pools: dict[str, List[str]], shares: dict[str, float], shot_count: int, rng: random.Random
) -> List[tuple[str, str]]:
    """
    Builds a shot_count-length sequence of (render_kind, path) hitting the
    configured per-source shares as closely as integer rounding allows.

    `pools` maps a source label ("video" | "real" | "ai") to its asset list.
    Whichever pool is empty (e.g. no licensed photo existed for this topic) has
    its target share redistributed proportionally across the remaining pools,
    rather than leaving gaps in the sequence. Sources are spread evenly across
    the sequence (not clumped) so cuts alternate naturally.
    """
    active = {k: v for k, v in pools.items() if v}
    if not active:
        return []

    total_share = sum(shares.get(k, 0) for k in active) or 1.0
    targets = {k: shares.get(k, 0) / total_share for k in active}

    counts = {k: int(round(shot_count * targets[k])) for k in active}
    drift = shot_count - sum(counts.values())
    for k in sorted(active, key=lambda k: -targets[k]):
        if drift == 0:
            break
        step = 1 if drift > 0 else -1
        counts[k] = max(0, counts[k] + step)
        drift -= step

    # Spread each source across the sequence via a deficit scheduler: at each
    # step, emit whichever active source is furthest BEHIND its fair share of
    # steps taken so far (targets[k] * step_index - emitted[k] is most positive),
    # rather than emitting all of one kind before moving to the next.
    labels = []
    emitted = {k: 0 for k in active}
    remaining = dict(counts)
    for step in range(1, shot_count + 1):
        candidates = [k for k in active if remaining[k] > 0]
        if not candidates:
            break
        rng.shuffle(candidates)  # stable tie-break that still varies between jobs
        best = max(candidates, key=lambda k: targets[k] * step - emitted[k])
        labels.append(best)
        emitted[best] += 1
        remaining[best] -= 1

    cursors = {k: 0 for k in active}
    sequence = []
    for k in labels:
        pool = active[k]
        path = pool[cursors[k] % len(pool)]
        cursors[k] += 1
        sequence.append(("video" if k == "video" else "image", path))

    return sequence


def _build_shot_list(ordered_segments, total_duration: float):
    """
    Short-form videos cut every few seconds. We have a fixed pool of assets, so
    rather than stretching each one across a long slow beat, we cycle the pool
    until the narration is covered — giving fast cuts without needing more assets.
    Each asset reappears with different motion/transition, so repeats don't read
    as repeats.
    """
    if not ordered_segments:
        return []

    shot_count = max(1, int(round(total_duration / MAX_SEGMENT_SECONDS)))
    shot_count = max(shot_count, len(ordered_segments))

    # Shots are concatenated with padding=-TRANSITION_SECONDS, so each one after the
    # first overlaps its predecessor. Without compensating, the assembled timeline
    # ends (shot_count-1) * TRANSITION_SECONDS short of the narration and the tail
    # renders as black. Lengthen each shot to absorb the overlap.
    #
    # This arithmetic is exact only in theory — each clip's actual duration gets
    # rounded to a frame boundary at export FPS, and that per-clip rounding can
    # accumulate across many shots into the composite finishing a frame or two
    # short of `total_duration`. Since the final step trims DOWN to total_duration
    # (safe — it can only shorten, never reveal a gap), pad every shot slightly
    # over-length here as cheap insurance against that drift ever going the other
    # way and exposing black frames at the tail.
    overlap_total = (shot_count - 1) * TRANSITION_SECONDS
    rounding_safety = 0.15  # seconds of extra runtime per shot, trimmed off at the end
    per = (total_duration + overlap_total) / shot_count + rounding_safety

    return [(ordered_segments[i % len(ordered_segments)], per) for i in range(shot_count)]


def generate_animated_video_with_stock(
    topic: str,
    image_paths: List[str],
    audio_path: str,
    output_path: str = "youtube_ready_with_stock.mp4",
    fps: Optional[int] = None,
    fade_duration: float = 1.0,          # kept for call-site compatibility
    zoom: float = 1.2,                   # kept for call-site compatibility
    stock_clips: int = 2,
    scene_descriptions: Optional[List[str]] = None,
    image_sources: Optional[List[str]] = None,
    pattern: Optional[str] = None,
    hook_text: Optional[str] = None,
) -> str:
    """
    Assembles the final edit: CLIP-matched b-roll interleaved with generated scene
    images, cut fast to short-form pacing, every shot carrying motion (Ken Burns or
    punch-in), varied transitions between cuts, a hook overlay on the opening beat,
    and a colour grade + vignette over the whole piece.

    Output is YouTube Shorts 1080x1920 by default (VIDEO_ORIENTATION=landscape for 16:9).
    """
    canvas = get_canvas()
    rng = random.Random(hash(topic) & 0xFFFFFFFF)
    transitions = transition_cycle()

    # 0) b-roll, matched per scene where possible, excluding clips already used
    # in an earlier video on this channel.
    used_video_ids = get_used_video_urls()
    if scene_descriptions and len(scene_descriptions) == len(image_paths):
        per_scene = fetch_stock_videos_per_scene(scene_descriptions, per_query=4, exclude_ids=used_video_ids)
        stock_paths = [p for p in per_scene if p]
    else:
        stock_paths = fetch_stock_videos(topic, max_clips=stock_clips, scene_descriptions=scene_descriptions)

    audio = AudioFileClip(audio_path)
    total = audio.duration
    shot_count = _compute_shot_count(total)

    # 1) sort generated scene images into the real-photo vs AI-generated pools
    # (agents.image_generation already picked real photos where a licensed match
    # existed) and build the shot sequence to hit the configured media-mix ratio.
    resized = resize_images(image_paths, size=canvas)
    if image_sources and len(image_sources) == len(resized):
        real_pool = [p for p, s in zip(resized, image_sources) if s == "real"]
        ai_pool = [p for p, s in zip(resized, image_sources) if s != "real"]
        pools = {"video": stock_paths, "real": real_pool, "ai": ai_pool}
        shares = {"video": MEDIA_STOCK_VIDEO_SHARE, "real": MEDIA_REAL_PHOTO_SHARE, "ai": MEDIA_AI_IMAGE_SHARE}
    else:
        # No real/AI split known (older caller or real-photo sourcing unavailable):
        # fall back to a plain video-vs-image ratio using the combined photo+AI share.
        pools = {"video": stock_paths, "image": resized}
        shares = {"video": MEDIA_STOCK_VIDEO_SHARE, "image": MEDIA_REAL_PHOTO_SHARE + MEDIA_AI_IMAGE_SHARE}

    ordered_segments = _build_media_sequence(pools, shares, shot_count, rng)
    if not ordered_segments:  # both pools somehow empty — legacy interleave as last resort
        ordered_segments = _interleave(stock_paths, resized, pattern or VIDEO_IMAGE_PATTERN)

    # Every stock clip that actually made it into the cut is now spoken for —
    # register it so a future video on the channel won't pull the same clip.
    used_ids_this_video = {extract_video_id(p) for _, p in ordered_segments if p in stock_paths}
    mark_videos_used([i for i in used_ids_this_video if i])

    shot_list = _build_shot_list(ordered_segments, total)

    # 2) build each shot with motion + an incoming transition
    open_video_clips = []
    clips = []
    for idx, ((kind, path), seg_duration) in enumerate(shot_list):
        if kind == "video":
            source = VideoFileClip(path)
            open_video_clips.append(source)
            # sample a different span of longer clips on repeat visits so reuse isn't obvious
            span = min(seg_duration, source.duration)
            max_start = max(source.duration - span, 0)
            start = (idx * span) % (max_start + 1e-6) if max_start > 0 else 0
            shot = source.subclip(start, start + span)
            shot = fill_frame(shot, canvas)
            shot = punch_in(shot, span, canvas)
        else:
            shot = ken_burns(path, seg_duration, canvas, rng)

        if idx > 0:
            shot = apply_transition(shot, transitions[idx % len(transitions)], TRANSITION_SECONDS, canvas)
        clips.append(shot)

    # 3) concatenate with each shot overlapping its predecessor by the transition length
    final = concatenate_videoclips(clips, method="compose", padding=-TRANSITION_SECONDS)

    # 4) hook text over the opening beat (replaces the old static title card)
    hook_layers = hook_overlay(hook_text or topic, min(2.6, total), canvas)
    if hook_layers:
        final = CompositeVideoClip([final, *hook_layers], size=canvas)

    # 4.5) Safety net: the per-shot duration math (and stock clips shorter than
    # their allotted span, which get capped rather than stretched) can still leave
    # the assembled timeline a hair short of `total`. Rather than trust arithmetic
    # never to drift, freeze the last real frame to cover any gap — a still frame
    # is a much smaller defect than a QA-failing black frame, and it disappears
    # entirely when there's no gap since it gets trimmed off by set_duration below.
    if final.duration < total:
        from moviepy.editor import ImageClip

        gap = total - final.duration
        freeze = ImageClip(final.get_frame(max(0, final.duration - 0.04))).set_duration(gap + 0.2)
        final = concatenate_videoclips([final, freeze], method="compose")

    # 5) trim to the narration. The colour grade + vignette are NOT applied here:
    # doing them in numpy cost ~227 ms/frame (the single largest render cost), while
    # ffmpeg's eq/vignette filters do the same work in optimised C during the encode
    # that has to happen anyway — see GRADE_FILTER below.
    final = final.set_duration(total).set_audio(audio)

    # 6) export
    final.write_videofile(
        output_path,
        fps=fps or OUTPUT_FPS,
        codec="libx264",
        audio_codec="aac",
        temp_audiofile="temp-audio.m4a",
        remove_temp=True,
        threads=os.cpu_count() or 4,
        preset=ENCODE_PRESET,
        ffmpeg_params=(["-vf", GRADE_FILTER] if GRADE_FILTER else None),
        logger=None,
    )

    for c in open_video_clips:
        try:
            c.close()
        except Exception:
            pass
    audio.close()

    return output_path
