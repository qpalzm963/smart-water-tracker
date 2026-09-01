const TOKEN_STORAGE_KEY = 'water_jwt_token';

export class ApiError extends Error {
  public status: number;
  public data: any;

  constructor(message: string, status: number, data?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
    if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) {
      return (globalThis as any).localStorage;
    }
  } catch {
    // ignore
  }
  return null;
}

class ApiClient {
  private baseUrl: string = '/api/v1';
  private token: string | null = null;
  private onUnauthorizedCallback?: () => void;

  constructor() {
    this.token = this.loadToken();
  }

  public setBaseUrl(url: string) {
    this.baseUrl = url.replace(/\/+$/, '');
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public setToken(token: string | null) {
    this.token = token;
    const storage = getStorage();
    if (storage) {
      if (token) {
        storage.setItem(TOKEN_STORAGE_KEY, token);
      } else {
        storage.removeItem(TOKEN_STORAGE_KEY);
      }
    }
  }

  public getToken(): string | null {
    if (!this.token) {
      this.token = this.loadToken();
    }
    return this.token;
  }

  public loadToken(): string | null {
    try {
      const storage = getStorage();
      return storage ? storage.getItem(TOKEN_STORAGE_KEY) : null;
    } catch {
      return null;
    }
  }

  public setOnUnauthorized(cb: () => void) {
    this.onUnauthorizedCallback = cb;
  }

  public async request<T = any>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    };

    const currentToken = this.getToken();
    if (currentToken && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${currentToken}`;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        ...options,
        headers,
      });
    } catch (err: any) {
      throw new ApiError(err.message || '網路連線失敗，請檢查網路連線', 0);
    }

    let responseData: any;
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      responseData = await response.json();
    } else {
      responseData = await response.text();
    }

    if (!response.ok) {
      if (response.status === 401 && this.onUnauthorizedCallback) {
        this.onUnauthorizedCallback();
      }
      const errorMessage =
        (typeof responseData === 'object' && responseData?.error) ||
        (typeof responseData === 'string' && responseData) ||
        `請求失敗 (Status: ${response.status})`;
      throw new ApiError(errorMessage, response.status, responseData);
    }

    return responseData as T;
  }

  public get<T = any>(endpoint: string, headers?: Record<string, string>): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET', headers });
  }

  public post<T = any>(endpoint: string, body?: any, headers?: Record<string, string>): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
      headers,
    });
  }

  public put<T = any>(endpoint: string, body?: any, headers?: Record<string, string>): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
      headers,
    });
  }

  public delete<T = any>(endpoint: string, headers?: Record<string, string>): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE', headers });
  }
}

export const apiClient = new ApiClient();
