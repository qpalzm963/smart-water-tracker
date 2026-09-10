describe('Environment Configuration Guard', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
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

  it('fails fast in production when MONGODB_URI is missing', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a_very_strong_random_secret_for_jwt_auth_12345';
    delete process.env.MONGODB_URI;

    expect(() => {
      require('../src/config/env');
    }).toThrow('[FATAL CONFIG ERROR] In production, MONGODB_URI must be configured. Server refusing to start.');
  });

  it('fails fast in production when JWT_SECRET is missing or empty', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;
    process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/test';

    expect(() => {
      require('../src/config/env');
    }).toThrow('[FATAL SECURITY ERROR] In production, JWT_SECRET must be set to a strong random secret');
  });

  it('fails fast in production when JWT_SECRET is shorter than 16 characters', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'short_secret';
    process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/test';

    expect(() => {
      require('../src/config/env');
    }).toThrow('[FATAL SECURITY ERROR] In production, JWT_SECRET must be set to a strong random secret');
  });

  it('fails fast in production when JWT_SECRET uses known example placeholders', () => {
    process.env.NODE_ENV = 'production';
    process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/test';

    const placeholders = [
      'replace_with_a_strong_random_secret_generated_via_openssl_rand_hex_32',
      'replace_this_with_your_key',
      'super_secret_jwt_key_that_is_very_long',
      'your_jwt_secret_must_be_changed',
      'default_secret_key_123456789',
    ];

    for (const placeholder of placeholders) {
      jest.resetModules();
      process.env.JWT_SECRET = placeholder;
      expect(() => {
        require('../src/config/env');
      }).toThrow('[FATAL SECURITY ERROR] In production, JWT_SECRET must be set to a strong random secret');
    }
  });

  it('loads successfully in production when both JWT_SECRET and MONGODB_URI are configured', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a_very_strong_random_secret_for_jwt_auth_12345';
    process.env.MONGODB_URI = 'mongodb+srv://user:pass@cluster.mongodb.net/prod';
    process.env.ALLOWED_ORIGINS = 'https://custom-site.com, https://app.example.com ';

    const { config } = require('../src/config/env');
    expect(config.mongodbUri).toBe('mongodb+srv://user:pass@cluster.mongodb.net/prod');
    expect(config.nodeEnv).toBe('production');
    expect(config.allowedOrigins).toEqual(['https://custom-site.com', 'https://app.example.com']);
  });
});
