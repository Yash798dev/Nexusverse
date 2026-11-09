// models/VideoHistory.js
const mongoose = require('mongoose');

const videoHistorySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  prompt: { type: String },
  videoUrl: { type: String, required: true },
  status: { type: String, enum: ['generated', 'uploaded'], default: 'generated' },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('VideoHistory', videoHistorySchema);
