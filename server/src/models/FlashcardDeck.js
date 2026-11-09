// A user's flashcard deck for one knowledge source, with its review schedule.
//
// The cards are generated from the notes (and could be regenerated), but the
// scheduling is the part that must never be lost: it represents everything the
// user has actually learned. It lives here, against their account, rather than
// beside the notes — which have no concept of a user.
const mongoose = require("mongoose");

const flashcardSchema = new mongoose.Schema({
  front: { type: String, required: true },
  back: { type: String, required: true },
  hint: { type: String, default: "" },

  // ── SM-2 scheduling state (see services/spacedRepetition.js) ──
  /** Multiplier applied to the interval; drops when a card is hard. */
  ease: { type: Number, default: 2.5 },
  /** Days until this card is next due. 0 = still due today. */
  intervalDays: { type: Number, default: 0 },
  /** Consecutive successful recalls. Reset to 0 on a lapse. */
  repetitions: { type: Number, default: 0 },
  /** How many times this card has been forgotten. */
  lapses: { type: Number, default: 0 },
  dueAt: { type: Date, default: Date.now },
  lastGrade: { type: String, enum: ["again", "hard", "good", "easy", null], default: null },
});

const flashcardDeckSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  knowledgeSource: { type: mongoose.Schema.Types.ObjectId, ref: "KnowledgeSource", required: true },

  cards: [flashcardSchema],

  /** Review counters, for the "you've reviewed N cards" summary. */
  reviewCount: { type: Number, default: 0 },
  lastReviewedAt: { type: Date, default: null },

  createdAt: { type: Date, default: Date.now },
});

// One deck per user per source — generating twice must not leave two decks
// with divergent schedules.
flashcardDeckSchema.index({ user: 1, knowledgeSource: 1 }, { unique: true });

module.exports = mongoose.model("FlashcardDeck", flashcardDeckSchema);
