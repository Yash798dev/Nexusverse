// /api/knowledge — the Knowledge Hub's API.
//
// Everything here is JWT-guarded and scoped to the signed-in user. The notes
// service behind it has no auth and no concept of users; these routes are what
// give a note an owner, and they refuse to return anybody else's work.
//
// Routes:
//   POST /api/knowledge              start ingesting a YouTube URL
//   GET  /api/knowledge              list my knowledge sources
//   GET  /api/knowledge/:id          status + notes + quiz for one source
//   GET  /api/knowledge/:id/progress live SSE progress (proxied)
//   POST /api/knowledge/:id/retry    resume a failed job from its checkpoint

const express = require("express");
const { Readable } = require("stream");
const path = require("path");
const fs = require("fs");

const router = express.Router();
const auth = require("../utils/authMiddleware");
const KnowledgeSource = require("../models/KnowledgeSource");
const notes = require("../services/notesClient");
const podcast = require("../services/podcastService");
const FlashcardDeck = require("../models/FlashcardDeck");
const srs = require("../services/spacedRepetition");

router.use(auth);

/** Statuses the notes service reports, mapped onto the model's enum. */
const KNOWN_STATUSES = new Set(["processing", "completed", "failed"]);

/**
 * Load a source by id and prove it belongs to the caller. Returns null and
 * sends the response when it does not — a missing row and someone else's row
 * are both reported as 404, so ids cannot be probed for existence.
 */
async function ownedSource(req, res) {
  const source = await KnowledgeSource.findOne({ _id: req.params.id, user: req.user._id });
  if (!source) {
    res.status(404).json({ error: "Knowledge source not found" });
    return null;
  }
  return source;
}

/** Report a notes-service failure with its own status code where we have one. */
function sendServiceError(res, err, fallback) {
  if (err instanceof notes.NotesServiceError) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(`${fallback}:`, err);
  return res.status(500).json({ error: fallback });
}

// ─────────────────────────────────────────────────────────── create

router.post("/", async (req, res) => {
  const url = typeof req.body.url === "string" ? req.body.url.trim() : "";
  if (!url) return res.status(400).json({ error: "Enter a YouTube URL." });
  if (!/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: "That does not look like a URL." });
  }

  try {
    const started = await notes.startIngest(url, req.user._id.toString());
    if (!started || !started.video_id) {
      return res.status(502).json({ error: "The notes service did not return a job id." });
    }

    const source = await KnowledgeSource.create({
      user: req.user._id,
      externalId: started.video_id,
      sourceUrl: url,
      status: "processing",
    });

    res.status(201).json({ ok: true, source });
  } catch (err) {
    sendServiceError(res, err, "Could not start processing that video");
  }
});

// ─────────────────────────────────────────────────────────── list

router.get("/", async (req, res) => {
  try {
    const sources = await KnowledgeSource.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ ok: true, sources });
  } catch (err) {
    console.error("GET /api/knowledge failed:", err);
    res.status(500).json({ error: "Could not load your knowledge library" });
  }
});

// ─────────────────────────────────────────────────────────── detail

router.get("/:id", async (req, res) => {
  const source = await ownedSource(req, res);
  if (!source) return;

  try {
    const status = await notes.getStatus(source.externalId);

    // Keep the local mirror honest, so the library list does not need to ask
    // the notes service about every row.
    const updates = {};
    if (status.title && status.title !== source.title) updates.title = status.title;
    if (KNOWN_STATUSES.has(status.status) && status.status !== source.status) {
      updates.status = status.status;
    }
    if (Object.keys(updates).length) {
      Object.assign(source, updates);
      await source.save();
    }

    // Notes and quiz only exist once the pipeline has finished; a job still
    // running is a normal state here, not an error.
    let notesPayload = null;
    let quizPayload = null;
    if (status.status === "completed") {
      const [n, q] = await Promise.allSettled([
        notes.getNotes(source.externalId),
        notes.getQuiz(source.externalId),
      ]);
      if (n.status === "fulfilled") notesPayload = n.value;
      if (q.status === "fulfilled") quizPayload = q.value;
    }

    res.json({
      ok: true,
      source,
      status,
      notes: notesPayload,
      quiz: quizPayload ? quizPayload.questions : null,
    });
  } catch (err) {
    sendServiceError(res, err, "Could not load that knowledge source");
  }
});

