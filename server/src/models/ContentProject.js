// A video the user is creating from their own knowledge.
//
// This is the join between the two halves of the platform: it remembers which
// Knowledge Hub sources a video was made from, so a finished video can say what
// it was built on instead of appearing out of nowhere.
const mongoose = require("mongoose");

const contentProjectSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

  /** The prompt/topic the video is about. */
  topic: { type: String, required: true },

  /** Knowledge Hub sources this video is grounded in. */
  knowledgeSources: [{ type: mongoose.Schema.Types.ObjectId, ref: "KnowledgeSource" }],

  /** Document titles at the time of generation — kept even if a source is later removed. */
  sourceTitles: [{ type: String }],

  /** The generation run this project produced. */
  videoJob: { type: mongoose.Schema.Types.ObjectId, ref: "VideoJob" },

  status: {
    type: String,
    enum: ["draft", "generating", "completed", "failed"],
    default: "draft",
  },

  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("ContentProject", contentProjectSchema);
