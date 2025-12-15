// server.js
import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import multer from "multer";
import fs from "fs";
import session from "express-session";
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const __dirname = path.resolve();

const DATA_FILE = path.join(__dirname, "admins.json");

// === загрузки ===
// const uploadDir = path.join(__dirname, "uploads");
// if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  // filename: (req, file, cb) => Date.now() + "-" + file.originalname
  filename: (req, file, cb) => cb(null, 'stream.mp4')
});
const upload = multer({ storage });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
// app.use('/api')

// === сессии ===
app.use(session({
  name: "curok.sid",
  secret: process.env.SESSION_SECRET || "CHANGE_ME_IN_PROD",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: true,        // ОБЯЗАТЕЛЬНО при HTTPS
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 6 // 6 часов
  }
}));
// app.use(express.urlencoded({ extended: true }));
// === статика ===
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

// === состояние стрима ===
let currentVideo = null;      // путь к видео /uploads/...
let streamMeta = {           // метаинформация
  title: "",
  description: "",
  streamer: "",
  viewers: 0
};
let adminSocketId = null;
let playback = {             // authoritative playback state (by admin)
  playing: false,
  time: 0,
  lastUpdate: Date.now()
};

// === helpers для админов ===
function readAdmins() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return { admins: [] };
  }
}
function writeAdmins(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}


(async () => {
  const data = readAdmins();
  if (!data.admins.find(a => a.id === "admin")) {
    data.admins.push({
      id: "admin",
      displayName: "Main Admin",
      passwordHash: await bcrypt.hash("admin", 12)
    });
    writeAdmins(data);
    console.log("✅ Admin admin/admin created");
  }
})();


// === middleware проверки админа ===
function requireAdmin(req, res, next) {
  console.log("рекваир")
  console.log(req.session.isAdmin)
  console.log(req.session.adminId)
  if (req.session.isAdmin && req.session.adminId) return next();
  return res.redirect("/login");
}

// === маршруты управления админами ===
app.post("/api/auth/login", async (req, res) => {
  console.log("апи логин пост")
  const { login, password } = req.body;

  if (!login || !password) {
    console.log("апи логин пост отсутсвие логина")
    return res.status(400).json({ error: "missing_credentials" });
  }

  const data = readAdmins();
  const admin = data.admins.find(a => a.id === login);
  console.log("data", data)
  console.log("admin", admin)
  console.log("admin", admin.id)

  if (!admin) {
    return res.status(401).json({ error: "invalid_credentials" });
  }

  const ok = await bcrypt.compare(password, admin.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: "invalid_credentials" });
  }

  // ⚠️ важно: регенерация сессии
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: "session_error" });

    req.session.isAdmin = true;
    req.session.adminId = admin.id;
    req.session.adminName = admin.displayName;

    return res.redirect("/admin");
    
  });
  
});


// app.post("/api/auth/login", async (req, res) => {
//   const { login, password } = req.body;
//   const data = readAdmins();
//   const admin = data.admins.find(a => a.id === login);
//   if (!admin) return res.redirect("/admin_login.html?error=1");
//   const ok = await bcrypt.compare(password, admin.passwordHash);
//   // const ok = await password == admin.password;
//   if (!ok) return res.redirect("/admin_login.html?error=1");
//   req.session.isAdmin = true;
//   req.session.adminId = admin.id;
//   res.redirect("/admin");
// });

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin_login.html"));
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("curok.sid");
    return res.redirect("/")
  });
});

// API: список админов (GET) и управление (POST/DELETE)
app.get("/api/admins", requireAdmin, (req, res) => {
  const data = readAdmins();
  res.json(data.admins.map(a => ({ id: a.id, displayName: a.displayName })));
});

// Добавить админа
app.post("/api/admins", requireAdmin, async (req, res) => {
  const { id, password, displayName } = req.body;
  if (!id || !password) return res.status(400).json({ error: "id & password required" });
  const data = readAdmins();
  if (data.admins.find(a => a.id === id)) return res.status(400).json({ error: "exists" });
  const hash = await bcrypt.hash(password, 10);
  data.admins.push({ id, passwordHash: hash, displayName: displayName || id });
  writeAdmins(data);
  res.json({ ok: true });
});

// Удалить админа
app.delete("/api/admins/:id", requireAdmin, (req, res) => {
  const id = req.params.id;
  const data = readAdmins();
  data.admins = data.admins.filter(a => a.id !== id);
  writeAdmins(data);
  res.json({ ok: true });
});

// === загрузка видео (admin only) ===
app.post("/upload", requireAdmin, upload.single("video"), (req, res) => {
  currentVideo = `/uploads/stream.mp4`;
  // сбросить playback
  playback = { playing: false, time: 0, lastUpdate: Date.now() };
  io.emit("video-changed", currentVideo);
  res.redirect("/admin");
});

// Метаданные стрима (admin sets)
app.post("/api/meta", requireAdmin, (req, res) => {
  const { title, description, streamer } = req.body;
  streamMeta.title = title || "";
  streamMeta.description = description || "";
  streamMeta.streamer = streamer || (req.session.adminId || "admin");
  io.emit("meta-updated", streamMeta);
  res.json({ ok: true });
});

// protected admin page
app.get("/admin", requireAdmin, (req, res) => {
  console.log("в админе")
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// === сокеты: синхронизация ===
io.on("connection", socket => {
  if (socket.isAdmin) {
    adminSocketId = socket.id;
  } else {
    streamMeta.viewers++;
    io.emit("meta-updated", streamMeta);
  }

  // отправляем текущее состояние новому клиенту
  socket.emit("current-state", { currentVideo, streamMeta, playback });

  // админские события (только от admin socket)
  socket.on("admin-register", () => {
    if (!socket.isAdmin) return;
    adminSocketId = socket.id;
  });

  socket.on("admin-play", time => {
    // only accept if sender is current admin socket
    if (socket.id !== adminSocketId) return;
    playback.playing = true;
    playback.time = time || playback.time;
    playback.lastUpdate = Date.now();
    io.emit("admin-play", playback);
  });

  socket.on("admin-pause", time => {
    if (socket.id !== adminSocketId) return;
    playback.playing = false;
    playback.time = time || playback.time;
    playback.lastUpdate = Date.now();
    io.emit("admin-pause", playback);
  });

  socket.on("admin-seek", time => {
    if (socket.id !== adminSocketId) return;
    playback.time = time;
    playback.lastUpdate = Date.now();
    io.emit("admin-seek", playback);
  });

  // админ периодически может отправлять heartbeat (для коррекции)
  socket.on("admin-heartbeat", data => {
    if (socket.id !== adminSocketId) return;
    playback.time = data.time;
    playback.playing = data.playing;
    playback.lastUpdate = Date.now();
    io.emit("admin-sync", playback);
  });

  // Запрос на получение меты
  socket.on("request-meta", () => {
    socket.emit("meta-updated", streamMeta);
  });

  socket.on("disconnect", () => {
    // если отключился админ - сброс админSocketId
    if (socket.id === adminSocketId) {
      adminSocketId = null;
      // оповестить зрителей
      io.emit("admin-disconnected");
    } else {
      streamMeta.viewers = Math.max((streamMeta.viewers || 1) - 1, 0);
      io.emit("meta-updated", streamMeta);
    }
  });
});

// === старт сервера ===
const PORT = process.env.PORT || 3000;
server.listen(PORT, '127.0.0.1', () => console.log(`🚀 Server running at http://localhost:${PORT}`));
