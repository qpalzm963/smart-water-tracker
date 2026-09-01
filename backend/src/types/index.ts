import { Request } from 'express';

export interface User {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  display_name: string | null;
  daily_goal_ml: number;
  created_at: string;
  updated_at: string;
}

export interface UserResponse {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
  dailyGoalMl: number;
  createdAt: string;
}

export interface Device {
  id: string;
  user_id: string;
  device_token: string;
  claim_code: string | null;
  name: string | null;
  last_seen_at: string | null;
  created_at: string;
}

export interface DeviceResponse {
  id: string;
  name: string | null;
  deviceToken?: string;
  hasClaimCode?: boolean;
  lastSeenAt: string | null;
  isOnline: boolean;
  createdAt: string;
}

export interface DrinkRecord {
  id: string;
  event_id: string | null;
  user_id: string;
  device_id: string | null;
  event_type: 'drink' | 'refill';
  amount_ml: number;
  remaining_ml: number | null;
  occurred_at: string;
  synced_at: string;
}

export interface DrinkRecordResponse {
  id: string;
  eventId: string | null;
  userId: string;
  deviceId: string | null;
  eventType: 'drink' | 'refill';
  amountMl: number;
  remainingMl: number | null;
  occurredAt: string;
  syncedAt: string;
}

export interface JwtUserPayload {
  userId: string;
  username?: string;
  email?: string;
}

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    username?: string;
    email?: string;
  };
  device?: {
    id: string;
    userId: string;
  };
}
