import { User, Device, DrinkRecord } from '../types';

export interface CreateUserInput {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  displayName?: string | null;
  dailyGoalMl?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface UpdateUserProfileInput {
  displayName?: string | null;
  dailyGoalMl?: number;
  updatedAt?: string;
}

export interface IUserRepository {
  create(input: CreateUserInput): Promise<User>;
  findById(id: string): Promise<User | null>;
  findByUsernameOrEmail(identifier: string): Promise<User | null>;
  updateProfile(id: string, input: UpdateUserProfileInput): Promise<User | null>;
  deleteById(id: string): Promise<boolean>;
}

export interface CreateDeviceInput {
  id: string;
  userId: string;
  deviceToken: string;
  claimCode?: string | null;
  name?: string | null;
  createdAt?: string;
}

export interface ClaimDeviceInput {
  userId: string;
  deviceToken: string;
  claimCode: string;
  name?: string | null;
  createdAt?: string;
  expectedOwnerId?: string;
  expectedClaimCode?: string;
}

export interface IDeviceRepository {
  create(input: CreateDeviceInput): Promise<Device>;
  findById(id: string): Promise<Device | null>;
  findByToken(deviceToken: string): Promise<Device | null>;
  findByUserId(userId: string): Promise<Device[]>;
  claimDevice(id: string, input: ClaimDeviceInput): Promise<boolean>;
  rotateToken(id: string, userId: string, newDeviceToken: string): Promise<boolean>;
  updateLastSeen(id: string, userId: string, lastSeenAt: string): Promise<void>;
  deleteById(id: string, userId: string): Promise<boolean>;
}

export interface CreateWaterRecordInput {
  id: string;
  eventId?: string | null;
  userId: string;
  deviceId?: string | null;
  eventType: 'drink' | 'refill';
  amountMl: number;
  remainingMl?: number | null;
  occurredAt: string;
  timeSynced: boolean;
  syncedAt?: string;
}

export interface QueryWaterRecordsInput {
  userId: string;
  fromDate?: string;
  toDate?: string;
  eventType?: 'drink' | 'refill';
  deviceId?: string;
  page: number;
  limit: number;
}

export interface IWaterRecordRepository {
  create(input: CreateWaterRecordInput): Promise<{ record: DrinkRecord; isDuplicate: boolean }>;
  findById(id: string, userId: string): Promise<DrinkRecord | null>;
  findByUserAndEventId(userId: string, eventId: string): Promise<DrinkRecord | null>;
  list(input: QueryWaterRecordsInput): Promise<{ records: DrinkRecord[]; total: number }>;
  deleteById(id: string, userId: string): Promise<boolean>;
  getRecordsInRange(
    userId: string,
    startIso: string,
    endIso: string
  ): Promise<Array<{ event_type: 'drink' | 'refill'; amount_ml: number; occurred_at: string }>>;
  getDailyRecords(
    userId: string,
    startIso: string,
    endIso: string
  ): Promise<Array<{ event_type: 'drink' | 'refill'; amount_ml: number }>>;
}

export interface IDeletedWaterEventRepository {
  isEventDeleted(userId: string, eventId: string): Promise<boolean>;
  recordDeletedEvent(userId: string, eventId: string, deletedAt?: string): Promise<void>;
  deleteByUserId(userId: string): Promise<void>;
}
