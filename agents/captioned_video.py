# agents/captioned_video.py

import os
import subprocess
from typing import List, Tuple

FFMPEG_PATH = os.getenv("FFMPEG_PATH", "ffmpeg")
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "small")
# Short-form captions run 3-4 words a line: big enough to read on a phone at arm's
# length, short enough that the highlighted word is always obvious.
WORDS_PER_LINE = int(os.getenv("CAPTION_WORDS_PER_LINE", "3"))
# Where the caption block sits, as a fraction of frame height from the top.
CAPTION_HEIGHT_FRAC = float(os.getenv("CAPTION_HEIGHT_FRAC", "0.60"))
# One accent colour used across every video — on a faceless channel this consistency
# is a large part of what makes content recognisable in a feed. Hex RGB.
BRAND_ACCENT = os.getenv("BRAND_ACCENT", "00E5FF")


def _ass_colour(hex_rgb: str, alpha: str = "00") -> str:
    """ASS stores colours as &HAABBGGRR — alpha first, then BLUE-GREEN-RED (reversed)."""
    h = hex_rgb.strip().lstrip("#")
    if len(h) != 6:
        h = "00E5FF"
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H{alpha}{b}{g}{r}"

_whisper_model = None


def burn_subtitles_with_ffmpeg(
    video_path: str,
    captions: List[Tuple[float, float, str]],
    output_path: str = "video_with_captions.mp4",
    font: str = "Arial",
    font_size: int = 24,
    font_color: str = "FFFFFF"
) -> str:
    """
    Legacy path: burns caption blocks onto a video via FFmpeg's `subtitles` filter
    (plain SRT). Kept for the Streamlit prototype (main.py) and anywhere captions
    are already pre-chunked into (start, end, text) tuples.
    """
    srt_path = "temp_subtitles.srt"
    with open(srt_path, "w", encoding="utf-8") as f:
        for idx, (start, end, text) in enumerate(captions, start=1):
            def fmt(ts):
                h = int(ts // 3600)
                m = int((ts % 3600) // 60)
                s = int(ts % 60)
                ms = int((ts - int(ts)) * 1000)
                return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"
            f.write(f"{idx}\n")
            f.write(f"{fmt(start)} --> {fmt(end)}\n")
            f.write(text + "\n\n")

    vf = (
        f"subtitles={srt_path}"
        f":force_style='FontName={font},FontSize={font_size},"
        f"PrimaryColour=&H{font_color}&,MarginV=20'"
    )

    cmd = [FFMPEG_PATH, "-y", "-i", video_path, "-vf", vf, "-c:a", "copy", output_path]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg error:\n{result.stderr}")

    os.remove(srt_path)
    return output_path


def _load_whisper():
    global _whisper_model
    if _whisper_model is not None:
        return _whisper_model
    from faster_whisper import WhisperModel
    import torch

    device = "cuda" if torch.cuda.is_available() else "cpu"
    compute_type = "float16" if device == "cuda" else "int8"
    _whisper_model = WhisperModel(WHISPER_MODEL, device=device, compute_type=compute_type)
    return _whisper_model


def transcribe_words(audio_path: str) -> List[dict]:
    """
    Real ASR-based word-level timestamps (faster-whisper), replacing the old
    heuristic of guessing caption timing from character count / sentence splitting.
    Returns [{"start": float, "end": float, "word": str}, ...].
    """
    model = _load_whisper()
    segments, _ = model.transcribe(audio_path, word_timestamps=True)
    words = []
    for segment in segments:
        for w in (segment.words or []):
            words.append({"start": w.start, "end": w.end, "word": w.word.strip()})
    return words


def _group_words_into_lines(words: List[dict], words_per_line: int = WORDS_PER_LINE) -> List[List[dict]]:
    lines, current = [], []
    for w in words:
        current.append(w)
        if len(current) >= words_per_line:
            lines.append(current)
            current = []
    if current:
        lines.append(current)
    return lines


def _fmt_ass_time(t: float) -> str:
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = int(t % 60)
    cs = int((t - int(t)) * 100)
    return f"{h:d}:{m:02d}:{s:02d}.{cs:02d}"


def _build_ass_karaoke(words: List[dict], output_ass_path: str, font: str, font_size: int):
    """
    Writes karaoke ASS sized to the *output canvas* (portrait for Shorts), with the
    heavy outline + drop shadow and centred placement short-form captions use so
    they stay legible over any footage.
    """
    from agents.video_effects import get_canvas

    canvas_w, canvas_h = get_canvas()
    # scale type to the frame so the same code reads correctly at 1080x1920 and 1920x1080
    size = font_size or int(canvas_w * 0.085)
    outline = max(3, int(size * 0.11))
    shadow = max(2, int(size * 0.05))
    # Alignment 2 anchors bottom-centre, so MarginV is measured up from the bottom.
    margin_v = int(canvas_h * (1.0 - CAPTION_HEIGHT_FRAC))
    side_margin = int(canvas_w * 0.07)

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {canvas_w}
PlayResY: {canvas_h}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{font},{size},{_ass_colour(BRAND_ACCENT)},&H00FFFFFF,&H00000000,&HA0000000,-1,0,0,0,100,100,0,0,1,{outline},{shadow},2,{side_margin},{side_margin},{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = _group_words_into_lines(words)
    events = []
    for line_words in lines:
        if not line_words:
            continue
        line_start = line_words[0]["start"]
        line_end = line_words[-1]["end"]
        # brief scale-up as each line appears, so captions pop in rather than blink on
        intro = "{\\fscx88\\fscy88\\t(0,120,\\fscx100\\fscy100)}"
        karaoke_text = ""
        for w in line_words:
            duration_cs = max(1, int(round((w["end"] - w["start"]) * 100)))
            karaoke_text += "{\\k%d}%s " % (duration_cs, w["word"])
        events.append(
            f"Dialogue: 0,{_fmt_ass_time(line_start)},{_fmt_ass_time(line_end)},Default,,0,0,0,,{intro}{karaoke_text.strip()}"
        )

    with open(output_ass_path, "w", encoding="utf-8") as f:
        f.write(header)
        f.write("\n".join(events))


def burn_word_level_captions(
    video_path: str,
    audio_path: str,
    output_path: str = "video_with_captions.mp4",
    font: str = "Arial",
    font_size: int = 0,  # 0 = derive from canvas width
) -> str:
    """
    Stage 4: transcribes `audio_path` with faster-whisper for real word-level
    timestamps, then burns karaoke-style (per-word highlight) captions via FFmpeg's
    ASS subtitle support. This entirely replaces the old duration-guessing heuristic
    — captions are driven by what was actually said, not an estimate.
    """
    words = transcribe_words(audio_path)
    if not words:
        raise RuntimeError("faster-whisper returned no words to caption.")

    ass_path = os.path.join(os.path.dirname(output_path) or ".", "_captions.ass")
    _build_ass_karaoke(words, ass_path, font=font, font_size=font_size)

    # ffmpeg's ass filter needs forward slashes / escaped colons on Windows paths
    escaped_ass_path = ass_path.replace("\\", "/").replace(":", "\\:")
    cmd = [FFMPEG_PATH, "-y", "-i", video_path, "-vf", f"ass={escaped_ass_path}", "-c:a", "copy", output_path]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg error:\n{result.stderr}")

    os.remove(ass_path)
    return output_path
