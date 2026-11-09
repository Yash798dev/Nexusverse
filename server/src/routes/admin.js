const express = require("express");
const router = express.Router();
const auth = require("../utils/authMiddleware");
const User = require("../models/User");
const VideoJob = require("../models/VideoJob");

router.use(auth);
router.use((req,res,next)=> {
  if (req.user.role !== "admin") return res.status(403).json({ error: "admin only" });
  next();
});

router.get("/users", async (req, res) => {
  const users = await User.find().select("-passwordHash");
  res.json(users);
});

router.get("/video-jobs", async (req, res) => {
  const jobs = await VideoJob.find().populate("user");
  res.json(jobs);
});

// subscription plan CRUD
router.post("/plans", async (req,res)=> {
  const plan = new SubscriptionPlan(req.body);
  await plan.save();
  res.json(plan);
});

module.exports = router;
