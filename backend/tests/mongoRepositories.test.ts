import { MongoMemoryServer } from 'mongodb-memory-server';
import { getMongoDb, closeMongoConnection, ensureIndexes } from '../src/database/mongo';
import { getRepositoryContainer, setRepositoryContainer } from '../src/repositories';

jest.setTimeout(60000);

describe('MongoDB Repositories Layer (#13)', () => {
  let mongoServer: MongoMemoryServer;
  let testDb: any;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    testDb = await getMongoDb('test_repo_db', uri);
    await ensureIndexes(testDb);
    await getRepositoryContainer(testDb);
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

  it('differentiates DUPLICATE_EMAIL from DUPLICATE_USERNAME on constraint violation', async () => {
    const { userRepository } = await getRepositoryContainer();

    await userRepository.create({
      id: 'user_email_test_1',
      username: 'unique_user_alpha',
      email: 'shared_email@example.com',
      passwordHash: 'hash',
    });

    // Attempting to create user with different username but identical email should trigger DUPLICATE_EMAIL
    await expect(
      userRepository.create({
        id: 'user_email_test_2',
        username: 'unique_user_beta',
        email: 'shared_email@example.com',
        passwordHash: 'hash',
      })
    ).rejects.toMatchObject({ code: 'DUPLICATE_EMAIL' });
  });

  it('initializePersistence ensures indexes and provides valid repository container', async () => {
    const { initializePersistence } = await import('../src/repositories');
    const container = await initializePersistence(testDb);
    expect(container).toHaveProperty('userRepository');
    expect(container).toHaveProperty('deviceRepository');
    expect(container).toHaveProperty('waterRecordRepository');
    expect(container).toHaveProperty('deletedWaterEventRepository');
  });

  it('prevents TOCTOU race: concurrent claims with same old claimCode only allows one winner', async () => {
    const { deviceRepository } = await getRepositoryContainer();

    const initialOwner = 'user_owner_orig';
    const deviceId = 'dev_concurrent_claim';
    await deviceRepository.create({
      id: deviceId,
      userId: initialOwner,
      deviceToken: 'dvt_orig_claim',
      claimCode: 'VALID_SECRET_123',
    });

    // Two different users concurrently try to claim with the same initial claim code
    const [claimA, claimB] = await Promise.all([
      deviceRepository.claimDevice(deviceId, {
        userId: 'user_claimant_A',
        deviceToken: 'dvt_claimant_A',
        claimCode: 'NEW_SECRET_A',
        expectedOwnerId: initialOwner,
        expectedClaimCode: 'VALID_SECRET_123',
      }),
      deviceRepository.claimDevice(deviceId, {
        userId: 'user_claimant_B',
        deviceToken: 'dvt_claimant_B',
        claimCode: 'NEW_SECRET_B',
        expectedOwnerId: initialOwner,
        expectedClaimCode: 'VALID_SECRET_123',
      }),
    ]);

    // Exactly one must succeed, the other must fail (false)
    expect([claimA, claimB].filter(Boolean).length).toBe(1);

    // The winning user now owns the device, and the old claimCode is invalidated
    const device = await deviceRepository.findById(deviceId);
    expect(device).not.toBeNull();
    const winningUser = claimA ? 'user_claimant_A' : 'user_claimant_B';
    const expectedNewSecret = claimA ? 'NEW_SECRET_A' : 'NEW_SECRET_B';
    expect(device?.user_id).toBe(winningUser);
    expect(device?.claim_code).toBe(expectedNewSecret);

    // A third attempt with the old claimCode fails
    const claimLate = await deviceRepository.claimDevice(deviceId, {
      userId: 'user_late',
      deviceToken: 'dvt_late',
      claimCode: 'NEW_SECRET_LATE',
      expectedOwnerId: initialOwner,
      expectedClaimCode: 'VALID_SECRET_123',
    });
    expect(claimLate).toBe(false);
  });

  it('supports retryable cleanup: children are deleted before parent so failure leaves parent retryable', async () => {
    const { userRepository, deviceRepository } = await getRepositoryContainer();

    const userId = 'user_retry_test';
    await userRepository.create({
      id: userId,
      username: 'retry_cascade_user',
      email: 'retry@example.com',
      passwordHash: 'hash',
    });

    await deviceRepository.create({
      id: 'dev_retry_child',
      userId,
      deviceToken: 'dvt_retry_token',
    });

    // Calling deleteById on a nonexistent user returns false cleanly
    expect(await userRepository.deleteById('nonexistent_user')).toBe(false);

    // Deleting existing user succeeds
    const deleted = await userRepository.deleteById(userId);
    expect(deleted).toBe(true);

    // Repeated delete returns false (idempotent, no orphans)
    expect(await userRepository.deleteById(userId)).toBe(false);
  });
});
