// A piece of knowledge a user has ingested through NexusNotes.
//
// The notes themselves (markdown, fused timeline, quiz) stay in the notes
// service's own SQLite database — this model is only the ownership record that
// links a user to one of its jobs, which is what NexusNotes on its own has no
// concept of. `externalId` is the notes service's video_id (a UUID).
const mongoose = require("mongoose");

const knowledgeSourceSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

  /** video_id in the notes service. The join key for everything else. */
  externalId: { type: String, required: true, unique: true },

  /** Only YouTube ingest exists today; kept explicit so other kinds can be added. */
  kind: { type: String, enum: ["youtube"], default: "youtube" },

  sourceUrl: { type: String, required: true },
  /** Filled in once the notes service has resolved the video's real title. */
  title: { type: String, default: "" },

  // Mirrors the notes service's own status so the library can be listed without
  // fanning out a request per row. Refreshed whenever a detail/status is fetched.
  status: {
    type: String,
    enum: ["processing", "completed", "failed"],
    default: "processing",
  },

  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("KnowledgeSource", knowledgeSourceSchema);
