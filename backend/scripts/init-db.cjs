const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Initialize the SQLite database
const dbPath = process.env.DB_PATH || '/app/data/indexmon.db';
const dataDir = path.dirname(dbPath);

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);

// Create tables
const createTables = () => {
  db.exec(`
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

db.close();