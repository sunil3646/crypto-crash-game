const express = require("express");
const http = require("http");
const cors = require("cors");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
require("dotenv").config();

// Constants
const GAME_SEED = process.env.GAME_SEED || "crypto-crash-game-seed-2024";
const MAX_CRASH = 120;

// Setup
const app = express();
app.use(cors());
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log("MongoDB connected"))
  .catch(err => console.error("MongoDB error:", err));

// Provably Fair Crash Point Generator
function generateCrashPoint() {
  const hash = require("crypto")
    .createHmac("sha256", GAME_SEED)
    .update(Date.now().toString())
    .digest("hex");

  const num = parseInt(hash.substring(0, 13), 16);
  const max = Math.pow(2, 52);
  const result = Math.floor((100 * max) / (max - num)) / 100;
  return Math.min(result, MAX_CRASH);
}

// Game State
let gameStatus = "waiting";
let multiplier = 1.0;
let crashPoint = generateCrashPoint();
let players = {};
let roundTimer = null;

// Socket.IO Events
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Send initial game state
  socket.emit("gameState", {
    gameStatus,
    multiplier,
    crashPoint,
    players
  });

  // Handle new bet
  socket.on("placeBet", ({ userId, amount }) => {
    if (gameStatus !== "waiting") return;

    players[userId] = {
      amount,
      cashedOut: false
    };

    io.emit("playerUpdate", players);
  });

  // Handle cashout
  socket.on("cashOut", ({ userId }) => {
    if (!players[userId] || players[userId].cashedOut || gameStatus !== "started") return;

    players[userId].cashedOut = true;
    players[userId].cashOutMultiplier = multiplier;

    io.emit("playerUpdate", players);
  });

  // Disconnect
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

// Game Loop
function startRound() {
  gameStatus = "waiting";
  multiplier = 1.0;
  crashPoint = generateCrashPoint();
  players = {};

  io.emit("gameState", {
    gameStatus,
    multiplier,
    crashPoint,
    players
  });

  setTimeout(() => {
    gameStatus = "started";
    io.emit("gameState", { gameStatus, multiplier, crashPoint });

    const interval = setInterval(() => {
      multiplier += 0.01;
      multiplier = Math.round(multiplier * 100) / 100;

      io.emit("multiplierUpdate", multiplier);

      if (multiplier >= crashPoint) {
        clearInterval(interval);
        gameStatus = "crashed";
        io.emit("gameCrashed", crashPoint);

        setTimeout(startRound, 5000);
      }
    }, 100);
  }, 5000);
}

// Start Game
startRound();

// Root Route
app.get("/", (req, res) => {
  res.send("Crypto Crash Game Backend is Running");
});

// Start Server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
