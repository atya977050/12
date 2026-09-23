import express from "express";
import http from "http";
import { Server } from "socket.io";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const uploadDir = path.join(__dirname, "uploads");

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name =
      `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;

    cb(null, name);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 200 * 1024 * 1024
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(uploadDir));

const users = new Map();
const messages = new Map();

app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      ok: false,
      error: "لم يتم اختيار ملف"
    });
  }

  res.json({
    ok: true,
    file: {
      name: req.file.originalname,
      type: req.file.mimetype,
      size: req.file.size,
      url: `/uploads/${req.file.filename}`
    }
  });
});

io.on("connection", (socket) => {

  socket.on("user:join", ({ userId, name }) => {
    if (!userId) return;

    users.set(userId, {
      userId,
      name: name || "مستخدم",
      socketId: socket.id
    });

    socket.data.userId = userId;

    socket.emit("chat:ready", { userId });

    io.emit(
      "presence:update",
      [...users.values()].map(({ userId, name }) => ({
        userId,
        name
      }))
    );
  });

  socket.on("chat:send", (message) => {
    const {
      chatId,
      senderId,
      senderName,
      text,
      attachment
    } = message || {};

    if (!chatId || !senderId) return;

    if (!text?.trim() && !attachment) return;

    const item = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      chatId,
      senderId,
      senderName: senderName || "مستخدم",
      text: text?.trim() || "",
      attachment: attachment || null,
      createdAt: new Date().toISOString()
    };

    if (!messages.has(chatId)) {
      messages.set(chatId, []);
    }

    messages.get(chatId).push(item);

    io.emit("chat:message", item);
  });

  socket.on("chat:history", ({ chatId }) => {
    socket.join(`chat:${chatId}`);

    socket.emit("chat:history", {
      chatId,
      messages: messages.get(chatId) || []
    });
  });

  // WebRTC signaling
  socket.on("call:join", ({ chatId }) => {
    if (!chatId) return;
    socket.join(`call:${chatId}`);
    socket.to(`call:${chatId}`).emit("call:peer-joined", {
      userId: socket.data.userId
    });
  });

  socket.on("webrtc:offer", ({ chatId, offer }) => {
    if (!chatId || !offer) return;
    socket.to(`chat:${chatId}`).emit("webrtc:offer", {
      offer,
      from: socket.data.userId
    });
  });

  socket.on("webrtc:answer", ({ chatId, answer }) => {
    if (!chatId || !answer) return;
    socket.to(`chat:${chatId}`).emit("webrtc:answer", {
      answer,
      from: socket.data.userId
    });
  });

  socket.on("webrtc:ice", ({ chatId, candidate }) => {
    if (!chatId || !candidate) return;
    socket.to(`chat:${chatId}`).emit("webrtc:ice", {
      candidate,
      from: socket.data.userId
    });
  });

  socket.on("call:end", ({ chatId }) => {
    if (!chatId) return;
    socket.to(`chat:${chatId}`).emit("call:ended");
  });

  socket.on("disconnect", () => {
    const userId = socket.data.userId;

    if (userId) {
      users.delete(userId);
    }

    io.emit(
      "presence:update",
      [...users.values()].map(({ userId, name }) => ({
        userId,
        name
      }))
    );
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    app: "الهلباوى Chat",
    version: "0.2.0",
    features: [
      "attachments",
      "video",
      "audio-recording",
      "camera-preview",
      "webrtc-signaling-ready"
    ]
  });
});

const PORT = process.env.PORT || 3010;

server.listen(PORT, () => {
  console.log(`الهلباوى Chat running on port ${PORT}`);
});
