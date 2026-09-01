import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  DailyStats,
  DrinkRecord,
  MonthlyStats,
  SyncStatus,
  UploadRecordPayload,
  WeeklyStats,
} from '../types';
import { ListRecordsParams, waterApi } from '../services/api/waterApi';
import { offlineQueue } from '../services/sync/offlineQueue';
import { syncEngine } from '../services/sync/syncEngine';
import { useAuth } from './AuthContext';

interface WaterContextType {
  dailyStats: DailyStats | null;
  weeklyStats: WeeklyStats | null;
  monthlyStats: MonthlyStats | null;
  records: DrinkRecord[];
  pagination: { page: number; total: number; totalPages: number };
  syncStatus: SyncStatus;
  isLoading: boolean;
  refreshAll: () => Promise<void>;
  logWaterRecord: (payload: UploadRecordPayload) => Promise<void>;
  deleteWaterRecord: (recordId: string) => Promise<void>;
  fetchRecords: (params?: ListRecordsParams) => Promise<void>;
  triggerSync: () => Promise<void>;
}

const WaterContext = createContext<WaterContextType | undefined>(undefined);

export const WaterProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuth();
  const [dailyStats, setDailyStats] = useState<DailyStats | null>(null);
  const [weeklyStats, setWeeklyStats] = useState<WeeklyStats | null>(null);
  const [monthlyStats, setMonthlyStats] = useState<MonthlyStats | null>(null);
  const [records, setRecords] = useState<DrinkRecord[]>([]);
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 1 });
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(syncEngine.getStatus());
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const refreshRequestId = useRef(0);

  const refreshAll = useCallback(async () => {
    if (!isAuthenticated) return;

    const requestId = ++refreshRequestId.current;
    setIsLoading(true);
    try {
      const [dStats, wStats, mStats, recs] = await Promise.all([
        waterApi.getDailyStats().catch(() => null),
        waterApi.getWeeklyStats().catch(() => null),
        waterApi.getMonthlyStats().catch(() => null),
        waterApi.listRecords({ page: 1, limit: 15 }).catch(() => ({
          records: [],
          pagination: { page: 1, limit: 15, total: 0, totalPages: 1 },
        })),
      ]);

      // A refresh started by an older sync must not overwrite the response of
      // a newer refresh that already contains the IoT event.
      if (requestId !== refreshRequestId.current) return;

      if (dStats) setDailyStats(dStats);
      if (wStats) setWeeklyStats(wStats);
      if (mStats) setMonthlyStats(mStats);
      if (recs) {
        setRecords(recs.records);
        setPagination({
          page: recs.pagination.page,
          total: recs.pagination.total,
          totalPages: recs.pagination.totalPages,
        });
      }
    } finally {
      if (requestId === refreshRequestId.current) setIsLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    const unsubStatus = syncEngine.onStatusChange((status) => {
      setSyncStatus(status);
      if (!status.isSyncing && isAuthenticated) {
        refreshAll().catch(() => {});
      }
    });
    const unsubRecord = syncEngine.onRecordSynced(() => {
      if (isAuthenticated) refreshAll().catch(() => {});
    });
    return () => {
      unsubStatus();
      unsubRecord();
    };
  }, [isAuthenticated, refreshAll]);

  useEffect(() => {
    if (isAuthenticated) {
      refreshAll();
    } else {
      refreshRequestId.current += 1;
      setDailyStats(null);
      setWeeklyStats(null);
      setMonthlyStats(null);
      setRecords([]);
    }
  }, [isAuthenticated, refreshAll]);

  const logWaterRecord = async (payload: UploadRecordPayload) => {
    try {
      await waterApi.uploadRecord(payload);
      await refreshAll();
    } catch {
      // Offline fallback
      offlineQueue.enqueue(payload);
      setSyncStatus(syncEngine.getStatus());
    }
  };

  const fetchRecords = async (params: ListRecordsParams = {}) => {
    setIsLoading(true);
    try {
      const res = await waterApi.listRecords(params);
      setRecords(res.records);
      setPagination({
        page: res.pagination.page,
        total: res.pagination.total,
        totalPages: res.pagination.totalPages,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const deleteWaterRecord = async (recordId: string) => {
    await waterApi.deleteRecord(recordId);

    setRecords((current) => current.filter((record) => record.id !== recordId));
    setPagination((current) => {
      const total = Math.max(0, current.total - 1);
      return {
        ...current,
        total,
        totalPages: Math.max(1, Math.ceil(total / 15)),
      };
    });

    const [dStats, wStats, mStats] = await Promise.all([
      waterApi.getDailyStats().catch(() => null),
      waterApi.getWeeklyStats().catch(() => null),
      waterApi.getMonthlyStats().catch(() => null),
    ]);
    if (dStats) setDailyStats(dStats);
    if (wStats) setWeeklyStats(wStats);
    if (mStats) setMonthlyStats(mStats);
  };

  const triggerSync = async () => {
    await syncEngine.triggerSync();
    await refreshAll();
  };

  return (
    <WaterContext.Provider
      value={{
        dailyStats,
        weeklyStats,
        monthlyStats,
        records,
        pagination,
        syncStatus,
        isLoading,
        refreshAll,
        logWaterRecord,
        deleteWaterRecord,
        fetchRecords,
        triggerSync,
      }}
    >
      {children}
    </WaterContext.Provider>
  );
};

export const useWater = (): WaterContextType => {
  const context = useContext(WaterContext);
  if (!context) {
    throw new Error('useWater must be used within a WaterProvider');
  }
  return context;
};
