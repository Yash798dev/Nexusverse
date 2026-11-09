// server/src/services/pythonWorker.js
const { PythonShell } = require("python-shell");
const path = require("path");
const VideoJob = require("../models/VideoJob");

// === CONFIG ===
// Prefer setting these in server/.env, otherwise these defaults will be used.
const PYTHON_PATH = process.env.PYTHON_PATH || "C:\\Users\\yash\\Documents\\MLProjects\\youtube_video_project\\venv\\python.exe";
const PY_MAIN = process.env.PY_MAIN_PATH || path.resolve(__dirname, "../../main_new.py");
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve(__dirname, "../../uploads");
const UPLOAD_HELPER = process.env.UPLOAD_HELPER_PATH || path.resolve(__dirname, "../../python_workers/upload_helper.py");

// Build child env forcing UTF-8 for Python stdout/stderr
function makeChildEnv() {
  return Object.assign({}, process.env, {
    PYTHONIOENCODING: "utf-8"
  });
}

// Create PythonShell options for a script
function makeOptionsForScript(scriptFullPath, args = []) {
  return {
    mode: "text",
    pythonPath: PYTHON_PATH,
    pythonOptions: ["-u", "-X", "utf8"],
    scriptPath: path.dirname(scriptFullPath),
    args,
    env: makeChildEnv()
  };
}

// Safe persistence helper: use findByIdAndUpdate to avoid parallel save collisions.
// It also updates the in-memory jobDoc fields so the rest of the code sees latest values.
async function persistJob(jobDoc, updates = {}) {
  if (!jobDoc || !jobDoc._id) return null;
  try {
    const updated = await VideoJob.findByIdAndUpdate(jobDoc._id, { $set: updates }, { new: true }).lean();
    // update in-memory jobDoc fields (non-Mongoose doc after lean)
    if (updated) {
      Object.keys(updates).forEach(k => { jobDoc[k] = updated[k]; });
    } else {
      // If findByIdAndUpdate returned null, still set locally
      Object.assign(jobDoc, updates);
    }
    return updated;
  } catch (err) {
    console.error("persistJob error:", err);
    throw err;
  }
}

// Run the generation Python script and stream progress via socket.io
async function runGeneration(jobDoc, io) {
  // set status running atomically
  await persistJob(jobDoc, { status: "running" });

  const args = [jobDoc.prompt, jobDoc._id.toString(), UPLOAD_DIR];
  const options = makeOptionsForScript(PY_MAIN, args);

  return new Promise((resolve, reject) => {
    try {
      const pyshell = new PythonShell(path.basename(PY_MAIN), options);

      // message handler
      pyshell.on("message", async (msg) => {
        try {
          if (typeof msg !== "string") return;

          // PROGRESS:<pct>
          if (msg.startsWith("PROGRESS:")) {
            const pct = parseFloat(msg.split(":")[1]) || 0;
            // persist using atomic update
            await persistJob(jobDoc, { progress: pct });
            io.to(`user_${jobDoc.user.toString()}`).emit("video:progress", { jobId: jobDoc._id, progress: pct });

          // VIDEO_PATH:<path>
          } else if (msg.startsWith("VIDEO_PATH:")) {
            const val = msg.split(":")[1] || "";
            await persistJob(jobDoc, { videoPath: val });
            io.to(`user_${jobDoc.user.toString()}`).emit("video:video_path", { jobId: jobDoc._id, videoPath: val });

          // COMPLETED:<path>
          } else if (msg.startsWith("COMPLETED:")) {
            const val = msg.split(":", 2)[1] || "";
            await persistJob(jobDoc, { videoWithMusic: val, status: "completed", progress: 100, completedAt: new Date() });
            io.to(`user_${jobDoc.user.toString()}`).emit("video:completed", { jobId: jobDoc._id, finalPath: val });

          // YOUTUBE_ID:<id>
          } else if (msg.startsWith("YOUTUBE_ID:")) {
            const id = msg.split(":")[1];
            await persistJob(jobDoc, { youtubeVideoId: id });
            io.to(`user_${jobDoc.user.toString()}`).emit("video:uploaded", { jobId: jobDoc._id, youtubeId: id });

          // FAILED:<message>
          } else if (msg.startsWith("FAILED:")) {
            const errMsg = msg.split(":", 2)[1] || "Python reported failure";
            await persistJob(jobDoc, { status: "failed", error: errMsg });
            io.to(`user_${jobDoc.user.toString()}`).emit("video:failed", { jobId: jobDoc._id, error: errMsg });

          // Generic log
          } else {
            console.log("PYMSG:", msg);
            io.to(`user_${jobDoc.user.toString()}`).emit("video:log", { jobId: jobDoc._id, message: msg });
          }
        } catch (err) {
          // Catch per-message errors and persist failure if needed.
          console.error("Error handling python message:", err);
          try {
            await persistJob(jobDoc, { status: "failed", error: String(err) });
            io.to(`user_${jobDoc.user.toString()}`).emit("video:failed", { jobId: jobDoc._id, error: String(err) });
          } catch (saveErr) {
            console.error("Error persisting failure after message handler error:", saveErr);
          }
        }
      });

      // end handler
      pyshell.end(async (err) => {
        if (err) {
          const errorMsg = err && err.traceback ? err.traceback : (err && err.message) ? err.message : String(err);
          console.error("runGeneration error:", err);
          try {
            await persistJob(jobDoc, { status: "failed", error: errorMsg });
            io.to(`user_${jobDoc.user.toString()}`).emit("video:failed", { jobId: jobDoc._id, error: errorMsg });
          } catch (saveErr) {
            console.error("Failed saving job state after Python end error:", saveErr);
          }
          return reject(err);
        }
        // If process exited cleanly but didn't emit COMPLETED, we still resolve
        return resolve(jobDoc);
      });

    } catch (ex) {
      console.error("runGeneration threw:", ex);
      // In case of unexpected sync error, persist failure (use promise save to avoid nested awaits)
      persistJob(jobDoc, { status: "failed", error: String(ex) })
        .then(() => {
          io.to(`user_${jobDoc.user.toString()}`).emit("video:failed", { jobId: jobDoc._id, error: String(ex) });
          reject(ex);
        })
        .catch((saveErr) => {
          console.error("Failed saving job after runGeneration threw:", saveErr);
          reject(ex);
        });
    }
  });
}

