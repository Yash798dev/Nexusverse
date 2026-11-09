// Renders "Podcast from your notes" — a two-host discussion of one source.
//
// A render takes ~90-120 seconds (measured), so this is deliberately NOT a
// request/response endpoint: the route starts a job and the page polls. A
// synchronous version would hold a connection open past every sane timeout.
//
// The notes payload is written to the same non-served jobdata directory the
// knowledge grounding uses, and for the same reason: UPLOAD_DIR is exposed at
// /uploads, so note content written there would be publicly downloadable. Only
// the finished mp3 goes into UPLOAD_DIR, which is exactly what we want served.

const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const notesClient = require("./notesClient");

const PYTHON_BIN = process.env.PYTHON_PATH || "python";
/** The pipeline project root — `agents.podcast_audio` is resolved from here. */
const PROJECT_ROOT = process.env.PY_MAIN_PATH
  ? path.dirname(process.env.PY_MAIN_PATH)
  : path.resolve(__dirname, "../../..");
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve(__dirname, "../../uploads");
const JOB_DATA_DIR = process.env.JOB_DATA_DIR || path.resolve(__dirname, "../../jobdata");

const PODCAST_DIR = path.join(UPLOAD_DIR, "podcasts");
const PAYLOAD_DIR = path.join(JOB_DATA_DIR, "podcasts");

/** Renders are expensive; one at a time per account. */
const activeByUser = new Map();
/** sourceId -> { status, progress, url, error, startedAt } */
const jobs = new Map();

const outputPathFor = (sourceId) => path.join(PODCAST_DIR, `${sourceId}.mp3`);
/** Cache-busted so a re-render is not masked by a previously cached episode. */
const publicUrlFor = (sourceId, version) => `/uploads/podcasts/${sourceId}.mp3?v=${version}`;

class PodcastError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "PodcastError";
    this.status = status;
  }
}

/**
 * What the page should show for this source right now.
 * Falls back to disk so an episode rendered before a server restart is still
 * offered rather than appearing to have vanished.
 */
function status(sourceId) {
  const job = jobs.get(String(sourceId));
  if (job) return { ...job };

  const onDisk = outputPathFor(sourceId);
  if (fsSync.existsSync(onDisk)) {
    const { mtimeMs } = fsSync.statSync(onDisk);
    return { status: "ready", progress: 100, url: publicUrlFor(sourceId, Math.round(mtimeMs)), error: null };
  }
  return { status: "idle", progress: 0, url: null, error: null };
}

/**
 * Start a render. Returns immediately with the initial status; progress is
 * read back through status().
 */
async function start(userId, source) {
  const sourceId = source._id.toString();

  const existing = jobs.get(sourceId);
  if (existing && existing.status === "rendering") return { ...existing };

  const running = activeByUser.get(String(userId));
  if (running && running !== sourceId) {
    throw new PodcastError("A podcast is already rendering. Wait for it to finish.", 409);
  }
  if (source.status !== "completed") {
    throw new PodcastError("Wait for processing to finish before making a podcast.", 409);
  }

  // Fetch the notes now so a missing/empty source fails immediately rather
  // than 90 seconds into a render.
  const notes = await notesClient.getNotes(source.externalId);
  const markdown = notes && notes.markdown_content ? notes.markdown_content : "";
  if (!markdown.trim()) {
    throw new PodcastError("There are no notes to build a podcast from.", 409);
  }

  await fs.mkdir(PAYLOAD_DIR, { recursive: true });
  await fs.mkdir(PODCAST_DIR, { recursive: true });

  const payloadPath = path.join(PAYLOAD_DIR, `${sourceId}.json`);
  await fs.writeFile(
    payloadPath,
    JSON.stringify({ title: source.title || "these notes", markdown }),
    "utf8"
  );

  const outPath = outputPathFor(sourceId);
  const job = { status: "rendering", progress: 0, url: null, error: null, startedAt: Date.now() };
  jobs.set(sourceId, job);
  activeByUser.set(String(userId), sourceId);

  const child = spawn(
    PYTHON_BIN,
    ["-m", "agents.podcast_audio", `--notes-file=${payloadPath}`, `--out=${outPath}`],
    {
      cwd: PROJECT_ROOT, // so `agents.podcast_audio` resolves as a module
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }
  );

  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith("PROGRESS:")) {
        const pct = parseInt(line.slice(9), 10);
        if (Number.isFinite(pct)) job.progress = Math.max(job.progress, pct);
      } else if (line.startsWith("FAILED:")) {
        job.error = line.slice(7).trim();
      }
    }
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString("utf8").trim();
    if (text) console.error(`[podcast ${sourceId}] ${text.slice(0, 300)}`);
  });

  child.on("close", (code) => {
    activeByUser.delete(String(userId));
    fs.unlink(payloadPath).catch(() => {}); // the notes copy lives only for the render

    if (code === 0 && fsSync.existsSync(outPath)) {
      job.status = "ready";
      job.progress = 100;
      job.url = publicUrlFor(sourceId, Date.now());
      job.error = null;
      console.log(`[podcast ${sourceId}] ready in ${Math.round((Date.now() - job.startedAt) / 1000)}s`);
    } else {
      job.status = "failed";
      job.error = job.error || `The renderer exited with code ${code}.`;
      console.error(`[podcast ${sourceId}] failed: ${job.error}`);
    }
  });

  child.on("error", (err) => {
    activeByUser.delete(String(userId));
    job.status = "failed";
    job.error = `Could not start the renderer: ${err.message}`;
  });

  return { ...job };
}

module.exports = { start, status, PodcastError, PODCAST_DIR };
