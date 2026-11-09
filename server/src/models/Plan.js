// models/Plan.js
const mongoose = require('mongoose');

const planSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  description: { type: String },
  price: { type: Number, required: true },
  credits: { type: Number, required: true },
  durationDays: { type: Number, required: true }, // e.g. 30 for monthly
}, { timestamps: true });

module.exports = mongoose.model('Plan', planSchema);
