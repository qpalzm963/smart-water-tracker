import { offlineQueue } from './offlineQueue';
import { UploadRecordResponse, waterApi } from '../api/waterApi';
import { SyncStatus, UploadRecordPayload } from '../../types';

export type SyncStatusListener = (status: SyncStatus) => void;
export type RecordSyncedListener = (
  payload: UploadRecordPayload,
  response: UploadRecordResponse,
) => void;

export interface SyncEngineOptions {
  autoStart?: boolean;
  queue?: typeof offlineQueue;
  uploader?: Pick<typeof waterApi, 'uploadRecord'>;
}

export interface SyncResult {
  total: number;
  succeeded: number;
  failed: number;
  confirmedEventIds: string[];
  /** The most recent upload error, included so callers can show the real cause. */
  lastError?: string;
}

export class SyncEngine {
  private readonly queue: typeof offlineQueue;
  private readonly uploader: Pick<typeof waterApi, 'uploadRecord'>;
  private isSyncing: boolean = false;
  private lastSyncAt: number | null = null;
  private lastError: string | null = null;
  private listeners: Set<SyncStatusListener> = new Set();
  private recordSyncedListeners: Set<RecordSyncedListener> = new Set();
  private autoSyncInterval: any = null;
  private syncPromise: Promise<SyncResult> | null = null;

  constructor(options: SyncEngineOptions = {}) {
    this.queue = options.queue ?? offlineQueue;
    this.uploader = options.uploader ?? waterApi;

    if (options.autoStart !== false) {
      this.initNetworkListeners();
      this.startPeriodicSync();
    }
  }

  private initNetworkListeners(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.triggerSync().catch(() => {});
      });
    }
  }

  public onStatusChange(listener: SyncStatusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public onRecordSynced(listener: RecordSyncedListener): () => void {
    this.recordSyncedListeners.add(listener);
    return () => this.recordSyncedListeners.delete(listener);
  }

  private notify(): void {
    const status = this.getStatus();
    this.listeners.forEach((listener) => listener(status));
  }

  public getStatus(): SyncStatus {
    return {
      isSyncing: this.isSyncing,
      pendingCount: this.queue.getCount(),
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError,
    };
  }

  public startPeriodicSync(intervalMs: number = 30000): void {
    if (this.autoSyncInterval) clearInterval(this.autoSyncInterval);
    this.autoSyncInterval = setInterval(() => {
      if (this.queue.getCount() > 0 && !this.isSyncing) {
        this.triggerSync().catch(() => {});
      }
    }, intervalMs);
  }

  public stopPeriodicSync(): void {
    if (this.autoSyncInterval) {
      clearInterval(this.autoSyncInterval);
      this.autoSyncInterval = null;
    }
  }

  public triggerSync(): Promise<SyncResult> {
    // All callers share one in-flight run. This prevents a BLE event that
    // arrives during an upload from being mistaken for an already-completed
    // sync and left behind until the 30-second timer fires.
    if (this.syncPromise) return this.syncPromise;

    this.syncPromise = this.runSync();
    this.syncPromise.finally(() => {
      this.syncPromise = null;
    }).catch(() => {
      // The original promise remains rejected for the caller; this catch only
      // prevents an unhandled rejection from the cleanup branch.
    });
    return this.syncPromise;
  }

  private async runSync(): Promise<SyncResult> {
    const initialItems = this.queue.getAll();
    if (initialItems.length === 0) {
      this.notify();
      return { total: 0, succeeded: 0, failed: 0, confirmedEventIds: [] };
    }

    this.isSyncing = true;
    this.lastError = null;
    this.notify();

    let total = 0;
    let succeeded = 0;
    let failed = 0;
    const attemptedIds = new Set<string>();
    const confirmedEventIds: string[] = [];

    // Drain the queue snapshot and any records enqueued while an upload is in
    // flight. Failed items are attempted once per run and remain queued for a
    // later retry, while newly enqueued items are picked up immediately.
    while (true) {
      const items = this.queue.getAll().filter((item) => !attemptedIds.has(item.clientQueueId));
      if (items.length === 0) break;

      for (const item of items) {
        attemptedIds.add(item.clientQueueId);
        total += 1;
        try {
          const response = await this.uploader.uploadRecord(item.payload);
          this.queue.remove(item.clientQueueId);
          succeeded += 1;
          if (item.payload.eventId) confirmedEventIds.push(item.payload.eventId);
          this.recordSyncedListeners.forEach((listener) => {
            try {
              listener(item.payload, response);
            } catch {
              // UI refresh listeners must not interrupt queue processing.
            }
          });
        } catch (err: any) {
          failed += 1;
          const errorMessage = err?.message || '上傳失敗';
          this.lastError = errorMessage;
          this.queue.updateError(item.clientQueueId, errorMessage);
        }
      }
    }

    this.isSyncing = false;
    this.lastSyncAt = Date.now();
    this.notify();

    return {
      total,
      succeeded,
      failed,
      confirmedEventIds,
      ...(this.lastError ? { lastError: this.lastError } : {}),
    };
  }
}

export const syncEngine = new SyncEngine();
