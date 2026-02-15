require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  DeleteObjectCommand
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const { findUser, addUser } = require('./users.js');

const app = express();
const PORT = process.env.PORT || 3000;

// ────────────────────────────────────────────────
// IDrive e2 S3 Client
// ────────────────────────────────────────────────
const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.IDRIVE_ENDPOINT,
  credentials: {
    accessKeyId: process.env.IDRIVE_ACCESS_KEY_ID,
    secretAccessKey: process.env.IDRIVE_SECRET_ACCESS_KEY
  },
  forcePathStyle: true
});

const BUCKET = process.env.IDRIVE_BUCKET_NAME;

// ────────────────────────────────────────────────
// Multer (memory → direct to S3)
// ────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // 25 MB max
});

// ────────────────────────────────────────────────
// CORS – allow GitHub Pages + local dev
// ────────────────────────────────────────────────
const allowedOrigins = [
  'https://jogendradipeng11-png.github.io',
  'http://127.0.0.1:8080',
  'http://localhost:8080',
  'http://127.0.0.1:5500',
  'http://localhost:5500',
  'http://127.0.0.1:3000',
  'http://localhost:3000'
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || origin.startsWith('http://127.0.0.1:') || origin.startsWith('http://localhost:')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

// ────────────────────────────────────────────────
// Session
// ────────────────────────────────────────────────
app.use(session({
  secret: process.env.JWT_SECRET || 'radhe-krishna-secret-very-secure-2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 14 * 24 * 60 * 60 * 1000, // 14 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'none'
  }
}));

app.use(express.json());

// ────────────────────────────────────────────────
// Auth middleware
// ────────────────────────────────────────────────
const requireLogin = (req, res, next) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, error: 'Please login first' });
  }
  next();
};

// ────────────────────────────────────────────────
// Routes
// ────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ message: 'Radhe Krishna File Library Backend ✨ API is running' });
});

app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password required' });
  }

  try {
    const user = await addUser(username, password);
    req.session.user = { username: user.username, role: user.role };
    res.json({ success: true, message: 'Registered successfully' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password required' });
  }

  const user = findUser(username);
  if (!user) {
    return res.status(401).json({ success: false, error: 'Invalid username or password' });
  }

  const match = await require('bcryptjs').compare(password, user.password);
  if (!match) {
    return res.status(401).json({ success: false, error: 'Invalid username or password' });
  }

  req.session.user = { username: user.username, role: user.role };
  res.json({ success: true, message: 'Login successful' });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true, message: 'Logged out' });
  });
});

// ────────────────────────────────────────────────
// File Routes (IDrive e2)
// ────────────────────────────────────────────────
app.post('/upload', requireLogin, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded' });
  }

  const username = req.session.user.username;
  const originalName = req.file.originalname;
  const key = `${username}/${Date.now()}-${originalName.replace(/\s+/g, '_')}`;

  try {
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype
    }));

    res.json({ success: true, message: 'File uploaded', filename: originalName });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ success: false, error: 'Upload failed' });
  }
});

app.get('/files', requireLogin, async (req, res) => {
  const username = req.session.user.username;
  const prefix = `${username}/`;

  try {
    const data = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix
    }));

    const files = (data.Contents || [])
      .filter(obj => obj.Key !== prefix)
      .map(obj => path.basename(obj.Key));

    res.json(files);
  } catch (err) {
    console.error('List error:', err);
    res.status(500).json({ success: false, error: 'Cannot list files' });
  }
});

app.get('/file/:filename', requireLogin, async (req, res) => {
  const username = req.session.user.username;
  const filename = req.params.filename;
  const key = `${username}/${filename}`;

  try {
    const url = await getSignedUrl(s3, new GetObjectCommand({
      Bucket: BUCKET,
      Key: key
    }), { expiresIn: 3600 }); // 1 hour

    res.json({ success: true, url });
  } catch (err) {
    console.error('Presign error:', err);
    res.status(404).json({ success: false, error: 'File not found or access denied' });
  }
});

app.delete('/file/:filename', requireLogin, async (req, res) => {
  const username = req.session.user.username;
  const filename = req.params.filename;
  const key = `${username}/${filename}`;

  try {
    await s3.send(new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: key
    }));
    res.json({ success: true, message: 'File deleted' });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ success: false, error: 'Delete failed' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Bucket:', BUCKET);
  console.log('Endpoint:', process.env.IDRIVE_ENDPOINT);
});