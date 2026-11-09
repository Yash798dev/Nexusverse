"""
agents/voice_clone.py — Prepare and validate reference clips for XTTS-v2 voice cloning.

XTTS-v2 clones a voice from short reference audio rather than training a model —
no fine-tuning step, just clean samples of the target voice. Quality depends
almost entirely on the reference audio, so this validates and cleans it before
it ever reaches the model:

  - trims leading/trailing silence (dead air biases the cloned prosody)
  - checks duration is in XTTS's effective range (too short = thin/unstable clone,
    too long past ~30s per clip is wasted — it only samples the conditioning window)
  - flags likely background noise/music (XTTS clones whatever is in the clip,
    including room tone and hum)
  - resamples to the rate XTTS expects

Multiple clips are supported and recommended: agents/assets/voices/<name>/*.wav.
XTTS averages the conditioning across all of them, which produces a steadier
clone than any single clip — especially if your samples vary a little in tone,
which real recordings always do.
"""

import glob
import os
from pathlib import Path

MIN_CLIP_SECONDS = 4.0
MAX_USEFUL_SECONDS = 30.0
RECOMMENDED_TOTAL_SECONDS = 60.0  # across all clips combined
TARGET_SR = 22050

RECORDING_CHECKLIST = """
For a voice clone that actually sounds like you (not a muffled approximation):

  1. Record in a quiet room — no fan/AC hum, no music, no echo. A closet full of
     clothes or a blanket fort kills room echo better than most people expect.
  2. Use the same mic you'd use for real narration if possible — a clone trained
     on a phone mic and then narrated through a USB mic will sound like a
     different person than either recording alone.
  3. Read naturally, at the pace and energy you want your videos to sound like.
     XTTS clones prosody and pacing, not just timbre — a flat, slow reading
     produces a flat, slow-sounding clone even on exciting scripts later.
  4. Provide 3-6 separate clips, 8-15 seconds each, varying sentence types
     (a statement, a question, an exclamation) — 60-90s total is the sweet spot.
     One long clip clones worse than several short varied ones.
  5. Save them as agents/assets/voices/<your_name>/clip_01.wav (etc). Any common
     format works (wav/mp3/m4a); this module converts and validates them.
"""


def _load_audio(path: str):
    from pydub import AudioSegment

    return AudioSegment.from_file(path)


def _trim_silence(audio, silence_thresh_db: float = -40.0, min_silence_ms: int = 200):
    from pydub.silence import detect_nonsilent

    ranges = detect_nonsilent(audio, min_silence_len=min_silence_ms, silence_thresh=silence_thresh_db)
    if not ranges:
        return audio
    start = ranges[0][0]
    end = ranges[-1][1]
    return audio[start:end]


def prepare_reference_clips(source: str, output_dir: str | None = None) -> list[str]:
    """
    Validates and cleans reference clips for voice cloning.

    `source` is either a single audio file or a directory of them. Returns a list
    of cleaned WAV paths ready to pass as XTTS's `speaker_wav`. Raises with a
    clear, actionable message rather than silently producing a bad clone — a bad
    reference clip fails quietly (it "works" but sounds wrong), which is worse
    than failing loudly here.
    """
    src_path = Path(source)
    if src_path.is_dir():
        candidates = sorted(
            p for ext in ("*.wav", "*.mp3", "*.m4a", "*.flac", "*.ogg")
            for p in glob.glob(str(src_path / ext))
        )
    elif src_path.is_file():
        candidates = [str(src_path)]
    else:
        raise FileNotFoundError(
            f"Voice reference not found at {source}.\n{RECORDING_CHECKLIST}"
        )

    if not candidates:
        raise FileNotFoundError(
            f"No audio files found in {source}.\n{RECORDING_CHECKLIST}"
        )

    out_dir = Path(output_dir) if output_dir else src_path.parent / "_prepared"
    out_dir.mkdir(parents=True, exist_ok=True)

    prepared = []
    total_seconds = 0.0
    warnings = []

    for i, clip_path in enumerate(candidates):
        audio = _load_audio(clip_path)
        audio = audio.set_channels(1).set_frame_rate(TARGET_SR)
        trimmed = _trim_silence(audio)
        duration_s = len(trimmed) / 1000.0

        if duration_s < MIN_CLIP_SECONDS:
            warnings.append(
                f"  - {Path(clip_path).name}: only {duration_s:.1f}s after trimming silence "
                f"(want >= {MIN_CLIP_SECONDS:.0f}s) — likely too short to clone reliably, skipping."
            )
            continue
        if duration_s > MAX_USEFUL_SECONDS:
            trimmed = trimmed[: int(MAX_USEFUL_SECONDS * 1000)]

        # crude clipping/loudness sanity check — XTTS clones distortion just as
        # faithfully as it clones your voice
        peak_dbfs = trimmed.max_dBFS
        if peak_dbfs > -1.0:
            warnings.append(
                f"  - {Path(clip_path).name}: peaks at {peak_dbfs:.1f} dBFS — likely clipping/distorted."
            )

        out_path = out_dir / f"ref_{i:02d}.wav"
        trimmed.export(str(out_path), format="wav")
        prepared.append(str(out_path))
        total_seconds += duration_s

    if not prepared:
        raise ValueError(
            "None of the provided clips were usable after cleaning.\n" + "\n".join(warnings) + RECORDING_CHECKLIST
        )

    if total_seconds < RECOMMENDED_TOTAL_SECONDS:
        warnings.append(
            f"  - Only {total_seconds:.0f}s of usable reference audio total "
            f"(recommend >= {RECOMMENDED_TOTAL_SECONDS:.0f}s across all clips for a stable clone)."
        )

    if warnings:
        print("PYMSG: [voice_clone] warnings while preparing reference clips:", flush=True)
        for w in warnings:
            print(f"PYMSG: [voice_clone]{w}", flush=True)

    print(
        f"PYMSG: [voice_clone] prepared {len(prepared)} reference clip(s), "
        f"{total_seconds:.0f}s total, from {source}",
        flush=True,
    )
    return prepared
