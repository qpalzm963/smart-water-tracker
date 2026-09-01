import { apiClient } from './apiClient';
import { BindDeviceRequest, BindDeviceResponse, Device, RotateTokenResponse } from '../../types';

export const deviceApi = {
  async bindDevice(payload: BindDeviceRequest): Promise<BindDeviceResponse> {
    const targetId = payload.id;
    return apiClient.post<BindDeviceResponse>('/devices', {
      ...payload,
      deviceId: targetId,
    });
  },

  async listDevices(): Promise<{ devices: Device[] }> {
    return apiClient.get<{ devices: Device[] }>('/devices');
  },

  async unbindDevice(deviceId: string): Promise<{ message: string }> {
    return apiClient.delete<{ message: string }>(`/devices/${encodeURIComponent(deviceId)}`);
  },

  async getDeviceStatus(deviceId: string): Promise<{
    deviceId: string;
    isOnline: boolean;
    lastSeenAt: string | null;
  }> {
    return apiClient.get(`/devices/${encodeURIComponent(deviceId)}/status`);
  },

  async rotateDeviceToken(deviceId: string): Promise<RotateTokenResponse> {
    return apiClient.post<RotateTokenResponse>(`/devices/${encodeURIComponent(deviceId)}/token/rotate`);
  },
};
