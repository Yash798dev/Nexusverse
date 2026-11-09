const mongoose = require('mongoose');

const subscriptionHistorySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  planId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true },
  planName: String,
  credits: Number,
  price: Number,
  subscribedAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('SubscriptionHistory', subscriptionHistorySchema);
