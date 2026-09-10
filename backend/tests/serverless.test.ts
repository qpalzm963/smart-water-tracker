import request from 'supertest';
import { createApp } from '../src/app';

describe('Serverless Runtime Compatibility (#7)', () => {
  const originalVercelEnv = process.env.VERCEL;

  afterAll(() => {
    process.env.VERCEL = originalVercelEnv;
  });

  it('instantiates Express app without requiring listen() lifecycle', () => {
    const app = createApp();
    expect(app).toBeDefined();
    expect(typeof app.use).toBe('function');
  });

  it('responds with 200 OK on /api/v1/health in Vercel serverless mode', async () => {
    process.env.VERCEL = '1';
    const app = createApp();
    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.runtime).toBe('vercel-serverless');
    expect(res.body.service).toBe('smart-water-tracker-backend');
    expect(typeof res.body.uptime).toBe('number');
  });
});
