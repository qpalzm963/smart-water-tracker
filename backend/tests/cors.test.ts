import request from 'supertest';
import { createApp } from '../src/app';

describe('CORS and Same-Origin Security (#8)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'test';
  });

  afterAll(() => {
    process.env = originalEnv;
    process.env.NODE_ENV = 'test';
  });

  it('allows non-browser requests without Origin header (e.g. ESP32, curl, server-to-server)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a_very_strong_random_secret_for_jwt_auth_12345';
    process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/test';

    const app = createApp();
    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('allows same-origin requests where Origin matches Host header (scheme + host)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a_very_strong_random_secret_for_jwt_auth_12345';
    process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/test';

    const app = createApp();
    const res = await request(app)
      .get('/api/v1/health')
      .set('Host', 'smart-water-tracker.vercel.app')
      .set('X-Forwarded-Proto', 'https')
      .set('Origin', 'https://smart-water-tracker.vercel.app');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://smart-water-tracker.vercel.app');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('rejects http Origin when server is https — scheme mismatch is not same-origin', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a_very_strong_random_secret_for_jwt_auth_12345';
    process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/test';
    delete process.env.ALLOWED_ORIGINS;

    const app = createApp();
    // Server is https (X-Forwarded-Proto: https), but Origin sends http:// — must NOT be same-origin
    const res = await request(app)
      .get('/api/v1/health')
      .set('Host', 'smart-water-tracker.vercel.app')
      .set('X-Forwarded-Proto', 'https')
      .set('Origin', 'http://smart-water-tracker.vercel.app');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows same-origin requests where Origin matches X-Forwarded-Host header', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a_very_strong_random_secret_for_jwt_auth_12345';
    process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/test';

    const app = createApp();
    const res = await request(app)
      .get('/api/v1/health')
      .set('X-Forwarded-Host', 'smart-water-tracker.vercel.app')
      .set('X-Forwarded-Proto', 'https')
      .set('Origin', 'https://smart-water-tracker.vercel.app');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://smart-water-tracker.vercel.app');
  });

  it('allows cross-origin requests from explicit ALLOWED_ORIGINS whitelist', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a_very_strong_random_secret_for_jwt_auth_12345';
    process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/test';
    process.env.ALLOWED_ORIGINS = 'https://custom-portal.com,https://app.trusted.com';

    const app = createApp();

    // Allowed origin
    const resAllowed = await request(app)
      .get('/api/v1/health')
      .set('Origin', 'https://custom-portal.com');
    expect(resAllowed.status).toBe(200);
    expect(resAllowed.headers['access-control-allow-origin']).toBe('https://custom-portal.com');

    // Disallowed origin
    const resBlocked = await request(app)
      .get('/api/v1/health')
      .set('Origin', 'https://untrusted-attacker.com');
    expect(resBlocked.status).toBe(200);
    expect(resBlocked.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows localhost in non-production environments by default', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.ALLOWED_ORIGINS;

    const app = createApp();
    const res = await request(app)
      .get('/api/v1/health')
      .set('Origin', 'http://localhost:5173');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('rejects cross-origin requests in production when ALLOWED_ORIGINS is unset and not same-origin', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a_very_strong_random_secret_for_jwt_auth_12345';
    process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/test';
    delete process.env.ALLOWED_ORIGINS;

    const app = createApp();
    const res = await request(app)
      .get('/api/v1/health')
      .set('Host', 'smart-water-tracker.vercel.app')
      .set('Origin', 'https://untrusted-site.com');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
