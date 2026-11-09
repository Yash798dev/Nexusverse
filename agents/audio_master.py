"""
agents/audio_master.py — Broadcast-grade mastering for the narration track.

Raw TTS output is quiet and dynamically uneven, which is part of why generated
narration sounds "AI" even when the voice model is good. This runs an ffmpeg
chain to fix that:

  high-pass   -> kill rumble below speech
  EQ          -> cut 200Hz mud, lift 3-9kHz presence/air (this is the main lever
                 for cloned-voice brightness — see note below)
  compressor  -> even out level so quiet words stay audible
  de-esser    -> tame harsh sibilance the presence lift exposes
  limiter     -> catch peaks
  loudnorm    -> EBU R128 to -14 LUFS, YouTube's playback target, so the video is
                 as loud as everything else in the feed instead of noticeably quieter

Denoise (afftdn) is OFF by default. It's built for real microphone recordings
with hiss/hum to remove; XTTS/Piper output is already clean synthetic audio, so
its spectral-subtraction can't tell natural high-frequency speech content from
noise and strips real signal — measured here as spectral centroid dropping ~25%
(1680Hz -> 1266Hz on a test clip) with denoise on. Cloned voices need every bit
of high-frequency detail they can get to sound like the source, since XTTS's own
vocoder already band-limits the clone well below the reference recording's
brightness — so denoising on top makes a real similarity problem measurably
worse. Enable it (AUDIO_DENOISE=true) only for genuinely noisy source audio.

Optionally trims long pauses and nudges tempo up — short-form delivery is faster
than default TTS pacing, and dead air is where viewers scroll away.
"""

import os
import shutil
import subprocess
import tempfile

FFMPEG_PATH = os.getenv("FFMPEG_PATH", "ffmpeg")

TARGET_LUFS = float(os.getenv("AUDIO_TARGET_LUFS", "-14"))
SPEECH_TEMPO = float(os.getenv("AUDIO_TEMPO", "0.98"))
TRIM_SILENCE = os.getenv("AUDIO_TRIM_SILENCE", "true").lower() == "true"
MAX_PAUSE_SECONDS = float(os.getenv("AUDIO_MAX_PAUSE_SECONDS", "0.35"))
DENOISE = os.getenv("AUDIO_DENOISE", "false").lower() == "true"
# How hard to push presence/air back in to counter XTTS's inherent band-limiting.
PRESENCE_DB = float(os.getenv("AUDIO_PRESENCE_DB", "5.5"))
AIR_DB = float(os.getenv("AUDIO_AIR_DB", "3.5"))


def _build_filter_chain() -> str:
    filters = ["highpass=f=85"]  # rumble / DC

    if DENOISE:
        filters.append("afftdn=nf=-28")

    filters += [
        "equalizer=f=220:t=q:w=1.2:g=-2.5",                          # cut boxy low-mid mud
        f"equalizer=f=3200:t=q:w=1.6:g={PRESENCE_DB}",               # presence -> clarity + cloned-voice brightness
        f"equalizer=f=9000:t=q:w=2:g={AIR_DB}",                      # air / crispness
        "acompressor=threshold=-20dB:ratio=3.5:attack=6:release=120:makeup=2",
        "deesser=i=0.4",                                             # tame sibilance the presence lift exposes
    ]

    if TRIM_SILENCE:
        # collapse any pause longer than MAX_PAUSE_SECONDS — dead air loses viewers
        filters.append(
            f"silenceremove=stop_periods=-1:stop_duration={MAX_PAUSE_SECONDS}:stop_threshold=-38dB"
        )

    if abs(SPEECH_TEMPO - 1.0) > 0.001:
        filters.append(f"atempo={SPEECH_TEMPO:.3f}")

    filters.append("alimiter=limit=0.97")
    filters.append(f"loudnorm=I={TARGET_LUFS}:TP=-1.5:LRA=11")
    return ",".join(filters)


def master_audio(audio_path: str, output_path: str | None = None) -> str:
    """
    Applies the mastering chain to `audio_path`. Writes in place unless
    `output_path` is given. Returns the path actually written.

    Never raises: if ffmpeg is unavailable or the chain fails (an unsupported
    filter on an older build, say), the original audio is left untouched and the
    job continues with unmastered narration rather than failing outright.
    """
    target = output_path or audio_path
    tmp_fd, tmp_path = tempfile.mkstemp(suffix=os.path.splitext(target)[1] or ".mp3")
    os.close(tmp_fd)

    cmd = [
        FFMPEG_PATH, "-y", "-i", audio_path,
        "-af", _build_filter_chain(),
        "-ar", "48000", "-b:a", "192k",
        tmp_path,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0 or not os.path.getsize(tmp_path):
            print(f"PYMSG: [audio_master] mastering skipped: {result.stderr[-400:]}", flush=True)
            os.unlink(tmp_path)
            return audio_path

        shutil.move(tmp_path, target)
        print(f"PYMSG: [audio_master] mastered -> {TARGET_LUFS} LUFS, tempo x{SPEECH_TEMPO}", flush=True)
        return target
    except Exception as e:
        print(f"PYMSG: [audio_master] mastering unavailable ({e}); using raw narration.", flush=True)
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        return audio_path
