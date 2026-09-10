import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import rootServerlessApp from '../../api/index';
import backendServerlessApp from '../src/serverless';
import backendApiServerlessApp from '../api/index';
import { createApp, resetDbInitPromise } from '../src/app';
import { config } from '../src/config/env';
import { setRepositoryContainer, hasActiveRepositoryContainer } from '../src/repositories';
import { closeMongoConnection } from '../src/database/mongo';

jest.setTimeout(60000);

describe('Serverless Runtime Compatibility (#7)', () => {
  const originalVercelEnv = process.env.VERCEL;
  const originalMongoUri = config.mongodbUri;
  const originalDbName = config.mongodbDbName;
  let mongoServer: MongoMemoryServer;
  let uri: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    uri = mongoServer.getUri();
    (config as any).mongodbUri = uri;
    (config as any).mongodbDbName = 'test_serverless_runtime_db';
  }, 60000);

  afterAll(async () => {
    process.env.VERCEL = originalVercelEnv;
    (config as any).mongodbUri = originalMongoUri;
    (config as any).mongodbDbName = originalDbName;
    setRepositoryContainer(null);
    resetDbInitPromise();
    await closeMongoConnection();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  describe('Entry Point Structure & Topology', () => {
    it('instantiates Express app without requiring listen() lifecycle', () => {
      const app = createApp();
      expect(app).toBeDefined();
      expect(typeof app.use).toBe('function');
    });

    it('exports valid Express application from root api/index.ts (Monorepo root deployment)', () => {
      expect(rootServerlessApp).toBeDefined();
      expect(typeof rootServerlessApp).toBe('function');
      expect(typeof (rootServerlessApp as any).use).toBe('function');
    });

    it('exports valid Express application from backend/src/serverless.ts (Backend package export)', () => {
      expect(backendServerlessApp).toBeDefined();
      expect(typeof backendServerlessApp).toBe('function');
      expect(typeof (backendServerlessApp as any).use).toBe('function');
    });

    it('exports valid Express application from backend/api/index.ts (Subdirectory root deployment)', () => {
      expect(backendApiServerlessApp).toBeDefined();
      expect(typeof backendApiServerlessApp).toBe('function');
      expect(typeof (backendApiServerlessApp as any).use).toBe('function');
    });
  });

  describe('Health Endpoint in Serverless Mode', () => {
    it('responds with 200 OK on /api/v1/health in Vercel serverless mode without requiring DB connection', async () => {
      process.env.VERCEL = '1';
      // Ensure DB container is null to verify health check does not block on DB
      setRepositoryContainer(null);
      resetDbInitPromise();

      const res = await request(rootServerlessApp).get('/api/v1/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.runtime).toBe('vercel-serverless');
      expect(res.body.service).toBe('smart-water-tracker-backend');
      expect(typeof res.body.uptime).toBe('number');
      // DB container should still not be initialized by health check
      expect(hasActiveRepositoryContainer()).toBe(false);
    });
  });

  describe('Lazy Cold-Start Connection & Authenticated Request Pipeline', () => {
    let authToken: string;
    let authUsername: string;

    beforeEach(() => {
      process.env.VERCEL = '1';
    });

    it('triggers lazy DB initialization and index building on first API request through serverless entry', async () => {
      // Ensure cold start state
      setRepositoryContainer(null);
      resetDbInitPromise();
      expect(hasActiveRepositoryContainer()).toBe(false);

      authUsername = `srv_user_${Date.now()}`;
      const res = await request(rootServerlessApp)
        .post('/api/v1/auth/register')
        .send({
          username: authUsername,
          email: `${authUsername}@example.com`,
          password: 'Password123!',
          displayName: 'Serverless Tester',
        });

      expect(res.status).toBe(201);
      expect(res.body.token).toBeDefined();
      expect(res.body.user).toBeDefined();
      expect(res.body.user.username).toBe(authUsername);
      authToken = res.body.token;

      // Persistence should now be active
      expect(hasActiveRepositoryContainer()).toBe(true);
    });

    it('executes authenticated profile and drink record creation through serverless entry point', async () => {
      expect(authToken).toBeDefined();

      // 1. Authenticated User Profile check
      const profileRes = await request(rootServerlessApp)
        .get('/api/v1/user/me')
        .set('Authorization', `Bearer ${authToken}`);

      expect(profileRes.status).toBe(200);
      expect(profileRes.body.user.username).toBe(authUsername);

      // 2. Authenticated Water Record submission
      const recordRes = await request(rootServerlessApp)
        .post('/api/v1/water/records')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          amountMl: 350,
          drinkType: 'water',
          occurredAt: new Date().toISOString(),
        });

      expect(recordRes.status).toBe(201);
      expect(recordRes.body.record).toBeDefined();
      expect(recordRes.body.record.amountMl).toBe(350);

      // 3. Authenticated Water Records query
      const listRes = await request(rootServerlessApp)
        .get('/api/v1/water/records')
        .set('Authorization', `Bearer ${authToken}`);

      expect(listRes.status).toBe(200);
      expect(listRes.body.records).toHaveLength(1);
      expect(listRes.body.records[0].amountMl).toBe(350);

      // 4. Authenticated Daily Statistics query
      const statsRes = await request(rootServerlessApp)
        .get('/api/v1/water/stats/daily')
        .set('Authorization', `Bearer ${authToken}`);

      expect(statsRes.status).toBe(200);
      expect(statsRes.body.totalMl).toBe(350);
    });

    it('enforces authentication security boundary on protected serverless routes', async () => {
      // Missing token
      const noTokenRes = await request(rootServerlessApp).get('/api/v1/user/me');
      expect(noTokenRes.status).toBe(401);

      // Invalid token
      const invalidTokenRes = await request(rootServerlessApp)
        .get('/api/v1/user/me')
        .set('Authorization', 'Bearer invalid_signature_token');
      expect(invalidTokenRes.status).toBe(401);
    });

    it('handles concurrent cold-start requests safely without connection or index race conditions', async () => {
      // Force cold-start state
      setRepositoryContainer(null);
      resetDbInitPromise();
      expect(hasActiveRepositoryContainer()).toBe(false);

      const count = 5;
      const promises = Array.from({ length: count }, (_, i) => {
        const username = `concurrent_${Date.now()}_${i}`;
        return request(rootServerlessApp)
          .post('/api/v1/auth/register')
          .send({
            username,
            email: `${username}@example.com`,
            password: 'Password123!',
          });
      });

      const responses = await Promise.all(promises);
      for (const res of responses) {
        expect(res.status).toBe(201);
        expect(res.body.token).toBeDefined();
        expect(res.body.user).toBeDefined();
      }
      expect(hasActiveRepositoryContainer()).toBe(true);
    });
  });
});
