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

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

// ============================
// CORS CONFIGURATIONS
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
      callback(new Error("CORS Policy Blocking"));
    }
  },
  credentials: true
}));
app.options("*", cors());

// ============================
// IDRIVE S3 CLIENT
// ============================
const s3 = new S3Client({
  region: "us-west-1", // Locked to your exact IDrive region
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
  limits: { fileSize: 25 * 1024 * 1024 }
});

// ============================
// CLOUD PERSISTENT USER MANAGEMENT (NO DISK REQUIRED)
// ============================
const USER_DATA_KEY = "system_data/users.json";
let cachedUsers = [];

// Back up master admin profile
const defaultAdmin = {
  id: 1,
  username: "k",
  password: bcrypt.hashSync("r", 10),
  role: "admin",
  createdAt: new Date().toISOString()
};

// Pull accounts directly from IDrive Bucket when server boots up
async function loadUsersFromCloud() {
  try {
    const data = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: USER_DATA_KEY }));
    const streamToString = (stream) =>
      new Promise((resolve, reject) => {
        const chunks = [];
        stream.on("data", (chunk) => chunks.push(chunk));
        stream.on("error", reject);
        stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      });
    const bodyContents = await streamToString(data.Body);
    cachedUsers = JSON.parse(bodyContents);
    console.log("Users synced successfully from IDrive storage!");
  } catch (err) {
    console.log("No cloud data file found yet. Initializing default admin profile...");
    cachedUsers = [defaultAdmin];
    await saveUsersToCloud();
  }
}

// Sync back to IDrive immediately during account generation
async function saveUsersToCloud() {
  try {
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: USER_DATA_KEY,
      Body: JSON.stringify(cachedUsers, null, 2),
      ContentType: "application/json"
    }));
  } catch (err) {
    console.error("Failed to back up user db file to cloud bucket:", err.message);
  }
}

function findUser(username) {
  return cachedUsers.find(u => u.username.toLowerCase() === username.toLowerCase());
}

async function addUser(username, password) {
  if (findUser(username)) throw new Error("Username already taken");
  if (username.length < 3) throw new Error("Username must be at least 3 characters");
  if (password.length < 4) throw new Error("Password must be at least 4 characters");

  const hashed = await bcrypt.hash(password, 10);
  const newUser = {
    id: cachedUsers.length + 1,
    username,
    password: hashed,
    role: "user",
    createdAt: new Date().toISOString()
  };

  cachedUsers.push(newUser);
  await saveUsersToCloud();
  return newUser;
}

// Sync users out of storage at container runtime boot cycle
loadUsersFromCloud();

const requireLogin = (req, res, next) => {
  const username = req.headers["x-user"];
  if (!username) return res.status(401).json({ success: false, error: "Login required" });
  req.currentUser = username;
  next();
};

// ============================
// EXPRESS API ROUTE ENDPOINTS
// ============================
app.get("/", (req, res) => {
  res.json({ message: "Radhe Krishna Backend Running Seamlessly ✨" });
});

app.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await addUser(username, password);
    res.json({ success: true, username: user.username });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = findUser(username);
  if (!user) return res.status(401).json({ success: false, error: "Invalid username" });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ success: false, error: "Incorrect password" });

  res.json({ success: true, username: user.username });
});

app.post("/upload", requireLogin, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: "No file chosen" });

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
    res.status(500).json({ success: false, error: "S3 transmission error" });
  }
});

app.get("/files", requireLogin, async (req, res) => {
  const prefix = req.currentUser + "/";
  try {
    const data = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix
    }));

    const files = (data.Contents || [])
      .filter(f => f.Key !== prefix && f.Size > 0)
      .map(f => path.basename(f.Key));

    res.json(files);
  } catch (err) {
    res.status(500).json({ success: false, error: "IDrive storage tracking failed" });
  }
});

app.get("/file/:name", requireLogin, async (req, res) => {
  const key = `${req.currentUser}/${req.params.name}`;
  try {
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: BUCKET, Key: key }),
      { expiresIn: 3600 }
    );
    res.json({ success: true, url });
  } catch (err) {
    res.status(404).json({ success: false, error: "File not found" });
  }
});

app.delete("/file/:name", requireLogin, async (req, res) => {
  const key = `${req.currentUser}/${req.params.name}`;
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Object destruction failed" });
  }
});

app.listen(PORT, () => {
  console.log("Cloud database integration active on port:", PORT);
});
