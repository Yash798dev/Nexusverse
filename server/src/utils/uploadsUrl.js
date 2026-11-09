// Turn an absolute path the pipeline wrote into a URL the browser can fetch.
//
// app.js serves UPLOAD_DIR at /uploads, so only files under that directory are
// reachable — anything else returns null rather than leaking a filesystem path
// the client could not use anyway.
//
// (workflowSocket.js carries its own older copy of this for artifact paths;
// left alone deliberately rather than refactored while a release is in flight.)
const path = require("path");

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve(__dirname, "../../uploads");

/**
 * @param {string} filePath absolute path written by the pipeline
 * @param {string|number} [version] cache-buster; file names are reused between runs
 * @returns {string|null} e.g. "/uploads/final_video.mp4?v=123"
 */
function uploadsUrlFor(filePath, version) {
  if (typeof filePath !== "string" || !filePath) return null;

  const relative = path.relative(path.resolve(UPLOAD_DIR), path.resolve(filePath));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;

  const url = `/uploads/${relative.split(path.sep).map(encodeURIComponent).join("/")}`;
  return version === undefined ? url : `${url}?v=${version}`;
}

module.exports = { uploadsUrlFor, UPLOAD_DIR };
