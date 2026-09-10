import { MongoClient, Db, MongoClientOptions } from 'mongodb';
import { config } from '../config/env';
import { MONGO_COLLECTIONS } from './mongoCollections';

const clientPromises = new Map<string, Promise<MongoClient>>();
const cachedClients = new Map<string, MongoClient>();
const cachedDbs = new Map<string, Db>();

/**
 * Get or initialize MongoDB client instance.
 * Caches connection Promises keyed by connection URI to prevent cold-start
 * concurrency races while correctly isolating different connection endpoints.
 */
export async function getMongoClient(
  uri?: string,
  options?: MongoClientOptions
): Promise<MongoClient> {
  const connectionUri = uri || config.mongodbUri;

  const existingClient = cachedClients.get(connectionUri);
  if (existingClient) {
    return existingClient;
  }

  const existingPromise = clientPromises.get(connectionUri);
  if (existingPromise) {
    return existingPromise;
  }

  const client = new MongoClient(connectionUri, {
    maxPoolSize: 10,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 5000,
    ...options,
  });

  const promise = (async () => {
    try {
      await client.connect();
      cachedClients.set(connectionUri, client);
      return client;
    } catch (err) {
      clientPromises.delete(connectionUri);
      cachedClients.delete(connectionUri);
      throw err;
    }
  })();

  clientPromises.set(connectionUri, promise);
  return promise;
}

/**
 * Get or initialize MongoDB database instance.
 * Isolates cache by target URI and database name to prevent cross-database leakage.
 */
export async function getMongoDb(dbName?: string, uri?: string): Promise<Db> {
  const targetUri = uri || config.mongodbUri;
  const targetDbName = dbName || config.mongodbDbName;
  const cacheKey = `${targetUri}::${targetDbName}`;

  const existingDb = cachedDbs.get(cacheKey);
  if (existingDb) {
    return existingDb;
  }

  const client = await getMongoClient(targetUri);
  const db = client.db(targetDbName);
  cachedDbs.set(cacheKey, db);
  return db;
}

/**
 * Closes active MongoDB connections.
 * Used during graceful shutdown and after integration test runs.
 */
export async function closeMongoConnection(): Promise<void> {
  const clientsToClose = new Set<MongoClient>();

  for (const client of cachedClients.values()) {
    clientsToClose.add(client);
  }

  for (const promise of clientPromises.values()) {
    try {
      const client = await promise;
      clientsToClose.add(client);
    } catch {
      // Ignore errors if client failed to connect initially
    }
  }

  for (const client of clientsToClose) {
    try {
      await client.close();
    } catch {
      // Ignore close errors
    }
  }

  clientPromises.clear();
  cachedClients.clear();
  cachedDbs.clear();
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
