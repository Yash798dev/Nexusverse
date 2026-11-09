# Starts the NexusNotes ingest service (FastAPI) on port 8100.
#
# Two things this script exists to get right:
#
# 1. PORT. The service used to default to 8000, which is the Express API's port —
#    the two could never run at the same time. Nothing in the Python changed;
#    the port is a command-line argument.
#
# 2. INTERPRETER. `uvicorn` on PATH resolves to the Agentic YouTube venv's copy
#    (Python 3.10), which does NOT have fastapi, opencv or whisper installed —
#    starting it that way fails with an import error. NexusNotes' dependencies
#    live in the system Python 3.13 install, so that interpreter is pinned here.
#    (backend\venv exists but is a broken partial venv with no python.exe.)
#
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\start-notes.ps1

$ErrorActionPreference = 'Stop'

$NotesRoot = 'C:\Users\yashw\Desktop\nexusnotes\backend'
$Python = 'C:\Users\yashw\AppData\Local\Programs\Python\Python313\python.exe'
$Port = 8100

if (-not (Test-Path $NotesRoot)) { throw "NexusNotes backend not found at $NotesRoot" }
if (-not (Test-Path $Python))    { throw "Python 3.13 not found at $Python" }

# Fail early with a clear message rather than a stack trace from inside uvicorn.
& $Python -c "import fastapi, uvicorn, yt_dlp, whisper, cv2" 2>$null
if ($LASTEXITCODE -ne 0) {
  throw "NexusNotes dependencies are missing from $Python. Run: pip install -r requirements.txt"
}

Write-Host "Starting NexusNotes ingest service on http://127.0.0.1:$Port ..." -ForegroundColor Cyan
Set-Location $NotesRoot
& $Python -m uvicorn main:app --host 127.0.0.1 --port $Port --reload
