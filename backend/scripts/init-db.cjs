const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

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

    CREATE TABLE IF NOT EXISTS alert_state (
      key TEXT PRIMARY KEY,
      down_since INTEGER NOT NULL,
      alerted INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS indexer_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      indexer_id TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      last_checked TIMESTAMP NOT NULL,
      source TEXT NOT NULL DEFAULT 'prowlarr'
    );

    CREATE INDEX IF NOT EXISTS idx_indexer_history_lookup ON indexer_history(indexer_id, source, last_checked);
  `);

  console.log("Database initialized successfully.");
};

createTables();

// Add source column to existing indexer_history tables
try {
  db.exec("ALTER TABLE indexer_history ADD COLUMN source TEXT NOT NULL DEFAULT 'prowlarr'");
} catch {
  // Column already exists — ignore
}

db.close();