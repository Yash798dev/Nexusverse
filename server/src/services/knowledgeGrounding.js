// Assembles the knowledge payload that grounds a video run.
//
// When a user starts a run from the Knowledge Hub, the pipeline needs the actual
// note content. This fetches the notes for each selected source (proving the
// caller owns every one of them first), writes them to a file, and hands back
// the path for main_new.py's --knowledge-file argument.
//
// Where that file goes matters: app.js serves UPLOAD_DIR at /uploads, so writing
// note content there would publish every user's private notes at a guessable
// URL. It goes in a directory that is not served by anything, and is deleted
// when the run ends.

const fs = require("fs/promises");
const path = require("path");

const KnowledgeSource = require("../models/KnowledgeSource");
const notes = require("./notesClient");

/** Not under UPLOAD_DIR — nothing serves this directory. */
const JOB_DATA_DIR = process.env.JOB_DATA_DIR || path.resolve(__dirname, "../../jobdata");
const KNOWLEDGE_DIR = path.join(JOB_DATA_DIR, "knowledge");

/** Guard against a caller passing an unbounded list of ids. */
const MAX_SOURCES = 5;

class KnowledgeSelectionError extends Error {
  constructor(message) {
    super(message);
    this.name = "KnowledgeSelectionError";
  }
}

/**
 * Build the grounding file for one job.
 *
 * @returns {Promise<{filePath: string, sources: {id: string, title: string}[]}>}
 * @throws  {KnowledgeSelectionError} when the selection is invalid, not owned,
 *          or has no processed notes behind it yet.
 */
async function buildKnowledgeFile(userId, sourceIds, jobId) {
  const ids = Array.from(new Set((sourceIds || []).filter((id) => typeof id === "string" && id)));
  if (!ids.length) throw new KnowledgeSelectionError("No knowledge sources selected.");
  if (ids.length > MAX_SOURCES) {
    throw new KnowledgeSelectionError(`Select at most ${MAX_SOURCES} knowledge sources.`);
  }

  // Ownership is enforced in the query itself: another user's id simply does
  // not come back, and the count check below turns that into a clear error.
  let owned;
  try {
    owned = await KnowledgeSource.find({ _id: { $in: ids }, user: userId }).lean();
  } catch {
    // A malformed ObjectId throws rather than returning nothing.
    throw new KnowledgeSelectionError("One of the selected knowledge sources is not valid.");
  }
  if (owned.length !== ids.length) {
    throw new KnowledgeSelectionError("One or more selected knowledge sources could not be found.");
  }

  const unfinished = owned.filter((s) => s.status !== "completed");
  if (unfinished.length) {
    throw new KnowledgeSelectionError(
      "Wait for processing to finish before creating a video from these notes."
    );
  }

  // Fetch each source's notes. One failure should not sink the whole run, so
  // failures are skipped and only a completely empty result is an error.
  const settled = await Promise.allSettled(
    owned.map(async (source) => {
      const payload = await notes.getNotes(source.externalId);
      return {
        id: source._id.toString(),
        title: source.title || "Untitled document",
        markdown: payload?.markdown_content || "",
      };
    })
  );

  const sources = settled
    .filter((r) => r.status === "fulfilled" && r.value.markdown.trim())
    .map((r) => r.value);

  if (!sources.length) {
    throw new KnowledgeSelectionError("The selected knowledge sources have no notes to build from.");
  }

  await fs.mkdir(KNOWLEDGE_DIR, { recursive: true });
  const filePath = path.join(KNOWLEDGE_DIR, `${jobId}.json`);
  await fs.writeFile(filePath, JSON.stringify({ jobId, sources }, null, 2), "utf8");

  return {
    filePath,
    sources: sources.map(({ id, title }) => ({ id, title })),
  };
}

/** Remove a finished run's knowledge file. Never throws. */
async function cleanupKnowledgeFile(jobId) {
  try {
    await fs.unlink(path.join(KNOWLEDGE_DIR, `${jobId}.json`));
  } catch {
    /* already gone, or never written */
  }
}

module.exports = { buildKnowledgeFile, cleanupKnowledgeFile, KnowledgeSelectionError, KNOWLEDGE_DIR };
