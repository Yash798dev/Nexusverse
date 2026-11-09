"""
text_to_speech.py — Local neural narration, replacing the old edge-tts/gTTS call.

Primary engine: Coqui XTTS-v2 (via the maintained `coqui-tts` fork) running on the
local GPU (RTX 4050, 6GB) — much higher quality, expressive narration, optional
voice cloning from a short reference clip.
Fallback engine: Piper (fast, CPU-only, ONNX) — used automatically if XTTS/CUDA
isn't available, so the pipeline never hard-fails on a machine without a GPU.

Engine selection: TTS_ENGINE=xtts|piper in .env (default: xtts, auto-falls back).
"""

import os
import re
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

TTS_ENGINE = os.getenv("TTS_ENGINE", "xtts").lower()
XTTS_MODEL_NAME = os.getenv("XTTS_MODEL_NAME", "tts_models/multilingual/multi-dataset/xtts_v2")
# A file OR a directory of clips — see agents/voice_clone.py for how to record these.
# When set, this takes priority over XTTS_SPEAKER: your own voice IS the brand.
XTTS_SPEAKER_WAV = os.getenv("XTTS_SPEAKER_WAV")
XTTS_LANGUAGE = os.getenv("XTTS_LANGUAGE", "en")
# Fallback stock speaker, used only if no XTTS_SPEAKER_WAV is configured. Pinned by
# name (not speakers[0], which isn't stable across versions) so it's at least
# consistent between videos until a real voice clone is set up.
XTTS_SPEAKER = os.getenv("XTTS_SPEAKER", "Damien Black")
MASTER_AUDIO = os.getenv("MASTER_AUDIO", "true").lower() == "true"

_cloned_speaker_wavs: list[str] | None = None  # cached prepared reference clips
PIPER_MODEL_PATH = os.getenv(
    "PIPER_MODEL_PATH",
    os.path.join(os.path.dirname(__file__), "assets", "voices", "en_US-amy-medium.onnx"),
)

_xtts_engine = None  # lazily loaded, kept resident only for the duration of the process
_torchaudio_patched = False


def _patch_torchaudio_load():
    """
    coqui-tts (and torchaudio >= 2.9) route torchaudio.load() through torchcodec by
    default. torchcodec's precompiled Windows wheel can't find its FFmpeg shared
    libraries here (it needs FFmpeg's "full-shared" DLL build, not just ffmpeg.exe
    on PATH), so every reference-clip load in XTTS's voice cloning path raises
    OSError deep inside coqui-tts, well past where our own error handling can
    give a useful message. We never need torchcodec's actual decoding — every
    file XTTS loads is a plain WAV we already produced — so route torchaudio.load
    straight through soundfile instead, which has no such dependency.
    """
    global _torchaudio_patched
    if _torchaudio_patched:
        return
    import torchaudio
    import soundfile as sf
    import torch

    def _load_via_soundfile(filepath, *args, **kwargs):
        data, sr = sf.read(str(filepath), dtype="float32", always_2d=True)
        tensor = torch.from_numpy(data.T)  # soundfile: (samples, channels) -> torchaudio: (channels, samples)
        return tensor, sr

    torchaudio.load = _load_via_soundfile
    _torchaudio_patched = True


def unload_engine():
    """Free XTTS's VRAM once narration is done — on a 6GB card it can't stay
    loaded alongside the image diffusion pipeline / Whisper / CLIP."""
    global _xtts_engine
    if _xtts_engine is None:
        return
    import torch

    del _xtts_engine
    _xtts_engine = None
    torch.cuda.empty_cache()


def _get_cloned_speaker_wavs() -> list[str] | None:
    """
    Validates and caches the configured voice-clone reference clips. Returns None
    (not an empty list) if cloning isn't configured, so callers can fall back to
    the stock speaker cleanly.
    """
    global _cloned_speaker_wavs
    if not XTTS_SPEAKER_WAV:
        return None
    if _cloned_speaker_wavs is not None:
        return _cloned_speaker_wavs

    from agents.voice_clone import prepare_reference_clips

    _cloned_speaker_wavs = prepare_reference_clips(XTTS_SPEAKER_WAV)
    return _cloned_speaker_wavs


def _split_into_chunks(script: str, max_chars: int = 250) -> list[str]:
    """Split narration into sentence-bounded chunks so long scripts don't blow past
    the TTS model's max input length, and so pacing/pauses land on sentence breaks."""
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", script) if s.strip()]
    chunks, current = [], ""
    for sentence in sentences:
        candidate = f"{current} {sentence}".strip() if current else sentence
        if len(candidate) > max_chars and current:
            chunks.append(current)
            current = sentence
        else:
            current = candidate
    if current:
        chunks.append(current)
    return chunks or [script]


