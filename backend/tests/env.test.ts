describe('Environment Configuration Guard', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('fails fast in production when MONGODB_URI is missing', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a_very_strong_random_secret_for_jwt_auth_12345';
    delete process.env.MONGODB_URI;

    expect(() => {
      require('../src/config/env');
    }).toThrow('[FATAL CONFIG ERROR] In production, MONGODB_URI must be configured. Server refusing to start.');
  });

  it('loads successfully in production when both JWT_SECRET and MONGODB_URI are configured', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a_very_strong_random_secret_for_jwt_auth_12345';
    process.env.MONGODB_URI = 'mongodb+srv://user:pass@cluster.mongodb.net/prod';

    const { config } = require('../src/config/env');
    expect(config.mongodbUri).toBe('mongodb+srv://user:pass@cluster.mongodb.net/prod');
    expect(config.nodeEnv).toBe('production');
  });
});
