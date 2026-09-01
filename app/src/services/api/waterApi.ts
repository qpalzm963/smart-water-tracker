import { apiClient } from './apiClient';
import {
  DailyStats,
  DrinkRecord,
  MonthlyStats,
  UploadRecordPayload,
  WaterEventType,
  WeeklyStats,
} from '../../types';

export interface ListRecordsParams {
  page?: number;
  limit?: number;
  startDate?: string;
  endDate?: string;
  eventType?: WaterEventType;
}

export interface ListRecordsResponse {
  records: DrinkRecord[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface DailyStatsResponse {
  date: string;
  totalMl: number;
  goalMl: number;
  progress?: number;
  progressPercent?: number;
  goalMet?: boolean;
  drinkCount: number;
  refillCount: number;
}

interface StatsBreakdownResponse {
  date: string;
  totalMl: number;
  goalMet?: boolean;
  drinkCount?: number;
  refillCount?: number;
}

interface WeeklyStatsResponse {
  days: StatsBreakdownResponse[];
  averageMl: number;
  goalMetDays: number;
  totalWeekMl: number;
  goalMl: number;
}

interface MonthlyStatsResponse {
  days: StatsBreakdownResponse[];
  averageMl: number;
  totalMonthMl: number;
  currentStreak: number;
  bestStreak: number;
  goalMl: number;
}

const mapBreakdown = (day: StatsBreakdownResponse) => ({
  date: day.date,
  totalMl: day.totalMl,
  ...(typeof day.drinkCount === 'number' ? { drinkCount: day.drinkCount } : {}),
  ...(typeof day.refillCount === 'number' ? { refillCount: day.refillCount } : {}),
});

export interface UploadRecordResponse {
  message: string;
  record?: DrinkRecord;
  duplicated?: boolean;
  deleted?: boolean;
}

export const waterApi = {
  async uploadRecord(payload: UploadRecordPayload, customToken?: string): Promise<UploadRecordResponse> {
    const headers = customToken ? { Authorization: `Bearer ${customToken}` } : undefined;
    // The app model calls this field eventType, while the backend contract
    // uses type. Send only the API shape so refill events are preserved.
    const { eventType, ...rest } = payload;
    return apiClient.post<UploadRecordResponse>(
      '/water/records',
      { ...rest, type: eventType },
      headers,
    );
  },

  async listRecords(params: ListRecordsParams = {}): Promise<ListRecordsResponse> {
    const query = new URLSearchParams();
    if (params.page !== undefined) query.set('page', String(params.page));
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    if (params.startDate) query.set('startDate', params.startDate);
    if (params.endDate) query.set('endDate', params.endDate);
    if (params.eventType) query.set('eventType', params.eventType);

    const queryString = query.toString();
    const endpoint = `/water/records${queryString ? `?${queryString}` : ''}`;
    return apiClient.get<ListRecordsResponse>(endpoint);
  },

  async deleteRecord(recordId: string): Promise<{ success: boolean; message: string }> {
    return apiClient.delete<{ success: boolean; message: string }>(
      `/water/records/${encodeURIComponent(recordId)}`
    );
  },

  async getDailyStats(date?: string): Promise<DailyStats> {
    const endpoint = `/water/stats/daily${date ? `?date=${encodeURIComponent(date)}` : ''}`;
    const response = await apiClient.get<DailyStatsResponse>(endpoint);
    return {
      date: response.date,
      totalMl: response.totalMl,
      goalMl: response.goalMl,
      drinkCount: response.drinkCount,
      refillCount: response.refillCount,
      progressPercent: response.progressPercent ?? Math.round((response.progress ?? 0) * 100),
    };
  },

  async getWeeklyStats(date?: string): Promise<WeeklyStats> {
    const endpoint = `/water/stats/weekly${date ? `?date=${encodeURIComponent(date)}` : ''}`;
    const response = await apiClient.get<WeeklyStatsResponse>(endpoint);
    return {
      startDate: response.days[0]?.date ?? '',
      endDate: response.days[response.days.length - 1]?.date ?? '',
      totalMl: response.totalWeekMl,
      dailyAverageMl: response.averageMl,
      goalMl: response.goalMl,
      daysMetGoal: response.goalMetDays,
      days: response.days.map(mapBreakdown),
    };
  },

  async getMonthlyStats(date?: string): Promise<MonthlyStats> {
    const endpoint = `/water/stats/monthly${date ? `?date=${encodeURIComponent(date)}` : ''}`;
    const response = await apiClient.get<MonthlyStatsResponse>(endpoint);
    return {
      startDate: response.days[0]?.date ?? '',
      endDate: response.days[response.days.length - 1]?.date ?? '',
      totalMl: response.totalMonthMl,
      dailyAverageMl: response.averageMl,
      goalMl: response.goalMl,
      daysMetGoal: response.days.filter((day) => day.goalMet).length,
      currentStreak: response.currentStreak,
      maxStreak: response.bestStreak,
      days: response.days.map(mapBreakdown),
    };
  },
};
