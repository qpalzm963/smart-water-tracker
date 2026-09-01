import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError, apiClient } from '../src/services/api/apiClient';

class LocalStorageMock {
  private store: Record<string, string> = {};

  getItem(key: string): string | null {
    return this.store[key] || null;
  }

  setItem(key: string, value: string): void {
    this.store[key] = value;
  }

  removeItem(key: string): void {
    delete this.store[key];
  }

  clear(): void {
    this.store = {};
  }
}

(globalThis as any).localStorage = new LocalStorageMock();

describe('ApiClient', () => {
  beforeEach(() => {
    (globalThis as any).localStorage.clear();
    apiClient.setToken(null);
    apiClient.setBaseUrl('/api/v1');
  });

  it('should store and clear token', () => {
    expect(apiClient.getToken()).toBeNull();
    apiClient.setToken('jwt_test_token_123');
    expect(apiClient.getToken()).toBe('jwt_test_token_123');
    apiClient.setToken(null);
    expect(apiClient.getToken()).toBeNull();
  });

  it('should format baseUrl cleanly without trailing slash', () => {
    apiClient.setBaseUrl('http://localhost:3000/api/v1///');
    expect(apiClient.getBaseUrl()).toBe('http://localhost:3000/api/v1');
  });

  it('ApiError should encapsulate status and data', () => {
    const err = new ApiError('Not found', 404, { detail: 'resource missing' });
    expect(err.message).toBe('Not found');
    expect(err.status).toBe(404);
    expect(err.data).toEqual({ detail: 'resource missing' });
  });
});
