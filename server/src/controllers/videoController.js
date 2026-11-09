const VideoJob = require("../models/VideoJob");
const User = require("../models/User");
const { runGeneration, runUpload } = require("../services/pythonWorker");

const { COST_PER_VIDEO } = require("../config/credits");

async function createJob(req, res) {
  const user = req.user; // assume auth middleware already set req.user (JWT)
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Missing prompt" });

  // credit check
  if ((user.credits || 0) < COST_PER_VIDEO) {
    return res.status(402).json({ error: "Insufficient credits", needed: COST_PER_VIDEO, current: user.credits });
  }

  // deduct credits and save user
  user.credits -= COST_PER_VIDEO;
  await user.save();

  // create job
  const job = new VideoJob({ user: user._id, prompt, status: "queued", costCredits: COST_PER_VIDEO });
  await job.save();

}




async function getJob(req, res) {
  const { jobId } = req.params;
  const job = await VideoJob.findById(jobId).populate("user", "-passwordHash");
  if (!job) return res.status(404).json({ error: "Not found" });
  res.json(job);
}

async function submitUpload(req, res) {
  const io = req.app.locals.io;
  const { jobId } = req.params;
  const { youtubeEmail } = req.body;
  if (!youtubeEmail) return res.status(400).json({ error: "Missing youtubeEmail" });

  const job = await VideoJob.findById(jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (!job.videoWithMusic && !job.videoPath) return res.status(400).json({ error: "No final video to upload" });

  job.youtubeEmail = youtubeEmail;
  await job.save();

  // spawn upload helper
  runUpload(job, youtubeEmail, io).catch(err => console.error("runUpload error:", err));

  res.json({ ok: true, message: "Upload started" });
}

module.exports = { createJob,  getJob, submitUpload };
