import { sanitizeErrorMessage } from '../src/utils/sanitize';

describe('Sanitize Utility (#9 review fix)', () => {
  it('masks sensitive MongoDB credentials in error messages', () => {
    const error = new Error('Connection failed: mongodb+srv://admin:supersecretpassword123@cluster0.abcde.mongodb.net/test');
    const sanitized = sanitizeErrorMessage(error);
    expect(sanitized).toBe('Connection failed: mongodb+srv://***:***@cluster0.abcde.mongodb.net/test');
    expect(sanitized).not.toContain('admin');
    expect(sanitized).not.toContain('supersecretpassword123');
  });

  it('masks standard mongodb:// URIs', () => {
    const raw = 'Failed at mongodb://dbuser:mypassword@127.0.0.1:27017/water';
    const sanitized = sanitizeErrorMessage(raw);
    expect(sanitized).toBe('Failed at mongodb+srv://***:***@127.0.0.1:27017/water');
    expect(sanitized).not.toContain('dbuser');
    expect(sanitized).not.toContain('mypassword');
  });

  it('masks device tokens (dvt_ prefix)', () => {
    const error = new Error('Device auth failed for token dvt_a1b2c3d4e5f60718293a4b5c6d7e8f9012345678');
    const sanitized = sanitizeErrorMessage(error);
    expect(sanitized).toBe('Device auth failed for token dvt_***');
    expect(sanitized).not.toContain('a1b2c3d4e5f60718293a4b5c6d7e8f9012345678');
  });

  it('masks Bearer tokens', () => {
    const error = new Error('HTTP 401: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz');
    const sanitized = sanitizeErrorMessage(error);
    expect(sanitized).toContain('Bearer ***');
    expect(sanitized).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz');
  });

  it('preserves stack trace when includeStack is true', () => {
    const error = new Error('mongodb://secret:pass@localhost:27017 err');
    const sanitizedWithStack = sanitizeErrorMessage(error, true);
    expect(sanitizedWithStack).toContain('Error: mongodb+srv://***:***@localhost:27017 err');
    expect(sanitizedWithStack).toContain('at ');
    expect(sanitizedWithStack).not.toContain('secret:pass');
  });
});
