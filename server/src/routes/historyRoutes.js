const express = require('express');
const router = express.Router();
const VideoHistory = require('../models/VideoHistory');
const authmiddleware = require('../utils/authMiddleware');
const VideoJob=require('../models/VideoJob');
const User=require('../models/User');
const SubscriptionHistory = require('../models/SubscriptionHistory');
const thumbnails = require('../services/thumbnails');
const { uploadsUrlFor } = require('../utils/uploadsUrl');
// GET subscription history for logged-in user
router.get('/subscriptions', authmiddleware, async (req, res) => {
  try {
    const subs = await SubscriptionHistory.find({ userId: req.user._id }).sort({ createdAt: -1 });
    
    res.json({ ok: true, history: subs });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch subscription history' });
  }
});

// POST new subscription record
router.post('/subscriptions', authmiddleware, async (req, res) => {
  try {
    const { planName, amount, creditsAdded, endDate } = req.body;
    const sub = new SubscriptionHistory({
      userId: req.user._id,
      planName,
      amount,
      creditsAdded,
      endDate
    });
    await sub.save();
    res.json({ ok: true, subscription: sub });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create subscription record' });
  }
});

// GET video history for logged-in user
router.get('/videos', authmiddleware, async (req, res) => {
  try {
    const videos = await VideoJob.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.json({ ok: true, history: videos });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch video history' });
  }
});

// POST new video record
router.post('/videos', authmiddleware, async (req, res) => {
  try {
    const { title, prompt, videoUrl, status } = req.body;
    const video = new VideoHistory({
      userId: req.user._id,
      title,
      prompt,
      videoUrl,
      status
    });
    await video.save();
    res.json({ ok: true, video });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create video record' });
  }
});

// GET profile of logged in user
router.get("/profile", authmiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("name email role credits");
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (err) {
    console.error("Profile fetch error:", err);
    res.status(500).json({ error: "Server error" });
  }
});


// GET /api/history/my - the user's videos, newest first.
//
// This backs the video gallery, so each row now carries what it takes to SHOW a
// video rather than just name it: a playable URL, a thumbnail, the settings it
// was made with, and what it was grounded in. Previously the select() returned
// only the prompt, which is why the gallery had nothing to display.
router.get("/my", authmiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page || "1", 10);
    const limit = Math.min(50, parseInt(req.query.limit || "20", 10));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      VideoJob.find({ user: userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select("prompt createdAt completedAt status youtubeVideoId videoPath videoWithMusic config knowledgeTitles error")
        .lean(),
      VideoJob.countDocuments({ user: userId })
    ]);

    // Frame grabs run concurrently and are cached on disk; a failure yields no
    // thumbnail rather than failing the listing.
    const thumbs = await thumbnails.thumbnailsFor(items);

    const videos = items.map((job) => {
      const id = job._id.toString();
      const finalPath = job.videoWithMusic || job.videoPath;
      const { videoPath, videoWithMusic, ...rest } = job;
      return {
        ...rest,
        // Absolute server paths are replaced by URLs the browser can use.
        videoUrl: uploadsUrlFor(finalPath, job.completedAt ? +new Date(job.completedAt) : id),
        thumbnailUrl: thumbs[id] || null,
        youtubeUrl: job.youtubeVideoId ? `https://youtu.be/${job.youtubeVideoId}` : null,
      };
    });

    res.json({ ok: true, page, limit, total, videos });
  } catch (err) {
    console.error("GET /api/history/my error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
