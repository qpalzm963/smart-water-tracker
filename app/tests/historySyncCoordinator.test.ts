import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  connectWithAutomaticHistorySync,
  HistorySyncCoordinator,
  HistorySyncDriver,
  HistorySyncOutcome,
} from '../src/services/sync/historySyncCoordinator';
import { HistoryCursorStore } from '../src/services/sync/historyCursorStore';
import { OfflineQueue } from '../src/services/sync/offlineQueue';
import { SyncEngine } from '../src/services/sync/syncEngine';
import {
  BleHistoryEventMetadata,
  BleHistorySyncComplete,
  BleWaterEvent,
  UploadRecordPayload,
} from '../src/types';

class LocalStorageMock {
  private store: Record<string, string> = {};

  public getItem(key: string): string | null {
    return this.store[key] ?? null;
  }

  public setItem(key: string, value: string): void {
    this.store[key] = value;
  }

  public removeItem(key: string): void {
    delete this.store[key];
  }

  public clear(): void {
    this.store = {};
  }
}

(global as any).localStorage = new LocalStorageMock();

const events: BleWaterEvent[] = [
  {
    eventId: 'evt-1',
    occurredAt: 1_721_389_200,
    type: 'drink',
    amountMl: 100,
    remainingMl: 500,
    todayTotalMl: 100,
    timeSynced: true,
  },
  {
    eventId: 'evt-2',
    occurredAt: 1_721_389_201,
    type: 'drink',
    amountMl: 120,
    remainingMl: 380,
    todayTotalMl: 220,
    timeSynced: true,
  },
  {
    eventId: 'evt-3',
    occurredAt: 1_721_389_202,
    type: 'refill',
    amountMl: 140,
    remainingMl: 520,
    todayTotalMl: 220,
    timeSynced: true,
  },
];

const batchId = 'batch-test-1';
const completion: BleHistorySyncComplete = {
  batchId,
  count: events.length,
  firstEventId: events[0].eventId,
  lastEventId: events[events.length - 1].eventId,
};

interface Harness {
  coordinator: HistorySyncCoordinator;
  driver: HistorySyncDriver & {
    requestHistorySync: ReturnType<typeof vi.fn>;
    acknowledgeHistory: ReturnType<typeof vi.fn>;
  };
  queue: OfflineQueue;
  cursors: HistoryCursorStore;
  uploader: { uploadRecord: ReturnType<typeof vi.fn> };
  onEvent: ReturnType<typeof vi.fn>;
}

function createHarness(): Harness {
  const queue = new OfflineQueue();
  const cursors = new HistoryCursorStore();
  const uploader = {
    uploadRecord: vi.fn(async (_payload: UploadRecordPayload) => ({ message: 'ok' })),
  };
  const engine = new SyncEngine({ autoStart: false, queue, uploader });
  const driver = {
    getCachedSummary: () => ({
      deviceId: 'water_test',
      dailyGoalMl: 2000,
      todayTotalMl: 0,
      currentWeight: 500,
      isStable: true,
      timeSynced: true,
      claimSecret: 'secret',
      wifiConnected: false,
      wifiConfigured: false,
      ip: '0.0.0.0',
      latestEventId: 'evt-3',
    }),
    requestHistorySync: vi.fn(async (
      _afterEventId: string,
      onHistoryEvent: (event: BleWaterEvent, metadata: BleHistoryEventMetadata) => void,
      onComplete: (metadata: BleHistorySyncComplete) => void,
    ) => {
      events.forEach((event, sequence) => onHistoryEvent(event, { batchId, sequence }));
      onComplete(completion);
    }),
    acknowledgeHistory: vi.fn(async (throughEventId: string) => ({
      action: 'ack_history',
      success: true,
      throughEventId,
    })),
  };
  const onEvent = vi.fn();
  const coordinator = new HistorySyncCoordinator({ driver, queue, engine, cursors, onEvent });

  return { coordinator, driver, queue, cursors, uploader, onEvent };
}

