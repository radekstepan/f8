import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const SCHEMA_VERSION = 2;

// The schema lives here as a string (rather than a .sql asset) so `tsc`
// emits a self-contained dist with no asset copying.
const MIGRATION_1 = `
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  hash TEXT UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('file', 'url')),
  path TEXT,
  url TEXT,
  thumbnail_url TEXT,
  filename TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  camera TEXT NOT NULL DEFAULT '',
  lens TEXT NOT NULL DEFAULT '',
  iso INTEGER NOT NULL DEFAULT 0,
  aperture TEXT NOT NULL DEFAULT '-',
  shutter TEXT NOT NULL DEFAULT '-',
  focal_length TEXT NOT NULL DEFAULT '-',
  date_taken TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  raw INTEGER NOT NULL DEFAULT 0,
  favorite INTEGER NOT NULL DEFAULT 0,
  rating INTEGER NOT NULL DEFAULT 0,
  album_id TEXT NOT NULL DEFAULT 'imports',
  photographer TEXT,
  file_size INTEGER NOT NULL DEFAULT 0,
  mtime INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS photo_edits (
  photo_id TEXT PRIMARY KEY REFERENCES photos (id) ON DELETE CASCADE,
  present_json TEXT NOT NULL,
  edited INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS albums (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cover TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  values_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_photos_hash ON photos (hash);
CREATE INDEX IF NOT EXISTS idx_photos_album ON photos (album_id);
`;

// Local semantic search (task 14): CLIP-image embeddings (512-d float32 LE
// blob, 2KB per photo) plus zero-shot/hand-added labels. Model + version
// stamp every embedding so a model swap re-embeds instead of mixing spaces.
const MIGRATION_2 = `
CREATE TABLE IF NOT EXISTS photo_embeddings (
  photo_id TEXT PRIMARY KEY REFERENCES photos (id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  version TEXT NOT NULL,
  dim INTEGER NOT NULL,
  embedding BLOB NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS photo_labels (
  photo_id TEXT NOT NULL REFERENCES photos (id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  score REAL NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('ml', 'user')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (photo_id, label)
);
CREATE INDEX IF NOT EXISTS idx_photo_labels_label ON photo_labels (label);
`;

function currentVersion(db: DatabaseSync): number {
  const row = db
    .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
    .get() as { value: string } | undefined;
  if (!row) return 0;
  const parsed = Number.parseInt(row.value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function setVersion(db: DatabaseSync, version: number): void {
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('schema_version', ?) " +
      "ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  ).run(String(version));
}

function migrate(db: DatabaseSync): void {
  db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);");
  if (currentVersion(db) < 1) {
    db.exec(MIGRATION_1);
    setVersion(db, 1);
  }
  if (currentVersion(db) < 2) {
    db.exec(MIGRATION_2);
    setVersion(db, 2);
  }
}

export function openDatabase(dbPath: string): DatabaseSync {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}
