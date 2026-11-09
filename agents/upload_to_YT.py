# agents/youtube_uploader.py

import os
from dotenv import load_dotenv
load_dotenv()
import pickle
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

# OAuth Scopes
SCOPES = ["https://www.googleapis.com/auth/youtube.upload",
          "https://www.googleapis.com/auth/youtube.readonly"]

# Path to your client_secret JSON downloaded from Google Cloud
# Prefer setting `CLIENT_SECRETS_FILE` in your environment or in `.env`.
CLIENT_SECRETS_FILE = os.getenv(
    "CLIENT_SECRETS_FILE",
    os.path.join(os.path.dirname(__file__), "..", "client_secret_625503251573-ee6v09qpbvav8i3mg1dotlcfcg94htl5.apps.googleusercontent.com.json")
)
CREDENTIALS_PICKLE = "youtube_credentials.pkl"

def get_authenticated_service():
    creds = None
    # Load saved credentials
    if os.path.exists(CREDENTIALS_PICKLE):
        with open(CREDENTIALS_PICKLE, "rb") as f:
            creds = pickle.load(f)

    # If no valid credentials, run OAuth browser flow
    if not creds or not creds.valid:
        flow = InstalledAppFlow.from_client_secrets_file(
            CLIENT_SECRETS_FILE, SCOPES
        )
        # Browser login
        creds = flow.run_local_server(port=0)
        with open(CREDENTIALS_PICKLE, "wb") as f:
            pickle.dump(creds, f)

    service = build("youtube", "v3", credentials=creds)
    return service

def get_user_channel(service):
    """Return the first channel ID of the logged-in user, or None if no channel exists."""
    request = service.channels().list(part="id,snippet", mine=True)
    response = request.execute()
    if response["items"]:
        channel = response["items"][0]
        print(f"Logged-in user channel: {channel['snippet']['title']} ({channel['id']})")
        return channel["id"]
    else:
        print("No YouTube channel found for this account.")
        return None

def upload_video(file_path: str, title: str, description: str, tags=None, category_id="22", privacy_status="public"):
    """
    Uploads a video to the user's YouTube channel.
    """
    service = get_authenticated_service()
    channel_id = get_user_channel(service)
    if not channel_id:
        raise Exception("This Google account has no YouTube channel!")

    body = {
        "snippet": {
            "title": title,
            "description": description,
            "tags": tags or [],
            "categoryId": category_id
        },
        "status": {
            "privacyStatus": privacy_status
        }
    }

    media = MediaFileUpload(file_path, chunksize=-1, resumable=True)
    request = service.videos().insert(
        part="snippet,status",
        body=body,
        media_body=media
    )

    response = None
    while response is None:
        status, response = request.next_chunk()
        if status:
            print(f"Upload progress: {int(status.progress() * 100)}%")

    print("Upload Complete! Video ID:", response.get("id"))
    return response
