import { MongoMemoryServer } from 'mongodb-memory-server';
import { Collection } from 'mongodb';
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
    const { userRepository, deviceRepository } = await getRepositoryContainer();

    const initialOwner = 'user_owner_orig_123';
    await userRepository.create({
      id: initialOwner,
      username: 'owner_orig_unique',
      email: 'owner_orig@example.com',
      passwordHash: 'hash',
    });

    // Valid target claimants must exist in users collection
    await userRepository.create({
      id: 'user_claimant_A',
      username: 'claimant_a',
      email: 'claimant_a@example.com',
      passwordHash: 'hash',
    });
    await userRepository.create({
      id: 'user_claimant_B',
      username: 'claimant_b',
      email: 'claimant_b@example.com',
      passwordHash: 'hash',
    });

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
      userId: 'user_claimant_A',
      deviceToken: 'dvt_late',
      claimCode: 'NEW_SECRET_LATE',
      expectedOwnerId: initialOwner,
      expectedClaimCode: 'VALID_SECRET_123',
    });
    expect(claimLate).toBe(false);
  });

  it('rejects claimDevice when target claimant user does not exist or is being deleted', async () => {
    const { userRepository, deviceRepository } = await getRepositoryContainer();

    const ownerId = 'user_owner_claim_valid';
    await userRepository.create({
      id: ownerId,
      username: 'claim_valid_owner',
      email: 'claim_valid@example.com',
      passwordHash: 'hash',
    });

    const deviceId = 'dev_claim_nonexistent_target';
    await deviceRepository.create({
      id: deviceId,
      userId: ownerId,
      deviceToken: 'dvt_claim_target_token',
      claimCode: 'CODE_TARGET_123',
    });

    // 1. Claiming with a non-existent user must return false
    const claimNonExistent = await deviceRepository.claimDevice(deviceId, {
      userId: 'user_does_not_exist_99999',
      deviceToken: 'dvt_new_fake',
      claimCode: 'NEW_CODE_FAKE',
      expectedOwnerId: ownerId,
      expectedClaimCode: 'CODE_TARGET_123',
    });
    expect(claimNonExistent).toBe(false);

    // Device still owned by original owner
    const device = await deviceRepository.findById(deviceId);
    expect(device?.user_id).toBe(ownerId);

    // 2. Claiming with a user marked isDeleting must return false
    const deletingUserId = 'user_claimant_deleting';
    await userRepository.create({
      id: deletingUserId,
      username: 'deleting_claimant',
      email: 'deleting_claimant@example.com',
      passwordHash: 'hash',
    });
    await testDb.collection('users').updateOne({ _id: deletingUserId }, { $set: { isDeleting: true } });

    const claimDeleting = await deviceRepository.claimDevice(deviceId, {
      userId: deletingUserId,
      deviceToken: 'dvt_new_deleting',
      claimCode: 'NEW_CODE_DELETING',
      expectedOwnerId: ownerId,
      expectedClaimCode: 'CODE_TARGET_123',
    });
    expect(claimDeleting).toBe(false);

    // Device still owned by original owner
    const deviceStill = await deviceRepository.findById(deviceId);
    expect(deviceStill?.user_id).toBe(ownerId);
  });

  it('supports retryable cleanup on injected failure: cleans remaining child records and parent upon retry', async () => {
    const { userRepository, deviceRepository, waterRecordRepository } = await getRepositoryContainer();

    const userId = 'user_injected_fail_test';
    await userRepository.create({
      id: userId,
      username: 'injected_user',
      email: 'injected@example.com',
      passwordHash: 'hash',
    });

    await deviceRepository.create({
      id: 'dev_injected_child',
      userId,
      deviceToken: 'dvt_injected_token',
    });

    await waterRecordRepository.create({
      id: 'rec_injected_child',
      userId,
      deviceId: 'dev_injected_child',
      eventType: 'drink',
      amountMl: 250,
      occurredAt: new Date().toISOString(),
      timeSynced: true,
    });

    // Mock a transient failure during child cascade cleanup
    const deleteManySpy = jest
      .spyOn(Collection.prototype, 'deleteMany')
      .mockRejectedValueOnce(new Error('Transient network error during cascade'));

    // First delete attempt fails due to the injected error
    await expect(userRepository.deleteById(userId)).rejects.toThrow('Transient network error during cascade');

    // Restore deleteMany
    deleteManySpy.mockRestore();

    // The user document still exists in DB so the operation can be retried safely
    const userDocInDb = await testDb.collection('users').findOne({ _id: userId });
    expect(userDocInDb).not.toBeNull();
    expect(userDocInDb?.isDeleting).toBe(true);

    // Retrying delete succeeds
    const retrySuccess = await userRepository.deleteById(userId);
    expect(retrySuccess).toBe(true);

    // All records are cleanly deleted after retry
    expect(await testDb.collection('users').findOne({ _id: userId })).toBeNull();
    expect(await testDb.collection('devices').findOne({ _id: 'dev_injected_child' })).toBeNull();
    expect(await testDb.collection('drink_records').findOne({ _id: 'rec_injected_child' })).toBeNull();
  });

  it('prevents dangling references during concurrent device unbind and record insert', async () => {
    const { userRepository, deviceRepository, waterRecordRepository } = await getRepositoryContainer();

    const userId = 'user_unbind_race_test';
    await userRepository.create({
      id: userId,
      username: 'unbind_race_user',
      email: 'unbind_race@example.com',
      passwordHash: 'hash',
    });

    const deviceId = 'dev_unbind_race';
    await deviceRepository.create({
      id: deviceId,
      userId,
      deviceToken: 'dvt_unbind_race',
    });

    // Run device unbind and concurrent record creation simultaneously
    const [unbindResult, recordResult] = await Promise.all([
      deviceRepository.deleteById(deviceId, userId),
      waterRecordRepository.create({
        id: 'rec_during_unbind_race',
        userId,
        deviceId,
        eventType: 'drink',
        amountMl: 300,
        occurredAt: new Date().toISOString(),
        timeSynced: true,
      }),
    ]);

    expect(unbindResult).toBe(true);
    expect(recordResult.record).toBeDefined();

    // Verify: device is deleted
    expect(await deviceRepository.findById(deviceId)).toBeNull();

    // Verify: record created in concurrent window has deviceId set to null (NO dangling reference!)
    const savedRecord = await testDb.collection('drink_records').findOne({ _id: 'rec_during_unbind_race' });
    expect(savedRecord).not.toBeNull();
    expect(savedRecord?.deviceId).toBeNull();
  });

  it('prevents orphan child records during concurrent user deletion and record insert', async () => {
    const { userRepository, waterRecordRepository } = await getRepositoryContainer();

    const userId = 'user_delete_race_test';
    await userRepository.create({
      id: userId,
      username: 'delete_race_user',
      email: 'delete_race@example.com',
      passwordHash: 'hash',
    });

    // Run user deletion and concurrent record creation simultaneously
    const [deleteResult, recordResult] = await Promise.allSettled([
      userRepository.deleteById(userId),
      waterRecordRepository.create({
        id: 'rec_during_user_delete_race',
        userId,
        eventType: 'drink',
        amountMl: 350,
        occurredAt: new Date().toISOString(),
        timeSynced: true,
      }),
    ]);

    expect(deleteResult.status).toBe('fulfilled');
    expect((deleteResult as PromiseFulfilledResult<boolean>).value).toBe(true);

    // If record creation ran after isDeleting was marked, it was rejected with USER_NOT_FOUND
    // If it ran before, compensating sweep deleted it
    const remainingRecord = await testDb.collection('drink_records').findOne({ _id: 'rec_during_user_delete_race' });
    expect(remainingRecord).toBeNull();
  });

  it('deterministic race test: prevents orphan records when child write passes parent validation but insertOne is paused until full user delete + sweep completes', async () => {
    const { userRepository, waterRecordRepository } = await getRepositoryContainer();

    const userId = 'user_deterministic_race';
    await userRepository.create({
      id: userId,
      username: 'det_race_user',
      email: 'det_race@example.com',
      passwordHash: 'hash',
    });

    let pauseResolve!: () => void;
    const pausedBeforeInsert = new Promise<void>((resolve) => {
      pauseResolve = resolve;
    });
    let resumeResolve!: () => void;
    const resumeInsert = new Promise<void>((resolve) => {
      resumeResolve = resolve;
    });

    // Spy on drink_records insertOne to intercept the write right after parent validation
    const origInsertOne = Collection.prototype.insertOne;
    const insertSpy = jest.spyOn(Collection.prototype, 'insertOne').mockImplementation(async function (
      this: any,
      doc: any,
      ...args: any[]
    ) {
      if (doc?._id === 'rec_deterministic_orphan_target') {
        // Notify test that parent validation has passed and we are paused right before insert
        pauseResolve();
        // Wait until deleteById finishes completely
        await resumeInsert;
      }
      return (origInsertOne as any).apply(this, [doc, ...args]);
    });

    // Start child write in the background
    const writePromise = waterRecordRepository.create({
      id: 'rec_deterministic_orphan_target',
      userId,
      eventType: 'drink',
      amountMl: 400,
      occurredAt: new Date().toISOString(),
      timeSynced: true,
    });

    // Wait until child write has passed parent validation and is paused
    await pausedBeforeInsert;

    // Now execute full parent deletion + cleanup + sweep to completion
    const deleteSuccess = await userRepository.deleteById(userId);
    expect(deleteSuccess).toBe(true);

    // Verify parent user document is completely gone from MongoDB
    expect(await testDb.collection('users').findOne({ _id: userId })).toBeNull();

    // Now release the child write's insertOne
    resumeResolve();

    // The write promise must be rejected with USER_NOT_FOUND (because two-phase fence catches the deletion)
    await expect(writePromise).rejects.toThrow('User does not exist or account is being deleted');

    // Crucial verification: NO ORPHAN RECORD EXISTS IN DRINK_RECORDS!
    const orphanDoc = await testDb.collection('drink_records').findOne({ _id: 'rec_deterministic_orphan_target' });
    expect(orphanDoc).toBeNull();

    insertSpy.mockRestore();
  });

  it('deterministic race test: prevents dangling deviceId when child write passes device validation but insertOne is paused until full device unbind completes', async () => {
    const { userRepository, deviceRepository, waterRecordRepository } = await getRepositoryContainer();

    const userId = 'user_det_dev_race';
    await userRepository.create({
      id: userId,
      username: 'det_dev_user',
      email: 'det_dev@example.com',
      passwordHash: 'hash',
    });

    const deviceId = 'dev_det_race';
    await deviceRepository.create({
      id: deviceId,
      userId,
      deviceToken: 'dvt_det_race',
    });

    let pauseResolve!: () => void;
    const pausedBeforeInsert = new Promise<void>((resolve) => {
      pauseResolve = resolve;
    });
    let resumeResolve!: () => void;
    const resumeInsert = new Promise<void>((resolve) => {
      resumeResolve = resolve;
    });

    const origInsertOne = Collection.prototype.insertOne;
    const insertSpy = jest.spyOn(Collection.prototype, 'insertOne').mockImplementation(async function (
      this: any,
      doc: any,
      ...args: any[]
    ) {
      if (doc?._id === 'rec_deterministic_dev_target') {
        pauseResolve();
        await resumeInsert;
      }
      return (origInsertOne as any).apply(this, [doc, ...args]);
    });

    const writePromise = waterRecordRepository.create({
      id: 'rec_deterministic_dev_target',
      userId,
      deviceId,
      eventType: 'drink',
      amountMl: 350,
      occurredAt: new Date().toISOString(),
      timeSynced: true,
    });

    await pausedBeforeInsert;

    // Delete device while write is paused
    const unbindSuccess = await deviceRepository.deleteById(deviceId, userId);
    expect(unbindSuccess).toBe(true);

    // Release write
    resumeResolve();

    const result = await writePromise;
    expect(result.record).toBeDefined();

    // Verified: record was saved, BUT deviceId was automatically nullified by two-phase fence (NO dangling reference!)
    const savedDoc = await testDb.collection('drink_records').findOne({ _id: 'rec_deterministic_dev_target' });
    expect(savedDoc).not.toBeNull();
    expect(savedDoc?.deviceId).toBeNull();

    insertSpy.mockRestore();
  });
});