describe('HistorySyncCoordinator', () => {
  beforeEach(() => {
    (global as any).localStorage.clear();
  });

  it('enqueues every event, waits for uploads, and ACKs the last successful event', async () => {
    const { coordinator, driver, queue, cursors, uploader, onEvent } = createHarness();

    const result = await coordinator.sync();

    expect(uploader.uploadRecord).toHaveBeenCalledTimes(3);
    expect(uploader.uploadRecord.mock.calls.map(([payload]) => payload.eventId)).toEqual([
      'evt-1',
      'evt-2',
      'evt-3',
    ]);
    expect(uploader.uploadRecord.mock.calls[0][0]).toMatchObject({
      deviceId: 'water_test',
      occurredAt: new Date(events[0].occurredAt * 1000).toISOString(),
    });
    expect(onEvent).toHaveBeenCalledTimes(3);
    expect(driver.acknowledgeHistory).toHaveBeenCalledWith('evt-3');
    expect(cursors.get('water_test')).toBe('evt-3');
    expect(queue.getCount()).toBe(0);
    expect(result).toEqual({ received: 3, acknowledgedThrough: 'evt-3', pending: 0 });
  });

  it('starts from the persisted cursor for the stable device ID', async () => {
    const { coordinator, driver, cursors } = createHarness();
    cursors.set('water_test', 'evt-before');

    await coordinator.sync();

    expect(driver.requestHistorySync).toHaveBeenCalledWith(
      'evt-before',
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('ACKs only the contiguous prefix before a failed event', async () => {
    const { coordinator, driver, queue, uploader } = createHarness();
    uploader.uploadRecord.mockImplementation(async (payload: UploadRecordPayload) => {
      if (payload.eventId === 'evt-2') throw new Error('offline');
      return { message: 'ok' };
    });

    await expect(coordinator.sync()).rejects.toThrow(
      '雲端上傳未完成：offline。事件仍保留在裝置上，請確認裝置已綁定目前帳號後重試',
    );

    expect(driver.acknowledgeHistory).toHaveBeenCalledWith('evt-1');
    expect(queue.hasEventId('evt-2')).toBe(true);
    expect(queue.hasEventId('evt-3')).toBe(false);
  });

  it('does not ACK when the first event fails', async () => {
    const { coordinator, driver, queue, uploader } = createHarness();
    uploader.uploadRecord.mockImplementation(async (payload: UploadRecordPayload) => {
      if (payload.eventId === 'evt-1') throw new Error('offline');
      return { message: 'ok' };
    });

    await expect(coordinator.sync()).rejects.toThrow(
      '雲端上傳未完成：offline。事件仍保留在裝置上，請確認裝置已綁定目前帳號後重試',
    );

    expect(driver.acknowledgeHistory).not.toHaveBeenCalled();
    expect(queue.hasEventId('evt-1')).toBe(true);
    expect(queue.hasEventId('evt-2')).toBe(false);
    expect(queue.hasEventId('evt-3')).toBe(false);
  });

  it('does not advance the cursor when device ACK fails', async () => {
    const { coordinator, driver, cursors } = createHarness();
    driver.acknowledgeHistory.mockResolvedValue({
      action: 'ack_history',
      success: false,
      error: 'unknown_event_id',
    });

    await expect(coordinator.sync()).rejects.toThrow('unknown_event_id');
    expect(cursors.get('water_test')).toBe('');
  });

  it('does not advance the cursor when ACK returns a different cursor', async () => {
    const { coordinator, driver, cursors } = createHarness();
    driver.acknowledgeHistory.mockResolvedValue({
      action: 'ack_history',
      success: true,
      throughEventId: 'evt-wrong',
    });

    await expect(coordinator.sync()).rejects.toThrow('ACK 游標不相符');
    expect(cursors.get('water_test')).toBe('');
  });

  it('does not ACK an empty history batch', async () => {
    const { coordinator, driver } = createHarness();
    driver.requestHistorySync.mockImplementation(async (
      _afterEventId: string,
      _onHistoryEvent: (event: BleWaterEvent, metadata: BleHistoryEventMetadata) => void,
      onComplete: (metadata: BleHistorySyncComplete) => void,
    ) => onComplete({
      batchId: 'batch-empty',
      count: 0,
      firstEventId: null,
      lastEventId: null,
    }));

    const result = await coordinator.sync();

    expect(driver.acknowledgeHistory).not.toHaveBeenCalled();
    expect(result).toEqual({ received: 0, acknowledgedThrough: null, pending: 0 });
  });

  it('does not enqueue or ACK an incomplete history batch', async () => {
    const { coordinator, driver, queue, uploader } = createHarness();
    driver.requestHistorySync.mockImplementation(async (
      _afterEventId: string,
      onHistoryEvent: (event: BleWaterEvent, metadata: BleHistoryEventMetadata) => void,
      onComplete: (metadata: BleHistorySyncComplete) => void,
    ) => {
      onHistoryEvent(events[0], { batchId, sequence: 0 });
      onHistoryEvent(events[2], { batchId, sequence: 2 });
      onComplete(completion);
    });

    await expect(coordinator.sync()).rejects.toThrow('歷史批次缺漏');
    expect(uploader.uploadRecord).not.toHaveBeenCalled();
    expect(driver.acknowledgeHistory).not.toHaveBeenCalled();
    expect(queue.getCount()).toBe(0);
  });

  it('does not treat queue clearing as upload confirmation', async () => {
    const { coordinator, driver, queue, uploader } = createHarness();
    let uploadCount = 0;
    uploader.uploadRecord.mockImplementation(async (payload: UploadRecordPayload) => {
      uploadCount += 1;
      if (uploadCount === 1) {
        queue.clear();
        return { message: 'ok' };
      }
      if (payload.eventId === 'evt-2') throw new Error('offline');
      return { message: 'ok' };
    });

    await expect(coordinator.sync()).rejects.toThrow(
      '雲端上傳未完成：offline。事件仍保留在裝置上，請確認裝置已綁定目前帳號後重試',
    );

    expect(driver.acknowledgeHistory).toHaveBeenCalledWith('evt-1');
  });

  it('requires a stable device ID before requesting history', async () => {
    const { coordinator, driver } = createHarness();
    driver.getCachedSummary = () => null;

    await expect(coordinator.sync()).rejects.toThrow('無法取得穩定裝置 ID');
    expect(driver.requestHistorySync).not.toHaveBeenCalled();
  });

  it('shares one in-flight Promise between simultaneous sync calls', async () => {
    const { coordinator, driver } = createHarness();
    let releaseHistory: (() => void) | undefined;
    const historyPending = new Promise<void>((resolve) => {
      releaseHistory = resolve;
    });
    driver.requestHistorySync.mockImplementation(async (
      _afterEventId: string,
      onHistoryEvent: (event: BleWaterEvent, metadata: BleHistoryEventMetadata) => void,
      onComplete: (metadata: BleHistorySyncComplete) => void,
    ) => {
      await historyPending;
      events.forEach((event, sequence) => onHistoryEvent(event, { batchId, sequence }));
      onComplete(completion);
    });

    const first = coordinator.sync();
    const second = coordinator.sync();

    expect(second).toBe(first);
    expect(driver.requestHistorySync).toHaveBeenCalledTimes(1);
    releaseHistory?.();
    await first;
  });
});

describe('connectWithAutomaticHistorySync', () => {
  const outcome: HistorySyncOutcome = {
    received: 0,
    acknowledgedThrough: null,
    pending: 0,
  };

  it('propagates connection failures and does not start history sync', async () => {
    const connectionError = new Error('connect failed');
    const connect = vi.fn().mockRejectedValue(connectionError);
    const sync = vi.fn().mockResolvedValue(outcome);
    const onSyncError = vi.fn();

    await expect(connectWithAutomaticHistorySync(connect, sync, onSyncError)).rejects.toBe(
      connectionError,
    );
    expect(sync).not.toHaveBeenCalled();
    expect(onSyncError).not.toHaveBeenCalled();
  });

  it('reports sync failures without rejecting the successful connection', async () => {
    const syncError = new Error('sync failed');
    const connect = vi.fn().mockResolvedValue(undefined);
    const sync = vi.fn().mockRejectedValue(syncError);
    const onSyncError = vi.fn();

    await expect(connectWithAutomaticHistorySync(connect, sync, onSyncError)).resolves.toBeUndefined();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(onSyncError).toHaveBeenCalledWith(syncError);
  });
});
