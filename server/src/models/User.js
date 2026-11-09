const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, required: true, unique: true, lowercase: true },
  passwordHash: String,
  verified: { type: Boolean, default: true }, // already verified if using email OTP flow
  credits: { type: Number, default: 100 },
  role: { type: String, enum: ["user","admin"], default: "user" },
  subscriptions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'SubscriptionHistory' }],
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("User", userSchema);
