import {
  BleCommandResponse,
  BleHistoryEventMetadata,
  BleHistorySyncComplete,
  BleSummary,
  BleWaterEvent,
} from '../../types';
import { HistoryCursorStore } from './historyCursorStore';
import { OfflineQueue } from './offlineQueue';
import { SyncEngine } from './syncEngine';

export interface HistorySyncDriver {
  getCachedSummary(): BleSummary | null;
  requestHistorySync(
    afterEventId: string,
    onEvent: (event: BleWaterEvent, metadata: BleHistoryEventMetadata) => void,
    onComplete: (metadata: BleHistorySyncComplete) => void,
  ): Promise<void>;
  acknowledgeHistory(throughEventId: string): Promise<BleCommandResponse>;
}

export interface HistorySyncOutcome {
  received: number;
  acknowledgedThrough: string | null;
  pending: number;
}

export interface HistorySyncCoordinatorOptions {
  driver: HistorySyncDriver;
  queue: OfflineQueue;
  engine: Pick<SyncEngine, 'triggerSync'>;
  cursors: HistoryCursorStore;
  onEvent?: (event: BleWaterEvent) => void;
}

export class HistorySyncCoordinator {
  private readonly driver: HistorySyncDriver;
  private readonly queue: OfflineQueue;
  private readonly engine: Pick<SyncEngine, 'triggerSync'>;
  private readonly cursors: HistoryCursorStore;
  private readonly onEvent?: (event: BleWaterEvent) => void;
  private inFlight: Promise<HistorySyncOutcome> | null = null;

  constructor(options: HistorySyncCoordinatorOptions) {
    this.driver = options.driver;
    this.queue = options.queue;
    this.engine = options.engine;
    this.cursors = options.cursors;
    this.onEvent = options.onEvent;
  }

  public sync(): Promise<HistorySyncOutcome> {
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.run().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async run(): Promise<HistorySyncOutcome> {
    const deviceId = this.driver.getCachedSummary()?.deviceId;
    if (!deviceId) throw new Error('無法取得穩定裝置 ID');

    const batch: Array<{ event: BleWaterEvent; metadata: BleHistoryEventMetadata }> = [];
    let completion: BleHistorySyncComplete | null = null;
    await this.driver.requestHistorySync(
      this.cursors.get(deviceId),
      (event, metadata) => {
        batch.push({ event, metadata });
      },
      (metadata) => {
        if (completion) throw new Error('歷史批次收到重複完成通知');
        completion = metadata;
      },
    );

    this.validateBatch(batch, completion);

    for (const { event } of batch) {
        this.queue.enqueue({
          eventId: event.eventId,
          deviceId,
          eventType: event.type,
          amountMl: event.amountMl,
          remainingMl: event.remainingMl,
          occurredAt: event.occurredAt > 0
            ? new Date(event.occurredAt * 1000).toISOString()
            : undefined,
          timeSynced: event.timeSynced,
        });
        this.onEvent?.(event);
    }

    const syncResult = await this.engine.triggerSync();
    const confirmedEventIds = new Set(syncResult.confirmedEventIds);

    let acknowledgedThrough: string | null = null;
    for (const { event } of batch) {
      if (!confirmedEventIds.has(event.eventId)) break;
      acknowledgedThrough = event.eventId;
    }

    if (acknowledgedThrough) {
      const response = await this.driver.acknowledgeHistory(acknowledgedThrough);
      if (!response.success) {
        throw new Error(response.error || '裝置拒絕歷史 ACK');
      }
      if (response.throughEventId !== acknowledgedThrough) {
        throw new Error(
          `裝置 ACK 游標不相符：預期 ${acknowledgedThrough}，收到 ${response.throughEventId || '空值'}`,
        );
      }
      this.cursors.set(deviceId, acknowledgedThrough);
    }

    // A failed upload must be visible to the caller. Without this guard the
    // UI reports "sync complete" while the event remains on the device and
    // no ACK is sent, causing the same event to replay forever.
    if (syncResult.failed > 0) {
      const detail = syncResult.lastError ? `：${syncResult.lastError}` : '';
      throw new Error(
        `雲端上傳未完成${detail}。事件仍保留在裝置上，請確認裝置已綁定目前帳號後重試`,
      );
    }

    return {
      received: batch.length,
      acknowledgedThrough,
      pending: this.queue.getCount(),
    };
  }

  private validateBatch(
    batch: Array<{ event: BleWaterEvent; metadata: BleHistoryEventMetadata }>,
    completion: BleHistorySyncComplete | null,
  ): asserts completion is BleHistorySyncComplete {
    if (!completion) throw new Error('歷史批次缺少完成通知');
    if (batch.length !== completion.count) {
      throw new Error(`歷史批次缺漏：預期 ${completion.count} 筆，收到 ${batch.length} 筆`);
    }
    for (let index = 0; index < batch.length; index += 1) {
      const item = batch[index];
      if (item.metadata.batchId !== completion.batchId) {
        throw new Error('歷史批次 ID 不相符');
      }
      if (item.metadata.sequence !== index) {
        throw new Error(`歷史批次序號不連續：預期 ${index}，收到 ${item.metadata.sequence}`);
      }
    }
    const firstEventId = batch[0]?.event.eventId ?? null;
    const lastEventId = batch[batch.length - 1]?.event.eventId ?? null;
    if (firstEventId !== completion.firstEventId) {
      throw new Error('歷史批次第一筆事件 ID 不相符');
    }
    if (lastEventId !== completion.lastEventId) {
      throw new Error('歷史批次最後一筆事件 ID 不相符');
    }
  }
}

export async function connectWithAutomaticHistorySync(
  connect: () => Promise<void>,
  sync: () => Promise<HistorySyncOutcome>,
  onSyncError: (error: unknown) => void,
): Promise<void> {
  await connect();
  try {
    await sync();
  } catch (error) {
    onSyncError(error);
  }
}
