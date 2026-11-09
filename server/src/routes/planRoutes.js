const express = require('express');
const router = express.Router();
const Plan = require('../models/Plan');

// GET all plans
router.get('/', async (req, res) => {
  try {
    const plans = await Plan.find().sort({ price: 1 });
    res.json({ ok: true, plans });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch plans' });
  }
});

// Admin route: create new plan
router.post('/', async (req, res) => {
  try {
    const { name, description, price, credits, durationDays } = req.body;
    const plan = new Plan({ name, description, price, credits, durationDays });
    await plan.save();
    res.json({ ok: true, plan });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create plan' });
  }
});

module.exports = router;
