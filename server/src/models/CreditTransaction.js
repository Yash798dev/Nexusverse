const mongoose = require("mongoose");

const txSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  change: Number,
  reason: String,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("CreditTransaction", txSchema);
