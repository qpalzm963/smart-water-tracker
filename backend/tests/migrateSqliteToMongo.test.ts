import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Db, MongoClient } from 'mongodb';
import { runMigration, maskMongoUri, sanitizeMongoError } from '../src/scripts/migrateSqliteToMongo';
import {
  MONGO_COLLECTIONS,
  MongoUserDoc,
  MongoDeviceDoc,
  MongoDrinkRecordDoc,
  MongoDeletedWaterEventDoc,
} from '../src/database/mongoCollections';

jest.setTimeout(60000);

describe('SQLite to MongoDB Migration Tool (#14)', () => {
  let mongoServer: MongoMemoryServer;
  let mongoClient: MongoClient;
  let mongoDb: Db;
  let tempSqlitePath: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    mongoClient = new MongoClient(mongoServer.getUri());
    await mongoClient.connect();
    mongoDb = mongoClient.db('migration_test_db');

    // Create a temporary SQLite database with test fixtures
    // Note: Matches real production schema.sql / db.ts where drink_records does NOT have time_synced
    tempSqlitePath = path.join(os.tmpdir(), `test_migration_${Date.now()}.db`);
    const sqlite = new DatabaseSync(tempSqlitePath);

    sqlite.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        display_name TEXT,
        daily_goal_ml INTEGER DEFAULT 2000,
        created_at TEXT,
        updated_at TEXT
      );

      CREATE TABLE devices (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        device_token TEXT UNIQUE NOT NULL,
        claim_code TEXT,
        name TEXT,
        last_seen_at TEXT,
        created_at TEXT
      );

      CREATE TABLE drink_records (
        id TEXT PRIMARY KEY,
        event_id TEXT,
        user_id TEXT NOT NULL,
        device_id TEXT,
        event_type TEXT NOT NULL DEFAULT 'drink',
        amount_ml INTEGER NOT NULL,
        remaining_ml INTEGER,
        occurred_at TEXT NOT NULL,
        synced_at TEXT,
        UNIQUE(user_id, event_id)
      );

      CREATE TABLE deleted_water_events (
        user_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        deleted_at TEXT,
        PRIMARY KEY (user_id, event_id)
      );

      INSERT INTO users VALUES ('u1', 'alice', 'alice@test.com', 'hash_alice', 'Alice', 2000, '2026-09-01T10:00:00Z', '2026-09-01T10:00:00Z');
      INSERT INTO users VALUES ('u2', 'bob', 'bob@test.com', 'hash_bob', 'Bob', 2500, '2026-09-01T11:00:00Z', '2026-09-01T11:00:00Z');

      INSERT INTO devices VALUES ('d1', 'u1', 'dvt_alice_cup', 'claim_123', 'Alice Cup', '2026-09-01T12:00:00Z', '2026-09-01T10:30:00Z');
      INSERT INTO devices VALUES ('d2', 'u2', 'dvt_bob_cup', NULL, 'Bob Cup', NULL, '2026-09-01T11:30:00Z');

      INSERT INTO drink_records VALUES ('r1', 'evt_1', 'u1', 'd1', 'drink', 250, 450, '2026-09-01T12:00:00Z', '2026-09-01T12:01:00Z');
      INSERT INTO drink_records VALUES ('r2', 'evt_2', 'u1', 'd1', 'refill', 500, 700, '2026-09-01T13:00:00Z', '2026-09-01T13:01:00Z');
      INSERT INTO drink_records VALUES ('r3', NULL, 'u2', NULL, 'drink', 300, NULL, '2026-09-01T14:00:00Z', '2026-09-01T14:01:00Z');

      INSERT INTO deleted_water_events VALUES ('u1', 'evt_old_1', '2026-09-01T15:00:00Z');
    `);

    sqlite.close();
  }, 60000);

  afterAll(async () => {
    if (mongoClient) {
      await mongoClient.close();
    }
    if (mongoServer) {
      await mongoServer.stop();
    }
    if (fs.existsSync(tempSqlitePath)) {
      fs.unlinkSync(tempSqlitePath);
    }
  }, 30000);

  it('masks sensitive credentials in MongoDB URI', () => {
    const rawUri = 'mongodb+srv://admin:SuperSecretPassword123@cluster0.mongodb.net/test';
    const masked = maskMongoUri(rawUri);
    expect(masked).toBe('mongodb+srv://admin:****@cluster0.mongodb.net/test');
    expect(masked).not.toContain('SuperSecretPassword123');
  });

  it('dry-run mode calculates projected counts without modifying target MongoDB', async () => {
    const report = await runMigration(
      {
        sourcePath: tempSqlitePath,
        targetUri: mongoServer.getUri(),
        targetDbName: 'migration_test_db',
        dryRun: true,
      },
      mongoDb
    );

    expect(report.success).toBe(true);
    expect(report.options.dryRun).toBe(true);
    expect(report.collections[MONGO_COLLECTIONS.USERS].sourceCount).toBe(2);
    expect(report.collections[MONGO_COLLECTIONS.USERS].imported).toBe(2);
    expect(report.collections[MONGO_COLLECTIONS.USERS].skipped).toBe(0);
    expect(report.collections[MONGO_COLLECTIONS.USERS].conflicted).toBe(0);
    expect(report.collections[MONGO_COLLECTIONS.DEVICES].sourceCount).toBe(2);
    expect(report.collections[MONGO_COLLECTIONS.DRINK_RECORDS].sourceCount).toBe(3);
    expect(report.collections[MONGO_COLLECTIONS.DELETED_WATER_EVENTS].sourceCount).toBe(1);

    // Target MongoDB must still be empty
    const userCount = await mongoDb.collection(MONGO_COLLECTIONS.USERS).countDocuments();
    expect(userCount).toBe(0);
  });

  it('live migration imports collections matching real SQLite schema (without time_synced column)', async () => {
    const report = await runMigration(
      {
        sourcePath: tempSqlitePath,
        targetUri: mongoServer.getUri(),
        targetDbName: 'migration_test_db',
        dryRun: false,
      },
      mongoDb
    );

    expect(report.success).toBe(true);
    expect(report.collections[MONGO_COLLECTIONS.USERS].imported).toBe(2);
    expect(report.collections[MONGO_COLLECTIONS.DEVICES].imported).toBe(2);
    expect(report.collections[MONGO_COLLECTIONS.DRINK_RECORDS].imported).toBe(3);
    expect(report.collections[MONGO_COLLECTIONS.DELETED_WATER_EVENTS].imported).toBe(1);

    // Verify imported users
    const alice = await mongoDb.collection<MongoUserDoc>(MONGO_COLLECTIONS.USERS).findOne({ _id: 'u1' });
    expect(alice).not.toBeNull();
    expect(alice?.username).toBe('alice');
    expect(alice?.email).toBe('alice@test.com');
    expect(alice?.passwordHash).toBe('hash_alice');
    expect(alice?.displayName).toBe('Alice');
    expect(alice?.dailyGoalMl).toBe(2000);

    // Verify imported devices
    const cup = await mongoDb.collection<MongoDeviceDoc>(MONGO_COLLECTIONS.DEVICES).findOne({ _id: 'd1' });
    expect(cup).not.toBeNull();
    expect(cup?.userId).toBe('u1');
    expect(cup?.deviceToken).toBe('dvt_alice_cup');
    expect(cup?.claimCode).toBe('claim_123');

    // Verify imported drink records - timeSynced defaults to true when column missing in SQLite
    const record = await mongoDb.collection<MongoDrinkRecordDoc>(MONGO_COLLECTIONS.DRINK_RECORDS).findOne({ _id: 'r1' });
    expect(record).not.toBeNull();
    expect(record?.eventId).toBe('evt_1');
    expect(record?.amountMl).toBe(250);
    expect(record?.timeSynced).toBe(true);

    // Verify deleted event tombstone
    const tombstone = await mongoDb.collection<MongoDeletedWaterEventDoc>(MONGO_COLLECTIONS.DELETED_WATER_EVENTS).findOne({ _id: 'u1:evt_old_1' });
    expect(tombstone).not.toBeNull();
    expect(tombstone?.eventId).toBe('evt_old_1');

    // Verify automated post-migration verification details
    expect(report.verification).toBeDefined();
    expect(report.verification?.verified).toBe(true);
    expect(report.verification?.usersMatch).toBe(true);
    expect(report.verification?.checksumMatch).toBe(true);
    expect(report.verification?.details.drinkAmountSum.sqlite).toBe(1050);
    expect(report.verification?.details.drinkAmountSum.mongo).toBe(1050);
  });

  it('subsequent migration runs are completely idempotent without duplicating documents', async () => {
    const report2 = await runMigration(
      {
        sourcePath: tempSqlitePath,
        targetUri: mongoServer.getUri(),
        targetDbName: 'migration_test_db',
        dryRun: false,
      },
      mongoDb
    );

    expect(report2.success).toBe(true);
    expect(report2.collections[MONGO_COLLECTIONS.USERS].imported).toBe(0);
    expect(report2.collections[MONGO_COLLECTIONS.USERS].skipped).toBe(2);
    expect(report2.collections[MONGO_COLLECTIONS.USERS].conflicted).toBe(0);

    expect(report2.collections[MONGO_COLLECTIONS.DEVICES].imported).toBe(0);
    expect(report2.collections[MONGO_COLLECTIONS.DEVICES].skipped).toBe(2);

    expect(report2.collections[MONGO_COLLECTIONS.DRINK_RECORDS].imported).toBe(0);
    expect(report2.collections[MONGO_COLLECTIONS.DRINK_RECORDS].skipped).toBe(3);

    expect(report2.collections[MONGO_COLLECTIONS.DELETED_WATER_EVENTS].imported).toBe(0);
    expect(report2.collections[MONGO_COLLECTIONS.DELETED_WATER_EVENTS].skipped).toBe(1);

    // Total documents in MongoDB remain unchanged
    const totalUsers = await mongoDb.collection(MONGO_COLLECTIONS.USERS).countDocuments();
    expect(totalUsers).toBe(2);
    const totalRecords = await mongoDb.collection(MONGO_COLLECTIONS.DRINK_RECORDS).countDocuments();
    expect(totalRecords).toBe(3);
  });

  it('correctly reads time_synced when column is present in SQLite', async () => {
    const customSqlitePath = path.join(os.tmpdir(), `test_with_time_synced_${Date.now()}.db`);
    const sqlite = new DatabaseSync(customSqlitePath);
    sqlite.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL
      );
      INSERT INTO users VALUES ('u_custom', 'custom_user', 'custom@test.com', 'hash');
      CREATE TABLE drink_records (
        id TEXT PRIMARY KEY,
        event_id TEXT,
        user_id TEXT NOT NULL,
        amount_ml INTEGER NOT NULL,
        occurred_at TEXT NOT NULL,
        time_synced INTEGER DEFAULT 0
      );
      INSERT INTO drink_records VALUES ('rec_synced_false', 'e99', 'u_custom', 150, '2026-09-01T12:00:00Z', 0);
    `);
    sqlite.close();

    const customDb = mongoClient.db(`test_ts_${Date.now()}`);
    const report = await runMigration(
      {
        sourcePath: customSqlitePath,
        targetUri: mongoServer.getUri(),
        targetDbName: customDb.databaseName,
        dryRun: false,
      },
      customDb
    );

    expect(report.success).toBe(true);
    const doc = await customDb.collection<MongoDrinkRecordDoc>(MONGO_COLLECTIONS.DRINK_RECORDS).findOne({ _id: 'rec_synced_false' });
    expect(doc?.timeSynced).toBe(false);

    fs.unlinkSync(customSqlitePath);
  });

  it('detects unique collisions and payload conflicts in preflight check (dry-run & live)', async () => {
    const conflictSqlitePath = path.join(os.tmpdir(), `test_conflicts_${Date.now()}.db`);
    const sqlite = new DatabaseSync(conflictSqlitePath);
    sqlite.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL
      );
      CREATE TABLE devices (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        device_token TEXT UNIQUE NOT NULL
      );
      CREATE TABLE drink_records (
        id TEXT PRIMARY KEY,
        event_id TEXT,
        user_id TEXT NOT NULL,
        amount_ml INTEGER NOT NULL,
        occurred_at TEXT NOT NULL
      );

      -- 1. Same _id 'u1' but different username/email payload than existing Mongo doc
      INSERT INTO users VALUES ('u1', 'alice_changed', 'alice_changed@test.com', 'hash_diff');
      -- 2. Different _id 'u99' but same username 'bob' as existing Mongo doc
      INSERT INTO users VALUES ('u99', 'bob', 'new_bob@test.com', 'hash_bob');

      -- 3. Device with conflicting token
      INSERT INTO devices VALUES ('d99', 'u1', 'dvt_alice_cup');

      -- 4. Drink record with conflicting userId + eventId
      INSERT INTO drink_records VALUES ('r99', 'evt_1', 'u1', 400, '2026-09-01T12:00:00Z');
    `);
    sqlite.close();

    // Run dry-run against the existing mongoDb (which already has u1, u2, d1, r1)
    const dryReport = await runMigration(
      {
        sourcePath: conflictSqlitePath,
        targetUri: mongoServer.getUri(),
        targetDbName: 'migration_test_db',
        dryRun: true,
      },
      mongoDb
    );

    expect(dryReport.success).toBe(false);
    expect(dryReport.collections[MONGO_COLLECTIONS.USERS].conflicted).toBe(2);
    expect(dryReport.collections[MONGO_COLLECTIONS.DEVICES].conflicted).toBe(1);
    expect(dryReport.collections[MONGO_COLLECTIONS.DRINK_RECORDS].conflicted).toBe(1);
    expect(dryReport.conflicts.length).toBeGreaterThanOrEqual(4);

    fs.unlinkSync(conflictSqlitePath);
  });

  it('normalizes legacy SQLite datetime format (YYYY-MM-DD HH:mm:ss) into canonical ISO-8601 UTC', async () => {
    const tsSqlitePath = path.join(os.tmpdir(), `test_ts_norm_${Date.now()}.db`);
    const sqlite = new DatabaseSync(tsSqlitePath);
    sqlite.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        display_name TEXT,
        daily_goal_ml INTEGER,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE drink_records (
        id TEXT PRIMARY KEY,
        event_id TEXT,
        user_id TEXT NOT NULL,
        amount_ml INTEGER NOT NULL,
        occurred_at TEXT NOT NULL,
        synced_at TEXT
      );

      -- Insert SQLite standard datetime('now') formatted timestamp without 'T' and 'Z'
      INSERT INTO users VALUES ('u_ts', 'tsuser', 'ts@test.com', 'hash', 'TS User', 2000, '2026-09-10 09:30:00', '2026-09-10 09:30:00');
      INSERT INTO drink_records VALUES ('rec_ts', 'e_ts', 'u_ts', 250, '2026-09-10 09:30:00', '2026-09-10 09:30:00');
    `);
    sqlite.close();

    const tsDb = mongoClient.db(`test_ts_norm_${Date.now()}`);
    const report = await runMigration(
      {
        sourcePath: tsSqlitePath,
        targetUri: mongoServer.getUri(),
        targetDbName: tsDb.databaseName,
        dryRun: false,
      },
      tsDb
    );

    expect(report.success).toBe(true);

    const user = await tsDb.collection<MongoUserDoc>(MONGO_COLLECTIONS.USERS).findOne({ _id: 'u_ts' });
    expect(user).not.toBeNull();
    expect(user?.createdAt).toBe('2026-09-10T09:30:00.000Z');
    expect(user?.updatedAt).toBe('2026-09-10T09:30:00.000Z');

    const record = await tsDb.collection<MongoDrinkRecordDoc>(MONGO_COLLECTIONS.DRINK_RECORDS).findOne({ _id: 'rec_ts' });
    expect(record).not.toBeNull();
    expect(record?.occurredAt).toBe('2026-09-10T09:30:00.000Z');
    expect(record?.syncedAt).toBe('2026-09-10T09:30:00.000Z');

    fs.unlinkSync(tsSqlitePath);
  });

  it('sanitizes logs and conflict reports without leaking deviceToken or sensitive keys', async () => {
    const sanitizeSqlitePath = path.join(os.tmpdir(), `test_sanitize_${Date.now()}.db`);
    const sqlite = new DatabaseSync(sanitizeSqlitePath);
    const secretToken = 'dvt_secret_hardware_key_999999999999';
    sqlite.exec(`
      CREATE TABLE devices (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        device_token TEXT UNIQUE NOT NULL
      );
      INSERT INTO devices VALUES ('d_leak_test', 'u1', '${secretToken}');
    `);
    sqlite.close();

    // The target mongoDb already has 'dvt_alice_cup' for 'd1'. Let's run migration into mongoDb
    // with a token collision or duplicate key
    const targetDb = mongoClient.db(`test_sanitize_${Date.now()}`);
    await targetDb.collection<MongoDeviceDoc>(MONGO_COLLECTIONS.DEVICES).insertOne({
      _id: 'd_existing',
      userId: 'u1',
      deviceToken: secretToken,
      claimCode: null,
      name: 'Existing Device',
      lastSeenAt: null,
      createdAt: new Date().toISOString(),
    });

    const report = await runMigration(
      {
        sourcePath: sanitizeSqlitePath,
        targetUri: mongoServer.getUri(),
        targetDbName: targetDb.databaseName,
        dryRun: false,
      },
      targetDb
    );

    expect(report.success).toBe(false);
    expect(report.collections[MONGO_COLLECTIONS.DEVICES].conflicted).toBe(1);

    // Verify: deviceToken secret value is NEVER leaked into report conflicts or errors
    const conflictsStr = JSON.stringify(report.conflicts);
    const errorsStr = JSON.stringify(report.errors);
    expect(conflictsStr).not.toContain(secretToken);
    expect(conflictsStr).not.toContain('dvt_');
    expect(errorsStr).not.toContain(secretToken);
    expect(errorsStr).not.toContain('dvt_');

    fs.unlinkSync(sanitizeSqlitePath);
  });

  it('flags same _id with differing payload fields as conflicted (full payload equality)', async () => {
    const diffSqlitePath = path.join(os.tmpdir(), `test_diff_payload_${Date.now()}.db`);
    const sqlite = new DatabaseSync(diffSqlitePath);
    sqlite.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        display_name TEXT,
        daily_goal_ml INTEGER
      );
      CREATE TABLE devices (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        device_token TEXT UNIQUE NOT NULL,
        claim_code TEXT,
        name TEXT
      );
      CREATE TABLE drink_records (
        id TEXT PRIMARY KEY,
        event_id TEXT,
        user_id TEXT NOT NULL,
        event_type TEXT,
        amount_ml INTEGER NOT NULL,
        occurred_at TEXT NOT NULL
      );

      -- Same _id 'u1', same username & email, BUT different daily_goal_ml (3500 vs 2000 in mongoDb)
      INSERT INTO users VALUES ('u1', 'alice', 'alice@test.com', 'hash_alice', 'Alice', 3500);

      -- Same _id 'd1', same token & user_id, BUT different claim_code ('different_claim' vs 'claim_123')
      INSERT INTO devices VALUES ('d1', 'u1', 'dvt_alice_cup', 'different_claim', 'Alice Cup');

      -- Same _id 'r1', same user_id, event_id, occurred_at, BUT different event_type ('refill' vs 'drink')
      INSERT INTO drink_records VALUES ('r1', 'evt_1', 'u1', 'refill', 250, '2026-09-01T12:00:00Z');
    `);
    sqlite.close();

    const report = await runMigration(
      {
        sourcePath: diffSqlitePath,
        targetUri: mongoServer.getUri(),
        targetDbName: 'migration_test_db',
        dryRun: true,
      },
      mongoDb
    );

    expect(report.success).toBe(false);
    expect(report.collections[MONGO_COLLECTIONS.USERS].conflicted).toBe(1);
    expect(report.collections[MONGO_COLLECTIONS.USERS].skipped).toBe(0);

    expect(report.collections[MONGO_COLLECTIONS.DEVICES].conflicted).toBe(1);
    expect(report.collections[MONGO_COLLECTIONS.DEVICES].skipped).toBe(0);

    expect(report.collections[MONGO_COLLECTIONS.DRINK_RECORDS].conflicted).toBe(1);
    expect(report.collections[MONGO_COLLECTIONS.DRINK_RECORDS].skipped).toBe(0);

    fs.unlinkSync(diffSqlitePath);
  });

  it('post-migration exact parity verification fails if target database contains extra documents', async () => {
    const parityDb = mongoClient.db(`test_parity_fail_${Date.now()}`);

    // Pre-populate target with an extra user
    await parityDb.collection<MongoUserDoc>(MONGO_COLLECTIONS.USERS).insertOne({
      _id: 'u_extra',
      username: 'extra_user',
      email: 'extra@test.com',
      passwordHash: 'hash',
      displayName: 'Extra',
      dailyGoalMl: 2000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Run migration of tempSqlitePath (which has 2 users: u1, u2)
    const report = await runMigration(
      {
        sourcePath: tempSqlitePath,
        targetUri: mongoServer.getUri(),
        targetDbName: parityDb.databaseName,
        dryRun: false,
      },
      parityDb
    );

    // Because target now has 3 users but SQLite has 2 users, exact verification must fail!
    expect(report.success).toBe(false);
    expect(report.verification).toBeDefined();
    expect(report.verification?.verified).toBe(false);
    expect(report.verification?.usersMatch).toBe(false);
    expect(report.verification?.errors.some((e) => e.includes('User count mismatch'))).toBe(true);
  });

  it('sanitizes index or connection-level errors without leaking credentials or raw key values', () => {
    // 1. Mongo error with sensitive token in message or keyValue
    const mongoErr = new Error('E11000 duplicate key error collection: water_tracker.devices index: idx_devices_token_unique dup key: { deviceToken: "dvt_super_secret_hardware_key_12345" }');
    (mongoErr as any).code = 11000;
    (mongoErr as any).keyPattern = { deviceToken: 1 };

    const sanitized = sanitizeMongoError(mongoErr);
    expect(sanitized).not.toContain('dvt_super_secret_hardware_key_12345');
    expect(sanitized).not.toContain('dvt_');
    expect(sanitized).toBe('duplicate key error on index [deviceToken]');

    // 2. Connection error with embedded URI credentials
    const connErr = new Error('getaddrinfo ENOTFOUND mongodb://user:super_secret_pass@cluster0.abc.mongodb.net/test');
    const sanitizedConn = sanitizeMongoError(connErr);
    expect(sanitizedConn).not.toContain('super_secret_pass');
    expect(sanitizedConn).toContain('****');
  });

  it('propagates parent user conflict to dependent child entities (device, drink record, tombstone) preventing orphan documents', async () => {
    const depSqlitePath = path.join(os.tmpdir(), `test_dep_prop_${Date.now()}.db`);
    const sqlite = new DatabaseSync(depSqlitePath);
    sqlite.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL
      );
      CREATE TABLE devices (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        device_token TEXT UNIQUE NOT NULL
      );
      CREATE TABLE drink_records (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        device_id TEXT,
        amount_ml INTEGER NOT NULL,
        occurred_at TEXT NOT NULL
      );
      CREATE TABLE deleted_water_events (
        user_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        deleted_at TEXT
      );

      -- User 'u_conflict'
      INSERT INTO users VALUES ('u_conflict', 'conflict_user', 'conflict@test.com', 'hash1');
      -- Child device, record, and tombstone depending on 'u_conflict'
      INSERT INTO devices VALUES ('dev_child', 'u_conflict', 'dvt_child_token_unique');
      INSERT INTO drink_records VALUES ('rec_child', 'u_conflict', 'dev_child', 300, '2026-09-10T12:00:00Z');
      INSERT INTO deleted_water_events VALUES ('u_conflict', 'evt_child', '2026-09-10T12:00:00Z');
    `);
    sqlite.close();

    const targetDb = mongoClient.db(`test_dep_prop_${Date.now()}`);
    // Pre-seed target MongoDB with a colliding username for a DIFFERENT _id
    await targetDb.collection<MongoUserDoc>(MONGO_COLLECTIONS.USERS).insertOne({
      _id: 'u_existing_collision',
      username: 'conflict_user',
      email: 'existing_other@test.com',
      passwordHash: 'hash_other',
      displayName: null,
      dailyGoalMl: 2000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Test A: Dry-Run projection must NOT show children as imported!
    const dryReport = await runMigration(
      {
        sourcePath: depSqlitePath,
        targetUri: mongoServer.getUri(),
        targetDbName: targetDb.databaseName,
        dryRun: true,
      },
      targetDb
    );

    expect(dryReport.success).toBe(false);
    expect(dryReport.collections[MONGO_COLLECTIONS.USERS].conflicted).toBe(1);
    expect(dryReport.collections[MONGO_COLLECTIONS.USERS].imported).toBe(0);

    // Dependent device, record, and deleted event must be conflicted, NOT imported!
    expect(dryReport.collections[MONGO_COLLECTIONS.DEVICES].imported).toBe(0);
    expect(dryReport.collections[MONGO_COLLECTIONS.DEVICES].conflicted).toBe(1);

    expect(dryReport.collections[MONGO_COLLECTIONS.DRINK_RECORDS].imported).toBe(0);
    expect(dryReport.collections[MONGO_COLLECTIONS.DRINK_RECORDS].conflicted).toBe(1);

    expect(dryReport.collections[MONGO_COLLECTIONS.DELETED_WATER_EVENTS].imported).toBe(0);
    expect(dryReport.collections[MONGO_COLLECTIONS.DELETED_WATER_EVENTS].conflicted).toBe(1);

    // Test B: Live Run must NOT insert orphan child documents into MongoDB!
    const liveReport = await runMigration(
      {
        sourcePath: depSqlitePath,
        targetUri: mongoServer.getUri(),
        targetDbName: targetDb.databaseName,
        dryRun: false,
      },
      targetDb
    );

    expect(liveReport.success).toBe(false);
    // Verify NO orphan documents exist in MongoDB
    expect(await targetDb.collection<MongoDeviceDoc>(MONGO_COLLECTIONS.DEVICES).findOne({ _id: 'dev_child' })).toBeNull();
    expect(await targetDb.collection<MongoDrinkRecordDoc>(MONGO_COLLECTIONS.DRINK_RECORDS).findOne({ _id: 'rec_child' })).toBeNull();
    expect(await targetDb.collection<MongoDeletedWaterEventDoc>(MONGO_COLLECTIONS.DELETED_WATER_EVENTS).findOne({ _id: 'u_conflict:evt_child' })).toBeNull();

    fs.unlinkSync(depSqlitePath);
  });

  it('flags same _id user as conflicted and verification fails if only updatedAt differs', async () => {
    const userUpdSqlitePath = path.join(os.tmpdir(), `test_user_upd_${Date.now()}.db`);
    const sqlite = new DatabaseSync(userUpdSqlitePath);
    sqlite.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        display_name TEXT,
        daily_goal_ml INTEGER,
        created_at TEXT,
        updated_at TEXT
      );
      -- SQLite record with updatedAt = 2026-09-10 10:00:00
      INSERT INTO users VALUES ('u_upd_diff', 'upd_user', 'upd@test.com', 'hash123', 'Upd User', 2000, '2026-09-10 08:00:00', '2026-09-10 10:00:00');
    `);
    sqlite.close();

    const targetDb = mongoClient.db(`test_user_upd_${Date.now()}`);
    // Pre-populate target with the same user, but updatedAt = 2026-09-10 12:00:00 (diverged!)
    await targetDb.collection<MongoUserDoc>(MONGO_COLLECTIONS.USERS).insertOne({
      _id: 'u_upd_diff',
      username: 'upd_user',
      email: 'upd@test.com',
      passwordHash: 'hash123',
      displayName: 'Upd User',
      dailyGoalMl: 2000,
      createdAt: '2026-09-10T08:00:00.000Z',
      updatedAt: '2026-09-10T12:00:00.000Z',
    });

    const report = await runMigration(
      {
        sourcePath: userUpdSqlitePath,
        targetUri: mongoServer.getUri(),
        targetDbName: targetDb.databaseName,
        dryRun: false,
      },
      targetDb
    );

    // Must be marked conflicted, NOT skipped!
    expect(report.success).toBe(false);
    expect(report.collections[MONGO_COLLECTIONS.USERS].conflicted).toBe(1);
    expect(report.collections[MONGO_COLLECTIONS.USERS].skipped).toBe(0);

    fs.unlinkSync(userUpdSqlitePath);
  });

  it('fails with clear error if source SQLite database does not exist', async () => {
    await expect(
      runMigration({
        sourcePath: '/path/does/not/exist/test.db',
        targetUri: mongoServer.getUri(),
        targetDbName: 'migration_test_db',
        dryRun: true,
      })
    ).rejects.toThrow(/Source SQLite database does not exist/);
  });
});