// ─────────────────────────────────────────────────────────── progress (SSE)

router.get("/:id/progress", async (req, res) => {
  const source = await ownedSource(req, res);
  if (!source) return;

  const controller = new AbortController();
  // The browser going away must tear down the upstream request too, or the
  // notes service keeps polling its database for a reader that has left.
  req.on("close", () => controller.abort());

  try {
    const upstream = await notes.openProgressStream(source.externalId, controller.signal);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    Readable.fromWeb(upstream.body)
      .on("error", () => res.end())
      .pipe(res);
  } catch (err) {
    if (controller.signal.aborted) return; // client left while connecting
    sendServiceError(res, err, "Could not open the progress stream");
  }
});

// ─────────────────────────────────────────────────────────── flashcards

/** Shape one card for the client, including what each button would do next. */
function toClientCard(card, now) {
  return {
    id: card._id.toString(),
    front: card.front,
    back: card.back,
    hint: card.hint || "",
    dueAt: card.dueAt,
    repetitions: card.repetitions,
    lapses: card.lapses,
    due: srs.isDue(card, now),
    intervals: srs.previewAll(card, now),
  };
}

/**
 * The user's deck for this source, generating it on first request.
 * Cards come from the notes; the schedule belongs to the account.
 */
router.get("/:id/flashcards", async (req, res) => {
  const source = await ownedSource(req, res);
  if (!source) return;

  try {
    let deck = await FlashcardDeck.findOne({ user: req.user._id, knowledgeSource: source._id });

    if (!deck) {
      if (source.status !== "completed") {
        return res.status(409).json({ error: "Wait for processing to finish before making flashcards." });
      }
      const generated = await notes.getFlashcards(source.externalId);
      const cards = (generated?.cards || []).map((c) => ({
        front: c.front,
        back: c.back,
        hint: c.hint || "",
        ...srs.newCardState(),
      }));
      if (!cards.length) {
        return res.status(502).json({ error: "No flashcards could be made from these notes." });
      }
      deck = await FlashcardDeck.create({
        user: req.user._id,
        knowledgeSource: source._id,
        cards,
      });
    }

    const now = new Date();
    const all = deck.cards.map((c) => toClientCard(c, now));
    res.json({
      ok: true,
      deckId: deck._id,
      total: all.length,
      dueCount: all.filter((c) => c.due).length,
      reviewCount: deck.reviewCount,
      lastReviewedAt: deck.lastReviewedAt,
      cards: all,
    });
  } catch (err) {
    sendServiceError(res, err, "Could not load your flashcards");
  }
});

/** Grade one card and reschedule it. */
router.post("/:id/flashcards/review", async (req, res) => {
  const source = await ownedSource(req, res);
  if (!source) return;

  const { cardId, grade } = req.body || {};
  if (!cardId || !srs.GRADES.includes(grade)) {
    return res.status(400).json({ error: `Send a cardId and a grade (${srs.GRADES.join(", ")}).` });
  }

  try {
    const deck = await FlashcardDeck.findOne({ user: req.user._id, knowledgeSource: source._id });
    if (!deck) return res.status(404).json({ error: "No deck yet for this source." });

    const card = deck.cards.id(cardId);
    if (!card) return res.status(404).json({ error: "That card is not in this deck." });

    const now = new Date();
    Object.assign(card, srs.schedule(card, grade, now));
    deck.reviewCount += 1;
    deck.lastReviewedAt = now;
    await deck.save();

    const dueCount = deck.cards.filter((c) => srs.isDue(c, now)).length;
    res.json({ ok: true, card: toClientCard(card, now), dueCount, reviewCount: deck.reviewCount });
  } catch (err) {
    sendServiceError(res, err, "Could not save that review");
  }
});

// ─────────────────────────────────────────────────────────── podcast

/**
 * Start a two-host podcast render for this source. A render takes roughly two
 * minutes, so this returns immediately and the page polls the GET below.
 */
router.post("/:id/podcast", async (req, res) => {
  const source = await ownedSource(req, res);
  if (!source) return;

  try {
    const state = await podcast.start(req.user._id, source);
    res.status(202).json({ ok: true, ...state });
  } catch (err) {
    if (err instanceof podcast.PodcastError) {
      return res.status(err.status).json({ error: err.message });
    }
    sendServiceError(res, err, "Could not start the podcast");
  }
});

