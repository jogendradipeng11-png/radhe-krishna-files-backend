require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
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

// CORS mapping configurations
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
      callback(new Error("CORS Policy Violation"));
    }
  },
  credentials: true
}));
app.options("*", cors());

// IDrive Object S3 Client Initialization Engine
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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // Maximum binary upload cap size: 25MB
});

// Custom Header Authorization Middleware
const requireLogin = (req, res, next) => {
  const username = req.headers["x-user"];
  if (!username) {
    return res.status(401).json({ success: false, error: "Access Denied: Please log in" });
  }
  req.currentUser = username;
  next();
};

// Root status confirmation route
app.get("/", (req, res) => {
  res.json({ message: "Radhe Krishna Backend Running" });
});

// Register User Account
app.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await addUser(username, password);
    res.json({ success: true, username: user.username });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// User Validation Login Access Route
app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = findUser(username);
  if (!user) return res.status(401).json({ success: false, error: "Invalid identity credentials" });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ success: false, error: "Incorrect password selection" });

  res.json({ success: true, username: user.username });
});

// Upload Document Interface Execution Block
app.post("/upload", requireLogin, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: "No file content detected" });

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
    res.status(500).json({ success: false, error: "Object upload mapping failed" });
  }
});

// Clean File-Listing Pipeline Loader
app.get("/files", requireLogin, async (req, res) => {
  const prefix = req.currentUser + "/";
  try {
    const data = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix
    }));

    // Drops raw folder objects so they don't corrupt the frontend layout list
    const files = (data.Contents || [])
      .filter(f => f.Key !== prefix && f.Size > 0)
      .map(f => path.basename(f.Key));

    res.json(files);
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to list documents from IDrive" });
  }
});

// Secure Temporary Signed Link Fetch Pipeline
app.get("/file/:name", requireLogin, async (req, res) => {
  const key = `${req.currentUser}/${req.params.name}`;
  try {
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: BUCKET, Key: key }),
      { expiresIn: 3600 } // URL link breaks natively after 1 hour for extreme file privacy
    );
    res.json({ success: true, url });
  } catch (err) {
    res.status(404).json({ success: false, error: "Target object key data not found" });
  }
});

// Delete Storage File Node Target Block
app.delete("/file/:name", requireLogin, async (req, res) => {
  const key = `${req.currentUser}/${req.params.name}`;
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Object removal failed" });
  }
});

app.listen(PORT, () => {
  console.log("Server active on port connection mapping node:", PORT);
});
