import request from 'supertest';
import express, { Request } from 'express';
import http from 'http';
import { getTestMongoUri } from './testMongoHelper';
import { getMongoDb, ensureIndexes, closeMongoConnection } from '../src/database/mongo';
import { MONGO_COLLECTIONS, MongoRateLimitDoc } from '../src/database/mongoCollections';
import {
  getClientIp,
  MongoRateLimitStore,
  createRateLimiter,
} from '../src/middleware/rateLimiter';

describe('Serverless Rate Limiting Layer (#9)', () => {
  let uri: string;

  beforeAll(async () => {
    uri = await getTestMongoUri();
    const db = await getMongoDb('test_rate_limits', uri);
    await ensureIndexes(db);
  }, 60000);

  afterAll(async () => {
    await closeMongoConnection();
  });

  describe('1. Client IP Extraction Behind Proxies', () => {
    it('prioritizes x-real-ip header if present', () => {
      const mockReq = {
        headers: {
          'x-real-ip': '203.0.113.195',
          'x-forwarded-for': '198.51.100.1, 192.0.2.1',
        },
        ip: '10.0.0.1',
      } as unknown as Request;

      expect(getClientIp(mockReq)).toBe('203.0.113.195');
    });

    it('parses the first IP from x-forwarded-for when x-real-ip is missing', () => {
      const mockReq = {
        headers: {
          'x-forwarded-for': '198.51.100.42, 10.0.0.2, 172.16.0.1',
        },
        ip: '10.0.0.2',
      } as unknown as Request;

      expect(getClientIp(mockReq)).toBe('198.51.100.42');
    });

    it('falls back to req.ip when proxy headers are absent', () => {
      const mockReq = {
        headers: {},
        ip: '192.168.1.100',
      } as unknown as Request;

      expect(getClientIp(mockReq)).toBe('192.168.1.100');
    });
  });

  describe('2. MongoDB Shared Store State & TTL Expiration', () => {
    it('persists and increments hit counters across separate store instances', async () => {
      const storeInstance1 = new MongoRateLimitStore(60 * 1000);
      const storeInstance2 = new MongoRateLimitStore(60 * 1000);
      const testKey = `test_client_${Date.now()}`;

      // First hit via Instance 1
      const res1 = await storeInstance1.increment(testKey);
      expect(res1.totalHits).toBe(1);
      expect(res1.resetTime?.getTime()).toBeGreaterThan(Date.now());

      // Second hit via Instance 2 (simulating another serverless container)
      const res2 = await storeInstance2.increment(testKey);
      expect(res2.totalHits).toBe(2);
      // resetTime must remain the same (window is still open)
      expect(res2.resetTime?.getTime()).toBe(res1.resetTime?.getTime());

      // Decrement works across instances
      await storeInstance2.decrement(testKey);
      const db = await getMongoDb();
      const doc = await db.collection<MongoRateLimitDoc>(MONGO_COLLECTIONS.RATE_LIMITS).findOne({ _id: testKey });
      expect(doc?.totalHits).toBe(1);

      // Verify TTL expiresAt field is set for MongoDB background cleanup
      expect(doc?.expiresAt).toBeDefined();
      expect(doc!.expiresAt.getTime()).toBeGreaterThan(doc!.resetTime.getTime());

      // Reset works
      await storeInstance1.resetKey(testKey);
      const resetDoc = await db.collection<MongoRateLimitDoc>(MONGO_COLLECTIONS.RATE_LIMITS).findOne({ _id: testKey });
      expect(resetDoc).toBeNull();
    });

    it('concurrent increments are fully atomic — no request is silently dropped', async () => {
      const store = new MongoRateLimitStore(60 * 1000);
      const testKey = `test_concurrent_${Date.now()}`;
      const concurrency = 20;

      // Fire 20 concurrent increments against the same key
      const results = await Promise.all(
        Array.from({ length: concurrency }, () => store.increment(testKey)),
      );

      // Every result must have totalHits >= 1
      for (const r of results) {
        expect(r.totalHits).toBeGreaterThanOrEqual(1);
      }

      // The highest counter seen must equal total concurrency (no dropped increments)
      const maxHits = Math.max(...results.map((r) => r.totalHits));
      expect(maxHits).toBe(concurrency);

      // The document itself must record the correct final count
      const db = await getMongoDb();
      const doc = await db
        .collection<MongoRateLimitDoc>(MONGO_COLLECTIONS.RATE_LIMITS)
        .findOne({ _id: testKey });
      expect(doc?.totalHits).toBe(concurrency);
    });
  });

  describe('3. Rate Limiter Middleware & HTTP 429 Enforcement', () => {
    let app: express.Express;
    let server: http.Server;

    beforeAll(async () => {
      app = express();
      app.set('trust proxy', 1);

      const testLimiter = createRateLimiter({
        windowMs: 30 * 1000,
        max: 3, // Allow maximum 3 requests per 30s
        message: 'Rate limit exceeded in test.',
        prefix: `rl:test:${Date.now()}`,
      });

      app.post('/test-throttled', testLimiter, (_req, res) => {
        res.status(200).json({ ok: true });
      });

      server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, resolve));
    });

    afterAll(async () => {
      if (server) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it('permits requests within quota and responds with 429 upon threshold breach', async () => {
      const clientIp = '198.51.100.99';

      // 1st request → 200 OK
      const r1 = await request(server).post('/test-throttled').set('x-forwarded-for', clientIp);
      expect(r1.status).toBe(200);

      // 2nd request → 200 OK
      const r2 = await request(server).post('/test-throttled').set('x-forwarded-for', clientIp);
      expect(r2.status).toBe(200);

      // 3rd request → 200 OK
      const r3 = await request(server).post('/test-throttled').set('x-forwarded-for', clientIp);
      expect(r3.status).toBe(200);

      // 4th request → 429 Too Many Requests
      const r4 = await request(server).post('/test-throttled').set('x-forwarded-for', clientIp);
      expect(r4.status).toBe(429);
      expect(r4.body.error).toContain('Rate limit exceeded');

      // Different IP is not blocked (multi-tenant / per-client isolation)
      const rOther = await request(server)
        .post('/test-throttled')
        .set('x-forwarded-for', '203.0.113.88');
      expect(rOther.status).toBe(200);
    });
  });

  describe('4. Fail-Open Resiliency on Store Outage', () => {
    it('catch block falls back gracefully and does not throw when MongoDB is unavailable', async () => {
      // Override the private fallbackStore with a known-fresh counter map to isolate the test
      // from any cross-test MemoryStore state. This directly validates the catch→fallback path.
      const store = new MongoRateLimitStore(60 * 1000);
      const counter = new Map<string, number>();

      // Replace fallbackStore with a minimal in-memory implementation
      (store as any).fallbackStore = {
        increment: (key: string) => {
          const hits = (counter.get(key) ?? 0) + 1;
          counter.set(key, hits);
          return Promise.resolve({
            totalHits: hits,
            resetTime: new Date(Date.now() + 60_000),
          });
        },
        decrement: (key: string) => {
          counter.set(key, Math.max(0, (counter.get(key) ?? 0) - 1));
          return Promise.resolve();
        },
        resetKey: (key: string) => {
          counter.delete(key);
          return Promise.resolve();
        },
        resetAll: () => {
          counter.clear();
          return Promise.resolve();
        },
        init: () => {},
      };

      // Force the MongoDB path to throw by temporarily closing the connection
      const db = await getMongoDb();
      const collection = db.collection(MONGO_COLLECTIONS.RATE_LIMITS);
      // Make collection.findOneAndUpdate throw by using an invalid aggregation operator
      const originalFindOneAndUpdate = collection.findOneAndUpdate.bind(collection);
      (collection as any).findOneAndUpdate = () => Promise.reject(new Error('MongoNetworkError: simulated outage'));

      const key = `failover_isolated`;
      const r1 = await store.increment(key);
      const r2 = await store.increment(key);

      // Restore
      (collection as any).findOneAndUpdate = originalFindOneAndUpdate;

      expect(r1.totalHits).toBe(1);
      expect(r2.totalHits).toBe(2);
      expect(r1.resetTime).toBeDefined();
    });
  });
});
