"""
agents/video_effects.py — The "edited by a human" layer.

Everything that makes a generated video read like an influencer's hand-edited
Short rather than a slideshow with narration bolted on:
  - dynamic Ken Burns (randomized pan direction + zoom, not a static centre push)
  - punch-in motion on stock b-roll so no shot is ever visually still
  - varied transitions (crossfade / slide / whip-pan) instead of one repeated dissolve
  - a colour grade (saturation + contrast lift) and vignette for a graded, cinematic look
  - a big bold hook overlay burned over the opening seconds

All helpers are canvas-size agnostic; the caller passes the target canvas so the
same code serves 1080x1920 Shorts and 1920x1080 landscape.
"""

import os
import random

import numpy as np
from dotenv import load_dotenv
from PIL import Image

if not hasattr(Image, "ANTIALIAS"):
    setattr(Image, "ANTIALIAS", Image.Resampling.LANCZOS)

# Load config and point MoviePy at ImageMagick here rather than relying on the
# caller having done it — TextClip silently degrades to "no overlay" otherwise.
load_dotenv()

from moviepy.config import change_settings
from moviepy.editor import ColorClip, CompositeVideoClip, TextClip, VideoClip, vfx

change_settings({"IMAGEMAGICK_BINARY": os.getenv("IMAGEMAGICK_BINARY", "magick")})


# --- Canvas / format -------------------------------------------------------

def get_canvas() -> tuple[int, int]:
    """
    (width, height) of the output frame. Defaults to YouTube Shorts 9:16 (1080x1920);
    set VIDEO_ORIENTATION=landscape for classic 16:9.
    """
    orientation = os.getenv("VIDEO_ORIENTATION", "portrait").lower()
    if orientation.startswith("land"):
        return (1920, 1080)
    return (1080, 1920)


# --- Framing ---------------------------------------------------------------

def fill_frame(clip, canvas: tuple[int, int]):
    """
    Scale-to-cover + centre-crop so a clip fills the canvas edge-to-edge whatever
    its native aspect ratio — no letterbox/pillarbox bars, ever. Critical for
    Shorts, where most stock footage arrives 16:9 and must be cropped to 9:16.
    """
    target_w, target_h = canvas
    target_ratio = target_w / target_h
    src_ratio = clip.w / clip.h

    resized = clip.resize(height=target_h) if src_ratio > target_ratio else clip.resize(width=target_w)
    # guard against off-by-one rounding leaving the clip a pixel short of the canvas
    if resized.w < target_w or resized.h < target_h:
        resized = resized.resize(max(target_w / resized.w, target_h / resized.h))

    return resized.crop(
        x_center=resized.w / 2, y_center=resized.h / 2, width=target_w, height=target_h
    )


# --- Motion ----------------------------------------------------------------

def _ease(p: float) -> float:
    """Smoothstep — moves settle instead of stopping dead."""
    return p * p * (3 - 2 * p)


def ken_burns(image_path: str, duration: float, canvas: tuple[int, int], rng: random.Random):
    """
    Ken Burns with a randomized pan direction and zoom sense, so consecutive slides
    don't all drift the same way (the giveaway of an auto-generated video).

    Implemented as a per-frame crop-then-resize on a pre-scaled PIL image rather
    than MoviePy's resize+composite: that path re-scaled a full 1404x2496 image
    every frame and profiled at ~92 ms/frame, which alone made a 55s Short take
    tens of minutes to render.
    """
    target_w, target_h = canvas
    overscan = 1.28

    src = Image.open(image_path).convert("RGB")
    # cover-crop to the canvas aspect first so the pan window never leaves the image
    target_ratio = target_w / target_h
    if src.width / src.height > target_ratio:
        new_w = int(src.height * target_ratio)
        left = (src.width - new_w) // 2
        src = src.crop((left, 0, left + new_w, src.height))
    else:
        new_h = int(src.width / target_ratio)
        top = (src.height - new_h) // 2
        src = src.crop((0, top, src.width, top + new_h))

    base_w, base_h = int(target_w * overscan), int(target_h * overscan)
    src = src.resize((base_w, base_h), Image.LANCZOS)  # done once, not per frame

    # keep both ends zoomed in a little so there is always slack to pan across
    z_lo, z_hi = 1.04, 1.22
    z_start, z_end = (z_lo, z_hi) if rng.random() < 0.5 else (z_hi, z_lo)
    direction = rng.choice(["left", "right", "up", "down"])

    def make_frame(t):
        p = _ease(min(max(t / duration, 0.0), 1.0))
        z = z_start + (z_end - z_start) * p
        cw, ch = int(base_w / z), int(base_h / z)
        slack_x, slack_y = base_w - cw, base_h - ch

        if direction == "left":
            x, y = int(slack_x * (1 - p)), slack_y // 2
        elif direction == "right":
            x, y = int(slack_x * p), slack_y // 2
        elif direction == "up":
            x, y = slack_x // 2, int(slack_y * (1 - p))
        else:
            x, y = slack_x // 2, int(slack_y * p)

        window = src.crop((x, y, x + cw, y + ch))
        return np.asarray(window.resize((target_w, target_h), Image.BILINEAR))

    return VideoClip(make_frame, duration=duration)


