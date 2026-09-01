import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OfflineQueue } from '../src/services/sync/offlineQueue';
import { HistoryCursorStore } from '../src/services/sync/historyCursorStore';
import { SyncEngine } from '../src/services/sync/syncEngine';
import { apiClient } from '../src/services/api/apiClient';
import { waterApi } from '../src/services/api/waterApi';
import { UploadRecordPayload } from '../src/types';

// Mock localStorage for Node environment
class LocalStorageMock {
  private store: Record<string, string> = {};

  getItem(key: string): string | null {
    return this.store[key] || null;
  }

  setItem(key: string, value: string): void {
    this.store[key] = value;
  }

  removeItem(key: string): void {
    delete this.store[key];
  }

  clear(): void {
    this.store = {};
  }
}

(global as any).localStorage = new LocalStorageMock();

describe('OfflineQueue', () => {
  let queue: OfflineQueue;

  beforeEach(() => {
    (global as any).localStorage.clear();
    queue = new OfflineQueue();
  });

  it('should enqueue and retrieve items', () => {
    expect(queue.getCount()).toBe(0);

    const item = queue.enqueue({
      eventId: 'evt_1',
      eventType: 'drink',
      amountMl: 250,
    });

    expect(queue.getCount()).toBe(1);
    expect(item.payload.eventId).toBe('evt_1');
    expect(item.payload.amountMl).toBe(250);

    const all = queue.getAll();
    expect(all.length).toBe(1);
    expect(all[0].clientQueueId).toBe(item.clientQueueId);
  });

  it('should deduplicate when enqueuing the same eventId', () => {
    const item1 = queue.enqueue({
      eventId: 'evt_dup',
      eventType: 'drink',
      amountMl: 300,
    });

    const item2 = queue.enqueue({
      eventId: 'evt_dup',
      eventType: 'drink',
      amountMl: 300,
    });

    expect(queue.getCount()).toBe(1);
    expect(item1.clientQueueId).toBe(item2.clientQueueId);
  });

  it('should remove items by clientQueueId', () => {
    const item1 = queue.enqueue({ eventId: 'evt_1', eventType: 'drink', amountMl: 200 });
    const item2 = queue.enqueue({ eventId: 'evt_2', eventType: 'refill', amountMl: 500 });

    expect(queue.getCount()).toBe(2);

    queue.remove(item1.clientQueueId);
    expect(queue.getCount()).toBe(1);

    const remaining = queue.getAll();
    expect(remaining[0].clientQueueId).toBe(item2.clientQueueId);
  });

  it('should update retryCount and error message', () => {
    const item = queue.enqueue({ eventId: 'evt_fail', eventType: 'drink', amountMl: 150 });

    queue.updateError(item.clientQueueId, 'Network Timeout');
    const updated = queue.getAll()[0];
    expect(updated.retryCount).toBe(1);
    expect(updated.lastError).toBe('Network Timeout');
  });

  it('should clear all items in queue', () => {
    queue.enqueue({ eventId: 'evt_1', eventType: 'drink', amountMl: 200 });
    queue.enqueue({ eventId: 'evt_2', eventType: 'drink', amountMl: 300 });
    expect(queue.getCount()).toBe(2);

    queue.clear();
    expect(queue.getCount()).toBe(0);
    expect(queue.getAll()).toEqual([]);
  });

  it('finds pending records by eventId', () => {
    queue.enqueue({ eventId: 'evt_pending', eventType: 'drink', amountMl: 200 });

    expect(queue.hasEventId('evt_pending')).toBe(true);
    expect(queue.hasEventId('evt_missing')).toBe(false);
  });

  it('stores ACK cursors independently per device', () => {
    const cursors = new HistoryCursorStore();

    cursors.set('water_a', 'evt_a2');
    cursors.set('water_b', 'evt_b4');

    expect(cursors.get('water_a')).toBe('evt_a2');
    expect(cursors.get('water_b')).toBe('evt_b4');
    expect(cursors.get('water_c')).toBe('');
    expect(new HistoryCursorStore().get('water_a')).toBe('evt_a2');
  });
});

describe('SyncEngine', () => {
  it('maps the app eventType field to the backend type field', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ message: 'ok' });

    await waterApi.uploadRecord({ eventType: 'refill', amountMl: 500 });

    expect(post).toHaveBeenCalledWith(
      '/water/records',
      { amountMl: 500, type: 'refill' },
      undefined,
    );
    post.mockRestore();
  });

  it('drains records queued while an upload is already in flight', async () => {
    const queue = new OfflineQueue();
    queue.clear();

    let releaseFirstUpload: (() => void) | undefined;
    const firstUpload = new Promise<void>((resolve) => {
      releaseFirstUpload = resolve;
    });
    const uploaded: UploadRecordPayload[] = [];
    const uploader = {
      uploadRecord: vi.fn(async (payload: UploadRecordPayload) => {
        uploaded.push(payload);
        if (uploaded.length === 1) await firstUpload;
        return { message: 'ok' };
      }),
    };
    const engine = new SyncEngine({ autoStart: false, queue, uploader });
    const recordSynced = vi.fn();
    engine.onRecordSynced(recordSynced);

    queue.enqueue({ eventId: 'evt_1', eventType: 'drink', amountMl: 200 });
    const firstSync = engine.triggerSync();
    await vi.waitFor(() => expect(uploaded).toHaveLength(1));

    queue.enqueue({ eventId: 'evt_2', eventType: 'drink', amountMl: 300 });
    const secondSync = engine.triggerSync();
    expect(secondSync).toBe(firstSync);

    releaseFirstUpload?.();
    const result = await firstSync;

    expect(result).toEqual({
      total: 2,
      succeeded: 2,
      failed: 0,
      confirmedEventIds: ['evt_1', 'evt_2'],
    });
    expect(uploaded.map((payload) => payload.eventId)).toEqual(['evt_1', 'evt_2']);
    expect(recordSynced).toHaveBeenCalledTimes(2);
    expect(queue.getCount()).toBe(0);
  });

  it('returns only event IDs explicitly confirmed by this sync run', async () => {
    const queue = new OfflineQueue();
    queue.clear();
    queue.enqueue({ eventId: 'evt_ok', eventType: 'drink', amountMl: 100 });
    queue.enqueue({ eventId: 'evt_duplicate', eventType: 'drink', amountMl: 100 });
    queue.enqueue({ eventId: 'evt_deleted', eventType: 'drink', amountMl: 100 });
    queue.enqueue({ eventId: 'evt_failed', eventType: 'drink', amountMl: 100 });

    const uploader = {
      uploadRecord: vi.fn(async (payload: UploadRecordPayload) => {
        if (payload.eventId === 'evt_failed') throw new Error('offline');
        if (payload.eventId === 'evt_duplicate') return { message: 'duplicate', duplicated: true };
        if (payload.eventId === 'evt_deleted') return { message: 'deleted', deleted: true };
        return { message: 'ok' };
      }),
    };
    const engine = new SyncEngine({ autoStart: false, queue, uploader });

    await expect(engine.triggerSync()).resolves.toEqual({
      total: 4,
      succeeded: 3,
      failed: 1,
      confirmedEventIds: ['evt_ok', 'evt_duplicate', 'evt_deleted'],
      lastError: 'offline',
    });
    expect(queue.hasEventId('evt_failed')).toBe(true);
  });
});
