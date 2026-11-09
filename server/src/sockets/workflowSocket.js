// Workflow page ⇄ server ⇄ main_new.py
//
// The only way a video run starts: a signed-in user submits a prompt on the
// Workflow page, the page sends it over this socket, and the server
//   1. authenticates the socket with the user's JWT,
//   2. validates the prompt and charges the video's credits atomically,
//   3. creates the VideoJob record,
//   4. spawns main_new.py with --prompt / --job-id (it has no prompt of its own),
// then streams the run back to that user only, records the outcome on the job,
// and lets the same user pause, resume or cancel it — from any of their tabs,
// including after a page reload.
//
// While it runs, main_new.py also reports what it has produced (ARTIFACT: lines —
// research, script, scenes, images, narration, cuts, QA). Those are forwarded as
// `workflow_artifact`, with file paths turned into /uploads URLs, and kept on the
// job so a reconnecting page can show everything made so far.
const path = require("path");
const jwt = require("jsonwebtoken");
const { spawn } = require("child_process");
const User = require("../models/User");
const VideoJob = require("../models/VideoJob");
const { COST_PER_VIDEO } = require("../config/credits");
const { treeSpawnOptions, suspendTree, resumeTree, killTree } = require("../services/processControl");
const {
  buildKnowledgeFile,
  cleanupKnowledgeFile,
  KnowledgeSelectionError,
} = require("../services/knowledgeGrounding");

const PYTHON_BIN = process.env.PYTHON_PATH || "python";
const PY_MAIN = process.env.PY_MAIN_PATH || path.resolve(__dirname, "../../../main_new.py");
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve(__dirname, "../uploads");
const MAX_PROMPT_LENGTH = 500;

// Per-video settings from the Studio. Everything is whitelisted rather than
// forwarded: these become command-line arguments and environment variables for
// a spawned process, so an unchecked value from the page has no business here.
const TONES = ["educational", "conversational", "punchy", "storytelling", "professional"];
const ORIENTATIONS = { portrait: "portrait", landscape: "landscape" };
/** Edge-TTS voice names, e.g. "en-US-AvaNeural". */
const VOICE_PATTERN = /^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$/;
/** BCP-47-ish language tags XTTS/Edge accept. */
const LANGUAGE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;
const MIN_DURATION = 15;
const MAX_DURATION = 900;

/** Coerce whatever the page sent into settings that are safe to spawn with. */
function sanitizeConfig(raw = {}) {
  const config = {};

  const duration = Number.parseInt(raw.durationSeconds, 10);
  if (Number.isFinite(duration)) {
    config.durationSeconds = Math.max(MIN_DURATION, Math.min(MAX_DURATION, duration));
  }
  if (typeof raw.tone === "string" && TONES.includes(raw.tone)) config.tone = raw.tone;
  if (typeof raw.voice === "string" && VOICE_PATTERN.test(raw.voice)) config.voice = raw.voice;
  if (typeof raw.language === "string" && LANGUAGE_PATTERN.test(raw.language)) config.language = raw.language;
  if (ORIENTATIONS[raw.orientation]) config.orientation = ORIENTATIONS[raw.orientation];
  config.reviewScript = raw.reviewScript === true;

  return config;
}
/** Artifacts kept per job for reconnecting pages (a run produces ~20–30). */
const MAX_ARTIFACTS = 120;

/** userId -> the pipeline that user is running (at most one per user). */
const activeJobs = new Map();
/** Placeholder that claims a user's slot while their job is being created. */
const STARTING = Symbol("starting");

const userRoom = (userId) => `user_${userId}`;
/** "VIDEO_PATH:C:\\a\\b.mp4" -> "C:\\a\\b.mp4" (split(":") would cut Windows paths at the drive letter). */
const valueAfterColon = (line) => line.slice(line.indexOf(":") + 1).trim();

/**
 * URL for a file main_new.py wrote, if it lives under UPLOAD_DIR (which app.js
 * serves at /uploads). Anything outside is not exposed. File names are reused on
 * every run, so a version query keeps browsers from showing a previous run's file.
 */
