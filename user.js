const fs = require('fs');
const bcrypt = require('bcryptjs');
const path = require('path');

const USERS_FILE = path.join(__dirname, 'users.json');

// Default admin: username "k", password "r"
const initialUsers = [
  {
    id: 1,
    username: "k",
    password: bcrypt.hashSync("r", 10),
    role: "admin",
    createdAt: new Date().toISOString()
  }
];

let users = [];
if (fs.existsSync(USERS_FILE)) {
  try {
    users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (err) {
    console.error("Error reading users.json → using default admin:", err.message);
    users = initialUsers;
  }
} else {
  users = initialUsers;
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
  console.log("Created users.json with default admin (k / r)");
}

function saveUsers() {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
  } catch (err) {
    console.error("Failed to save users.json:", err.message);
  }
}

function findUser(username) {
  return users.find(u => u.username.toLowerCase() === username.toLowerCase());
}

async function addUser(username, password) {
  if (findUser(username)) {
    throw new Error("Username already taken");
  }
  if (username.length < 3) {
    throw new Error("Username must be at least 3 characters");
  }
  if (password.length < 4) {
    throw new Error("Password must be at least 4 characters");
  }

  const hashed = await bcrypt.hash(password, 10);

  const newUser = {
    id: users.length + 1,
    username,
    password: hashed,
    role: "user",
    createdAt: new Date().toISOString()
  };

  users.push(newUser);
  saveUsers();
  return newUser;
}

module.exports = { findUser, addUser };