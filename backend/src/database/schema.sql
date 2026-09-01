-- Users Table
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  -- Kept for backwards compatibility with accounts created before username login.
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name  TEXT,
  daily_goal_ml INTEGER DEFAULT 2000,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

-- Devices Table (Smart Water Tracker Cups)
CREATE TABLE IF NOT EXISTS devices (
  id             TEXT PRIMARY KEY,       -- Firmware deviceId (e.g., "water_abcd1234")
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_token   TEXT UNIQUE NOT NULL,   -- Authentication token for ESP32 / IoT device
  claim_code     TEXT,                   -- Optional pairing secret / claim code for hardware ownership verification
  name           TEXT,                   -- Custom user device name
  last_seen_at   TEXT,                   -- Last communication timestamp
  created_at     TEXT DEFAULT (datetime('now'))
);

-- Drink and Refill Records Table
CREATE TABLE IF NOT EXISTS drink_records (
  id             TEXT PRIMARY KEY,
  event_id       TEXT,                   -- ESP32 event ID (scoped unique per user)
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id      TEXT REFERENCES devices(id) ON DELETE SET NULL,
  event_type     TEXT NOT NULL DEFAULT 'drink', -- 'drink' or 'refill'
  amount_ml      INTEGER NOT NULL,
  remaining_ml   INTEGER,
  occurred_at    TEXT NOT NULL,          -- ISO 8601 UTC string
  synced_at      TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, event_id)
);

-- Minimal tombstones prevent a permanently deleted device event from being
-- recreated when the device retries an already-synced upload.
CREATE TABLE IF NOT EXISTS deleted_water_events (
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id       TEXT NOT NULL,
  deleted_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, event_id)
);

-- Performance & Security Indexes
CREATE INDEX IF NOT EXISTS idx_records_user_date ON drink_records(user_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_records_user_event ON drink_records(user_id, event_id);
CREATE INDEX IF NOT EXISTS idx_deleted_water_events_user ON deleted_water_events(user_id);
CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);
CREATE INDEX IF NOT EXISTS idx_devices_token ON devices(device_token);
