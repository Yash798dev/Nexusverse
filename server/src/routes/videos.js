const express = require("express");
const router = express.Router();
const auth = require("../utils/authMiddleware"); // your JWT middleware that sets req.user
const { createJob, startJob, getJob, submitUpload } = require("../controllers/videoController");

router.post("/create", auth, createJob);
//router.post("/start/:jobId", auth, startJob);
router.get("/:jobId", auth, getJob);
router.post("/upload/:jobId", auth, submitUpload);

module.exports = router;
