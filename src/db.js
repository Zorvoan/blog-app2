'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Ovladač SQLite:
//  1. vestavěný `node:sqlite` (Node.js 22.13+) – bez jakýchkoliv závislostí,
//  2. jinak volitelný balíček `better-sqlite3` (starší Node.js 18/20).
// Lze vynutit proměnnou prostředí SQLITE_DRIVER=node|better-sqlite3.
function loadDriver() {
  const wanted = process.env.SQLITE_DRIVER;
  const errors = [];
  if (wanted !== 'better-sqlite3') {
    try {
      // Potlačit hlášku "SQLite is an experimental feature" – ostatní varování ponechat.
      const emit = process.emitWarning;
      process.emitWarning = (warning, ...rest) => {
        if (String(warning?.message ?? warning).includes('SQLite is an experimental feature')) return;
        return emit.call(process, warning, ...rest);
      };
      const { DatabaseSync } = require('node:sqlite');
      return { name: 'node:sqlite', open: (file) => new DatabaseSync(file) };
    } catch (err) {
      errors.push(`node:sqlite: ${err.message}`);
    }
  }
  if (wanted !== 'node') {
    try {
      const Database = require('better-sqlite3');
      return { name: 'better-sqlite3', open: (file) => new Database(file) };
    } catch (err) {
      errors.push(`better-sqlite3: ${err.message}`);
    }
  }
  const msg = [
    `Nelze načíst SQLite (Node.js ${process.version}).`,
    'Řešení: nainstalujte Node.js 22 LTS nebo novější (https://nodejs.org),',
    'nebo na starším Node.js spusťte "npm install better-sqlite3".',
    ...errors.map((e) => `  - ${e}`),
  ].join('\n');
  throw new Error(msg);
}

let driver;

// Migrace 1: výchozí schéma. Používá IF NOT EXISTS, takže databáze vytvořené
// před zavedením migrací (user_version = 0) projdou beze změny a jen se označí verzí.
const BASE_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email         TEXT UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  bio           TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  theme         TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('system', 'light', 'dark')),
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  csrf       TEXT NOT NULL,
  flash      TEXT,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  color       TEXT NOT NULL DEFAULT '#1d9bf0',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id           INTEGER PRIMARY KEY,
  author_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  category_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  pinned       INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  published_at TEXT,
  edited_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deleted_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_posts_feed ON posts (deleted_at, status, published_at);
CREATE INDEX IF NOT EXISTS idx_posts_category ON posts (category_id);
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts (author_id);

CREATE TABLE IF NOT EXISTS tags (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS post_tags (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);

CREATE TABLE IF NOT EXISTS votes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  value   INTEGER NOT NULL CHECK (value IN (-1, 1)),
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY,
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments (post_id);

CREATE TABLE IF NOT EXISTS pages (
  id          INTEGER PRIMARY KEY,
  title       TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  body        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  show_in_nav INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  author_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  edited_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS revisions (
  id         INTEGER PRIMARY KEY,
  entity     TEXT NOT NULL CHECK (entity IN ('post', 'page')),
  entity_id  INTEGER NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  editor_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revisions_entity ON revisions (entity, entity_id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

// Seznam migrací. Každá se spustí právě jednou, v pořadí, uvnitř transakce.
// Číslo verze = pořadí v poli (1, 2, …) a ukládá se do PRAGMA user_version.
// Existující migrace se NIKDY nemění – změna schématu = nová položka na konci.
const MIGRATIONS = [
  BASE_SCHEMA,

  // 2: rychlý součet hlasů pro příspěvek (primární klíč začíná user_id, proto nestačí).
  'CREATE INDEX IF NOT EXISTS idx_votes_post ON votes (post_id);',

  // 3: ochrana proti dvojímu zpracování stejného formuláře (dvojklik, opakované odeslání offline fronty).
  `CREATE TABLE IF NOT EXISTS idempotency_keys (
     user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     key        TEXT NOT NULL,
     location   TEXT NOT NULL,
     created_at TEXT NOT NULL,
     PRIMARY KEY (user_id, key)
   );`,
];

function migrate(db) {
  const current = db.prepare('PRAGMA user_version').get().user_version;
  if (current > MIGRATIONS.length) {
    throw new Error(`Databáze má verzi ${current}, ale aplikace zná jen ${MIGRATIONS.length}. Použijte novější verzi aplikace.`);
  }
  for (let version = current + 1; version <= MIGRATIONS.length; version++) {
    db.tx(() => {
      db.exec(MIGRATIONS[version - 1]);
      db.exec(`PRAGMA user_version = ${version}`);
    });
  }
}

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  driver ??= loadDriver();
  const db = driver.open(file);
  db.driverName = driver.name;
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

  db.tx = (fn) => {
    db.exec('BEGIN');
    try {
      const r = fn();
      db.exec('COMMIT');
      return r;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
  try {
    migrate(db);
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
}

const now = () => new Date().toISOString();

module.exports = { openDb, now, SCHEMA_VERSION: MIGRATIONS.length };
