import { MongoClient, Db, MongoClientOptions } from 'mongodb';
import { config } from '../config/env';
import { MONGO_COLLECTIONS } from './mongoCollections';

let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;

/**
 * Get or initialize MongoDB client instance.
 * Caches the connection in-memory across warm serverless invocations.
 */
export async function getMongoClient(
  uri?: string,
  options?: MongoClientOptions
): Promise<MongoClient> {
  if (cachedClient) {
    return cachedClient;
  }

  const connectionUri = uri || config.mongodbUri;
  const client = new MongoClient(connectionUri, {
    maxPoolSize: 10,
    minPoolSize: 1,
    serverSelectionTimeoutMS: 5000,
    ...options,
  });

  await client.connect();
  cachedClient = client;
  return cachedClient;
}

/**
 * Get or initialize MongoDB database instance.
 */
export async function getMongoDb(dbName?: string, uri?: string): Promise<Db> {
  if (cachedDb) {
    return cachedDb;
  }

  const client = await getMongoClient(uri);
  const targetDbName = dbName || config.mongodbDbName;
  cachedDb = client.db(targetDbName);
  return cachedDb;
}

/**
 * Closes the active MongoDB connection.
 * Used during graceful shutdown and after integration test runs.
 */
export async function closeMongoConnection(): Promise<void> {
  if (cachedClient) {
    await cachedClient.close();
    cachedClient = null;
    cachedDb = null;
  }
}

/**
 * Idempotently creates required indexes and unique constraints on collections.
 * Safe to execute multiple times upon cold starts or during migration runs.
 */
export async function ensureIndexes(db: Db): Promise<void> {
  const users = db.collection(MONGO_COLLECTIONS.USERS);
  const devices = db.collection(MONGO_COLLECTIONS.DEVICES);
  const drinkRecords = db.collection(MONGO_COLLECTIONS.DRINK_RECORDS);
  const deletedWaterEvents = db.collection(MONGO_COLLECTIONS.DELETED_WATER_EVENTS);

  // 1. Users collection
  // Case-insensitive unique constraint for username
  await users.createIndex(
    { username: 1 },
    {
      unique: true,
      name: 'idx_users_username_unique',
      collation: { locale: 'en', strength: 2 },
    }
  );

  // Case-insensitive unique constraint for email (sparse in case legacy accounts lack email)
  await users.createIndex(
    { email: 1 },
    {
      unique: true,
      sparse: true,
      name: 'idx_users_email_unique',
      collation: { locale: 'en', strength: 2 },
    }
  );

  // 2. Devices collection
  await devices.createIndex(
    { deviceToken: 1 },
    { unique: true, name: 'idx_devices_token_unique' }
  );

  await devices.createIndex(
    { userId: 1 },
    { name: 'idx_devices_user_id' }
  );

  // 3. Drink Records collection
  // Compound unique index for userId + eventId (with partialFilterExpression so null eventId records are not blocked)
  await drinkRecords.createIndex(
    { userId: 1, eventId: 1 },
    {
      unique: true,
      partialFilterExpression: { eventId: { $type: 'string' } },
      name: 'idx_records_user_event_unique',
    }
  );

  await drinkRecords.createIndex(
    { userId: 1, occurredAt: 1 },
    { name: 'idx_records_user_occurred_at' }
  );

  await drinkRecords.createIndex(
    { userId: 1, timeSynced: 1, occurredAt: 1 },
    { name: 'idx_records_user_time_synced' }
  );

  // 4. Deleted Water Events collection
  await deletedWaterEvents.createIndex(
    { userId: 1, eventId: 1 },
    { unique: true, name: 'idx_deleted_events_user_event_unique' }
  );

  await deletedWaterEvents.createIndex(
    { userId: 1 },
    { name: 'idx_deleted_events_user_id' }
  );
}
