import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { config } from '../config/env';
import {
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  normalizeUsername,
  usernameFromLegacyEmail,
} from '../utils/username';

let dbInstance: DatabaseSync | null = null;

const DEFAULT_SCHEMA_SQL = `
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

CREATE TABLE IF NOT EXISTS devices (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_token   TEXT UNIQUE NOT NULL,
  claim_code     TEXT,
  name           TEXT,
  last_seen_at   TEXT,
  created_at     TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS drink_records (
  id             TEXT PRIMARY KEY,
  event_id       TEXT,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id      TEXT REFERENCES devices(id) ON DELETE SET NULL,
  event_type     TEXT NOT NULL DEFAULT 'drink',
  amount_ml      INTEGER NOT NULL,
  remaining_ml   INTEGER,
  occurred_at    TEXT NOT NULL,
  synced_at      TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, event_id)
);

CREATE TABLE IF NOT EXISTS deleted_water_events (
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id       TEXT NOT NULL,
  deleted_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_records_user_date ON drink_records(user_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_records_user_event ON drink_records(user_id, event_id);
CREATE INDEX IF NOT EXISTS idx_deleted_water_events_user ON deleted_water_events(user_id);
CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);
CREATE INDEX IF NOT EXISTS idx_devices_token ON devices(device_token);
`;

function loadSchemaSql(): string {
  const possiblePaths = [
    path.resolve(__dirname, 'schema.sql'),
    path.resolve(__dirname, '../../src/database/schema.sql'),
    path.resolve(process.cwd(), 'src/database/schema.sql'),
    path.resolve(process.cwd(), 'backend/src/database/schema.sql'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, 'utf8');
    }
  }

  return DEFAULT_SCHEMA_SQL;
}

/**
 * Automatically and safely migrates database schemas.
 * Fail-closed: Throws on failure to prevent running with an inconsistent or insecure schema.
 */
export function migrateDatabase(db: DatabaseSync): void {
  try {
    const versionRow = db.prepare('PRAGMA user_version;').get() as unknown as { user_version: number } | undefined;
    const currentVersion = versionRow?.user_version ?? 0;

    if (currentVersion < 1) {
      // Check if drink_records exists and needs rebuilding to UNIQUE(user_id, event_id)
      const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='drink_records'").get();
      if (tableExists) {
        db.exec(`
          CREATE TABLE IF NOT EXISTS drink_records_v2 (
            id             TEXT PRIMARY KEY,
            event_id       TEXT,
            user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            device_id      TEXT REFERENCES devices(id) ON DELETE SET NULL,
            event_type     TEXT NOT NULL DEFAULT 'drink',
            amount_ml      INTEGER NOT NULL,
            remaining_ml   INTEGER,
            occurred_at    TEXT NOT NULL,
            synced_at      TEXT DEFAULT (datetime('now')),
            UNIQUE(user_id, event_id)
          );

          INSERT OR IGNORE INTO drink_records_v2 (id, event_id, user_id, device_id, event_type, amount_ml, remaining_ml, occurred_at, synced_at)
          SELECT id, event_id, user_id, device_id, event_type, amount_ml, remaining_ml, occurred_at, synced_at
          FROM drink_records;

          DROP TABLE drink_records;
          ALTER TABLE drink_records_v2 RENAME TO drink_records;

          CREATE INDEX IF NOT EXISTS idx_records_user_date ON drink_records(user_id, occurred_at);
          CREATE INDEX IF NOT EXISTS idx_records_user_event ON drink_records(user_id, event_id);
        `);
      }
    }

    if (currentVersion < 2) {
      // Ensure devices table has claim_code column
      const devicesTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='devices'").get();
      if (devicesTableExists) {
        const deviceCols = db.prepare("PRAGMA table_info('devices');").all() as unknown as { name: string }[];
        const hasClaimCode = deviceCols.some((col) => col.name === 'claim_code');
        if (!hasClaimCode) {
          db.exec('ALTER TABLE devices ADD COLUMN claim_code TEXT;');
        }
      }
    }

    if (currentVersion < 3) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS deleted_water_events (
          user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          event_id       TEXT NOT NULL,
          deleted_at     TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (user_id, event_id)
        );

        CREATE INDEX IF NOT EXISTS idx_deleted_water_events_user
        ON deleted_water_events(user_id);
      `);
    }

    if (currentVersion < 4) {
      // Add the canonical account name without deleting legacy email data.
      const usersTableExists = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
        .get();

      if (usersTableExists) {
        const userCols = db.prepare("PRAGMA table_info('users');").all() as unknown as { name: string }[];
        const hasUsername = userCols.some((col) => col.name === 'username');
        if (!hasUsername) {
          db.exec('ALTER TABLE users ADD COLUMN username TEXT;');
        }

        const users = db
          .prepare('SELECT id, email, username FROM users ORDER BY rowid')
          .all() as unknown as Array<{ id: string; email: string | null; username: string | null }>;
        const usedNames = new Set<string>();
        const updateUsername = db.prepare('UPDATE users SET username = ? WHERE id = ?');

        for (const user of users) {
          const rawName = user.username || usernameFromLegacyEmail(user.email, user.id);
          let baseName = normalizeUsername(rawName)
            .replace(/[^\p{L}\p{N}._-]+/gu, '_')
            .replace(/^[._-]+|[._-]+$/gu, '');

          if (!baseName || !/^[\p{L}\p{N}]/u.test(baseName)) {
            baseName = usernameFromLegacyEmail(user.email, user.id);
          }
          if (baseName.length < USERNAME_MIN_LENGTH) {
            baseName = `${baseName}_user`;
          }
          baseName = baseName.slice(0, USERNAME_MAX_LENGTH);

          let candidate = baseName;
          let suffix = 2;
          while (usedNames.has(candidate)) {
            const suffixText = `_${suffix}`;
            candidate = `${baseName.slice(0, USERNAME_MAX_LENGTH - suffixText.length)}${suffixText}`;
            suffix += 1;
          }

          usedNames.add(candidate);
          updateUsername.run(candidate, user.id);
        }

        db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);');
      }
    }

    db.exec('PRAGMA user_version = 4;');
  } catch (err) {
    console.error('[FATAL Database Migration Error]', err);
    throw new Error(`Database migration failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function initDatabase(dbPath?: string): DatabaseSync {
  if (dbInstance) {
    return dbInstance;
  }

  const targetPath = dbPath || config.databasePath;

  if (targetPath !== ':memory:') {
    const dir = path.dirname(path.resolve(targetPath));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(targetPath === ':memory:' ? ':memory:' : path.resolve(targetPath));
  db.exec('PRAGMA foreign_keys = ON;');

  if (targetPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }

  // Run schema
  const schemaSql = loadSchemaSql();
  db.exec(schemaSql);

  // Apply automatic migrations
  migrateDatabase(db);

  dbInstance = db;
  return dbInstance;
}

export function getDatabase(): DatabaseSync {
  if (!dbInstance) {
    return initDatabase();
  }
  return dbInstance;
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
