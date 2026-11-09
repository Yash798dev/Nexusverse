// HTTP client for the NexusNotes ingest service (FastAPI, default :8100).
//
// The browser never calls that service directly: it has no authentication of
// its own, so anything it exposed would be world-readable and world-runnable.
// Express is the only caller, and it attaches the user identity, which is what
// makes a note belong to somebody.
//
// Node 18+ ships a global fetch, so this needs no dependency.

const NOTES_BASE = (process.env.NOTES_SERVICE_URL || "http://localhost:8100").replace(/\/+$/, "");

/** How long a normal (non-streaming) call may take before we give up. */
const REQUEST_TIMEOUT_MS = 20000;

class NotesServiceError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "NotesServiceError";
    this.status = status || 502;
  }
}

async function request(path, { method = "GET", body, timeout = REQUEST_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${NOTES_BASE}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (!res.ok) {
      // Pass the service's own 404/409 through rather than flattening to 502,
      // so "not found" and "already running" stay meaningful to the caller.
      let detail = `notes service responded ${res.status}`;
      try {
        const payload = await res.json();
        if (payload && payload.detail) detail = payload.detail;
      } catch {
        /* non-JSON error body — keep the generic message */
      }
      throw new NotesServiceError(detail, res.status);
    }
    return res.json();
  } catch (err) {
    if (err instanceof NotesServiceError) throw err;
    if (err.name === "AbortError") {
      throw new NotesServiceError("The notes service did not respond in time.", 504);
    }
    throw new NotesServiceError(`Could not reach the notes service: ${err.message}`, 502);
  } finally {
    clearTimeout(timer);
  }
}

/** Start the ingest pipeline. Returns { video_id, message }. */
function startIngest(url, ownerId) {
  return request("/api/process-video", { method: "POST", body: { url, owner_id: ownerId } });
}

/** Resume a failed job from its last checkpoint. */
function retryIngest(videoId) {
  return request(`/api/retry/${encodeURIComponent(videoId)}`, { method: "POST" });
}

function getStatus(videoId) {
  return request(`/api/status/${encodeURIComponent(videoId)}`);
}

function getNotes(videoId) {
  return request(`/api/notes/${encodeURIComponent(videoId)}`);
}

function getQuiz(videoId) {
  return request(`/api/quiz/${encodeURIComponent(videoId)}`);
}

/** Generate recall cards from a video's notes. Waits on a model, so give it room. */
function getFlashcards(videoId, count = 12) {
  return request(`/api/flashcards/${encodeURIComponent(videoId)}?count=${encodeURIComponent(count)}`, {
    timeout: 90000,
  });
}

/**
 * Ask a question about one video. Allowed a longer timeout than other calls:
 * it waits on a language model, not a database read.
 */
function chat(videoId, question, history) {
  return request(`/api/chat/${encodeURIComponent(videoId)}`, {
    method: "POST",
    body: { question, history },
    timeout: 60000,
  });
}

/**
 * Open the service's Server-Sent Events progress stream.
 * Returns the raw fetch Response so the caller can pipe the body straight to
 * the browser; `signal` lets the caller abort it when the browser disconnects.
 */
async function openProgressStream(videoId, signal) {
  const res = await fetch(`${NOTES_BASE}/api/progress/${encodeURIComponent(videoId)}`, {
    headers: { Accept: "text/event-stream" },
    signal,
  });
  if (!res.ok || !res.body) {
    throw new NotesServiceError(`progress stream unavailable (${res.status})`, 502);
  }
  return res;
}

/** Absolute URL for a keyframe image the notes service holds. */
function keyframeUrl(path) {
  return `${NOTES_BASE}/api/keyframe?path=${encodeURIComponent(path)}`;
}

module.exports = {
  NotesServiceError,
  startIngest,
  retryIngest,
  getStatus,
  getNotes,
  getQuiz,
  getFlashcards,
  chat,
  openProgressStream,
  keyframeUrl,
  NOTES_BASE,
};
