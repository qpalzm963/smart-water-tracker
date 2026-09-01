import { apiClient } from './apiClient';
import { AuthResponse, User } from '../../types';

export const authApi = {
  async register(username: string, password: string, displayName?: string): Promise<AuthResponse> {
    const data = await apiClient.post<AuthResponse>('/auth/register', {
      username,
      password,
      displayName,
    });
    if (data.token) {
      apiClient.setToken(data.token);
    }
    return data;
  },

  async login(username: string, password: string): Promise<AuthResponse> {
    const data = await apiClient.post<AuthResponse>('/auth/login', {
      username,
      password,
    });
    if (data.token) {
      apiClient.setToken(data.token);
    }
    return data;
  },

  logout(): void {
    apiClient.setToken(null);
  },

  async getProfile(): Promise<{ user: User }> {
    return apiClient.get<{ user: User }>('/user/me');
  },

  async updateDailyGoal(dailyGoalMl: number): Promise<{ message: string; user: User }> {
    return apiClient.put<{ message: string; user: User }>('/user/me', {
      dailyGoalMl,
    });
  },

  async updateDisplayName(displayName: string): Promise<{ message: string; user: User }> {
    return apiClient.put<{ message: string; user: User }>('/user/me', {
      displayName,
    });
  },
};
