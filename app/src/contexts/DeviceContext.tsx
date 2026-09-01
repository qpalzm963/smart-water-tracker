import React, { createContext, useContext, useEffect, useState } from 'react';
import { BindDeviceRequest, Device } from '../types';
import { deviceApi } from '../services/api/deviceApi';
import { useAuth } from './AuthContext';

interface DeviceContextType {
  devices: Device[];
  isLoading: boolean;
  newlyBoundToken: string | null;
  setNewlyBoundToken: (token: string | null) => void;
  refreshDevices: () => Promise<void>;
  bindDevice: (payload: BindDeviceRequest) => Promise<string>;
  unbindDevice: (deviceId: string) => Promise<void>;
  rotateToken: (deviceId: string) => Promise<string>;
}

const DeviceContext = createContext<DeviceContextType | undefined>(undefined);

export const DeviceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuth();
  const [devices, setDevices] = useState<Device[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [newlyBoundToken, setNewlyBoundToken] = useState<string | null>(null);

  const refreshDevices = async () => {
    if (!isAuthenticated) return;
    setIsLoading(true);
    try {
      const res = await deviceApi.listDevices();
      setDevices(res.devices);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      refreshDevices();
    } else {
      setDevices([]);
      setNewlyBoundToken(null);
    }
  }, [isAuthenticated]);

  const bindDevice = async (payload: BindDeviceRequest): Promise<string> => {
    const res = await deviceApi.bindDevice(payload);
    const token = res.device.deviceToken;
    setNewlyBoundToken(token);
    await refreshDevices();
    return token;
  };

  const unbindDevice = async (deviceId: string) => {
    await deviceApi.unbindDevice(deviceId);
    await refreshDevices();
  };

  const rotateToken = async (deviceId: string): Promise<string> => {
    const res = await deviceApi.rotateDeviceToken(deviceId);
    setNewlyBoundToken(res.deviceToken);
    await refreshDevices();
    return res.deviceToken;
  };

  return (
    <DeviceContext.Provider
      value={{
        devices,
        isLoading,
        newlyBoundToken,
        setNewlyBoundToken,
        refreshDevices,
        bindDevice,
        unbindDevice,
        rotateToken,
      }}
    >
      {children}
    </DeviceContext.Provider>
  );
};

export const useDevices = (): DeviceContextType => {
  const context = useContext(DeviceContext);
  if (!context) {
    throw new Error('useDevices must be used within a DeviceProvider');
  }
  return context;
};
