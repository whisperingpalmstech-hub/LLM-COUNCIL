import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA_VERSION = 2;

/**
 * An append-only event log (the source of truth for conversations), a key/value
 * settings table (council configuration), and users + sessions for sign-in.
 */
export function openDatabase(location: string): DatabaseSync {
  if (location !== ":memory:") fs.mkdirSync(path.dirname(location), { recursive: true });
  const db = new DatabaseSync(location);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  const version = Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
  if (version < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        seq             INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT    NOT NULL,
        type            TEXT    NOT NULL,
        at              TEXT    NOT NULL,
        payload         TEXT    NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_conversation ON events(conversation_id, seq);
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }
  if (version < 2) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id            TEXT PRIMARY KEY,
        email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name          TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL DEFAULT 'member',
        created_at    TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    `);
  }
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  return db;
}

export class Settings {
  private readonly db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
  }

  get<T>(key: string): T | undefined {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : undefined;
  }

  set(key: string, value: unknown): void {
    this.db.prepare("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
  }
}
