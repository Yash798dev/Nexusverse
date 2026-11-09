// server.js (updated)
require('dotenv').config();
const dns = require("dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]); // Force Google DNS
const http = require("http");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const app = require("./app");
const { registerWorkflowSocket } = require("./sockets/workflowSocket");

const MONGO = process.env.MONGO_URI;
const port = process.env.PORT || 4000;

mongoose.connect(MONGO, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => {
    const server = http.createServer(app);
    const io = new Server(server, { cors: { origin: "*" } });

    // Workflow page -> server -> main_new.py (authenticated, credit-checked, one job per user).
    registerWorkflowSocket(io);

    // attach io to app locals
    app.locals.io = io;

    server.listen(port, () => console.log("Server listening on port", port));
  })
  .catch(err => {
    console.error("Mongo connect err", err);
    process.exit(1);
  });
