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
  imported: number;
  inserted: number;
  skipped: number;
  conflicted: number;
  failed: number;
}

export interface VerificationResult {
  verified: boolean;
  usersMatch: boolean;
  devicesMatch: boolean;
  drinkRecordsMatch: boolean;
  deletedEventsMatch: boolean;
  checksumMatch: boolean;
  details: {
    users: { sqlite: number; mongo: number };
    devices: { sqlite: number; mongo: number };
    drinkRecords: { sqlite: number; mongo: number };
    deletedWaterEvents: { sqlite: number; mongo: number };
    drinkAmountSum: { sqlite: number; mongo: number };
  };
  errors: string[];
}

export interface MigrationReport {
  options: {
    sourcePath: string;
    targetDbName: string;
    dryRun: boolean;
  };
  collections: Record<string, CollectionSummary>;
  conflicts: string[];
  errors: string[];
  verification?: VerificationResult;
  durationMs: number;
  success: boolean;
}

function createSummary(): CollectionSummary {
  const summary: CollectionSummary = {
    sourceCount: 0,
    imported: 0,
    inserted: 0,
    skipped: 0,
    conflicted: 0,
    failed: 0,
  };

  Object.defineProperty(summary, 'inserted', {
    get() {
      return this.imported;
    },
    set(val: number) {
      this.imported = val;
    },
    enumerable: true,
    configurable: true,
  });

  return summary;
}

