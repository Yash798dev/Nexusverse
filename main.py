# main.py

import os
from dotenv import load_dotenv
load_dotenv()
import streamlit as st
from moviepy.editor import VideoFileClip, AudioFileClip
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

from agents.info_generator import video_script_generator, image_generator
from agents.text_to_speech import generate_audio
from agents.image_generation import generate_images
# old alias for stock‑clip generator
from agents.video_generation import generate_animated_video_with_stock as generate_animated_video
from agents.bg_music import add_background_music_to_video
from agents.captioned_video import burn_subtitles_with_ffmpeg

# YouTube API OAuth2 scopes & client secrets
YOUTUBE_SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]
# Prefer setting `CLIENT_SECRETS_FILE` in your environment or `.env`
CLIENT_SECRETS_FILE = os.getenv(
    "CLIENT_SECRETS_FILE",
    os.path.join(os.path.dirname(__file__), "client_secret_625503251573-ee6v09qpbvav8i3mg1dotlcfcg94htl5.apps.googleusercontent.com.json")
)

st.set_page_config(page_title="YouTube Content Generator", layout="wide")

# --- Session State Init ---
for key in (
    "script", "audio_file", "image_prompts", "image_paths",
    "video_path", "final_video_with_music", "final_video_with_captions",
    "youtube_video_id"
):
    st.session_state.setdefault(key, None)

st.title("🎥 YouTube Content + Stock + AI Images + Audio + Video + Captions + Upload")

# 1) Topic → Script
topic = st.text_input("📌 Enter your video topic")
if st.button("Generate Script"):
    if not topic:
        st.warning("Enter a topic first.")
    else:
        st.session_state.script = video_script_generator(topic)

# 2) Script → Audio
if st.session_state.script:
    st.subheader("📖 Script")
    st.write(st.session_state.script)
    if st.button("Generate Audio"):
        st.session_state.audio_file = generate_audio(
            st.session_state.script,
            output_path="script_audio.mp3",
            voice="en-AU-NatashaNeural"
        )

# 3) Play Audio
if st.session_state.audio_file:
    st.success("✅ Audio ready")
    st.audio(st.session_state.audio_file)

# 4) Generate Image Prompts
if st.button("Generate Image Prompts"):
    raw = image_generator(topic)
    prompts = raw if isinstance(raw, list) else [
        line.strip() for line in str(raw).splitlines() if line.strip()
    ]
    st.session_state.image_prompts = prompts

# 5) Show Prompts → Generate Images
if st.session_state.image_prompts:
    st.subheader("🖼️ Image Prompts")
    for i,p in enumerate(st.session_state.image_prompts,1): st.write(f"{i}. {p}")
    if st.button("Generate AI Images"):
        st.session_state.image_paths = generate_images(
            st.session_state.image_prompts, num_images_per_prompt=1
        )

# 6) Show Images → Build Video
if st.session_state.image_paths:
    st.subheader("🌟 AI‑Generated Images")
    cols = st.columns(3)
    for i,path in enumerate(st.session_state.image_paths):
        cols[i%3].image(path, use_container_width=True)

    if st.button("🎬 Generate Video"):
        st.session_state.video_path = generate_animated_video(
            topic,
            st.session_state.image_paths,
            st.session_state.audio_file,
            output_path="final_video.mp4"
        )
        st.success("✅ Video generated!")
        st.video(st.session_state.video_path)

# 7) Add Background Music
if st.session_state.video_path:
    st.subheader("🎶 Add Background Music")
    bg = "assets/bg_music_1.mp3"
    if os.path.exists(bg) and st.button("Mix Music"):
        st.session_state.final_video_with_music = add_background_music_to_video(
            video_path=st.session_state.video_path,
            bg_music_path=bg,
            output_path="video_with_music.mp4"
        )
        st.success("✅ Music added!")
        st.video(st.session_state.final_video_with_music)

# 8) Burn Captions via FFmpeg
if st.session_state.final_video_with_music:
    st.subheader("💬 Burn Captions")
    if st.button("Burn Captions"):
        # build simple 12‑word captions list
        words = st.session_state.script.split()
        chunk = 12
        audio = AudioFileClip(st.session_state.audio_file)
        per = audio.duration / (len(words)/chunk)
        caps = []
        for i in range(0,len(words),chunk):
            start = (i//chunk)*per
            end   = start+per
            text = " ".join(words[i:i+chunk])
            caps.append((start,end,text))
        st.session_state.final_video_with_captions = burn_subtitles_with_ffmpeg(
            video_path=st.session_state.final_video_with_music,
            captions=caps,
            output_path="final_captioned_video.mp4",
            font="Arial", font_size=20, font_color="FFFFFF"
        )
        st.success("✅ Captions burned!")
        st.video(st.session_state.final_video_with_captions)

# 9) Upload to YouTube
def upload_to_youtube(video_file, title, description="", tags=None, privacy="unlisted"):
    flow = InstalledAppFlow.from_client_secrets_file(CLIENT_SECRETS_FILE, YOUTUBE_SCOPES)
    creds = flow.run_console()
    yt = build("youtube", "v3", credentials=creds)
    body = {
        "snippet": {
            "title": title,
            "description": description,
            "tags": tags or [],
            "categoryId": "27"  # Education
        },
        "status": {
            "privacyStatus": privacy
        }
    }
    media = MediaFileUpload(video_file, chunksize=-1, resumable=True)
    req = yt.videos().insert(part="snippet,status", body=body, media_body=media)
    resp = None
    while resp is None:
        status, resp = req.next_chunk()
    return resp["id"]

if st.session_state.final_video_with_captions:
    st.subheader("📤 Upload to YouTube")
    title = st.text_input("Video Title", value=topic[:60])
    desc  = st.text_area("Description", value=st.session_state.script[:200])
    tags  = st.text_input("Tags (comma‑separated)")
    privacy = st.selectbox("Privacy", ["public","unlisted","private"])
    if st.button("Upload"):
        vid_id = upload_to_youtube(
            st.session_state.final_video_with_captions,
            title,
            desc,
            [t.strip() for t in tags.split(",") if t.strip()],
            privacy
        )
        st.success(f"✅ Uploaded! → https://youtu.be/{vid_id}")
