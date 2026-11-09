const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
require("dotenv").config();

const authRoutes = require("./routes/auth");
const videoRoutes = require("./routes/videos");
const adminRoutes = require("./routes/admin");
const userRoutes=require("./routes/users");
const historyRoutes=require("./routes/historyRoutes");
const planRoutes=require("./routes/planRoutes");
const subscriptionHistoryRoutes=require("./routes/subscriptionHistory");
const knowledgeRoutes=require("./routes/knowledge");
const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/videos", videoRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/user",userRoutes);
app.use("/api/history",historyRoutes);
app.use("/api/plans",planRoutes);
app.use("/api/subscription",subscriptionHistoryRoutes);
// Knowledge Hub: owns the user↔NexusNotes link and proxies that service.
app.use("/api/knowledge",knowledgeRoutes);
app.get("/", (req, res) => res.json({ ok: true }));
// static uploads
app.use("/uploads", express.static(process.env.UPLOAD_DIR || "uploads"));

module.exports = app;