function uploadUrl(filePath, version) {
  if (typeof filePath !== "string" || !filePath) return null;
  const relative = path.relative(path.resolve(UPLOAD_DIR), path.resolve(filePath));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return `/uploads/${relative.split(path.sep).map(encodeURIComponent).join("/")}?v=${version}`;
}

/** Parse an ARTIFACT: payload into what the page receives. */
function toClientArtifact(json, jobId) {
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (!data || typeof data.kind !== "string") return null;
  const { path: filePath, ...rest } = data;
  const artifact = { ...rest, at: Date.now() };
  if (filePath !== undefined) artifact.url = uploadUrl(filePath, `${jobId}-${artifact.at}`);
  return artifact;
}

function registerWorkflowSocket(io) {
  // Only signed-in users may connect — the same JWT the REST API accepts.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth && socket.handshake.auth.token;
      if (!token) return next(new Error("UNAUTHORIZED"));
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(payload.id).select("_id").lean();
      if (!user) return next(new Error("UNAUTHORIZED"));
      socket.data.userId = user._id.toString();
      next();
    } catch (err) {
      next(new Error("UNAUTHORIZED"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId;
    const room = userRoom(userId);
    const emitToUser = (event, payload) => io.to(room).emit(event, payload);
    const refund = () =>
      User.updateOne({ _id: userId }, { $inc: { credits: COST_PER_VIDEO } })
        .catch((err) => console.error(`credit refund for ${userId} failed:`, err.message));

    socket.join(room);
    console.log("socket connected", socket.id, "user", userId);

    // A reload, a second tab or another page picks up the job that is already running.
    const current = activeJobs.get(userId);
    if (current && current !== STARTING) {
      socket.emit("workflow_active", {
        jobId: current.jobId,
        prompt: current.prompt,
        paused: current.paused,
        progress: current.progress,
        stage: current.stage,
        artifacts: current.artifacts,
        knowledgeTitles: current.knowledgeTitles || [],
      });
    }

    // ---------------------------------------------------------------- start

    socket.on("start_workflow", (payload) => {
      startWorkflow(payload).catch((err) => console.error("start_workflow crashed:", err));
    });

    /**
     * The user's answer to a script review: their edit, an unchanged draft, or
     * a cancellation. The pipeline is blocked on a single line of stdin, so
     * exactly one line goes back.
     */
    socket.on("submit_script", (payload = {}) => {
      const record = activeJobs.get(userId);
      if (!record || record === STARTING || !record.awaitingScript) {
        socket.emit("workflow_control_error", {
          action: "submit_script",
          code: "NO_JOB",
          error: "No script is waiting for review.",
        });
        return;
      }

      const cancel = payload.cancel === true;
      const script = typeof payload.script === "string" ? payload.script.trim() : null;
      const reply = cancel ? { cancel: true } : { script: script || null };

      try {
        record.child.stdin.write(`${JSON.stringify(reply)}\n`);
        record.awaitingScript = false;
        emitToUser("workflow_script_accepted", { jobId: record.jobId, cancelled: cancel });
      } catch (err) {
        console.error(`submit_script for ${record.jobId} failed:`, err.message);
        socket.emit("workflow_control_error", {
          action: "submit_script",
          code: "FAILED",
          error: "Could not send the script back to the pipeline.",
        });
      }
    });

    async function startWorkflow(payload = {}) {
      const reject = (code, error, extra = {}) => socket.emit("workflow_rejected", { code, error, ...extra });

      const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
      // Optional: a run started from the Knowledge Hub, grounded in the user's
      // own documents rather than web research.
      const knowledgeSourceIds = Array.isArray(payload.knowledgeSourceIds)
        ? payload.knowledgeSourceIds.filter((id) => typeof id === "string" && id)
        : [];
      const config = sanitizeConfig(payload.config);
      if (!prompt) return reject("INVALID_PROMPT", "Enter a prompt to start a video.");
      if (prompt.length > MAX_PROMPT_LENGTH) {
        return reject("INVALID_PROMPT", `Keep the prompt under ${MAX_PROMPT_LENGTH} characters.`);
      }
      if (activeJobs.has(userId)) {
        return reject("ALREADY_RUNNING", "A job is already running. Pause or clear it first.");
      }

      activeJobs.set(userId, STARTING); // claim the slot before any await
      let charged = false;
      try {
        // Charge only if the balance covers the video — a single atomic update.
        const user = await User.findOneAndUpdate(
          { _id: userId, credits: { $gte: COST_PER_VIDEO } },
          { $inc: { credits: -COST_PER_VIDEO } },
          { new: true }
        );
        if (!user) {
          activeJobs.delete(userId);
          const balance = await User.findById(userId).select("credits").lean();
          return reject("INSUFFICIENT_CREDITS", `Each video costs ${COST_PER_VIDEO} credits.`, {
            needed: COST_PER_VIDEO,
            current: balance ? balance.credits : 0,
          });
        }
        charged = true;

        const job = await VideoJob.create({
          user: userId,
          prompt,
          status: "running",
          costCredits: COST_PER_VIDEO,
          config,
        });
        const jobId = job._id.toString();

        // Gather the selected notes before the pipeline starts, so a bad
        // selection fails here — with the credits handed back — rather than
        // minutes into a run.
        let knowledgeFile = null;
        let knowledgeTitles = [];
        if (knowledgeSourceIds.length) {
          try {
            const built = await buildKnowledgeFile(userId, knowledgeSourceIds, jobId);
            knowledgeFile = built.filePath;
            knowledgeTitles = built.sources.map((s) => s.title);
            await VideoJob.updateOne(
              { _id: jobId },
              { $set: { knowledgeSources: knowledgeSourceIds, knowledgeTitles } }
            );
            console.log(`start_workflow user=${userId} job=${jobId} grounded in: ${knowledgeTitles.join(", ")}`);
          } catch (err) {
            if (err instanceof KnowledgeSelectionError) {
              activeJobs.delete(userId);
              await refund();
              await VideoJob.updateOne({ _id: jobId }, { $set: { status: "failed", error: err.message } });
              return reject("INVALID_KNOWLEDGE", err.message);
            }
            throw err;
          }
        }

        launch(jobId, prompt, user.credits, knowledgeFile, knowledgeTitles, config);
      } catch (err) {
        console.error("start_workflow failed:", err);
        activeJobs.delete(userId);
        if (charged) await refund();
        reject("FAILED", "Could not start the job. Please try again.");
      }
    }

    function launch(jobId, prompt, creditsLeft, knowledgeFile = null, knowledgeTitles = [], config = {}) {
      const saveJob = (updates) =>
        VideoJob.updateOne({ _id: jobId }, { $set: updates })
          .catch((err) => console.error(`VideoJob ${jobId} update failed:`, err.message));

      // Arguments go straight to the process (no shell), so the prompt needs no escaping.
      const args = [PY_MAIN, `--prompt=${prompt}`, `--job-id=${jobId}`];
      // Absent for an ordinary run, which behaves exactly as it always has.
      if (knowledgeFile) args.push(`--knowledge-file=${knowledgeFile}`);
      if (config.durationSeconds) args.push(`--duration=${config.durationSeconds}`);
      if (config.tone) args.push(`--tone=${config.tone}`);
      if (config.voice) args.push(`--voice=${config.voice}`);
      if (config.reviewScript) args.push("--review-script");

      // Orientation and language reach the pipeline as environment variables
      // rather than arguments: the modules that read them (video_effects.get_canvas,
      // text_to_speech) call os.getenv at import/call time, well before any
      // argument we passed could be threaded through to them.
      const env = { ...process.env, PYTHONIOENCODING: "utf-8", UPLOAD_DIR, AGENTIC_YT_LAUNCHER: "server" };
      if (config.orientation) env.VIDEO_ORIENTATION = config.orientation;
      if (config.language) env.XTTS_LANGUAGE = config.language;

      const child = spawn(PYTHON_BIN, args, {
        env,
        // stdin is piped (it used to be ignored) so a reviewed script can be
        // handed back to a pipeline that is paused waiting for it.
        stdio: ["pipe", "pipe", "pipe"],
        ...treeSpawnOptions(),
      });

      const record = {
        child,
        jobId,
        prompt,
        paused: false,
        cancelled: false,
        finished: false,
        youtubeId: null,
        failure: null,
        progress: 0,
        stage: null,
        artifacts: [],
        knowledgeTitles,
        config,
        /** True while the pipeline is blocked waiting for a reviewed script. */
        awaitingScript: false,
      };
      activeJobs.set(userId, record);
      console.log(`start_workflow user=${userId} job=${jobId} pid=${child.pid}`);
      emitToUser("workflow_started", { jobId, prompt, credits: creditsLeft });

      let stdoutBuf = "";

      child.stdout.on("data", (chunk) => {
        // A cancelled run may still flush buffered output while it is being killed.
        if (record.cancelled) return;
        stdoutBuf += chunk.toString("utf8");
        const lines = stdoutBuf.split(/\r?\n/);
        stdoutBuf = lines.pop(); // keep partial
        lines.forEach((raw) => handleLine(raw.trim()));
      });

      function handleLine(line) {
        if (!line) return;

        if (line.startsWith("JOB_ID:")) return; // the server created the job; nothing new

        if (line.startsWith("ARTIFACT:")) {
          const artifact = toClientArtifact(valueAfterColon(line), jobId);
          if (!artifact) return;
          record.artifacts.push(artifact);
          if (record.artifacts.length > MAX_ARTIFACTS) record.artifacts.shift();
          emitToUser("workflow_artifact", { jobId, artifact });
          return;
        }

        if (line.startsWith("STAGE:")) {
          record.stage = valueAfterColon(line);
          emitToUser("workflow_stage", { stage: record.stage, info: null, jobId });
          return;
        }

        // The pipeline has paused with a finished draft and is blocked on stdin.
        // The script itself arrived just before this as a `script_review` artifact,
        // so the page already has the text to put in the editor.
        if (line.startsWith("SCRIPT_REVIEW:")) {
          record.awaitingScript = true;
          emitToUser("workflow_script_review", { jobId });
          return;
        }

        if (line.startsWith("PROGRESS:")) {
          const pct = parseFloat(valueAfterColon(line)) || 0;
          record.progress = pct;
          saveJob({ progress: pct });
          emitToUser("workflow_progress", { jobId, pct, stage: record.stage });
          emitToUser("video:progress", { jobId, progress: pct });
          return;
        }

        if (line.startsWith("VIDEO_PATH:")) {
          const videoPath = valueAfterColon(line);
          saveJob({ videoPath });
          emitToUser("workflow_stage", { stage: "Video Ready", info: videoPath, jobId });
          emitToUser("video:video_path", { jobId, videoPath });
          return;
        }

        if (line.startsWith("YOUTUBE_ID:")) {
          record.youtubeId = valueAfterColon(line);
          saveJob({ youtubeVideoId: record.youtubeId, status: "uploaded" });
          emitToUser("workflow_stage", { stage: "Uploaded to YouTube", info: record.youtubeId, jobId });
          emitToUser("video:uploaded", { jobId, youtubeId: record.youtubeId });
          return;
        }

        if (line.startsWith("COMPLETED:")) {
          const finalPath = valueAfterColon(line);
          saveJob({ videoWithMusic: finalPath, progress: 100 });
          emitToUser("workflow_complete", { jobId, finalPath });
          emitToUser("video:completed", { jobId, finalPath });
          return;
        }

        if (line.startsWith("FAILED:")) {
          record.failure = valueAfterColon(line);
          saveJob({ status: "failed", error: record.failure });
          emitToUser("workflow_error", { jobId, error: record.failure });
          emitToUser("video:failed", { jobId, error: record.failure });
          return;
        }

        // otherwise generic logs
        emitToUser("workflow_log", { jobId, message: line });
        emitToUser("video:log", { jobId, log: line });
      }

      child.stderr.on("data", (chunk) => {
        if (record.cancelled) return;
        const errLine = chunk.toString("utf8").trim();
        emitToUser("workflow_error", { jobId, error: errLine });
        emitToUser("video:failed", { jobId, error: errLine });
      });

      child.on("close", (code) => {
        if (record.finished) return;
        record.finished = true;
        if (activeJobs.get(userId) === record) activeJobs.delete(userId);
        // The notes copy exists only for the duration of the run.
        if (knowledgeFile) cleanupKnowledgeFile(jobId);
        console.log(`main_new.py closed (code=${code}) job=${jobId}${record.cancelled ? " [cancelled]" : ""}`);

        if (record.cancelled) {
          saveJob({ status: "failed", error: "Cancelled by user" });
          emitToUser("workflow_cancelled", { jobId });
          return;
        }
        if (code === 0) {
          saveJob({ status: record.youtubeId ? "uploaded" : "completed", progress: 100, completedAt: new Date() });
          emitToUser("workflow_complete", { jobId, code });
          return;
        }
        const error = `process exited with code ${code}`;
        saveJob({ status: "failed", error: record.failure || error });
        emitToUser("workflow_error", { jobId, error });
      });

      child.on("error", (err) => {
        console.error("Failed to start main_new.py:", err);
        if (record.finished) return;
        record.finished = true;
        if (activeJobs.get(userId) === record) activeJobs.delete(userId);
        saveJob({ status: "failed", error: `Could not start the pipeline: ${err.message}` });
        refund(); // the pipeline never ran
        emitToUser("workflow_error", { jobId, error: `process exited with code -1 (${err.message})` });
      });
    }

    // ------------------------------------------- pause / resume / cancel

    const withJob = (action, handler) => async () => {
      const record = activeJobs.get(userId);
      if (!record || record === STARTING) {
        socket.emit("workflow_control_error", { action, code: "NO_JOB", error: "No running job for your account" });
        return;
      }
      try {
        await handler(record);
      } catch (err) {
        console.error(`${action}_workflow failed:`, err.message);
        socket.emit("workflow_control_error", { action, code: "FAILED", error: err.message });
      }
    };

    socket.on("pause_workflow", withJob("pause", async (record) => {
      if (!record.paused) {
        await suspendTree(record.child.pid);
        record.paused = true;
        console.log(`Paused job ${record.jobId} (pid=${record.child.pid})`);
      }
      emitToUser("workflow_paused", { jobId: record.jobId });
    }));

    socket.on("resume_workflow", withJob("resume", async (record) => {
      if (record.paused) {
        await resumeTree(record.child.pid);
        record.paused = false;
        console.log(`Resumed job ${record.jobId} (pid=${record.child.pid})`);
      }
      emitToUser("workflow_resumed", { jobId: record.jobId });
    }));

    socket.on("cancel_workflow", withJob("cancel", async (record) => {
      if (record.cancelled) return;
      record.cancelled = true;
      try {
        await killTree(record.child.pid);
        console.log(`Cancelling job ${record.jobId} (pid=${record.child.pid})`);
      } catch (err) {
        record.cancelled = false;
        throw err;
      }
      // "workflow_cancelled" is emitted from the child's close handler once it has exited.
    }));

    // ------------------------------------------------------------ disconnect

    socket.on("disconnect", async () => {
      console.log("socket disconnected", socket.id);
      const record = activeJobs.get(userId);
      if (!record || record === STARTING || !record.paused) return;
      // Nobody from this account is left to press Resume — let the job finish rather than stay frozen.
      const stillConnected = await io.in(room).fetchSockets();
      if (stillConnected.length) return;
      resumeTree(record.child.pid)
        .then(() => { record.paused = false; })
        .catch((err) => console.error("resume on disconnect failed:", err.message));
    });
  });
}

// sanitizeConfig is exported for its own sake: it is the boundary that decides
// what a page may turn into arguments and environment variables of a spawned
// process, so it should be exercised directly rather than only through a socket.
module.exports = { registerWorkflowSocket, MAX_PROMPT_LENGTH, sanitizeConfig, TONES };
