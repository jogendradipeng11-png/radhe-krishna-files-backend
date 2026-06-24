require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  DeleteObjectCommand
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { findUser, addUser } = require("./users.js");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

// ============================
// CORS Configuration
// ============================
const allowedOrigins = [
  "https://jogendradipeng11-png.github.io",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://localhost:5500",
  "http://127.0.0.1:5500"
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (
      allowedOrigins.includes(origin) ||
      origin.startsWith("http://localhost") ||
      origin.startsWith("http://127.0.0.1")
    ) {
      callback(null, true);
    } else {
      callback(new Error("CORS Not Allowed"));
    }
  },
  credentials: true
}));
app.options("*", cors());

// ============================
// IDrive S3 Client
// ============================
const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.IDRIVE_ENDPOINT,
  credentials: {
    accessKeyId: process.env.IDRIVE_ACCESS_KEY_ID,
    secretAccessKey: process.env.IDRIVE_SECRET_ACCESS_KEY
  },
  forcePathStyle: true
});

const BUCKET = process.env.IDRIVE_BUCKET_NAME;

// Multer memory storage (Handles PDFs, Docs, Images, Excel sheets up to 25MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

// ============================
// Simple Token Authentication Middleware
// ============================
// Instead of cookies, the frontend passes the username in a custom 'X-User' header
const requireLogin = (req, res, next) => {
  const username = req.headers["x-user"];
  if (!username) {
    return res.status(401).json({ success: false, error: "Login required" });
  }
  req.currentUser = username;
  next();
};

// ============================
// ROUTES
// ============================

app.get("/", (req, res) => {
  res.json({ message: "Radhe Krishna Backend Running" });
});

// REGISTER
app.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await addUser(username, password);
    res.json({ success: true, username: user.username });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// LOGIN
app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = findUser(username);
  if (!user) return res.status(401).json({ success: false, error: "Invalid User" });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ success: false, error: "Wrong Password" });

  res.json({ success: true, username: user.username });
});

// UPLOAD FILE
app.post("/upload", requireLogin, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: "No file uploaded" });

  const username = req.currentUser;
  const key = `${username}/${Date.now()}-${req.file.originalname.replace(/\s+/g, "_")}`;

  try {
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype
    }));
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Upload failed" });
  }
});

// LIST FILES
app.get("/files", requireLogin, async (req, res) => {
  const prefix = req.currentUser + "/";
  try {
    const data = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix
    }));

    // FIXED: Strips out empty directory placeholders so they don't break your list layout
    const files = (data.Contents || [])
      .filter(f => f.Key !== prefix && f.Size > 0)
      .map(f => path.basename(f.Key));

    res.json(files);
  } catch (err) {
    res.status(500).json({ success: false, error: "Cannot list files" });
  }
});

// DOWNLOAD / GENERATE PRESIGNED URL
app.get("/file/:name", requireLogin, async (req, res) => {
  const key = `${req.currentUser}/${req.params.name}`;
  try {
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: BUCKET, Key: key }),
      { expiresIn: 3600 } // Link active for 1 hour
    );
    res.json({ success: true, url });
  } catch (err) {
    res.status(404).json({ success: false, error: "File not found" });
  }
});

// DELETE FILE
app.delete("/file/:name", requireLogin, async (req, res) => {
  const key = `${req.currentUser}/${req.params.name}`;
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Delete failed" });
  }
});

app.listen(PORT, () => {
  console.log("Server running on port:", PORT);
});