def _generate_with_xtts(script: str, output_path: str) -> str:
    global _xtts_engine
    # XTTS-v2 is distributed under Coqui's non-commercial CPML license; this project
    # is a paid product, so treat XTTS as a local/dev quality bar and swap in a
    # commercially-licensed voice (Piper voices are MIT/CC0) before shipping to users.
    os.environ.setdefault("COQUI_TOS_AGREED", "1")
    _patch_torchaudio_load()
    import torch
    from TTS.api import TTS as CoquiTTS
    from pydub import AudioSegment

    if _xtts_engine is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"[text_to_speech] Loading XTTS-v2 on {device}...", flush=True)
        _xtts_engine = CoquiTTS(XTTS_MODEL_NAME).to(device)

    chunks = _split_into_chunks(script)
    tmp_dir = Path(output_path).parent / "_tts_chunks"
    tmp_dir.mkdir(parents=True, exist_ok=True)

    combined = AudioSegment.empty()
    pause = AudioSegment.silent(duration=250)
    for i, chunk in enumerate(chunks):
        chunk_path = tmp_dir / f"chunk_{i:03d}.wav"
        kwargs = {"text": chunk, "language": XTTS_LANGUAGE, "file_path": str(chunk_path)}
        cloned_refs = _get_cloned_speaker_wavs()
        if cloned_refs:
            # multiple clips get averaged by XTTS into one steadier conditioning
            # embedding — a more robust clone than any single reference clip
            kwargs["speaker_wav"] = cloned_refs
            # XTTS defaults to sampling only 6s of reference audio for conditioning
            # (gpt_cond_len) even when far more is available. With 60-90s of clean
            # reference on hand, use close to the model's max (30s) — more source
            # signal per clone pass measurably improves similarity.
            # (max_ref_length is NOT accepted at this call layer — passing it throws
            # "not used by the model" deep inside generate() and kills the whole call.)
            kwargs["gpt_cond_len"] = 30
        else:
            available = getattr(_xtts_engine, "speakers", None) or []
            # pin the configured speaker so the channel voice never drifts between videos
            kwargs["speaker"] = XTTS_SPEAKER if XTTS_SPEAKER in available else (available[0] if available else None)
        _xtts_engine.tts_to_file(**kwargs)
        combined += AudioSegment.from_wav(str(chunk_path)) + pause

    combined.export(output_path, format="mp3")

    for f in tmp_dir.glob("chunk_*.wav"):
        f.unlink(missing_ok=True)
    tmp_dir.rmdir()

    return output_path


EDGE_VOICE = os.getenv("EDGE_VOICE", "en-US-AvaNeural")


def _generate_with_edge(script: str, output_path: str, voice: str | None = None) -> str:
    """
    Microsoft Edge neural voices.

    Promoted to a first-class engine so the Studio's voice picker can actually
    change the narrator: XTTS is pinned to one cloned/configured speaker, and
    Piper to one downloaded model, so neither can honour a per-video choice.
    Edge offers hundreds of named voices, needs no GPU, and leaves the card free.
    """
    import asyncio
    import edge_tts

    chosen = (voice or EDGE_VOICE).strip()

    async def _synthesize():
        await edge_tts.Communicate(script, chosen).save(output_path)

    asyncio.run(_synthesize())
    print(f"[text_to_speech] Edge voice: {chosen}", flush=True)
    return output_path


def _generate_with_piper(script: str, output_path: str) -> str:
    import wave
    from piper import PiperVoice
    from pydub import AudioSegment

    if not os.path.exists(PIPER_MODEL_PATH):
        raise FileNotFoundError(
            f"Piper voice model not found at {PIPER_MODEL_PATH}. "
            "Download one from https://github.com/rhasspy/piper/releases and set PIPER_MODEL_PATH."
        )

    voice = PiperVoice.load(PIPER_MODEL_PATH)
    wav_path = str(Path(output_path).with_suffix(".wav"))
    with wave.open(wav_path, "wb") as wav_file:
        voice.synthesize(script, wav_file)

    AudioSegment.from_wav(wav_path).export(output_path, format="mp3")
    os.remove(wav_path)
    return output_path


def generate_audio(script: str, output_path: str = "audiofile.mp3", voice: str | None = None) -> str:
    """
    Convert `script` to narration audio. Tries the configured TTS_ENGINE first
    (xtts by default); on any failure (no GPU, model not downloaded yet, missing
    dependency) falls back to Piper, then to the old Edge-TTS as a last resort so
    a job never dies solely because a local model isn't set up on this machine.
    """
    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)
    out = str(output_file)

    def _finish(path: str) -> str:
        # Master whichever engine produced the audio, so loudness/clarity/pacing are
        # identical regardless of which fallback ran.
        if MASTER_AUDIO:
            from agents.audio_master import master_audio

            path = master_audio(path)
        return str(Path(path).resolve())

    # A caller that named a voice wants Edge, since it is the only engine here
    # that can honour one; otherwise the configured engine leads.
    preferred = "edge" if voice else TTS_ENGINE
    engines = [preferred] + [e for e in ("xtts", "piper", "edge") if e != preferred]

    last_error = None
    for engine in engines:
        try:
            if engine == "xtts":
                return _finish(_generate_with_xtts(script, out))
            elif engine == "piper":
                return _finish(_generate_with_piper(script, out))
            elif engine == "edge":
                return _finish(_generate_with_edge(script, out, voice))
        except Exception as e:
            print(f"[text_to_speech] Engine '{engine}' failed: {e}", flush=True)
            last_error = e

    print(f"[text_to_speech] All local engines failed ({last_error}); falling back to Edge-TTS.", flush=True)
    import asyncio
    import edge_tts

    async def _edge_synthesize():
        communicate = edge_tts.Communicate(script, voice or "en-AU-NatashaNeural")
        await communicate.save(out)

    asyncio.run(_edge_synthesize())
    return _finish(out)
