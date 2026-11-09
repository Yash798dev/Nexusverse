const express = require("express");
const router = express.Router();
const { register, verifyOtp, login } = require("../controllers/authcontroller");

// POST /api/auth/register
router.post("/register", register);

// POST /api/auth/verify-otp
router.post("/verify-otp", verifyOtp);

// POST /api/auth/login
router.post("/login", login);

module.exports = router;
