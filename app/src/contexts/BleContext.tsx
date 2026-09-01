import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  BleCommandResponse,
  BleConnectionStatus,
  BleSummary,
  BleWaterEvent,
} from '../types';
import { bleService } from '../services/ble/bleService';
import { mockBleService } from '../services/ble/mockBleService';
import { isWebBluetoothSupported } from '../services/ble/bleProtocol';
import { prependUniqueLiveEvent } from '../services/ble/liveEventBuffer';
import { offlineQueue } from '../services/sync/offlineQueue';
import { syncEngine } from '../services/sync/syncEngine';
import { historyCursorStore } from '../services/sync/historyCursorStore';
import {
  connectWithAutomaticHistorySync,
  HistorySyncCoordinator,
} from '../services/sync/historySyncCoordinator';

interface BleContextType {
  status: BleConnectionStatus;
  deviceName: string | null;
  deviceId: string | null;
  summary: BleSummary | null;
  liveEvents: BleWaterEvent[];
  isMockMode: boolean;
  isSupported: boolean;
  setMockMode: (mock: boolean) => void;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  tare: () => Promise<BleCommandResponse>;
  resetDaily: () => Promise<BleCommandResponse>;
  syncTime: () => Promise<BleCommandResponse>;
  rotateClaim: () => Promise<BleCommandResponse>;
  configureWifi: (
    ssid: string,
    pass: string,
    apiUrl: string,
    token: string
  ) => Promise<BleCommandResponse>;
  clearWifi: () => Promise<BleCommandResponse>;
  syncHistory: (afterEventId?: string) => Promise<void>;
  simulateDrink: (amount?: number) => void;
  simulateRefill: (amount?: number) => void;
}

const BleContext = createContext<BleContextType | undefined>(undefined);

export const BleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const isSupported = isWebBluetoothSupported();
  const [isMockMode, setMockMode] = useState<boolean>(!isSupported);
  const [status, setStatus] = useState<BleConnectionStatus>('disconnected');
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [summary, setSummary] = useState<BleSummary | null>(null);
  const [liveEvents, setLiveEvents] = useState<BleWaterEvent[]>([]);

  const activeDriver = isMockMode ? mockBleService : bleService;

  const historyCoordinator = useMemo(
    () =>
      new HistorySyncCoordinator({
        driver: activeDriver,
        queue: offlineQueue,
        engine: syncEngine,
        cursors: historyCursorStore,
        onEvent: (event) => {
          setLiveEvents((prev) => prependUniqueLiveEvent(prev, event));
        },
      }),
    [activeDriver]
  );

  const handleWaterEvent = (event: BleWaterEvent) => {
    setLiveEvents((prev) => prependUniqueLiveEvent(prev, event));

    // Automatically enqueue to offline sync queue to sync with backend
    const stableDeviceId = activeDriver.getCachedSummary()?.deviceId;
    offlineQueue.enqueue({
      eventId: event.eventId,
      ...(stableDeviceId ? { deviceId: stableDeviceId } : {}),
      eventType: event.type,
      amountMl: event.amountMl,
      remainingMl: event.remainingMl,
      occurredAt: event.occurredAt > 0 ? new Date(event.occurredAt * 1000).toISOString() : undefined,
      timeSynced: event.timeSynced,
    });

    syncEngine.triggerSync().catch(() => {});
  };

  useEffect(() => {
    const unsubStatus = activeDriver.onStatusChange((newStatus) => {
      setStatus(newStatus);
      if (newStatus === 'connected') {
        setDeviceName(activeDriver.getDeviceName());
        setDeviceId(activeDriver.getDeviceId());
      } else if (newStatus === 'disconnected') {
        setDeviceName(null);
        setDeviceId(null);
        setSummary(null);
      }
    });

    const unsubSummary = activeDriver.onSummary((newSummary) => {
      setSummary(newSummary);
    });

    const unsubLive = activeDriver.onLiveEvent(handleWaterEvent);

    return () => {
      unsubStatus();
      unsubSummary();
      unsubLive();
    };
  }, [isMockMode]);

  const connect = async () => {
    await connectWithAutomaticHistorySync(
      () => activeDriver.scanAndConnect(),
      () => historyCoordinator.sync(),
      (error) => {
        console.warn('自動歷史同步尚未完成，事件保留等待重試:', error);
      }
    );
  };

  const disconnect = async () => {
    await activeDriver.disconnect();
  };

  const tare = async () => {
    return activeDriver.tare();
  };

  const resetDaily = async () => {
    return activeDriver.resetDaily();
  };

  const syncTime = async () => {
    return activeDriver.syncDeviceTime();
  };

  const rotateClaim = async () => {
    return activeDriver.rotateClaimSecret();
  };

  const configureWifi = async (ssid: string, pass: string, apiUrl: string, token: string) => {
    if (isMockMode) {
      return mockBleService.configureWifi(ssid);
    }
    return bleService.configureWifi(ssid, pass, apiUrl, token);
  };

  const clearWifi = async () => {
    return activeDriver.clearWifi();
  };

  const syncHistory = async (afterEventId: string = '') => {
    if (afterEventId) {
      console.warn('syncHistory(afterEventId) 已由 per-device ACK 游標管理，忽略外部游標:', afterEventId);
    }
    await historyCoordinator.sync();
  };

  const simulateDrink = (amount: number = 250) => {
    if (isMockMode) {
      mockBleService.simulateDrinkEvent(amount);
    }
  };

  const simulateRefill = (amount: number = 500) => {
    if (isMockMode) {
      mockBleService.simulateRefillEvent(amount);
    }
  };

  return (
    <BleContext.Provider
      value={{
        status,
        deviceName,
        deviceId,
        summary,
        liveEvents,
        isMockMode,
        isSupported,
        setMockMode,
        connect,
        disconnect,
        tare,
        resetDaily,
        syncTime,
        rotateClaim,
        configureWifi,
        clearWifi,
        syncHistory,
        simulateDrink,
        simulateRefill,
      }}
    >
      {children}
    </BleContext.Provider>
  );
};

export const useBle = (): BleContextType => {
  const context = useContext(BleContext);
  if (!context) {
    throw new Error('useBle must be used within a BleProvider');
  }
  return context;
};
