import {
  BleCommandResponse,
  BleConnectionStatus,
  BleHistoryEventMetadata,
  BleHistorySyncComplete,
  BleSummary,
  BleWaterEvent,
} from '../../types';
import { LiveEventListener, StatusListener, SummaryListener } from './bleService';

export class MockBleService {
  private status: BleConnectionStatus = 'disconnected';
  private summary: BleSummary = {
    deviceId: 'water_mock_c3',
    dailyGoalMl: 2000,
    todayTotalMl: 650,
    currentWeight: 380.5,
    isStable: true,
    timeSynced: true,
    claimSecret: 'a1b2c3d4e5f67890',
    wifiConnected: true,
    wifiConfigured: true,
    ip: '192.168.1.150',
    rssi: -58,
    ssid: 'Office_WiFi',
    latestEventId: 'water_mock_c3-1710000000-session1-1',
  };

  private liveEventListeners: Set<LiveEventListener> = new Set();
  private summaryListeners: Set<SummaryListener> = new Set();
  private statusListeners: Set<StatusListener> = new Set();
  private timer: any = null;
  private lastAckedEventId: string | null = null;
  private historyBatchNumber = 0;
  private historyEvents: BleWaterEvent[] = [
    {
      eventId: 'mock-hist-1',
      occurredAt: Math.floor(Date.now() / 1000) - 7200,
      type: 'drink',
      amountMl: 200,
      remainingMl: 300,
      todayTotalMl: 200,
      timeSynced: true,
    },
    {
      eventId: 'mock-hist-2',
      occurredAt: Math.floor(Date.now() / 1000) - 3600,
      type: 'drink',
      amountMl: 250,
      remainingMl: 50,
      todayTotalMl: 450,
      timeSynced: true,
    },
    {
      eventId: 'mock-hist-3',
      occurredAt: Math.floor(Date.now() / 1000) - 1800,
      type: 'refill',
      amountMl: 400,
      remainingMl: 450,
      todayTotalMl: 450,
      timeSynced: true,
    },
  ];

  public getStatus(): BleConnectionStatus {
    return this.status;
  }

  public getDeviceName(): string | null {
    return 'WaterTracker-Mock';
  }

  public getDeviceId(): string | null {
    return 'water_mock_c3';
  }

  public getCachedSummary(): BleSummary | null {
    return this.summary;
  }

  public onLiveEvent(listener: LiveEventListener): () => void {
    this.liveEventListeners.add(listener);
    return () => this.liveEventListeners.delete(listener);
  }

  public onSummary(listener: SummaryListener): () => void {
    this.summaryListeners.add(listener);
    return () => this.summaryListeners.delete(listener);
  }

  public onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private setStatus(status: BleConnectionStatus) {
    this.status = status;
    this.statusListeners.forEach((l) => l(status));
  }

  public async scanAndConnect(): Promise<void> {
    this.setStatus('scanning');
    await new Promise((r) => setTimeout(r, 600));
    this.setStatus('connecting');
    await new Promise((r) => setTimeout(r, 600));
    this.setStatus('connected');
    this.summaryListeners.forEach((l) => l(this.summary));
  }

