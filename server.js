require("dotenv").config();

const express = require("express");
const cors = require("cors");
const session = require("express-session");
const multer = require("multer");
const path = require("path");

const {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  DeleteObjectCommand
} = require("@aws-sdk/client-s3");

const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const bcrypt = require("bcryptjs");

const { findUser, addUser } = require("./users.js");

const app = express();
const PORT = process.env.PORT || 10000;

app.set("trust proxy", 1); // IMPORTANT for Render / production

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

// ============================
// Multer
// ============================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

// ============================
// CORS FIX (VERY IMPORTANT)
// ============================

const allowedOrigins = [
  "https://jogendradipeng11-png.github.io",
  "https://radhe-krishna-files-2026.onrender.com",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://localhost:5500",
  "http://127.0.0.1:5500"
];

app.use(cors({
  origin: function (origin, callback) {

    // allow Postman / curl / file://
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
// SESSION FIX
// ============================

app.use(session({
  secret: process.env.JWT_SECRET || "rk-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    httpOnly: true,
    maxAge: 14 * 24 * 60 * 60 * 1000
  }
}));

app.use(express.json());

// ============================
// AUTH MIDDLEWARE
// ============================

const requireLogin = (req, res, next) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, error: "Login required" });
  }
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
    const user = await addUser(req.body.username, req.body.password);
    req.session.user = { username: user.username };
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// LOGIN
app.post("/login", async (req, res) => {

  const user = findUser(req.body.username);
  if (!user) return res.status(401).json({ success: false });

  const ok = await bcrypt.compare(req.body.password, user.password);
  if (!ok) return res.status(401).json({ success: false });

  req.session.user = { username: user.username };
  res.json({ success: true });
});

// LOGOUT
app.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// ============================
// FILE ROUTES
// ============================

// UPLOAD
app.post("/upload", requireLogin, upload.single("file"), async (req, res) => {

  const username = req.session.user.username;

  const key = `${username}/${Date.now()}-${req.file.originalname}`;

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: req.file.buffer,
    ContentType: req.file.mimetype
  }));

  res.json({ success: true });
});

// LIST FILES
app.get("/files", requireLogin, async (req, res) => {

  const prefix = req.session.user.username + "/";

  const data = await s3.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: prefix
  }));

  const files = (data.Contents || []).map(f =>
    path.basename(f.Key)
  );

  res.json(files);
});

// DOWNLOAD
app.get("/file/:name", requireLogin, async (req, res) => {

  const key = `${req.session.user.username}/${req.params.name}`;

  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    { expiresIn: 3600 }
  );

  res.json({ url });
});

// DELETE
app.delete("/file/:name", requireLogin, async (req, res) => {

  const key = `${req.session.user.username}/${req.params.name}`;

  await s3.send(new DeleteObjectCommand({
    Bucket: BUCKET,
    Key: key
  }));

  res.json({ success: true });
});

// START
app.listen(PORT, () => {
  console.log("Server running:", PORT);
});
