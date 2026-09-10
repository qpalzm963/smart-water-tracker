import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { Db, MongoClient } from 'mongodb';
import { config } from '../config/env';
import { ensureIndexes, getMongoClient } from '../database/mongo';
import {
  MONGO_COLLECTIONS,
  MongoUserDoc,
  MongoDeviceDoc,
  MongoDrinkRecordDoc,
  MongoDeletedWaterEventDoc,
} from '../database/mongoCollections';

export interface MigrationOptions {
  sourcePath: string;
  targetUri: string;
  targetDbName: string;
  dryRun: boolean;
}

export interface CollectionSummary {
  sourceCount: number;
  inserted: number;
  skipped: number;
  failed: number;
}

export interface MigrationReport {
  options: {
    sourcePath: string;
    targetDbName: string;
    dryRun: boolean;
  };
  collections: Record<string, CollectionSummary>;
  durationMs: number;
  success: boolean;
}

export function maskMongoUri(uri: string): string {
  return uri.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:****@');
}

export function parseArgs(args: string[]): MigrationOptions {
  let sourcePath = config.databasePath;
  let targetUri = config.mongodbUri;
  let targetDbName = config.mongodbDbName;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--source' && args[i + 1]) {
      sourcePath = args[++i];
    } else if (arg === '--target-uri' && args[i + 1]) {
      targetUri = args[++i];
    } else if (arg === '--target-db' && args[i + 1]) {
      targetDbName = args[++i];
    } else if (arg === '--dry-run') {
      dryRun = true;
    }
  }

  return {
    sourcePath: path.resolve(sourcePath),
    targetUri,
    targetDbName,
    dryRun,
  };
}

