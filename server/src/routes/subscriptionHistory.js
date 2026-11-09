const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Plan = require('../models/Plan');
const SubscriptionHistory = require('../models/SubscriptionHistory');
const authMiddleware=require('../utils/authMiddleware')


// POST subscribe to a plan
router.post('/:planId', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const planId = req.params.planId;

    const plan = await Plan.findById(planId);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // ✅ Add credits to user
    user.credits += plan.credits;

    // ✅ Save subscription history
    const history = new SubscriptionHistory({
      userId,
      planId,
      planName: plan.name,
      credits: plan.credits,
      price: plan.price
    });

    await history.save();
    user.subscriptions.push(history._id);
    await user.save();

    res.json({ ok: true, message: `Subscribed to ${plan.name}`, credits: user.credits });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Subscription failed' });
  }
});

module.exports = router;
