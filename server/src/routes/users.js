const User = require('../models/User');

const express = require('express');
const router = express.Router();
const authMiddleware=require('../utils/authMiddleware');
// middleware: requireAuth (decode JWT or session)
const requireAuth = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  next();
};

// get credits for logged-in user
router.get('/me/credits', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('credits');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ credits: user.credits });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;