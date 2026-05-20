const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Initialize the SQLite database
const dataDir = '/app/data';
const dbPath = '/app/data/indexmon.db';

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);

// Create tables
const createTables = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL DEFAULT '',
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user'
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_token TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS indexer_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      indexer_id TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      last_checked TIMESTAMP NOT NULL
    );
  `);

  console.log("Database initialized successfully.");
};

createTables();

// Add a default user
const addDefaultUser = () => {
  const envHash = process.env.ADMIN_PASSWORD_HASH;
  const hashedPassword = envHash || crypto.createHash('sha256').update('admin').digest('hex');
  const stmt = db.prepare("INSERT OR IGNORE INTO users (username, email, password, role) VALUES (?, ?, ?, ?)");
  stmt.run('admin', 'admin@indexmon.local', hashedPassword, 'admin');
  // Always update the password so ADMIN_PASSWORD_HASH env var changes take effect on restart
  const updateStmt = db.prepare("UPDATE users SET password = ? WHERE username = ?");
  updateStmt.run(hashedPassword, 'admin');
  console.log(`Default user 'admin' configured${envHash ? ' from ADMIN_PASSWORD_HASH' : ' with default password \'admin\''}.`);
};

addDefaultUser();
db.close();