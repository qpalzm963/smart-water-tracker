import {
  BleCommandResponse,
  BleHistorySyncComplete,
  BleSummary,
  BleWaterEvent,
} from '../../types';

export const BLE_UUIDS = {
  SERVICE: '7d5a0001-2d5c-4d2f-9f85-7d7bf8a9a101',
  LIVE_EVENT: '7d5a0002-2d5c-4d2f-9f85-7d7bf8a9a101',
  SUMMARY: '7d5a0003-2d5c-4d2f-9f85-7d7bf8a9a101',
  HISTORY_SYNC: '7d5a0004-2d5c-4d2f-9f85-7d7bf8a9a101',
  COMMAND: '7d5a0005-2d5c-4d2f-9f85-7d7bf8a9a101',
} as const;

export const BLE_DEVICE_NAME_PREFIX = 'WaterTracker-';

export function parseBleSummary(rawJson: string): BleSummary {
  try {
    const data = JSON.parse(rawJson);
    return {
      deviceId: data.deviceId || '',
      dailyGoalMl: Number(data.dailyGoalMl) || 2000,
      todayTotalMl: Number(data.todayTotalMl) || 0,
      currentWeight: Number(data.currentWeight) || 0,
      isStable: Boolean(data.isStable),
      timeSynced: Boolean(data.timeSynced),
      claimSecret: data.claimSecret || '',
      wifiConnected: Boolean(data.wifiConnected),
      wifiConfigured: Boolean(data.wifiConfigured),
      ip: data.ip || '0.0.0.0',
      rssi: data.rssi !== undefined ? Number(data.rssi) : undefined,
      ssid: data.ssid || undefined,
      latestEventId: data.latestEventId || null,
    };
  } catch (err: any) {
    throw new Error(`解析 BLE Summary 失敗: ${err.message}`);
  }
}

export function parseBleWaterEvent(rawJson: string): BleWaterEvent {
  try {
    const data = JSON.parse(rawJson);
    return {
      eventId: data.eventId || '',
      occurredAt: Number(data.occurredAt) || 0,
      type: data.type === 'refill' ? 'refill' : 'drink',
      amountMl: Number(data.amountMl) || 0,
      remainingMl: Number(data.remainingMl) || 0,
      todayTotalMl: Number(data.todayTotalMl) || 0,
      timeSynced: Boolean(data.timeSynced),
    };
  } catch (err: any) {
    throw new Error(`解析 BLE Water Event 失敗: ${err.message}`);
  }
}

export type HistorySyncMessage =
  | {
    isComplete: false;
    batchId: string;
    sequence: number;
    event: BleWaterEvent;
  }
  | ({ isComplete: true } & BleHistorySyncComplete);

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${field} 必須是非空字串`);
  }
  return value;
}

function requireNonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(`${field} 必須是非負整數`);
  }
  return Number(value);
}

function parseBoundaryEventId(value: unknown, field: string): string | null {
  if (value === null) return null;
  return requireNonEmptyString(value, field);
}

export function parseBleHistorySync(rawJson: string): HistorySyncMessage {
  try {
    const data = JSON.parse(rawJson);
    if (data.syncComplete === true) {
      const count = requireNonNegativeInteger(data.count, 'count');
      const firstEventId = parseBoundaryEventId(data.firstEventId, 'firstEventId');
      const lastEventId = parseBoundaryEventId(data.lastEventId, 'lastEventId');
      if (count === 0 && (firstEventId !== null || lastEventId !== null)) {
        throw new Error('空批次的首尾事件 ID 必須為 null');
      }
      if (count > 0 && (firstEventId === null || lastEventId === null)) {
        throw new Error('非空批次必須包含首尾事件 ID');
      }
      return {
        isComplete: true,
        batchId: requireNonEmptyString(data.batchId, 'batchId'),
        count,
        firstEventId,
        lastEventId,
      };
    }
    const event = parseBleWaterEvent(rawJson);
    if (!event.eventId) throw new Error('eventId 必須是非空字串');
    return {
      isComplete: false,
      batchId: requireNonEmptyString(data.batchId, 'batchId'),
      sequence: requireNonNegativeInteger(data.sequence, 'sequence'),
      event,
    };
  } catch (err: any) {
    throw new Error(`解析 BLE History Sync 訊息失敗: ${err.message}`);
  }
}

export function parseBleCommandResponse(rawJson: string): BleCommandResponse {
  try {
    // Some BLE stacks pad characteristic values with NUL bytes. Ignore that
    // transport padding before parsing the JSON payload.
    const data = JSON.parse(rawJson.replace(/\0/g, '').trim());
    return {
      action: data.action || '',
      success: Boolean(data.success),
      error: data.error,
      currentWeight: data.currentWeight !== undefined ? Number(data.currentWeight) : undefined,
      claimSecret: data.claimSecret,
      epoch: data.epoch !== undefined ? Number(data.epoch) : undefined,
      ssid: data.ssid,
      throughEventId: data.throughEventId,
      remainingEventCount: data.remainingEventCount !== undefined
        ? Number(data.remainingEventCount)
        : undefined,
    };
  } catch (err: any) {
    throw new Error(`解析 BLE Command Response 失敗: ${err.message}`);
  }
}

/**
 * A write to the command characteristic is also visible as the characteristic
 * value until the firmware finishes processing it.  Only accept a payload as
 * a response when it contains the expected action and an explicit boolean
 * success field; otherwise the caller may mistake the original request for a
 * failed command.
 */
export function isBleCommandResponseForAction(rawJson: string, expectedAction: string): boolean {
  try {
    const data = JSON.parse(rawJson.replace(/\0/g, '').trim());
    return (
      data !== null &&
      typeof data === 'object' &&
      data.action === expectedAction &&
      typeof data.success === 'boolean'
    );
  } catch {
    return false;
  }
}

export function isWebBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}
