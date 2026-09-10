import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  getMongoClient,
  getMongoDb,
  closeMongoConnection,
  ensureIndexes,
} from '../src/database/mongo';
import {
  MONGO_COLLECTIONS,
  MongoUserDoc,
  MongoDeviceDoc,
  MongoDrinkRecordDoc,
  MongoDeletedWaterEventDoc,
} from '../src/database/mongoCollections';

jest.setTimeout(60000);

describe('MongoDB Connection Layer and Index Management (#12)', () => {
  let mongoServer: MongoMemoryServer;
  let uri: string;
  const dbName = 'test_water_tracker';

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    uri = mongoServer.getUri();
  }, 60000);

  afterAll(async () => {
    await closeMongoConnection();
    if (mongoServer) {
      await mongoServer.stop();
    }
  }, 30000);

  afterEach(async () => {
    await closeMongoConnection();
  });

  it('connects to standard MongoDB URI and reuses warm connection', async () => {
    const client1 = await getMongoClient(uri);
    const client2 = await getMongoClient(uri);
    expect(client1).toBe(client2);

    const db1 = await getMongoDb(dbName, uri);
    const db2 = await getMongoDb(dbName, uri);
    expect(db1).toBe(db2);
    expect(db1.databaseName).toBe(dbName);
  });

  it('safely handles concurrent cold-start requests without creating duplicate clients', async () => {
    // Ensure connection is fully closed first
    await closeMongoConnection();

    // Trigger concurrent callers simultaneously while cold
    const [clientA, clientB] = await Promise.all([
      getMongoClient(uri),
      getMongoClient(uri),
    ]);

    expect(clientA).toBe(clientB);
  });

  it('idempotently creates indexes without error on repeated execution', async () => {
    const db = await getMongoDb(dbName, uri);
    await expect(ensureIndexes(db)).resolves.not.toThrow();
    // Second execution should succeed identically
    await expect(ensureIndexes(db)).resolves.not.toThrow();

    const userIndexes = await db.collection(MONGO_COLLECTIONS.USERS).indexes();
    const indexNames = userIndexes.map((i) => i.name);
    expect(indexNames).toContain('idx_users_username_unique');
    expect(indexNames).toContain('idx_users_email_unique');
  });

  it('enforces case-insensitive uniqueness on users.username', async () => {
    const db = await getMongoDb(dbName, uri);
    await ensureIndexes(db);
    const users = db.collection<MongoUserDoc>(MONGO_COLLECTIONS.USERS);

    const user1: MongoUserDoc = {
      _id: 'user_1',
      username: 'WaterChampion',
      email: 'champ@example.com',
      passwordHash: 'hashed123',
      displayName: 'Champion',
      dailyGoalMl: 2000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await users.insertOne(user1);

    // Same username in lowercase should be rejected by the case-insensitive collation index
    const userDuplicate: MongoUserDoc = {
      _id: 'user_2',
      username: 'waterchampion',
      email: 'champ2@example.com',
      passwordHash: 'hashed456',
      displayName: 'Another',
      dailyGoalMl: 2000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await expect(users.insertOne(userDuplicate)).rejects.toThrow(/duplicate key error/);
  });

  it('enforces uniqueness on devices.deviceToken', async () => {
    const db = await getMongoDb(dbName, uri);
    await ensureIndexes(db);
    const devices = db.collection<MongoDeviceDoc>(MONGO_COLLECTIONS.DEVICES);

    const device1: MongoDeviceDoc = {
      _id: 'dev_1',
      userId: 'user_1',
      deviceToken: 'dvt_unique_token_12345',
      claimCode: null,
      name: 'Cup 1',
      lastSeenAt: null,
      createdAt: new Date().toISOString(),
    };
    await devices.insertOne(device1);

    const device2: MongoDeviceDoc = {
      _id: 'dev_2',
      userId: 'user_2',
      deviceToken: 'dvt_unique_token_12345',
      claimCode: null,
      name: 'Cup 2',
      lastSeenAt: null,
      createdAt: new Date().toISOString(),
    };
    await expect(devices.insertOne(device2)).rejects.toThrow(/duplicate key error/);
  });

  it('enforces composite uniqueness on drink_records { userId, eventId } while allowing multiple null eventIds', async () => {
    const db = await getMongoDb(dbName, uri);
    await ensureIndexes(db);
    const records = db.collection<MongoDrinkRecordDoc>(MONGO_COLLECTIONS.DRINK_RECORDS);

    // Duplicate eventId for same user must fail
    await records.insertOne({
      _id: 'rec_1',
      eventId: 'evt_100',
      userId: 'user_1',
      deviceId: 'dev_1',
      eventType: 'drink',
      amountMl: 250,
      remainingMl: 500,
      occurredAt: new Date().toISOString(),
      timeSynced: true,
      syncedAt: new Date().toISOString(),
    });

    await expect(
      records.insertOne({
        _id: 'rec_2',
        eventId: 'evt_100',
        userId: 'user_1',
        deviceId: 'dev_1',
        eventType: 'drink',
        amountMl: 250,
        remainingMl: 500,
        occurredAt: new Date().toISOString(),
        timeSynced: true,
        syncedAt: new Date().toISOString(),
      })
    ).rejects.toThrow(/duplicate key error/);

    // Another user can use the same eventId (multi-tenant isolation)
    await expect(
      records.insertOne({
        _id: 'rec_3',
        eventId: 'evt_100',
        userId: 'user_2',
        deviceId: 'dev_2',
        eventType: 'drink',
        amountMl: 300,
        remainingMl: 400,
        occurredAt: new Date().toISOString(),
        timeSynced: true,
        syncedAt: new Date().toISOString(),
      })
    ).resolves.not.toThrow();

    // Multiple records with null eventId for same user must be permitted
    await expect(
      records.insertOne({
        _id: 'rec_4',
        eventId: null,
        userId: 'user_1',
        deviceId: null,
        eventType: 'drink',
        amountMl: 200,
        remainingMl: null,
        occurredAt: new Date().toISOString(),
        timeSynced: false,
        syncedAt: new Date().toISOString(),
      })
    ).resolves.not.toThrow();

    await expect(
      records.insertOne({
        _id: 'rec_5',
        eventId: null,
        userId: 'user_1',
        deviceId: null,
        eventType: 'drink',
        amountMl: 150,
        remainingMl: null,
        occurredAt: new Date().toISOString(),
        timeSynced: false,
        syncedAt: new Date().toISOString(),
      })
    ).resolves.not.toThrow();
  });

  it('enforces composite uniqueness on deleted_water_events { userId, eventId }', async () => {
    const db = await getMongoDb(dbName, uri);
    await ensureIndexes(db);
    const deletedEvents = db.collection<MongoDeletedWaterEventDoc>(
      MONGO_COLLECTIONS.DELETED_WATER_EVENTS
    );

    await deletedEvents.insertOne({
      _id: 'u1:evt_1',
      userId: 'u1',
      eventId: 'evt_1',
      deletedAt: new Date().toISOString(),
    });

    await expect(
      deletedEvents.insertOne({
        _id: 'u1:evt_1_dup',
        userId: 'u1',
        eventId: 'evt_1',
        deletedAt: new Date().toISOString(),
      })
    ).rejects.toThrow(/duplicate key error/);
  });
});
