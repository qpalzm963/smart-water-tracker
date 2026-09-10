import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Db, MongoClient } from 'mongodb';
import { runMigration, maskMongoUri } from '../src/scripts/migrateSqliteToMongo';
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
        event_type TEXT NOT NULL,
        amount_ml INTEGER NOT NULL,
        remaining_ml INTEGER,
        occurred_at TEXT NOT NULL,
        time_synced INTEGER DEFAULT 1,
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

      INSERT INTO drink_records VALUES ('r1', 'evt_1', 'u1', 'd1', 'drink', 250, 450, '2026-09-01T12:00:00Z', 1, '2026-09-01T12:01:00Z');
      INSERT INTO drink_records VALUES ('r2', 'evt_2', 'u1', 'd1', 'refill', 500, 700, '2026-09-01T13:00:00Z', 1, '2026-09-01T13:01:00Z');
      INSERT INTO drink_records VALUES ('r3', NULL, 'u2', NULL, 'drink', 300, NULL, '2026-09-01T14:00:00Z', 0, '2026-09-01T14:01:00Z');

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
    expect(report.collections[MONGO_COLLECTIONS.USERS].inserted).toBe(2);
    expect(report.collections[MONGO_COLLECTIONS.DEVICES].sourceCount).toBe(2);
    expect(report.collections[MONGO_COLLECTIONS.DRINK_RECORDS].sourceCount).toBe(3);
    expect(report.collections[MONGO_COLLECTIONS.DELETED_WATER_EVENTS].sourceCount).toBe(1);

    // Verify target MongoDB is still empty
    const userCount = await mongoDb.collection(MONGO_COLLECTIONS.USERS).countDocuments();
    expect(userCount).toBe(0);
  });

  it('live migration successfully imports all collections with preserved IDs and fields', async () => {
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
    expect(report.collections[MONGO_COLLECTIONS.USERS].inserted).toBe(2);
    expect(report.collections[MONGO_COLLECTIONS.DEVICES].inserted).toBe(2);
    expect(report.collections[MONGO_COLLECTIONS.DRINK_RECORDS].inserted).toBe(3);
    expect(report.collections[MONGO_COLLECTIONS.DELETED_WATER_EVENTS].inserted).toBe(1);

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

    // Verify imported drink records
    const record = await mongoDb.collection<MongoDrinkRecordDoc>(MONGO_COLLECTIONS.DRINK_RECORDS).findOne({ _id: 'r1' });
    expect(record).not.toBeNull();
    expect(record?.eventId).toBe('evt_1');
    expect(record?.amountMl).toBe(250);
    expect(record?.timeSynced).toBe(true);

    // Verify deleted event
    const tombstone = await mongoDb.collection<MongoDeletedWaterEventDoc>(MONGO_COLLECTIONS.DELETED_WATER_EVENTS).findOne({ _id: 'u1:evt_old_1' });
    expect(tombstone).not.toBeNull();
    expect(tombstone?.eventId).toBe('evt_old_1');
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
    // All rows should now be skipped, none newly inserted
    expect(report2.collections[MONGO_COLLECTIONS.USERS].inserted).toBe(0);
    expect(report2.collections[MONGO_COLLECTIONS.USERS].skipped).toBe(2);

    expect(report2.collections[MONGO_COLLECTIONS.DEVICES].inserted).toBe(0);
    expect(report2.collections[MONGO_COLLECTIONS.DEVICES].skipped).toBe(2);

    expect(report2.collections[MONGO_COLLECTIONS.DRINK_RECORDS].inserted).toBe(0);
    expect(report2.collections[MONGO_COLLECTIONS.DRINK_RECORDS].skipped).toBe(3);

    expect(report2.collections[MONGO_COLLECTIONS.DELETED_WATER_EVENTS].inserted).toBe(0);
    expect(report2.collections[MONGO_COLLECTIONS.DELETED_WATER_EVENTS].skipped).toBe(1);

    // Total documents should remain identical
    const totalUsers = await mongoDb.collection(MONGO_COLLECTIONS.USERS).countDocuments();
    expect(totalUsers).toBe(2);
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