// Run the upload helper Python script to upload to YouTube and stream results
async function runUpload(jobDoc, youtubeEmail, io) {
  const fileToUpload = jobDoc.videoWithMusic || jobDoc.videoPath;
  if (!fileToUpload) throw new Error("No final video available to upload");

  const args = [fileToUpload, youtubeEmail];
  const options = makeOptionsForScript(UPLOAD_HELPER, args);

  return new Promise((resolve, reject) => {
    try {
      const pyshell = new PythonShell(path.basename(UPLOAD_HELPER), options);

      pyshell.on("message", async (msg) => {
        try {
          if (typeof msg !== "string") return;

          if (msg.startsWith("YOUTUBE_ID:")) {
            const id = msg.split(":")[1];
            await persistJob(jobDoc, { youtubeVideoId: id, status: "uploaded" });
            io.to(`user_${jobDoc.user.toString()}`).emit("video:uploaded", { jobId: jobDoc._id, youtubeId: id });

          } else if (msg.startsWith("UPLOAD_FAILED:")) {
            const err = msg.split(":", 2)[1];
            await persistJob(jobDoc, { status: "failed", error: err });
            io.to(`user_${jobDoc.user.toString()}`).emit("video:upload_failed", { jobId: jobDoc._id, error: err });

          } else {
            console.log("UPLOAD MSG:", msg);
            io.to(`user_${jobDoc.user.toString()}`).emit("video:log", { jobId: jobDoc._id, message: msg });
          }
        } catch (err) {
          console.error("Error handling upload message:", err);
          try {
            await persistJob(jobDoc, { status: "failed", error: String(err) });
            io.to(`user_${jobDoc.user.toString()}`).emit("video:upload_failed", { jobId: jobDoc._id, error: String(err) });
          } catch (saveErr) {
            console.error("Error persisting upload failure:", saveErr);
          }
        }
      });

      pyshell.end(async (err) => {
        if (err) {
          const errorMsg = err && err.traceback ? err.traceback : (err && err.message) ? err.message : String(err);
          console.error("runUpload error:", err);
          try {
            await persistJob(jobDoc, { status: "failed", error: errorMsg });
            io.to(`user_${jobDoc.user.toString()}`).emit("video:upload_failed", { jobId: jobDoc._id, error: errorMsg });
          } catch (saveErr) {
            console.error("Failed saving job after upload end error:", saveErr);
          }
          return reject(err);
        }
        resolve(jobDoc);
      });

    } catch (ex) {
      console.error("runUpload threw:", ex);
      persistJob(jobDoc, { status: "failed", error: String(ex) })
        .then(() => {
          io.to(`user_${jobDoc.user.toString()}`).emit("video:upload_failed", { jobId: jobDoc._id, error: String(ex) });
          reject(ex);
        })
        .catch((saveErr) => {
          console.error("Failed saving job after runUpload threw:", saveErr);
          reject(ex);
        });
    }
  });
}

module.exports = { runGeneration, runUpload };