/** Where the render has got to, or the finished episode. */
router.get("/:id/podcast", async (req, res) => {
  const source = await ownedSource(req, res);
  if (!source) return;
  res.json({ ok: true, ...podcast.status(source._id.toString()) });
});

// ─────────────────────────────────────────────────────────── chat

/** Keep a single question, and the history sent with it, to a sane size. */
const MAX_QUESTION_LENGTH = 1000;
const MAX_HISTORY_TURNS = 12;

router.post("/:id/chat", async (req, res) => {
  const source = await ownedSource(req, res);
  if (!source) return;

  const question = typeof req.body.question === "string" ? req.body.question.trim() : "";
  if (!question) return res.status(400).json({ error: "Ask a question first." });
  if (question.length > MAX_QUESTION_LENGTH) {
    return res.status(400).json({ error: `Keep questions under ${MAX_QUESTION_LENGTH} characters.` });
  }
  if (source.status !== "completed") {
    return res.status(409).json({ error: "Wait for processing to finish before asking questions." });
  }

  // Only the shape the notes service expects is forwarded — the page cannot
  // smuggle extra fields into the model prompt.
  const history = (Array.isArray(req.body.history) ? req.body.history : [])
    .slice(-MAX_HISTORY_TURNS)
    .filter((t) => t && typeof t.content === "string")
    .map((t) => ({ role: t.role === "assistant" ? "assistant" : "user", content: t.content.slice(0, 2000) }));

  try {
    const answer = await notes.chat(source.externalId, question, history);
    res.json({ ok: true, ...answer });
  } catch (err) {
    sendServiceError(res, err, "Could not answer that question");
  }
});

// ─────────────────────────────────────────────────────────── keyframe

/** Where the notes service keeps its data; required to serve keyframes at all. */
const NOTES_DATA_DIR = process.env.NOTES_DATA_DIR || "";

/**
 * Serve one extracted keyframe.
 *
 * The notes service's own /api/keyframe hands back whatever absolute path it is
 * given, which makes it a path-traversal hole — and it is unauthenticated, so
 * that hole is open to anyone. This route is the guarded replacement: the caller
 * must own the job, and the requested file must resolve *inside that job's own*
 * keyframes directory. Anything else is refused, not fetched.
 */
router.get("/:id/keyframe", async (req, res) => {
  const source = await ownedSource(req, res);
  if (!source) return;

  const requested = req.query.path;
  if (typeof requested !== "string" || !requested) {
    return res.status(400).json({ error: "Missing keyframe path" });
  }
  if (!NOTES_DATA_DIR) {
    return res.status(503).json({ error: "Keyframe serving is not configured (NOTES_DATA_DIR)" });
  }

  // The notes service records image_path relative to its OWN working directory
  // ("data/keyframes/<job>/frame_x.png"), so the incoming value cannot be
  // resolved directly — path.resolve() would anchor it to this process's cwd
  // and land somewhere else entirely.
  //
  // Only the file name is taken, and it is joined to the directory belonging to
  // this job. That makes escaping impossible by construction rather than by
  // comparison: basename() discards every directory component, so "../.." and
  // absolute paths alike collapse to a bare name. The containment assertion
  // below is kept as defence in depth.
  const jobRoot = path.resolve(NOTES_DATA_DIR, "keyframes", source.externalId);
  const resolved = path.resolve(jobRoot, path.basename(requested));
  const relative = path.relative(jobRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return res.status(403).json({ error: "That file is not part of this knowledge source" });
  }
  if (!/\.(png|jpe?g)$/i.test(resolved)) {
    return res.status(400).json({ error: "Not an image" });
  }
  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ error: "Keyframe not found" });
  }

  res.sendFile(resolved);
});

// ─────────────────────────────────────────────────────────── retry

router.post("/:id/retry", async (req, res) => {
  const source = await ownedSource(req, res);
  if (!source) return;

  try {
    const result = await notes.retryIngest(source.externalId);
    source.status = "processing";
    await source.save();
    res.json({ ok: true, ...result });
  } catch (err) {
    sendServiceError(res, err, "Could not resume that job");
  }
});

module.exports = router;
