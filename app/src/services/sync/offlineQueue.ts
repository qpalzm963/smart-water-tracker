import { QueuedRecord, UploadRecordPayload } from '../../types';

const STORAGE_KEY = 'water_offline_records_queue';

function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
    if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) {
      return (globalThis as any).localStorage;
    }
  } catch {
    // ignore
  }
  return null;
}

export class OfflineQueue {
  private queue: QueuedRecord[] = [];

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const storage = getStorage();
      if (!storage) {
        this.queue = [];
        return;
      }
      const data = storage.getItem(STORAGE_KEY);
      if (data) {
        this.queue = JSON.parse(data);
      }
    } catch {
      this.queue = [];
    }
  }

  private save(): void {
    try {
      const storage = getStorage();
      if (storage) {
        storage.setItem(STORAGE_KEY, JSON.stringify(this.queue));
      }
    } catch {
      // ignore
    }
  }

  public enqueue(payload: UploadRecordPayload): QueuedRecord {
    // Avoid duplicate eventId in queue
    if (payload.eventId) {
      const existing = this.queue.find((q) => q.payload.eventId === payload.eventId);
      if (existing) {
        return existing;
      }
    }

    const item: QueuedRecord = {
      clientQueueId: `cq_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      payload,
      queuedAt: Date.now(),
      retryCount: 0,
    };

    this.queue.push(item);
    this.save();
    return item;
  }

  public getAll(): QueuedRecord[] {
    return [...this.queue];
  }

  public getCount(): number {
    return this.queue.length;
  }

  public hasEventId(eventId: string): boolean {
    return this.queue.some((item) => item.payload.eventId === eventId);
  }

  public remove(clientQueueId: string): void {
    this.queue = this.queue.filter((q) => q.clientQueueId !== clientQueueId);
    this.save();
  }

  public updateError(clientQueueId: string, error: string): void {
    const item = this.queue.find((q) => q.clientQueueId === clientQueueId);
    if (item) {
      item.retryCount += 1;
      item.lastError = error;
      this.save();
    }
  }

  public clear(): void {
    this.queue = [];
    this.save();
  }
}

export const offlineQueue = new OfflineQueue();
