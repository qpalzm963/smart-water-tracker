/**
 * MongoDB Collections and Document Definitions for Smart Water Tracker
 */

export const MONGO_COLLECTIONS = {
  USERS: 'users',
  DEVICES: 'devices',
  DRINK_RECORDS: 'drink_records',
  DELETED_WATER_EVENTS: 'deleted_water_events',
  RATE_LIMITS: 'rate_limits',
} as const;

export type MongoCollectionName =
  (typeof MONGO_COLLECTIONS)[keyof typeof MONGO_COLLECTIONS];

export interface MongoUserDoc {
  _id: string; // userId (UUID)
  username: string;
  email: string;
  passwordHash: string;
  displayName: string | null;
  dailyGoalMl: number;
  createdAt: string;
  updatedAt: string;
  isDeleting?: boolean;
}

export interface MongoDeviceDoc {
  _id: string; // deviceId (Hardware/App identifier)
  userId: string;
  deviceToken: string;
  claimCode: string | null;
  name: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  isDeleting?: boolean;
}

export interface MongoDrinkRecordDoc {
  _id: string; // recordId (UUID)
  eventId: string | null;
  userId: string;
  deviceId: string | null;
  eventType: 'drink' | 'refill';
  amountMl: number;
  remainingMl: number | null;
  occurredAt: string;
  timeSynced: boolean;
  syncedAt: string;
}

export interface MongoDeletedWaterEventDoc {
  _id: string; // `${userId}:${eventId}` composite primary key
  userId: string;
  eventId: string;
  deletedAt: string;
}

export interface MongoRateLimitDoc {
  _id: string; // `${prefix}:${clientIp}`
  totalHits: number;
  resetTime: Date;
  expiresAt: Date; // TTL index target
}