  public async disconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.setStatus('disconnected');
  }

  public async readSummary(): Promise<BleSummary> {
    return this.summary;
  }

  public async tare(): Promise<BleCommandResponse> {
    this.summary.currentWeight = 0.0;
    this.summaryListeners.forEach((l) => l({ ...this.summary }));
    return { action: 'tare', success: true, currentWeight: 0.0 };
  }

  public async resetDaily(): Promise<BleCommandResponse> {
    this.summary.todayTotalMl = 0;
    this.summaryListeners.forEach((l) => l({ ...this.summary }));
    return { action: 'reset_daily', success: true };
  }

  public async syncDeviceTime(): Promise<BleCommandResponse> {
    this.summary.timeSynced = true;
    this.summaryListeners.forEach((l) => l({ ...this.summary }));
    return { action: 'set_time', success: true, epoch: Math.floor(Date.now() / 1000) };
  }

  public async rotateClaimSecret(): Promise<BleCommandResponse> {
    const newSecret = Math.random().toString(16).substring(2, 18).padEnd(16, '0');
    this.summary.claimSecret = newSecret;
    this.summaryListeners.forEach((l) => l({ ...this.summary }));
    return { action: 'rotate_claim', success: true, claimSecret: newSecret };
  }

  public async configureWifi(ssid: string): Promise<BleCommandResponse> {
    this.summary.wifiConfigured = true;
    this.summary.wifiConnected = true;
    this.summary.ssid = ssid;
    this.summary.ip = '192.168.1.188';
    this.summaryListeners.forEach((l) => l({ ...this.summary }));
    return { action: 'configure_wifi', success: true, ssid };
  }

  public async clearWifi(): Promise<BleCommandResponse> {
    this.summary.wifiConfigured = false;
    this.summary.wifiConnected = false;
    this.summary.ssid = undefined;
    this.summary.ip = '0.0.0.0';
    this.summaryListeners.forEach((l) => l({ ...this.summary }));
    return { action: 'clear_wifi', success: true };
  }

  public simulateDrinkEvent(amountMl: number = 250): BleWaterEvent {
    this.summary.todayTotalMl += amountMl;
    this.summary.currentWeight = Math.max(0, this.summary.currentWeight - amountMl);
    const event: BleWaterEvent = {
      eventId: `mock-drink-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      occurredAt: Math.floor(Date.now() / 1000),
      type: 'drink',
      amountMl,
      remainingMl: Math.floor(this.summary.currentWeight),
      todayTotalMl: this.summary.todayTotalMl,
      timeSynced: true,
    };
    this.summary.latestEventId = event.eventId;
    this.historyEvents.push(event);
    this.liveEventListeners.forEach((l) => l(event));
    this.summaryListeners.forEach((l) => l({ ...this.summary }));
    return event;
  }

  public simulateRefillEvent(amountMl: number = 500): BleWaterEvent {
    this.summary.currentWeight += amountMl;
    const event: BleWaterEvent = {
      eventId: `mock-refill-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      occurredAt: Math.floor(Date.now() / 1000),
      type: 'refill',
      amountMl,
      remainingMl: Math.floor(this.summary.currentWeight),
      todayTotalMl: this.summary.todayTotalMl,
      timeSynced: true,
    };
    this.summary.latestEventId = event.eventId;
    this.historyEvents.push(event);
    this.liveEventListeners.forEach((l) => l(event));
    this.summaryListeners.forEach((l) => l({ ...this.summary }));
    return event;
  }

  public async requestHistorySync(
    afterEventId: string = '',
    onEvent: (event: BleWaterEvent, metadata: BleHistoryEventMetadata) => void,
    onComplete: (metadata: BleHistorySyncComplete) => void
  ): Promise<void> {
    const cursorIndex = afterEventId
      ? this.historyEvents.findIndex((event) => event.eventId === afterEventId)
      : -1;
    const startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    const eventsToReplay = this.historyEvents.slice(startIndex);
    const batchId = `mock-batch-${++this.historyBatchNumber}`;

    for (let sequence = 0; sequence < eventsToReplay.length; sequence += 1) {
      await new Promise((r) => setTimeout(r, 50));
      onEvent(eventsToReplay[sequence], { batchId, sequence });
    }
    await new Promise((r) => setTimeout(r, 50));
    onComplete({
      batchId,
      count: eventsToReplay.length,
      firstEventId: eventsToReplay[0]?.eventId ?? null,
      lastEventId: eventsToReplay[eventsToReplay.length - 1]?.eventId ?? null,
    });
  }

  public async acknowledgeHistory(throughEventId: string): Promise<BleCommandResponse> {
    if (throughEventId === this.lastAckedEventId) {
      return {
        action: 'ack_history',
        success: true,
        throughEventId,
        remainingEventCount: this.historyEvents.length,
      };
    }

    const index = this.historyEvents.findIndex((event) => event.eventId === throughEventId);
    if (index < 0) {
      return { action: 'ack_history', success: false, error: 'unknown_event_id' };
    }

    this.historyEvents.splice(0, index + 1);
    this.lastAckedEventId = throughEventId;
    return {
      action: 'ack_history',
      success: true,
      throughEventId,
      remainingEventCount: this.historyEvents.length,
    };
  }
}

export const mockBleService = new MockBleService();
