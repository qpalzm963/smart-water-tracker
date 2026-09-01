// ==========================================
// 1. User & Auth Types
// ==========================================
export interface User {
  id: string;
  username: string;
  /** Legacy field retained while older backend records are migrated. */
  email?: string | null;
  displayName: string | null;
  dailyGoalMl: number;
  createdAt: string;
}

export interface AuthResponse {
  message: string;
  token: string;
  user: User;
}

// ==========================================
// 2. Device Types
// ==========================================
export interface Device {
  id: string;
  name: string | null;
  deviceToken?: string;
  hasClaimCode?: boolean;
  lastSeenAt: string | null;
  isOnline: boolean;
  createdAt: string;
}

export interface BindDeviceRequest {
  id: string;
  name?: string;
  claimCode?: string;
  newClaimCode?: string;
}

export interface BindDeviceResponse {
  message: string;
  device: {
    id: string;
    name: string | null;
    deviceToken: string;
    hasClaimCode: boolean;
    createdAt: string;
  };
}

export interface RotateTokenResponse {
  message: string;
  deviceToken: string;
}

// ==========================================
// 3. Water Record & Stats Types
// ==========================================
export type WaterEventType = 'drink' | 'refill';

export interface DrinkRecord {
  id: string;
  eventId: string | null;
  userId: string;
  deviceId: string | null;
  eventType: WaterEventType;
  amountMl: number;
  remainingMl: number | null;
  occurredAt: string;
  syncedAt: string;
}

export interface UploadRecordPayload {
  eventId?: string;
  deviceId?: string;
  eventType: WaterEventType;
  amountMl: number;
  remainingMl?: number;
  occurredAt?: string;
  timeSynced?: boolean;
}

export interface DailyStats {
  date: string;
  totalMl: number;
  goalMl: number;
  drinkCount: number;
  refillCount: number;
  progressPercent: number;
}

export interface DailyBreakdownItem {
  date: string;
  totalMl: number;
  /** Older deployed API responses may omit per-day event counts. */
  drinkCount?: number;
  refillCount?: number;
}

export interface WeeklyStats {
  startDate: string;
  endDate: string;
  totalMl: number;
  dailyAverageMl: number;
  goalMl: number;
  daysMetGoal: number;
  days: DailyBreakdownItem[];
}

export interface MonthlyStats {
  startDate: string;
  endDate: string;
  totalMl: number;
  dailyAverageMl: number;
  goalMl: number;
  daysMetGoal: number;
  currentStreak: number;
  maxStreak: number;
  days: DailyBreakdownItem[];
}

// ==========================================
// 4. BLE Protocol & Hardware Types
// ==========================================
export interface BleWaterEvent {
  eventId: string;
  occurredAt: number; // Unix timestamp in seconds
  type: WaterEventType;
  amountMl: number;
  remainingMl: number;
  todayTotalMl: number;
  timeSynced: boolean;
}

export interface BleHistoryEventMetadata {
  batchId: string;
  sequence: number;
}

export interface BleHistorySyncComplete {
  batchId: string;
  count: number;
  firstEventId: string | null;
  lastEventId: string | null;
}

export interface BleSummary {
  deviceId: string;
  dailyGoalMl: number;
  todayTotalMl: number;
  currentWeight: number;
  isStable: boolean;
  timeSynced: boolean;
  claimSecret: string;
  wifiConnected: boolean;
  wifiConfigured: boolean;
  ip: string;
  rssi?: number;
  ssid?: string;
  latestEventId: string | null;
}

export type BleConnectionStatus = 'disconnected' | 'scanning' | 'connecting' | 'connected' | 'error';

export interface BleDeviceMeta {
  id: string;
  name: string;
  rssi?: number;
}

export type BleCommandAction =
  | 'tare'
  | 'reset_daily'
  | 'set_time'
  | 'rotate_claim'
  | 'configure_wifi'
  | 'clear_wifi'
  | 'ack_history';

export interface BleCommandResponse {
  action: string;
  success: boolean;
  error?: string;
  currentWeight?: number;
  claimSecret?: string;
  epoch?: number;
  ssid?: string;
  throughEventId?: string;
  remainingEventCount?: number;
}

// ==========================================
// 5. Offline Queue & Sync Types
// ==========================================
export interface QueuedRecord {
  clientQueueId: string;
  payload: UploadRecordPayload;
  queuedAt: number;
  retryCount: number;
  lastError?: string;
}

export interface SyncStatus {
  isSyncing: boolean;
  pendingCount: number;
  lastSyncAt: number | null;
  lastError: string | null;
}
