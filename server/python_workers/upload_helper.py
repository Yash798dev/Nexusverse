#!/usr/bin/env python3
import sys, os, traceback

# args: file_path, youtube_email
if len(sys.argv) < 3:
    print("UPLOAD_FAILED:Missing args")
    sys.exit(1)

file_path = sys.argv[1]
youtube_email = sys.argv[2]

try:
    # adjust path to your project import path if necessary
    # ensure PYTHONPATH includes the repo root
    sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
    from agents.upload_to_YT import upload_video  # your existing uploader

    # NOTE: upload_video must return a response with an 'id' or string id
    resp = upload_video(file_path=file_path, title=f"Auto: {os.path.basename(file_path)}", description="Uploaded via Agentic", tags=["ai","autogen"], privacy_status="unlisted")
    # extract id
    youtube_id = None
    if isinstance(resp, dict):
        youtube_id = resp.get("id") or resp.get("youtubeVideoId") or resp.get("videoId")
    elif isinstance(resp, str):
        youtube_id = resp
    else:
        youtube_id = getattr(resp, "id", None)

    if youtube_id:
        print(f"YOUTUBE_ID:{youtube_id}")
    else:
        print("UPLOAD_FAILED:No youtube id returned")
except Exception as e:
    tb = traceback.format_exc()
    print("UPLOAD_FAILED:" + str(e))
    print(tb)
    sys.exit(1)
