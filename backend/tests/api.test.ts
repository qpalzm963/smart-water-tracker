import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/app';
import { initDatabase, closeDatabase, migrateDatabase } from '../src/database/db';
import { Express } from 'express';

describe('Smart Water Tracker Backend API Test Suite', () => {
  let app: Express;
  let userToken: string;
  let userId: string;
  let deviceToken: string;
  const testUsername = `tester_${Date.now()}`;
  const testPassword = 'Password123!';
  const testDeviceId = `water_test_${Date.now().toString(16)}`;

  beforeAll(() => {
    // Initialize in-memory SQLite database for testing
    initDatabase(':memory:');
    app = createApp();
  });

  afterAll(() => {
    closeDatabase();
  });

  describe('1. Health Check', () => {
    it('GET /api/v1/health should return ok status', async () => {
      const res = await request(app).get('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.service).toBe('smart-water-tracker-backend');
      expect(typeof res.body.uptime).toBe('number');
    });
  });

  describe('2. User Authentication & Profile', () => {
    it('POST /api/v1/auth/register should register a new user and return JWT', async () => {
      const res = await request(app).post('/api/v1/auth/register').send({
        username: testUsername,
        password: testPassword,
        displayName: '水水測試員',
      });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('token');
      expect(res.body.user).toHaveProperty('id');
      expect(res.body.user.username).toBe(testUsername);
      expect(res.body.user.displayName).toBe('水水測試員');
      expect(res.body.user.dailyGoalMl).toBe(2000);

      userToken = res.body.token;
      userId = res.body.user.id;
    });

    it('POST /api/v1/auth/register should reject duplicate username', async () => {
      const res = await request(app).post('/api/v1/auth/register').send({
        username: testUsername,
        password: testPassword,
      });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('already registered');
    });

    it('POST /api/v1/auth/login should authenticate with correct credentials', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({
        username: testUsername,
        password: testPassword,
      });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
      expect(res.body.user.id).toBe(userId);
    });

    it('POST /api/v1/auth/login should treat account names case-insensitively', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({
        username: testUsername.toUpperCase(),
        password: testPassword,
      });

      expect(res.status).toBe(200);
      expect(res.body.user.username).toBe(testUsername);
    });

    it('keeps legacy email credentials working during the username migration', async () => {
      const legacyEmail = `legacy_${Date.now()}@example.com`;
      const registerRes = await request(app).post('/api/v1/auth/register').send({
        email: legacyEmail,
        password: testPassword,
      });
      expect(registerRes.status).toBe(201);

      const loginRes = await request(app).post('/api/v1/auth/login').send({
        email: legacyEmail,
        password: testPassword,
      });
      expect(loginRes.status).toBe(200);
      expect(loginRes.body.user.username).toBe(legacyEmail.split('@')[0]);
    });

    it('POST /api/v1/auth/login should reject wrong password', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({
        username: testUsername,
        password: 'wrong_password',
      });

      expect(res.status).toBe(401);
    });

    it('GET /api/v1/user/me should require authentication', async () => {
      const res = await request(app).get('/api/v1/user/me');
      expect(res.status).toBe(401);
    });

    it('GET /api/v1/user/me should return current user profile', async () => {
      const res = await request(app)
        .get('/api/v1/user/me')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.user.id).toBe(userId);
      expect(res.body.user.username).toBe(testUsername);
    });

    it('PUT /api/v1/user/me should update user daily goal', async () => {
      const res = await request(app)
        .put('/api/v1/user/me')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          dailyGoalMl: 2500,
          displayName: '水水大師',
        });

      expect(res.status).toBe(200);
      expect(res.body.user.dailyGoalMl).toBe(2500);
      expect(res.body.user.displayName).toBe('水水大師');
    });
  });

  describe('3. Device Management & Device Token', () => {
    it('POST /api/v1/devices should bind a new device and generate a device token', async () => {
      const res = await request(app)
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          deviceId: testDeviceId,
          name: '辦公桌智慧水杯',
        });

      expect(res.status).toBe(201);
      expect(res.body.device.id).toBe(testDeviceId);
      expect(res.body.device.name).toBe('辦公桌智慧水杯');
      expect(res.body.device.deviceToken).toMatch(/^dvt_/);

      deviceToken = res.body.device.deviceToken;
    });

    it('GET /api/v1/devices should list all bound devices with masked token', async () => {
      const res = await request(app)
        .get('/api/v1/devices')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.devices)).toBe(true);
      expect(res.body.devices.length).toBe(1);
      expect(res.body.devices[0].id).toBe(testDeviceId);
      expect(res.body.devices[0].deviceToken).toContain('****');
      expect(res.body.devices[0].deviceToken).not.toBe(deviceToken);
    });

    it('GET /api/v1/devices/:id/status should return device status', async () => {
      const res = await request(app)
        .get(`/api/v1/devices/${testDeviceId}/status`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.deviceId).toBe(testDeviceId);
      expect(typeof res.body.isOnline).toBe('boolean');
    });
  });

  describe('4. Water Records Sync & Deduplication', () => {
    const eventId1 = `${testDeviceId}-1787918400-0`;

    it('POST /api/v1/water/records should accept ESP32 drink event with Device Token', async () => {
      const res = await request(app)
        .post('/api/v1/water/records')
        .set('Authorization', `Bearer ${deviceToken}`)
        .send({
          eventId: eventId1,
          type: 'drink',
          amountMl: 300,
          remainingMl: 250,
          todayTotalMl: 300,
          timeSynced: true,
          occurredAt: Math.floor(Date.now() / 1000),
        });

      expect(res.status).toBe(201);
      expect(res.body.duplicated).toBe(false);
      expect(res.body.record.eventId).toBe(eventId1);
      expect(res.body.record.amountMl).toBe(300);
      expect(res.body.record.eventType).toBe('drink');
    });

    it('POST /api/v1/water/records should reject excessive amountMl (>5000ml)', async () => {
      const res = await request(app)
        .post('/api/v1/water/records')
        .set('Authorization', `Bearer ${deviceToken}`)
        .send({
          type: 'drink',
          amountMl: 999999,
        });

      expect(res.status).toBe(400);
    });

    it('POST /api/v1/water/records should deduplicate on identical eventId (idempotent)', async () => {
      const res = await request(app)
        .post('/api/v1/water/records')
        .set('Authorization', `Bearer ${deviceToken}`)
        .send({
          eventId: eventId1,
          type: 'drink',
          amountMl: 300,
          remainingMl: 250,
          todayTotalMl: 300,
          timeSynced: true,
          occurredAt: Math.floor(Date.now() / 1000),
        });

      expect(res.status).toBe(200);
      expect(res.body.duplicated).toBe(true);
      expect(res.body.record.eventId).toBe(eventId1);
      expect(res.body.message).toContain('idempotent');
    });

    it('POST /api/v1/water/records should accept Refill event without counting toward drink goal', async () => {
      const refillEventId = `${testDeviceId}-1787918400-1`;
      const res = await request(app)
        .post('/api/v1/water/records')
        .set('Authorization', `Bearer ${deviceToken}`)
        .send({
          eventId: refillEventId,
          type: 'refill',
          amountMl: 400,
          remainingMl: 650,
          todayTotalMl: 300,
          timeSynced: true,
          occurredAt: Math.floor(Date.now() / 1000),
        });

      expect(res.status).toBe(201);
      expect(res.body.record.eventType).toBe('refill');
      expect(res.body.record.amountMl).toBe(400);
    });

    it('POST /api/v1/water/records should handle timeSynced: false with server timestamp fallback', async () => {
      const unsyncedEventId = `${testDeviceId}-unsynced-2`;
      const res = await request(app)
        .post('/api/v1/water/records')
        .set('Authorization', `Bearer ${deviceToken}`)
        .send({
          eventId: unsyncedEventId,
          type: 'drink',
          amountMl: 200,
          timeSynced: false,
          occurredAt: 0,
        });

      expect(res.status).toBe(201);
      expect(res.body.record.occurredAt).toBeDefined();
      expect(new Date(res.body.record.occurredAt).getFullYear()).toBeGreaterThanOrEqual(2025);
    });

    it('GET /api/v1/water/records should list records for user with pagination and date filter', async () => {
      const res = await request(app)
        .get('/api/v1/water/records?limit=10&page=1')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.records.length).toBe(3); // 2 drinks + 1 refill
      expect(res.body.pagination.total).toBe(3);
    });
  });

  describe('5. Water Statistics (Daily, Weekly, Monthly)', () => {
    it('GET /api/v1/water/stats/daily should compute daily progress and counts', async () => {
      const res = await request(app)
        .get('/api/v1/water/stats/daily')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      // Total drink = 300ml + 200ml = 500ml. Refill (400ml) is excluded from totalMl.
      expect(res.body.totalMl).toBe(500);
      expect(res.body.goalMl).toBe(2500);
      expect(res.body.progress).toBe(0.2); // 500 / 2500 = 0.2
      expect(res.body.goalMet).toBe(false);
      expect(res.body.drinkCount).toBe(2);
      expect(res.body.refillCount).toBe(1);
    });

    it('GET /api/v1/water/stats/daily should validate date format and reject invalid date query', async () => {
      const res = await request(app)
        .get('/api/v1/water/stats/daily?date=invalid-date')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(400);
    });

    it('GET /api/v1/water/stats/daily should return zero for empty past date', async () => {
      const res = await request(app)
        .get('/api/v1/water/stats/daily?date=2020-01-01')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.date).toBe('2020-01-01');
      expect(res.body.totalMl).toBe(0);
      expect(res.body.drinkCount).toBe(0);
    });

    it('GET /api/v1/water/stats/weekly should return 7 days breakdown and averages using indexed range', async () => {
      const res = await request(app)
        .get('/api/v1/water/stats/weekly')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.days.length).toBe(7);
      expect(res.body.totalWeekMl).toBe(500);
      expect(typeof res.body.averageMl).toBe('number');
      expect(typeof res.body.goalMetDays).toBe('number');
    });

    it('GET /api/v1/water/stats/monthly should return 30 days breakdown and streak metrics', async () => {
      const res = await request(app)
        .get('/api/v1/water/stats/monthly')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.days.length).toBe(30);
      expect(typeof res.body.currentStreak).toBe('number');
      expect(typeof res.body.bestStreak).toBe('number');
    });
  });

  describe('6. Device Unbinding & Token Revocation', () => {
    it('DELETE /api/v1/devices/:id should unbind device', async () => {
      const res = await request(app)
        .delete(`/api/v1/devices/${testDeviceId}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('POST /api/v1/water/records should reject revoked device token', async () => {
      const res = await request(app)
        .post('/api/v1/water/records')
        .set('Authorization', `Bearer ${deviceToken}`)
        .send({
          amountMl: 200,
        });

      expect(res.status).toBe(401);
    });
  });

  describe('7. Security Boundaries, Multi-Tenant Isolation & Hardware Claiming', () => {
    let user2Token: string;
    let user2Id: string;
    let user2DeviceToken: string;
    let user1ActiveDeviceId: string;
    const user2DeviceId = `water_user2_${Date.now().toString(16)}`;
    const sharedEventId = `evt_shared_${Date.now()}`;

    beforeAll(async () => {
      // Bind a fresh active device for User 1
      user1ActiveDeviceId = `water_u1_active_${Date.now().toString(16)}`;
      await request(app)
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ deviceId: user1ActiveDeviceId, name: 'User 1 Active Cup' });

      // Register second independent user
      const res = await request(app).post('/api/v1/auth/register').send({
        email: `user2_${Date.now()}@example.com`,
        password: 'Password123!',
        displayName: '第二位使用者',
      });
      user2Token = res.body.token;
      user2Id = res.body.user.id;

      // Bind device for user 2
      const devRes = await request(app)
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ deviceId: user2DeviceId, name: 'User 2 Cup' });
      user2DeviceToken = devRes.body.device.deviceToken;
    });

    it('User 2 cannot spoof User 1 active deviceId via User JWT (returns 403)', async () => {
      // User 2 attempts to upload a drink record claiming user1ActiveDeviceId (owned by User 1)
      const res = await request(app)
        .post('/api/v1/water/records')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({
          deviceId: user1ActiveDeviceId,
          amountMl: 250,
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Device does not belong to current user');
    });

    it('User 1 and User 2 can upload same eventId independently without cross-tenant data leak', async () => {
      // 1. User 1 uploads event with sharedEventId
      const res1 = await request(app)
        .post('/api/v1/water/records')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          eventId: sharedEventId,
          amountMl: 250,
        });
      expect(res1.status).toBe(201);
      expect(res1.body.record.userId).toBe(userId);
      expect(res1.body.record.amountMl).toBe(250);

      // 2. User 2 uploads event with the SAME sharedEventId and different amount
      const res2 = await request(app)
        .post('/api/v1/water/records')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({
          eventId: sharedEventId,
          amountMl: 450,
        });
      // MUST NOT return User 1's record as duplicate! Must insert for User 2
      expect(res2.status).toBe(201);
      expect(res2.body.record.userId).toBe(user2Id);
      expect(res2.body.record.amountMl).toBe(450);

      // 3. User 1 sends sharedEventId again -> User 1 receives own duplicate (250ml)
      const res1Dup = await request(app)
        .post('/api/v1/water/records')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          eventId: sharedEventId,
          amountMl: 250,
        });
      expect(res1Dup.status).toBe(200);
      expect(res1Dup.body.duplicated).toBe(true);
      expect(res1Dup.body.record.userId).toBe(userId);
      expect(res1Dup.body.record.amountMl).toBe(250);
    });

    it('permanently deletes an owned record and suppresses the same event on re-upload', async () => {
      const deletedEventId = `evt_deleted_${Date.now()}`;
      const createRes = await request(app)
        .post('/api/v1/water/records')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          eventId: deletedEventId,
          amountMl: 175,
          occurredAt: new Date().toISOString(),
        });

      expect(createRes.status).toBe(201);
      const recordId = createRes.body.record.id;

      const statsBeforeDelete = await request(app)
        .get('/api/v1/water/stats/daily')
        .set('Authorization', `Bearer ${userToken}`);

      const unauthenticatedDelete = await request(app).delete(
        `/api/v1/water/records/${recordId}`
      );
      expect(unauthenticatedDelete.status).toBe(401);

      const crossTenantDelete = await request(app)
        .delete(`/api/v1/water/records/${recordId}`)
        .set('Authorization', `Bearer ${user2Token}`);
      expect(crossTenantDelete.status).toBe(404);

      const deleteRes = await request(app)
        .delete(`/api/v1/water/records/${recordId}`)
        .set('Authorization', `Bearer ${userToken}`);
      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.success).toBe(true);

      const statsAfterDelete = await request(app)
        .get('/api/v1/water/stats/daily')
        .set('Authorization', `Bearer ${userToken}`);
      expect(statsAfterDelete.body.totalMl).toBe(statsBeforeDelete.body.totalMl - 175);

      const reuploadRes = await request(app)
        .post('/api/v1/water/records')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          eventId: deletedEventId,
          amountMl: 175,
          occurredAt: new Date().toISOString(),
        });
      expect(reuploadRes.status).toBe(200);
      expect(reuploadRes.body.deleted).toBe(true);
      expect(reuploadRes.body.record).toBeUndefined();

      const listRes = await request(app)
        .get('/api/v1/water/records?limit=100')
        .set('Authorization', `Bearer ${userToken}`);
      expect(listRes.body.records.some((record: { id: string }) => record.id === recordId)).toBe(false);

      const repeatedDelete = await request(app)
        .delete(`/api/v1/water/records/${recordId}`)
        .set('Authorization', `Bearer ${userToken}`);
      expect(repeatedDelete.status).toBe(404);
    });

    it('Hardware Claiming: transfers ownership using the BLE-rotated replacement secret', async () => {
      const claimDeviceId = `water_claim_${Date.now().toString(16)}`;
      const oldClaimCode = 'CLAIM_SECRET_987';
      const newClaimCode = 'CLAIM_SECRET_654';
      const nextClaimCode = 'CLAIM_SECRET_321';

      // 1. User 1 registers device with a claimCode
      const bind1 = await request(app)
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          deviceId: claimDeviceId,
          claimCode: oldClaimCode,
          name: 'Original Bind',
        });
      expect(bind1.status).toBe(201);

      // 2. User 2 tries to claim without/wrong claimCode -> 409 Conflict
      const bindWrong = await request(app)
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({
          deviceId: claimDeviceId,
          claimCode: 'WRONG_CODE',
        });
      expect(bindWrong.status).toBe(409);

      // 3. User 2 proves possession with the old secret and submits the replacement
      // secret that was already rotated and persisted on the physical device over BLE.
      const bindCorrect = await request(app)
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({
          deviceId: claimDeviceId,
          claimCode: oldClaimCode,
          newClaimCode,
          name: 'User 2 Claimed Cup',
        });
      expect(bindCorrect.status).toBe(200);
      expect(bindCorrect.body.message).toContain('transferred');
      expect(bindCorrect.body.device.deviceToken).toMatch(/^dvt_/);

      // 4. User 1 tries to reclaim using the old secret -> rejected.
      const reclaimOld = await request(app)
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          deviceId: claimDeviceId,
          claimCode: oldClaimCode,
          newClaimCode: nextClaimCode,
        });
      expect(reclaimOld.status).toBe(409);

      // 5. The replacement secret is now authoritative and can transfer the device again.
      const reclaimNew = await request(app)
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          deviceId: claimDeviceId,
          claimCode: newClaimCode,
          newClaimCode: nextClaimCode,
        });
      expect(reclaimNew.status).toBe(200);
    });

    it('POST /api/v1/devices/:id/token/rotate rotates token and invalidates old token', async () => {
      const rotateRes = await request(app)
        .post(`/api/v1/devices/${user2DeviceId}/token/rotate`)
        .set('Authorization', `Bearer ${user2Token}`);

      expect(rotateRes.status).toBe(200);
      expect(rotateRes.body.deviceToken).toMatch(/^dvt_/);
      const newDeviceToken = rotateRes.body.deviceToken;
      expect(newDeviceToken).not.toBe(user2DeviceToken);

      // Old token should be rejected with 401
      const oldReq = await request(app)
        .post('/api/v1/water/records')
        .set('Authorization', `Bearer ${user2DeviceToken}`)
        .send({ amountMl: 100 });
      expect(oldReq.status).toBe(401);

      // New token should be accepted with 201
      const newReq = await request(app)
        .post('/api/v1/water/records')
        .set('Authorization', `Bearer ${newDeviceToken}`)
        .send({ amountMl: 100 });
      expect(newReq.status).toBe(201);
    });
  });

  describe('8. Concurrency & Idempotency Under Race Conditions', () => {
    it('handles concurrent identical eventId submissions gracefully without 500 errors', async () => {
      const raceEventId = `evt_race_${Date.now()}`;

      // Fire 5 identical requests simultaneously
      const requests = Array.from({ length: 5 }).map(() =>
        request(app)
          .post('/api/v1/water/records')
          .set('Authorization', `Bearer ${userToken}`)
          .send({
            eventId: raceEventId,
            amountMl: 150,
            timeSynced: true,
            occurredAt: Math.floor(Date.now() / 1000),
          })
      );

      const responses = await Promise.all(requests);

      // All requests must succeed (status 200 or 201, never 500)
      const statusCodes = responses.map((r) => r.status);
      expect(statusCodes.every((s) => s === 200 || s === 201)).toBe(true);

      const createdCount = responses.filter((r) => r.status === 201).length;
      const duplicatedCount = responses.filter((r) => r.status === 200 && r.body.duplicated === true).length;

      expect(createdCount).toBe(1);
      expect(duplicatedCount).toBe(4);
    });
  });

  describe('9. Database Migration & Schema Evolution (v1 to v4)', () => {
    const tempDbPath = path.resolve(__dirname, `test_migration_${Date.now()}.db`);

    afterAll(() => {
      if (fs.existsSync(tempDbPath)) {
        fs.unlinkSync(tempDbPath);
      }
    });

    it('migrates legacy v1 database to v4 with usernames, event tombstones, multi-tenant uniqueness and claim_code', () => {
      const legacyDb = new DatabaseSync(tempDbPath);
      legacyDb.exec('PRAGMA foreign_keys = OFF;');

      // 1. Create legacy v1 schema with global UNIQUE(event_id) and missing claim_code
      legacyDb.exec(`
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
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
          name TEXT,
          last_seen_at TEXT,
          created_at TEXT
        );

        CREATE TABLE drink_records (
          id TEXT PRIMARY KEY,
          event_id TEXT UNIQUE,
          user_id TEXT NOT NULL,
          device_id TEXT,
          event_type TEXT DEFAULT 'drink',
          amount_ml INTEGER NOT NULL,
          remaining_ml INTEGER,
          occurred_at TEXT NOT NULL,
          synced_at TEXT
        );
      `);

      // 2. Insert legacy test data
      legacyDb.exec(`
        INSERT INTO users (id, email, password_hash) VALUES ('u1', 'u1@test.com', 'hash1'), ('u2', 'u2@test.com', 'hash2');
        INSERT INTO devices (id, user_id, device_token) VALUES ('dev1', 'u1', 'tok1');
        INSERT INTO drink_records (id, event_id, user_id, amount_ml, occurred_at) VALUES ('rec1', 'evt_shared_v1', 'u1', 200, '2026-08-24T10:00:00.000Z');
      `);

      // 3. Execute migration
      migrateDatabase(legacyDb);

      // 4. Verify user_version is 4
      const versionRow = legacyDb.prepare('PRAGMA user_version;').get() as unknown as { user_version: number };
      expect(versionRow.user_version).toBe(4);

      // 5. Existing email accounts receive a stable username during migration.
      const migratedUser = legacyDb
        .prepare('SELECT username FROM users WHERE id = ?')
        .get('u1') as unknown as { username: string };
      expect(migratedUser.username).toBe('u1_user');

      // 6. Verify claim_code column exists in devices table
      const deviceCols = legacyDb.prepare("PRAGMA table_info('devices');").all() as unknown as { name: string }[];
      expect(deviceCols.some((c) => c.name === 'claim_code')).toBe(true);

      // 7. Verify permanent-deletion tombstones are available after migration
      const tombstoneTable = legacyDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'deleted_water_events'")
        .get() as unknown as { name: string } | undefined;
      expect(tombstoneTable?.name).toBe('deleted_water_events');

      // 8. Verify cross-tenant event isolation: User 2 CAN insert same 'evt_shared_v1' without UNIQUE constraint violation
      expect(() => {
        legacyDb.prepare(`
          INSERT INTO drink_records (id, event_id, user_id, amount_ml, occurred_at)
          VALUES ('rec2', 'evt_shared_v1', 'u2', 300, '2026-08-24T10:05:00.000Z')
        `).run();
      }).not.toThrow();

      // 9. Verify within-user duplicate still fails unique constraint
      expect(() => {
        legacyDb.prepare(`
          INSERT INTO drink_records (id, event_id, user_id, amount_ml, occurred_at)
          VALUES ('rec3', 'evt_shared_v1', 'u1', 200, '2026-08-24T10:10:00.000Z')
        `).run();
      }).toThrow();

      legacyDb.close();
    });
  });
});
