"""
agents/bg_music.py — Mood-matched background music selection + mixing.

Old version always mixed in whichever single bg_music_1.mp3 asset it found. This
version runs a lightweight local sentiment/emotion classifier over the script and
picks the best-matching track from a small local mood library
(agents/assets/music/<mood>/*.mp3), falling back to the old single-asset behavior
if no mood library or classifier is available.
"""

import os
import glob
import random
from moviepy.editor import VideoFileClip, AudioFileClip, CompositeAudioClip

MUSIC_LIBRARY_DIR = os.getenv(
    "MUSIC_LIBRARY_DIR", os.path.join(os.path.dirname(__file__), "assets", "music")
)
EMOTION_MODEL = os.getenv("EMOTION_MODEL", "j-hartmann/emotion-english-distilroberta-base")

# Map the emotion classifier's labels to mood folders we expect in MUSIC_LIBRARY_DIR.
EMOTION_TO_MOOD = {
    "joy": "upbeat",
    "surprise": "upbeat",
    "neutral": "calm",
    "sadness": "somber",
    "fear": "tense",
    "anger": "tense",
    "disgust": "tense",
}

_emotion_pipeline = None


def _load_emotion_pipeline():
    global _emotion_pipeline
    if _emotion_pipeline is not None:
        return _emotion_pipeline
    from transformers import pipeline

    _emotion_pipeline = pipeline("text-classification", model=EMOTION_MODEL, top_k=1)
    return _emotion_pipeline


def pick_music_for_script(script: str) -> str | None:
    """
    Returns a local track path matching the script's dominant mood, or None if no
    mood library / classifier is available (caller should fall back to a default asset).
    """
    if not os.path.isdir(MUSIC_LIBRARY_DIR):
        return None

    mood = "calm"
    try:
        classifier = _load_emotion_pipeline()
        result = classifier(script[:512])
        label = result[0][0]["label"].lower() if result and result[0] else "neutral"
        mood = EMOTION_TO_MOOD.get(label, "calm")
        print(f"PYMSG: [bg_music] script emotion={label} -> mood={mood}", flush=True)
    except Exception as e:
        print(f"PYMSG: [bg_music] emotion classification unavailable ({e}); defaulting to 'calm'.", flush=True)

    candidates = glob.glob(os.path.join(MUSIC_LIBRARY_DIR, mood, "*.mp3"))
    if not candidates:
        candidates = glob.glob(os.path.join(MUSIC_LIBRARY_DIR, "**", "*.mp3"), recursive=True)
    return random.choice(candidates) if candidates else None


def add_background_music_to_video(
    video_path: str,
    bg_music_path: str,
    output_path: str = "final_with_music.mp4",
    bg_volume: float = 0.2
) -> str:
    """
    Overlays background music over existing video narration, ducked under the
    narration so dialogue stays intelligible.
    """
    if not os.path.exists(video_path):
        raise FileNotFoundError("Video file not found.")
    if not os.path.exists(bg_music_path):
        raise FileNotFoundError("Background music not found.")

    video = VideoFileClip(video_path)
    narration = video.audio
    bg_music = AudioFileClip(bg_music_path).volumex(bg_volume).set_duration(video.duration)

    combined_audio = CompositeAudioClip([bg_music, narration])
    video = video.set_audio(combined_audio)
    video.write_videofile(output_path, codec="libx264", audio_codec="aac", logger=None)

    return output_path