def punch_in(clip, duration: float, canvas: tuple[int, int], amount: float = 0.08):
    """
    Slow push-in on b-roll so even 'static' stock shots carry motion. Crop-based
    for the same performance reason as ken_burns — a per-frame full-frame resize
    plus composite is far more expensive than cropping the array and scaling once.
    """
    target_w, target_h = canvas

    def transform(get_frame, t):
        frame = get_frame(t)
        p = _ease(min(max(t / duration, 0.0), 1.0))
        z = 1.0 + amount * p
        h, w = frame.shape[:2]
        cw, ch = max(int(w / z), 8), max(int(h / z), 8)
        x0, y0 = (w - cw) // 2, (h - ch) // 2
        window = frame[y0:y0 + ch, x0:x0 + cw]
        return np.asarray(Image.fromarray(window).resize((target_w, target_h), Image.BILINEAR))

    return clip.fl(transform, apply_to=[]).set_duration(duration)


# --- Grade -----------------------------------------------------------------

def _saturate_frame(frame, amount: float):
    gray = frame.mean(axis=2, keepdims=True)
    out = gray + (frame - gray) * amount
    return np.clip(out, 0, 255).astype("uint8")


def color_grade(clip, saturation: float = 1.18, contrast: float = 0.10):
    """Punchier, more 'graded' look — saturation lift plus a gentle contrast S-curve."""
    graded = clip.fl_image(lambda f: _saturate_frame(f, saturation))
    return graded.fx(vfx.lum_contrast, lum=0, contrast=contrast, contrast_thr=127)


def grade_and_vignette(
    clip,
    canvas: tuple[int, int],
    saturation: float = 1.18,
    contrast: float = 0.10,
    vignette_strength: float = 0.35,
):
    """
    Saturation + contrast + vignette in a SINGLE pass over the frame.

    Applied separately these were three full-frame float conversions per frame and
    dominated render time (~290 of 383 ms/frame in profiling). Fused, the frame is
    converted to float once and written back once.
    """
    mask = _vignette_mask(canvas, vignette_strength)
    target_w, target_h = canvas

    def apply(frame):
        img = frame.astype(np.float32)
        gray = img.mean(axis=2, keepdims=True)
        img = gray + (img - gray) * saturation          # saturation
        img = (img - 127.0) * (1.0 + contrast) + 127.0  # contrast
        if img.shape[0] == target_h and img.shape[1] == target_w:
            img *= mask                                  # vignette
        return np.clip(img, 0, 255).astype(np.uint8)

    return clip.fl_image(apply)


def _vignette_mask(canvas: tuple[int, int], strength: float):
    w, h = canvas
    yy, xx = np.mgrid[0:h, 0:w]
    cx, cy = w / 2.0, h / 2.0
    dist = np.sqrt(((xx - cx) / cx) ** 2 + ((yy - cy) / cy) ** 2)
    mask = 1.0 - strength * np.clip((dist - 0.55) / 0.85, 0, 1) ** 2
    return mask[:, :, None].astype("float32")


def vignette(clip, canvas: tuple[int, int], strength: float = 0.35):
    """Darkened corners pull the eye to centre frame — standard short-form polish."""
    mask = _vignette_mask(canvas, strength)
    return clip.fl_image(lambda f: np.clip(f * mask, 0, 255).astype("uint8"))


# --- Transitions -----------------------------------------------------------