export function maskMongoUri(uri: string): string {
  return uri.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:****@');
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
      [MONGO_COLLECTIONS.USERS]: createSummary(),
      [MONGO_COLLECTIONS.DEVICES]: createSummary(),
      [MONGO_COLLECTIONS.DRINK_RECORDS]: createSummary(),
      [MONGO_COLLECTIONS.DELETED_WATER_EVENTS]: createSummary(),
    },
    conflicts: [],
    errors: [],
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

  // Ensure target collections have the required indexes in live mode
  if (!options.dryRun) {
    await ensureIndexes(mongoDb);
  }

  try {
    // 1. Users
    const usersTableExists = sqliteDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
      .get();

    if (usersTableExists) {
      const userCols = (sqliteDb.prepare("PRAGMA table_info('users')").all() as Array<{ name: string }>).map(
        (c) => c.name
      );
      const hasDisplayName = userCols.includes('display_name');
      const hasDailyGoal = userCols.includes('daily_goal_ml');
      const hasCreatedAt = userCols.includes('created_at');
      const hasUpdatedAt = userCols.includes('updated_at');

      const selectFields = [
        'id',
        'username',
        'email',
        'password_hash',
        hasDisplayName ? 'display_name' : 'NULL as display_name',
        hasDailyGoal ? 'daily_goal_ml' : '2000 as daily_goal_ml',
        hasCreatedAt ? 'created_at' : 'NULL as created_at',
        hasUpdatedAt ? 'updated_at' : 'NULL as updated_at',
      ].join(', ');

      const users = sqliteDb.prepare(`SELECT ${selectFields} FROM users`).all() as any[];

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

        // Preflight conflict check
        const existingById = await userCol.findOne({ _id: doc._id });
        if (existingById) {
          const usernameMatch = existingById.username?.toLowerCase() === doc.username.toLowerCase();
          const emailMatch = existingById.email?.toLowerCase() === doc.email.toLowerCase();

          if (usernameMatch && emailMatch) {
            summary.skipped++;
            continue;
          } else {
            summary.conflicted++;
            report.conflicts.push(
              `User _id "${doc._id}" already exists in MongoDB with differing data (existing username="${existingById.username}", email="${existingById.email}").`
            );
            continue;
          }
        }

        // Check if username or email is already taken by another _id
        const existingByUniqueKey = await userCol.findOne({
          $or: [
            { username: { $regex: new RegExp(`^${escapeRegex(doc.username)}$`, 'i') } },
            { email: { $regex: new RegExp(`^${escapeRegex(doc.email)}$`, 'i') } },
          ],
        });

        if (existingByUniqueKey) {
          summary.conflicted++;
          report.conflicts.push(
            `User _id "${doc._id}" unique key collision: username "${doc.username}" or email "${doc.email}" is already used by existing document _id "${existingByUniqueKey._id}".`
          );
          continue;
        }

        if (options.dryRun) {
          summary.imported++;
        } else {
          try {
            await userCol.insertOne(doc);
            summary.imported++;
          } catch (err: any) {
            if (err.code === 11000) {
              summary.conflicted++;
              report.conflicts.push(`User _id "${doc._id}" unique constraint violation: ${err.message}`);
            } else {
              summary.failed++;
              report.errors.push(`User _id "${doc._id}" insert failed: ${err.message}`);
            }
          }
        }
      }
    }

    // 2. Devices
    const devicesTableExists = sqliteDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='devices'")
      .get();

    if (devicesTableExists) {
      const devCols = (sqliteDb.prepare("PRAGMA table_info('devices')").all() as Array<{ name: string }>).map(
        (c) => c.name
      );
      const hasClaimCode = devCols.includes('claim_code');
      const hasName = devCols.includes('name');
      const hasLastSeenAt = devCols.includes('last_seen_at');
      const hasCreatedAt = devCols.includes('created_at');

      const selectFields = [
        'id',
        'user_id',
        'device_token',
        hasClaimCode ? 'claim_code' : 'NULL as claim_code',
        hasName ? 'name' : 'NULL as name',
        hasLastSeenAt ? 'last_seen_at' : 'NULL as last_seen_at',
        hasCreatedAt ? 'created_at' : 'NULL as created_at',
      ].join(', ');

      const devices = sqliteDb.prepare(`SELECT ${selectFields} FROM devices`).all() as any[];

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

        // Preflight conflict check
        const existingById = await devCol.findOne({ _id: doc._id });
        if (existingById) {
          if (existingById.deviceToken === doc.deviceToken && existingById.userId === doc.userId) {
            summary.skipped++;
            continue;
          } else {
            summary.conflicted++;
            report.conflicts.push(
              `Device _id "${doc._id}" already exists in MongoDB with differing data (existing token="${existingById.deviceToken}", userId="${existingById.userId}").`
            );
            continue;
          }
        }

        // Check if deviceToken is already taken by another _id
        const existingByToken = await devCol.findOne({ deviceToken: doc.deviceToken });
        if (existingByToken) {
          summary.conflicted++;
          report.conflicts.push(
            `Device _id "${doc._id}" unique key collision: deviceToken "${doc.deviceToken}" is already used by existing document _id "${existingByToken._id}".`
          );
          continue;
        }

        if (options.dryRun) {
          summary.imported++;
        } else {
          try {
            await devCol.insertOne(doc);
            summary.imported++;
          } catch (err: any) {
            if (err.code === 11000) {
              summary.conflicted++;
              report.conflicts.push(`Device _id "${doc._id}" unique constraint violation: ${err.message}`);
            } else {
              summary.failed++;
              report.errors.push(`Device _id "${doc._id}" insert failed: ${err.message}`);
            }
          }
        }
      }
    }

    // 3. Drink Records
    const recordsTableExists = sqliteDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='drink_records'")
      .get();

    if (recordsTableExists) {
      const recCols = (sqliteDb.prepare("PRAGMA table_info('drink_records')").all() as Array<{ name: string }>).map(
        (c) => c.name
      );
      const hasEventId = recCols.includes('event_id');
      const hasDeviceId = recCols.includes('device_id');
      const hasEventType = recCols.includes('event_type');
      const hasRemainingMl = recCols.includes('remaining_ml');
      const hasTimeSynced = recCols.includes('time_synced');
      const hasSyncedAt = recCols.includes('synced_at');

      const selectFields = [
        'id',
        hasEventId ? 'event_id' : 'NULL as event_id',
        'user_id',
        hasDeviceId ? 'device_id' : 'NULL as device_id',
        hasEventType ? 'event_type' : "'drink' as event_type",
        'amount_ml',
        hasRemainingMl ? 'remaining_ml' : 'NULL as remaining_ml',
        'occurred_at',
        hasTimeSynced ? 'time_synced' : 'NULL as time_synced',
        hasSyncedAt ? 'synced_at' : 'NULL as synced_at',
      ].join(', ');

      const records = sqliteDb.prepare(`SELECT ${selectFields} FROM drink_records`).all() as any[];

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
          // If time_synced exists in SQLite, respect it; otherwise default to true per Mongo schema mapping
          timeSynced: hasTimeSynced && row.time_synced !== null && row.time_synced !== undefined ? Boolean(row.time_synced) : true,
          syncedAt: row.synced_at || new Date().toISOString(),
        };

        // Preflight conflict check
        const existingById = await recCol.findOne({ _id: doc._id });
        if (existingById) {
          const isSame =
            existingById.userId === doc.userId &&
            existingById.eventId === doc.eventId &&
            existingById.amountMl === doc.amountMl &&
            existingById.occurredAt === doc.occurredAt;

          if (isSame) {
            summary.skipped++;
            continue;
          } else {
            summary.conflicted++;
            report.conflicts.push(
              `Drink record _id "${doc._id}" already exists in MongoDB with differing data.`
            );
            continue;
          }
        }

        // Check compound uniqueness for userId + eventId (when eventId is present)
        if (doc.eventId) {
          const existingByEvent = await recCol.findOne({ userId: doc.userId, eventId: doc.eventId });
          if (existingByEvent) {
            summary.conflicted++;
            report.conflicts.push(
              `Drink record _id "${doc._id}" unique key collision: { userId: "${doc.userId}", eventId: "${doc.eventId}" } is already used by existing document _id "${existingByEvent._id}".`
            );
            continue;
          }
        }

        if (options.dryRun) {
          summary.imported++;
        } else {
          try {
            await recCol.insertOne(doc);
            summary.imported++;
          } catch (err: any) {
            if (err.code === 11000) {
              summary.conflicted++;
              report.conflicts.push(`Drink record _id "${doc._id}" unique constraint violation: ${err.message}`);
            } else {
              summary.failed++;
              report.errors.push(`Drink record _id "${doc._id}" insert failed: ${err.message}`);
            }
          }
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

        const existingById = await delCol.findOne({ _id: doc._id });
        if (existingById) {
          if (existingById.userId === doc.userId && existingById.eventId === doc.eventId) {
            summary.skipped++;
            continue;
          } else {
            summary.conflicted++;
            report.conflicts.push(
              `Deleted water event _id "${doc._id}" already exists with differing data.`
            );
            continue;
          }
        }

        const existingByEvent = await delCol.findOne({ userId: doc.userId, eventId: doc.eventId });
        if (existingByEvent) {
          summary.conflicted++;
          report.conflicts.push(
            `Deleted water event unique key collision: { userId: "${doc.userId}", eventId: "${doc.eventId}" } already exists.`
          );
          continue;
        }

        if (options.dryRun) {
          summary.imported++;
        } else {
          try {
            await delCol.insertOne(doc);
            summary.imported++;
          } catch (err: any) {
            if (err.code === 11000) {
              summary.conflicted++;
              report.conflicts.push(`Deleted water event _id "${doc._id}" unique collision: ${err.message}`);
            } else {
              summary.failed++;
              report.errors.push(`Deleted water event _id "${doc._id}" insert failed: ${err.message}`);
            }
          }
        }
      }
    }

    // 5. Automated Post-Migration Verification (Live mode only)
    if (!options.dryRun) {
      const verification: VerificationResult = {
        verified: false,
        usersMatch: false,
        devicesMatch: false,
        drinkRecordsMatch: false,
        deletedEventsMatch: false,
        checksumMatch: false,
        details: {
          users: { sqlite: 0, mongo: 0 },
          devices: { sqlite: 0, mongo: 0 },
          drinkRecords: { sqlite: 0, mongo: 0 },
          deletedWaterEvents: { sqlite: 0, mongo: 0 },
          drinkAmountSum: { sqlite: 0, mongo: 0 },
        },
        errors: [],
      };

      // Users verification
      const mongoUsersCount = await mongoDb.collection(MONGO_COLLECTIONS.USERS).countDocuments();
      const sqliteUsersCount = report.collections[MONGO_COLLECTIONS.USERS].sourceCount;
      verification.details.users = { sqlite: sqliteUsersCount, mongo: mongoUsersCount };
      verification.usersMatch = mongoUsersCount >= sqliteUsersCount;
      if (!verification.usersMatch) {
        verification.errors.push(`User count mismatch: SQLite has ${sqliteUsersCount}, but MongoDB has ${mongoUsersCount}`);
      }

      // Devices verification
      const mongoDevicesCount = await mongoDb.collection(MONGO_COLLECTIONS.DEVICES).countDocuments();
      const sqliteDevicesCount = report.collections[MONGO_COLLECTIONS.DEVICES].sourceCount;
      verification.details.devices = { sqlite: sqliteDevicesCount, mongo: mongoDevicesCount };
      verification.devicesMatch = mongoDevicesCount >= sqliteDevicesCount;
      if (!verification.devicesMatch) {
        verification.errors.push(`Device count mismatch: SQLite has ${sqliteDevicesCount}, but MongoDB has ${mongoDevicesCount}`);
      }

      // Drink records count verification
      const mongoRecordsCount = await mongoDb.collection(MONGO_COLLECTIONS.DRINK_RECORDS).countDocuments();
      const sqliteRecordsCount = report.collections[MONGO_COLLECTIONS.DRINK_RECORDS].sourceCount;
      verification.details.drinkRecords = { sqlite: sqliteRecordsCount, mongo: mongoRecordsCount };
      verification.drinkRecordsMatch = mongoRecordsCount >= sqliteRecordsCount;
      if (!verification.drinkRecordsMatch) {
        verification.errors.push(`Drink records count mismatch: SQLite has ${sqliteRecordsCount}, but MongoDB has ${mongoRecordsCount}`);
      }

      // Drink records volume checksum (amount_ml)
      const sqliteSumRow = recordsTableExists
        ? (sqliteDb.prepare('SELECT COALESCE(SUM(amount_ml), 0) AS total FROM drink_records').get() as { total: number })
        : { total: 0 };
      const sqliteTotalMl = Number(sqliteSumRow?.total ?? 0);

      const mongoSumAgg = await mongoDb.collection(MONGO_COLLECTIONS.DRINK_RECORDS).aggregate([
        { $group: { _id: null, total: { $sum: '$amountMl' } } },
      ]).toArray();
      const mongoTotalMl = mongoSumAgg[0]?.total ?? 0;

      verification.details.drinkAmountSum = { sqlite: sqliteTotalMl, mongo: mongoTotalMl };
      verification.checksumMatch = mongoTotalMl >= sqliteTotalMl;
      if (!verification.checksumMatch) {
        verification.errors.push(`Drink volume checksum mismatch: SQLite total is ${sqliteTotalMl}ml, but MongoDB total is ${mongoTotalMl}ml`);
      }

      // Deleted water events verification
      const mongoDeletedCount = await mongoDb.collection(MONGO_COLLECTIONS.DELETED_WATER_EVENTS).countDocuments();
      const sqliteDeletedCount = report.collections[MONGO_COLLECTIONS.DELETED_WATER_EVENTS].sourceCount;
      verification.details.deletedWaterEvents = { sqlite: sqliteDeletedCount, mongo: mongoDeletedCount };
      verification.deletedEventsMatch = mongoDeletedCount >= sqliteDeletedCount;
      if (!verification.deletedEventsMatch) {
        verification.errors.push(`Deleted events count mismatch: SQLite has ${sqliteDeletedCount}, but MongoDB has ${mongoDeletedCount}`);
      }

      verification.verified =
        verification.usersMatch &&
        verification.devicesMatch &&
        verification.drinkRecordsMatch &&
        verification.deletedEventsMatch &&
        verification.checksumMatch &&
        verification.errors.length === 0;

      report.verification = verification;
    }

    const totalConflicts = Object.values(report.collections).reduce((sum, c) => sum + c.conflicted, 0);
    const totalFailed = Object.values(report.collections).reduce((sum, c) => sum + c.failed, 0);

    if (totalConflicts > 0 || totalFailed > 0 || report.errors.length > 0) {
      report.success = false;
    } else if (options.dryRun) {
      report.success = true;
    } else {
      report.success = report.verification?.verified ?? false;
    }
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
  console.log(`🚦 Status: ${report.success ? '✅ SUCCESS' : '❌ FAILED'}`);
  console.log('-----------------------------------------------------');
  console.log('Collection             | Source | Imported | Skipped | Conflicted | Failed');
  console.log('-----------------------+--------+----------+---------+------------+-------');
  for (const [name, summary] of Object.entries(report.collections)) {
    const colName = name.padEnd(22, ' ');
    const src = String(summary.sourceCount).padStart(6, ' ');
    const imp = String(summary.imported).padStart(8, ' ');
    const skp = String(summary.skipped).padStart(7, ' ');
    const cnf = String(summary.conflicted).padStart(10, ' ');
    const fld = String(summary.failed).padStart(6, ' ');
    console.log(`${colName} | ${src} | ${imp} | ${skp} | ${cnf} | ${fld}`);
  }
  console.log('-----------------------------------------------------');

  if (report.verification) {
    const v = report.verification;
    console.log(`🔍 Automated Post-Migration Verification: ${v.verified ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`   - Users: SQLite=${v.details.users.sqlite}, Mongo=${v.details.users.mongo}`);
    console.log(`   - Devices: SQLite=${v.details.devices.sqlite}, Mongo=${v.details.devices.mongo}`);
    console.log(`   - Drink Records: SQLite=${v.details.drinkRecords.sqlite}, Mongo=${v.details.drinkRecords.mongo}`);
    console.log(`   - Total Drink Amount: SQLite=${v.details.drinkAmountSum.sqlite}ml, Mongo=${v.details.drinkAmountSum.mongo}ml`);
    console.log(`   - Deleted Events: SQLite=${v.details.deletedWaterEvents.sqlite}, Mongo=${v.details.deletedWaterEvents.mongo}`);
    if (v.errors.length > 0) {
      console.log('   Verification Errors:');
      for (const err of v.errors) {
        console.log(`     * ${err}`);
      }
    }
    console.log('-----------------------------------------------------');
  }

  if (report.conflicts.length > 0) {
    console.log(`⚠️ Detected Conflicts (${report.conflicts.length}):`);
    for (const conflict of report.conflicts) {
      console.log(`   * ${conflict}`);
    }
    console.log('-----------------------------------------------------');
  }

  if (report.errors.length > 0) {
    console.log(`❌ Execution Errors (${report.errors.length}):`);
    for (const error of report.errors) {
      console.log(`   * ${error}`);
    }
    console.log('-----------------------------------------------------');
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
    process.exit(report.success ? 0 : 1);
  } catch (err) {
    console.error('[Migration Error]', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