export async function runMigration(options: MigrationOptions, customDb?: Db): Promise<MigrationReport> {
  const startTime = Date.now();
  const report: MigrationReport = {
    options: {
      sourcePath: options.sourcePath,
      targetDbName: options.targetDbName,
      dryRun: options.dryRun,
    },
    collections: {
      [MONGO_COLLECTIONS.USERS]: { sourceCount: 0, inserted: 0, skipped: 0, failed: 0 },
      [MONGO_COLLECTIONS.DEVICES]: { sourceCount: 0, inserted: 0, skipped: 0, failed: 0 },
      [MONGO_COLLECTIONS.DRINK_RECORDS]: { sourceCount: 0, inserted: 0, skipped: 0, failed: 0 },
      [MONGO_COLLECTIONS.DELETED_WATER_EVENTS]: { sourceCount: 0, inserted: 0, skipped: 0, failed: 0 },
    },
    durationMs: 0,
    success: false,
  };

  if (!fs.existsSync(options.sourcePath)) {
    throw new Error(`Source SQLite database does not exist: ${options.sourcePath}`);
  }

  const sqliteDb = new DatabaseSync(options.sourcePath, { readOnly: true });

  let mongoClient: MongoClient | null = null;
  let mongoDb: Db;

  if (customDb) {
    mongoDb = customDb;
  } else {
    mongoClient = await getMongoClient(options.targetUri);
    mongoDb = mongoClient.db(options.targetDbName);
  }

  // Ensure target collections have the required indexes
  if (!options.dryRun) {
    await ensureIndexes(mongoDb);
  }

  try {
    // 1. Users
    const usersTableExists = sqliteDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
      .get();

    if (usersTableExists) {
      const users = sqliteDb
        .prepare('SELECT id, username, email, password_hash, display_name, daily_goal_ml, created_at, updated_at FROM users')
        .all() as any[];

      const summary = report.collections[MONGO_COLLECTIONS.USERS];
      summary.sourceCount = users.length;
      const userCol = mongoDb.collection<MongoUserDoc>(MONGO_COLLECTIONS.USERS);

      for (const row of users) {
        const doc: MongoUserDoc = {
          _id: row.id,
          username: row.username,
          email: row.email,
          passwordHash: row.password_hash,
          displayName: row.display_name ?? null,
          dailyGoalMl: row.daily_goal_ml ?? 2000,
          createdAt: row.created_at || new Date().toISOString(),
          updatedAt: row.updated_at || new Date().toISOString(),
        };

        if (options.dryRun) {
          const exists = await userCol.findOne({ _id: doc._id });
          if (exists) summary.skipped++;
          else summary.inserted++;
        } else {
          const res = await userCol.updateOne(
            { _id: doc._id },
            { $setOnInsert: doc },
            { upsert: true }
          );
          if (res.upsertedCount > 0) summary.inserted++;
          else summary.skipped++;
        }
      }
    }

    // 2. Devices
    const devicesTableExists = sqliteDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='devices'")
      .get();

    if (devicesTableExists) {
      const devices = sqliteDb
        .prepare('SELECT id, user_id, device_token, claim_code, name, last_seen_at, created_at FROM devices')
        .all() as any[];

      const summary = report.collections[MONGO_COLLECTIONS.DEVICES];
      summary.sourceCount = devices.length;
      const devCol = mongoDb.collection<MongoDeviceDoc>(MONGO_COLLECTIONS.DEVICES);

      for (const row of devices) {
        const doc: MongoDeviceDoc = {
          _id: row.id,
          userId: row.user_id,
          deviceToken: row.device_token,
          claimCode: row.claim_code ?? null,
          name: row.name ?? null,
          lastSeenAt: row.last_seen_at ?? null,
          createdAt: row.created_at || new Date().toISOString(),
        };

        if (options.dryRun) {
          const exists = await devCol.findOne({ _id: doc._id });
          if (exists) summary.skipped++;
          else summary.inserted++;
        } else {
          const res = await devCol.updateOne(
            { _id: doc._id },
            { $setOnInsert: doc },
            { upsert: true }
          );
          if (res.upsertedCount > 0) summary.inserted++;
          else summary.skipped++;
        }
      }
    }

    // 3. Drink Records
    const recordsTableExists = sqliteDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='drink_records'")
      .get();

    if (recordsTableExists) {
      const records = sqliteDb
        .prepare('SELECT id, event_id, user_id, device_id, event_type, amount_ml, remaining_ml, occurred_at, time_synced, synced_at FROM drink_records')
        .all() as any[];

      const summary = report.collections[MONGO_COLLECTIONS.DRINK_RECORDS];
      summary.sourceCount = records.length;
      const recCol = mongoDb.collection<MongoDrinkRecordDoc>(MONGO_COLLECTIONS.DRINK_RECORDS);

      for (const row of records) {
        const doc: MongoDrinkRecordDoc = {
          _id: row.id,
          eventId: row.event_id ?? null,
          userId: row.user_id,
          deviceId: row.device_id ?? null,
          eventType: row.event_type || 'drink',
          amountMl: row.amount_ml,
          remainingMl: row.remaining_ml ?? null,
          occurredAt: row.occurred_at,
          timeSynced: Boolean(row.time_synced ?? 1),
          syncedAt: row.synced_at || new Date().toISOString(),
        };

        if (options.dryRun) {
          const exists = await recCol.findOne({ _id: doc._id });
          if (exists) summary.skipped++;
          else summary.inserted++;
        } else {
          const res = await recCol.updateOne(
            { _id: doc._id },
            { $setOnInsert: doc },
            { upsert: true }
          );
          if (res.upsertedCount > 0) summary.inserted++;
          else summary.skipped++;
        }
      }
    }

    // 4. Deleted Water Events
    const deletedTableExists = sqliteDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='deleted_water_events'")
      .get();

    if (deletedTableExists) {
      const deletedEvents = sqliteDb
        .prepare('SELECT user_id, event_id, deleted_at FROM deleted_water_events')
        .all() as any[];

      const summary = report.collections[MONGO_COLLECTIONS.DELETED_WATER_EVENTS];
      summary.sourceCount = deletedEvents.length;
      const delCol = mongoDb.collection<MongoDeletedWaterEventDoc>(MONGO_COLLECTIONS.DELETED_WATER_EVENTS);

      for (const row of deletedEvents) {
        const id = `${row.user_id}:${row.event_id}`;
        const doc: MongoDeletedWaterEventDoc = {
          _id: id,
          userId: row.user_id,
          eventId: row.event_id,
          deletedAt: row.deleted_at || new Date().toISOString(),
        };

        if (options.dryRun) {
          const exists = await delCol.findOne({ _id: doc._id });
          if (exists) summary.skipped++;
          else summary.inserted++;
        } else {
          const res = await delCol.updateOne(
            { _id: doc._id },
            { $setOnInsert: doc },
            { upsert: true }
          );
          if (res.upsertedCount > 0) summary.inserted++;
          else summary.skipped++;
        }
      }
    }

    report.success = true;
  } finally {
    sqliteDb.close();
  }

  report.durationMs = Date.now() - startTime;
  return report;
}

export function printReport(report: MigrationReport): void {
  console.log('=====================================================');
  console.log(`📦 SQLite to MongoDB Migration Summary ${report.options.dryRun ? '[DRY RUN]' : '[COMPLETED]'}`);
  console.log(`📁 Source: ${report.options.sourcePath}`);
  console.log(`🎯 Target DB: ${report.options.targetDbName}`);
  console.log(`⏱️ Duration: ${report.durationMs}ms`);
  console.log('-----------------------------------------------------');
  console.log('Collection             | Source | Inserted | Skipped | Failed');
  console.log('-----------------------+--------+----------+---------+-------');
  for (const [name, summary] of Object.entries(report.collections)) {
    const colName = name.padEnd(22, ' ');
    const src = String(summary.sourceCount).padStart(6, ' ');
    const ins = String(summary.inserted).padStart(8, ' ');
    const skp = String(summary.skipped).padStart(7, ' ');
    const fld = String(summary.failed).padStart(6, ' ');
    console.log(`${colName} | ${src} | ${ins} | ${skp} | ${fld}`);
  }
  console.log('=====================================================');
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  console.log(`🚀 Starting migration tool (dryRun=${options.dryRun})...`);
  console.log(`Target: ${maskMongoUri(options.targetUri)}`);

  try {
    const report = await runMigration(options);
    printReport(report);
    process.exit(0);
  } catch (err) {
    console.error('[Migration Error]', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
