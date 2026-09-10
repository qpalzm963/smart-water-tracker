import { QUICK_DRINK_AMOUNTS_ML } from '../../game/gameConfig';
import { BleConnectionStatus, DrinkRecord, UploadRecordPayload } from '../../types';

/** Quick-drink amounts (Issue #3): shared with the hydration game energy preview. */
export const QUICK_AMOUNTS = QUICK_DRINK_AMOUNTS_ML;

export interface DashboardProgress {
  percent: number;
  ringPercent: number;
}

export interface BleDisplay {
  label: string;
  value: string;
  tone: 'connected' | 'connecting' | 'disconnected';
}

export const getProgress = (totalMl: number, goalMl: number): DashboardProgress => {
  const percent = goalMl > 0 ? Math.max(0, Math.round((totalMl / goalMl) * 100)) : 0;
  return { percent, ringPercent: Math.min(100, percent) };
};

export const getSceneProgress = (percent: number): number => {
  if (!Number.isFinite(percent)) return 0;
  return Math.min(1, Math.max(0, percent / 100));
};

export const getDayLabel = (value: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return '日期未定';
  return `${Number(match[2])} 月 ${Number(match[3])} 日`;
};

export const getWeekPercent = (totalMl: number, goalMl: number): number => {
  if (!Number.isFinite(totalMl) || !Number.isFinite(goalMl) || goalMl <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((totalMl / goalMl) * 100)));
};

export const getGreeting = (now = new Date()): string => {
  const hour = now.getHours();
  if (hour < 12) return '早安';
  if (hour < 18) return '午安';
  return '晚安';
};

export const getBleDisplay = (
  status: BleConnectionStatus,
  weight?: number,
): BleDisplay => {
  if (status === 'connected') {
    return {
      label: '智慧水杯已連線',
      value: typeof weight === 'number' ? `${Math.round(weight)} g` : '',
      tone: 'connected',
    };
  }

  if (status === 'connecting' || status === 'scanning') {
    return { label: '智慧水杯連線中', value: '', tone: 'connecting' };
  }

  return {
    label: '智慧水杯未連線',
    value: '前往連線',
    tone: 'disconnected',
  };
};

export const getRecentRecords = (
  records: DrinkRecord[],
  now = new Date(),
): DrinkRecord[] => {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  return [...records]
    .filter((record) => {
      const occurredAt = new Date(record.occurredAt).getTime();
      return occurredAt >= startOfDay.getTime() && occurredAt < endOfDay.getTime();
    })
    .sort(
      (a, b) =>
        new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
    )
    .slice(0, 3);
};

export const buildDrinkPayload = (
  amountMl: number,
  now = new Date(),
): UploadRecordPayload => ({
  eventType: 'drink',
  amountMl,
  occurredAt: now.toISOString(),
});
