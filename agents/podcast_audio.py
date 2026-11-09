"""
agents/podcast_audio.py — Voices a two-host dialogue as a single mp3.

The audio half of "Podcast from your notes". agents/podcast_writer.py produces
the conversation; this gives each host a distinct voice and renders it.

Edge-TTS is used rather than the XTTS stack the video pipeline uses, for one
decisive reason: this needs TWO clearly different voices, and XTTS here is
configured around a single cloned/pinned speaker. Edge-TTS offers hundreds of
neural voices, needs no GPU, and leaves the graphics card free for a video job
that may be running at the same time.

Spawned by the server:
    python -m agents.podcast_audio --notes-file=<json> --out=<mp3>

The notes file is {"title": str, "markdown": str}, written by the server so the
note content never travels on a command line.

Emits on stdout: PROGRESS:<pct>, PODCAST_PATH:<abs>, COMPLETED:<abs>, FAILED:<msg>
"""

import asyncio
import os
import shutil
import sys
import tempfile
import traceback

from dotenv import load_dotenv

load_dotenv()

# Windows consoles default to cp1252 and will crash on the first non-ASCII
# character in a transcript. Same guard main_new.py uses.
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass


def safe_print(*args, **kwargs):
    try:
        print(*args, **kwargs)
    except UnicodeEncodeError:
        text = " ".join(str(a) for a in args) + kwargs.get("end", "\n")
        sys.stdout.buffer.write(text.encode("utf-8", errors="replace"))
        sys.stdout.buffer.flush()


# Two clearly distinct hosts. Overridable, but the defaults are a matched pair.
HOST_VOICES = {
    "A": os.getenv("PODCAST_VOICE_A", "en-US-AvaNeural"),
    "B": os.getenv("PODCAST_VOICE_B", "en-US-AndrewNeural"),
}
# A beat between turns — without it the hosts talk over their own cadence.
GAP_MS = int(os.getenv("PODCAST_GAP_MS", "260"))
MASTER = os.getenv("PODCAST_MASTER_AUDIO", "true").lower() == "true"


def _ffmpeg() -> str | None:
    """pydub needs ffmpeg to decode and export mp3."""
    configured = os.getenv("FFMPEG_PATH")
    if configured and os.path.exists(configured):
        return configured
    return shutil.which("ffmpeg")


async def _speak(text: str, voice: str, path: str) -> None:
    import edge_tts

    await edge_tts.Communicate(text, voice).save(path)


def render_podcast(turns: list[dict], output_path: str, on_progress=None) -> str:
    """
    Render `turns` to one mp3 at `output_path` and return that path.

    Each turn is voiced separately and the clips are concatenated, which is what
    lets the two hosts actually sound like different people.
    """
    from pydub import AudioSegment

    ffmpeg = _ffmpeg()
    if ffmpeg:
        AudioSegment.converter = ffmpeg
        AudioSegment.ffmpeg = ffmpeg
        AudioSegment.ffprobe = os.path.join(os.path.dirname(ffmpeg), "ffprobe.exe")

    speakable = [t for t in turns if (t.get("text") or "").strip()]
    if not speakable:
        raise RuntimeError("The dialogue had nothing to say.")

    os.makedirs(os.path.dirname(os.path.abspath(output_path)) or ".", exist_ok=True)
    work_dir = tempfile.mkdtemp(prefix="podcast_")
    combined = AudioSegment.empty()
    gap = AudioSegment.silent(duration=GAP_MS)
    rendered = 0

    try:
        for index, turn in enumerate(speakable):
            voice = HOST_VOICES.get(str(turn.get("speaker", "A")).upper(), HOST_VOICES["A"])
            clip_path = os.path.join(work_dir, f"turn_{index:03d}.mp3")
            text = turn["text"].strip()

            try:
                asyncio.run(_speak(text, voice, clip_path))
            except Exception as e:
                # One unvoiceable line should not lose the whole episode.
                safe_print(f"PYMSG: [podcast_audio] turn {index + 1} failed ({e}); skipping it.")
                continue

            if not os.path.exists(clip_path) or os.path.getsize(clip_path) < 512:
                safe_print(f"PYMSG: [podcast_audio] turn {index + 1} produced no audio; skipping it.")
                continue

            combined += AudioSegment.from_mp3(clip_path) + gap
            rendered += 1

            if on_progress:
                on_progress(int(10 + (index + 1) / len(speakable) * 75))

        if rendered == 0:
            raise RuntimeError("No turns could be voiced.")

        combined.export(output_path, format="mp3", bitrate="160k")
        safe_print(f"PYMSG: [podcast_audio] rendered {rendered}/{len(speakable)} turns "
                   f"({len(combined) / 1000:.0f}s)")
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)

    if MASTER:
        try:
            from agents.audio_master import master_audio

            master_audio(output_path)
        except Exception as e:
            safe_print(f"PYMSG: [podcast_audio] mastering skipped ({e}).")

    return os.path.abspath(output_path)


def _main() -> None:
    import argparse
    import json

    parser = argparse.ArgumentParser(description="Render a two-host podcast from study notes.")
    parser.add_argument("--notes-file", required=True, help="JSON file with the notes to discuss")
    parser.add_argument("--out", required=True, help="where to write the mp3")
    args = parser.parse_args()

    try:
        with open(args.notes_file, "r", encoding="utf-8") as f:
            payload = json.load(f)

        title = payload.get("title") or "these notes"
        markdown = payload.get("markdown") or ""
        if not markdown.strip():
            safe_print("FAILED:There are no notes to build a podcast from.", flush=True)
            sys.exit(1)

        safe_print("PROGRESS:5", flush=True)
        from agents.podcast_writer import write_podcast

        turns = write_podcast(markdown, title)
        if not turns:
            safe_print("FAILED:Could not write the conversation.", flush=True)
            sys.exit(1)
        safe_print(f"PYMSG: [podcast_audio] dialogue has {len(turns)} turns", flush=True)
        safe_print("PROGRESS:10", flush=True)

        path = render_podcast(
            turns,
            args.out,
            on_progress=lambda pct: safe_print(f"PROGRESS:{pct}", flush=True),
        )

        safe_print("PROGRESS:100", flush=True)
        safe_print(f"PODCAST_PATH:{path}", flush=True)
        safe_print(f"COMPLETED:{path}", flush=True)

    except Exception as e:
        safe_print(f"FAILED:{type(e).__name__}: {e}", flush=True)
        safe_print(traceback.format_exc())
        sys.exit(1)


if __name__ == "__main__":
    _main()