def apply_transition(clip, kind: str, duration: float, canvas: tuple[int, int]):
    """
    Returns `clip` with an *incoming* transition applied. Callers concatenate with
    a negative padding equal to `duration` so each clip overlaps its predecessor.
    """
    if kind == "slide_left":
        return clip.fx(_slide_in, duration, "left", canvas)
    if kind == "slide_up":
        return clip.fx(_slide_in, duration, "top", canvas)
    if kind == "whip":
        return clip.fx(_whip_in, duration, canvas)
    return clip.crossfadein(duration)


def _slide_in(clip, duration: float, side: str, canvas: tuple[int, int]):
    w, h = canvas

    def pos_at(t):
        p = min(max(t / duration, 0.0), 1.0)
        p = 1 - (1 - p) ** 3  # ease-out so it decelerates into place
        if side == "left":
            return (w * (1 - p), 0)
        return (0, h * (1 - p))

    return clip.set_position(pos_at)


def _whip_in(clip, duration: float, canvas: tuple[int, int]):
    """Fast motion-blurred entry — the 'whip pan' beat common in edited Shorts."""
    def blur_at(get_frame, t):
        frame = get_frame(t)
        if t > duration:
            return frame
        p = 1 - min(max(t / duration, 0.0), 1.0)
        shift = int(40 * p)
        if shift <= 0:
            return frame
        acc = frame.astype("float32")
        for offset in (shift // 2, shift):
            acc += np.roll(frame, offset, axis=1).astype("float32")
        return np.clip(acc / 3.0, 0, 255).astype("uint8")

    return clip.fl(blur_at, apply_to=[]).crossfadein(min(duration, 0.25))


def transition_cycle():
    """The rotation of transition styles used across a cut, so no two adjacent cuts match."""
    raw = os.getenv("VIDEO_TRANSITIONS", "crossfade,slide_left,crossfade,whip,slide_up")
    return [t.strip() for t in raw.split(",") if t.strip()] or ["crossfade"]


# --- Overlays --------------------------------------------------------------

def hook_overlay(text: str, duration: float, canvas: tuple[int, int]) -> list:
    """
    Big bold hook text burned over the opening seconds. Shorts live or die on the
    first ~2s, so this replaces the old dead title card (which wasted them on a
    static black screen) with text laid over the actual moving footage.

    Returns a LIST of overlay layers (scrim, then text) for the caller to composite —
    the scrim can't be merged in here without its black box covering the whole frame.
    Empty list if text rendering is unavailable.
    """
    w, h = canvas
    words = text.strip().split()
    hook = " ".join(words[:8]).upper()

    font_size = int(w * 0.095)
    box = (int(w * 0.86), None)

    def _text(color: str, stroke: int):
        return TextClip(
            hook,
            fontsize=font_size,
            font="Arial-Bold",
            color=color,
            stroke_color=color if stroke else None,
            stroke_width=stroke,
            method="caption",
            size=box,
            align="center",
        )

    try:
        # Two passes: a thick black stroke underneath, solid white fill on top.
        # A single heavy-stroked TextClip renders hollow — ImageMagick centres the
        # stroke on the glyph outline, so past ~6px it eats the letter's own fill.
        outline = _text("black", int(w * 0.011))
        fill = _text("white", 0)
    except Exception:
        # ImageMagick missing/misconfigured — skip the overlay rather than fail the render
        return []

    top = int(h * 0.16)

    # Dark scrim behind the text so it reads over any shot, however bright or busy.
    scrim = (
        ColorClip(size=(w, fill.h + int(h * 0.06)), color=(0, 0, 0))
        .set_opacity(0.45)
        .set_duration(duration)
        .set_position((0, top - int(h * 0.03)))
        .crossfadein(0.2)
        .crossfadeout(0.35)
    )

    def pop_scale(t):
        # quick overshoot then settle, so the hook "pops" on rather than fading flatly
        if t > 0.35:
            return 1.0
        p = t / 0.35
        return 0.82 + 0.18 * (1 - (1 - p) ** 3) + 0.06 * np.sin(np.pi * p)

    def _place(clip):
        return (
            clip.set_duration(duration)
            .set_position(("center", top))
            .crossfadein(0.25)
            .crossfadeout(0.35)
            .resize(pop_scale)
        )

    return [scrim, _place(outline), _place(fill)]
