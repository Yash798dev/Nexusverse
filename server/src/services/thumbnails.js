// Still frames for the video gallery.
//
// A gallery of prompts as plain text tells a creator nothing about what they
// made. ffmpeg is already installed and configured for the pipeline, so a
// single frame grab per video costs a fraction of a second and needs no new
// dependency, no model and no network.
//
// Thumbnails are written into UPLOAD_DIR (which app.js serves at /uploads) and
// cached on disk: a video's frame never changes, so it is generated once.

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { execFile } = require("child_process");

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve(__dirname, "../../uploads");
const THUMB_DIR = path.join(UPLOAD_DIR, "thumbs");

/** Two seconds in: far enough past a fade-from-black to show real content. */
const GRAB_AT_SECONDS = 2;
const THUMB_WIDTH = 480;
/** A frame grab is quick; anything slower than this has gone wrong. */
const TIMEOUT_MS = 20000;

/** Only files the pipeline actually wrote under UPLOAD_DIR may be read. */
function isInsideUploads(filePath) {
  const relative = path.relative(path.resolve(UPLOAD_DIR), path.resolve(filePath));
  return !!relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function thumbPathFor(jobId) {
  return path.join(THUMB_DIR, `${jobId}.jpg`);
}

function publicUrlFor(jobId, version) {
  return `/uploads/thumbs/${jobId}.jpg?v=${version}`;
}

function grabFrame(videoPath, outPath) {
  return new Promise((resolve, reject) => {
    execFile(
      FFMPEG,
      [
        "-y",
        // -ss before -i seeks by keyframe, which is far faster than decoding.
        "-ss", String(GRAB_AT_SECONDS),
        "-i", videoPath,
        "-frames:v", "1",
        "-vf", `scale=${THUMB_WIDTH}:-2`,
        "-q:v", "4",
        outPath,
      ],
      { timeout: TIMEOUT_MS, windowsHide: true },
      (err, _stdout, stderr) => (err ? reject(new Error((stderr || err.message).toString().slice(-300))) : resolve())
    );
  });
}

/**
 * URL of this job's thumbnail, generating it on first request.
 *
 * Returns null rather than throwing when there is nothing to grab (no video
 * yet, a file outside UPLOAD_DIR, ffmpeg unavailable) — a missing thumbnail
 * should degrade the gallery, never fail the request that lists it.
 */
async function ensureThumbnail(job) {
  const jobId = job && job._id ? job._id.toString() : null;
  if (!jobId) return null;

  const videoPath = job.videoWithMusic || job.videoPath;
  if (!videoPath || !isInsideUploads(videoPath) || !fs.existsSync(videoPath)) return null;

  const outPath = thumbPathFor(jobId);

  // Cached: a finished video's frame never changes.
  try {
    const existing = await fsp.stat(outPath);
    if (existing.size > 0) return publicUrlFor(jobId, Math.round(existing.mtimeMs));
  } catch {
    // not generated yet
  }

  try {
    await fsp.mkdir(THUMB_DIR, { recursive: true });
    await grabFrame(videoPath, outPath);
    const written = await fsp.stat(outPath);
    if (!written.size) return null;
    return publicUrlFor(jobId, Math.round(written.mtimeMs));
  } catch (err) {
    console.error(`[thumbnail ${jobId}] ${err.message}`);
    return null;
  }
}

/**
 * Thumbnails for a page of jobs, generated concurrently.
 * Returns a { jobId: url } map, omitting the ones that have none.
 */
async function thumbnailsFor(jobs) {
  const entries = await Promise.all(
    (jobs || []).map(async (job) => [job._id.toString(), await ensureThumbnail(job)])
  );
  return Object.fromEntries(entries.filter(([, url]) => url));
}

module.exports = { ensureThumbnail, thumbnailsFor, THUMB_DIR, isInsideUploads };
