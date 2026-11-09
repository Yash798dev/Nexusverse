const mongoose = require("mongoose");

const videoJobSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  prompt: { type: String, required: true },
  status: { type: String, enum: ["queued","running","failed","completed","uploaded"], default: "queued" },
  progress: { type: Number, default: 0 },
  videoPath: String,
  videoWithMusic: String,
  youtubeVideoId: String,
  /**
   * Per-video settings chosen in the Studio. Kept so a finished video can say
   * how it was made, and so a re-run can reuse the same settings.
   */
  config: {
    durationSeconds: Number,
    tone: String,
    voice: String,
    language: String,
    orientation: { type: String, enum: ["portrait", "landscape"] },
    reviewScript: { type: Boolean, default: false },
  },
  costCredits: { type: Number, default: 50 },
  // Knowledge Hub runs: what this video was grounded in. Titles are stored
  // alongside the refs so attribution survives a source being deleted later.
  knowledgeSources: [{ type: mongoose.Schema.Types.ObjectId, ref: "KnowledgeSource" }],
  knowledgeTitles: [{ type: String }],
  youtubeEmail: String,
  error: String,
  createdAt: { type: Date, default: Date.now },
  completedAt: Date
});

module.exports = mongoose.model("VideoJob", videoJobSchema);
