const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Otp = require("../models/Otp");
const { sendEmail } = require("../utils/sendEmail");

const OTP_TTL_SECONDS = parseInt(process.env.OTP_TTL_SECONDS || "300", 10);
const JWT_SECRET = process.env.JWT_SECRET || "seceret";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

function genOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function register(req, res) {
  try {
    const { name, email, password, confirmPassword } = req.body;
    if (!name || !email || !password || !confirmPassword) {
      return res.status(400).json({ error: "Missing fields" });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ error: "Passwords do not match" });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      if (existing.verified) return res.status(400).json({ error: "Email already registered" });
      // if exists but not verified, allow re-sending OTP
    } else {
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(password, salt);
      await User.create({ name, email: email.toLowerCase(), passwordHash: hash, verified: false });
    }

    // generate OTP and store
    const code = genOtpCode();
    const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000);

    await Otp.deleteMany({ email: email.toLowerCase() });
    await Otp.create({ email: email.toLowerCase(), code, expiresAt });

    // send email
    const subject = "Your Agentic YouTube verification code";
    const text = `Your verification code is: ${code}. It will expire in ${Math.floor(OTP_TTL_SECONDS/60)} minutes.`;
    const html = `<p>Your verification code is: <strong>${code}</strong></p><p>It will expire in ${Math.floor(OTP_TTL_SECONDS/60)} minutes.</p>`;

    const sendRes = await sendEmail(email, subject, text, html);
    return res.json({ ok: true, message: "OTP sent", dev: sendRes.dev || false });
  } catch (err) {
    console.error("register err:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

async function verifyOtp(req, res) {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: "Missing email or otp" });

    const rec = await Otp.findOne({ email: email.toLowerCase(), code: otp });
    if (!rec) return res.status(400).json({ error: "Invalid OTP" });

    if (rec.expiresAt < new Date()) {
      await Otp.deleteMany({ email: email.toLowerCase() });
      return res.status(400).json({ error: "OTP expired" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ error: "User not found" });

    user.verified = true;
    await user.save();
    await Otp.deleteMany({ email: email.toLowerCase() });

    return res.json({ ok: true, message: "Email verified. Please login." });
  } catch (err) {
    console.error("verifyOtp err:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Missing email or password" });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(400).json({ error: "Invalid credentials" });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(400).json({ error: "Invalid credentials" });

    if (!user.verified) {
      return res.status(403).json({ error: "Email not verified. Please verify OTP." });
    }

    const token = jwt.sign({ id: user._id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    return res.json({ ok: true, token, user: { id: user._id, name: user.name, email: user.email, credits: user.credits } });
  } catch (err) {
    console.error("login err:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

module.exports = { register, verifyOtp, login };
