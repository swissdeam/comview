import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import multer from "multer";
import fs from "fs";

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const __dirname = path.resolve();

// === Настройка загрузок ===
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) =>
    cb(null, Date.now() + "-" + file.originalname),
});
const upload = multer({ storage });

// === Состояние ===
let connectedUsers = {};
let currentVideo = null;

// === Статические файлы ===
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

// === Маршруты ===
app.post("/upload", upload.single("video"), (req, res) => {
  currentVideo = `/uploads/${req.file.filename}`;
  io.emit("video-changed", currentVideo);
  res.redirect("/admin");
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// === WebSocket ===
io.on("connection", (socket) => {
  connectedUsers[socket.id] = { id: socket.id };
  io.emit("user-list", Object.values(connectedUsers));

  if (currentVideo) socket.emit("video-changed", currentVideo);

  socket.on("disconnect", () => {
    delete connectedUsers[socket.id];
    io.emit("user-list", Object.values(connectedUsers));
  });

  socket.on("play", (time) => io.emit("play", time));
  socket.on("pause", (time) => io.emit("pause", time));
  socket.on("seek", (time) => io.emit("seek", time));
});

server.listen(3000, () =>
  console.log("🚀 Сервер запущен на http://localhost:3000")
);
