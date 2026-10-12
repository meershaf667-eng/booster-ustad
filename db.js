// SQLite database layer (Node built-in node:sqlite — no native build needed).
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const { DATA_DIR } = require('./paths');

const db = new DatabaseSync(path.join(DATA_DIR, 'booster.db'));

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  phone       TEXT UNIQUE NOT NULL,
  created_at  TEXT NOT NULL,
  last_login  TEXT
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  phone       TEXT NOT NULL,
  code        TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_codes(phone);

CREATE TABLE IF NOT EXISTS fb_accounts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL REFERENCES users(id),
  fb_user_id       TEXT NOT NULL,
  name             TEXT,
  access_token     TEXT,
  token_expires_at TEXT,
  is_demo          INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fb_pages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  account_id    INTEGER REFERENCES fb_accounts(id),
  page_id       TEXT NOT NULL,
  name          TEXT NOT NULL,
  picture_url   TEXT,
  access_token  TEXT,
  perms         TEXT NOT NULL DEFAULT '[]',
  status        TEXT NOT NULL DEFAULT 'connected',
  is_demo       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  filename      TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime          TEXT NOT NULL,
  size          INTEGER NOT NULL,
  duration      REAL,
  folder        TEXT NOT NULL DEFAULT 'All',
  status        TEXT NOT NULL DEFAULT 'ready',
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_user ON media(user_id);

CREATE TABLE IF NOT EXISTS posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  page_id     INTEGER REFERENCES fb_pages(id),
  page_name   TEXT,
  caption     TEXT,
  media_ids   TEXT NOT NULL DEFAULT '[]',
  status      TEXT NOT NULL DEFAULT 'publishing',
  fb_post_id  TEXT,
  error       TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS captions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  text        TEXT NOT NULL,
  language    TEXT,
  tone        TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id),
  action      TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id);
`);

module.exports = db;
