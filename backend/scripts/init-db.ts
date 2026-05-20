import Database from "better-sqlite3";
import * as path from "path";

// Initialize the SQLite database
const dbPath = path.join(__dirname, "../../data/indexmon.db");
const db = new Database(dbPath);

// Create tables for user sessions and historical indexer data
const createTables = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user'
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_token TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      expires_at TIMESTAMP NOT NULL
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
db.close();