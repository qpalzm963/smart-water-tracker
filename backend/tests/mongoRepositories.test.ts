import { MongoMemoryServer } from 'mongodb-memory-server';
import { getMongoDb, closeMongoConnection, ensureIndexes } from '../src/database/mongo';
import { getRepositoryContainer, setRepositoryContainer } from '../src/repositories';

jest.setTimeout(60000);

describe('MongoDB Repositories Layer (#13)', () => {
  let mongoServer: MongoMemoryServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    const db = await getMongoDb('test_repo_db', uri);
    await ensureIndexes(db);
    await getRepositoryContainer(db);
  }, 60000);

  afterAll(async () => {
    setRepositoryContainer(null);
    await closeMongoConnection();
    if (mongoServer) {
      await mongoServer.stop();
    }
  }, 30000);

  it('handles cascade delete on user deletion', async () => {
    const { userRepository, deviceRepository, waterRecordRepository, deletedWaterEventRepository } =
      await getRepositoryContainer();

    const userId = 'user_cascade_test';
    await userRepository.create({
      id: userId,
      username: 'cascade_user',
      email: 'cascade@example.com',
      passwordHash: 'hash',
    });

    const deviceId = 'dev_cascade';
    await deviceRepository.create({
      id: deviceId,
      userId,
      deviceToken: 'dvt_cascade_token',
    });

    await waterRecordRepository.create({
      id: 'rec_cascade',
      userId,
      deviceId,
      eventType: 'drink',
      amountMl: 300,
      occurredAt: new Date().toISOString(),
      timeSynced: true,
    });

    await deletedWaterEventRepository.recordDeletedEvent(userId, 'evt_cascade');

    // Verify entities exist
    expect(await userRepository.findById(userId)).not.toBeNull();
    expect(await deviceRepository.findById(deviceId)).not.toBeNull();
    expect(await waterRecordRepository.findById('rec_cascade', userId)).not.toBeNull();
    expect(await deletedWaterEventRepository.isEventDeleted(userId, 'evt_cascade')).toBe(true);

    // Delete user
    const deleted = await userRepository.deleteById(userId);
    expect(deleted).toBe(true);

    // Verify all child entities were cascaded
    expect(await userRepository.findById(userId)).toBeNull();
    expect(await deviceRepository.findById(deviceId)).toBeNull();
    expect(await waterRecordRepository.findById('rec_cascade', userId)).toBeNull();
  });

  it('sets deviceId to null when device is deleted (ON DELETE SET NULL cascade)', async () => {
    const { userRepository, deviceRepository, waterRecordRepository } =
      await getRepositoryContainer();

    const userId = 'user_device_null_test';
    await userRepository.create({
      id: userId,
      username: 'device_null_user',
      email: 'nulluser@example.com',
      passwordHash: 'hash',
    });

    const deviceId = 'dev_null_test';
    await deviceRepository.create({
      id: deviceId,
      userId,
      deviceToken: 'dvt_null_test',
    });

    await waterRecordRepository.create({
      id: 'rec_device_null',
      userId,
      deviceId,
      eventType: 'drink',
      amountMl: 250,
      occurredAt: new Date().toISOString(),
      timeSynced: true,
    });

    // Delete device
    const deleted = await deviceRepository.deleteById(deviceId, userId);
    expect(deleted).toBe(true);

    // Verify drink record still exists but deviceId is now null
    const record = await waterRecordRepository.findById('rec_device_null', userId);
    expect(record).not.toBeNull();
    expect(record?.device_id).toBeNull();
  });
});
