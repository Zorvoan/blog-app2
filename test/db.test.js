'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb, SCHEMA_VERSION } = require('../src/db');

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blog-db-')), 'test.db');
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;
const hasObject = (db, name) => !!db.prepare('SELECT 1 FROM sqlite_master WHERE name = ?').get(name);

test('migrace: nová databáze dostane nejnovější schéma', () => {
  const db = openDb(tmpFile());
  assert.equal(version(db), SCHEMA_VERSION);
  assert.ok(hasObject(db, 'posts'));
  assert.ok(hasObject(db, 'idx_votes_post'));
  assert.ok(hasObject(db, 'idempotency_keys'));
  db.close();
});

test('migrace: databáze z doby před migracemi se povýší a data zůstanou', () => {
  const file = tmpFile();
  let db = openDb(file);
  db.prepare("INSERT INTO users (username, password_hash, display_name, created_at) VALUES ('stary', 'x', 'Starý', '2026-01-01')").run();
  // Simulace původní databáze: verze 0, bez objektů z pozdějších migrací.
  db.exec('DROP INDEX idx_votes_post; DROP TABLE idempotency_keys; PRAGMA user_version = 0;');
  db.close();

  db = openDb(file);
  assert.equal(version(db), SCHEMA_VERSION);
  assert.ok(hasObject(db, 'idx_votes_post'));
  assert.ok(hasObject(db, 'idempotency_keys'));
  assert.equal(db.prepare("SELECT display_name FROM users WHERE username = 'stary'").get().display_name, 'Starý');
  db.close();
});

test('migrace: opakované otevření nic nemění a novější databázi aplikace odmítne', () => {
  const file = tmpFile();
  openDb(file).close();
  let db = openDb(file);
  assert.equal(version(db), SCHEMA_VERSION);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
  db.close();
  assert.throws(() => openDb(file), /novější verzi aplikace/);
});
