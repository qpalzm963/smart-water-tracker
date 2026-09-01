import { describe, expect, it, vi } from 'vitest';
import {
  BLE_DEVICE_NAME_PREFIX,
  BLE_UUIDS,
  isBleCommandResponseForAction,
  parseBleCommandResponse,
  parseBleHistorySync,
  parseBleSummary,
  parseBleWaterEvent,
} from '../src/services/ble/bleProtocol';
import { BleService } from '../src/services/ble/bleService';
import { MockBleService } from '../src/services/ble/mockBleService';

const encoder = new TextEncoder();
const dataView = (value: string) => new DataView(encoder.encode(value).buffer);

function createHistoryCharacteristic() {
  const listeners = new Set<EventListener>();
  const characteristic = {
    startNotifications: vi.fn().mockResolvedValue(undefined),
    writeValue: vi.fn().mockResolvedValue(undefined),
    addEventListener: vi.fn((_type: string, listener: EventListener) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_type: string, listener: EventListener) => {
      listeners.delete(listener);
    }),
    emit(value: string) {
      const event = { target: { value: dataView(value) } } as unknown as Event;
      [...listeners].forEach((listener) => listener(event));
    },
    listenerCount() {
      return listeners.size;
    },
  };
  return characteristic;
}

describe('BLE Protocol & Payload Parsers', () => {
  it('should have standard UUIDs matching firmware', () => {
    expect(BLE_UUIDS.SERVICE).toBe('7d5a0001-2d5c-4d2f-9f85-7d7bf8a9a101');
    expect(BLE_UUIDS.LIVE_EVENT).toBe('7d5a0002-2d5c-4d2f-9f85-7d7bf8a9a101');
    expect(BLE_UUIDS.SUMMARY).toBe('7d5a0003-2d5c-4d2f-9f85-7d7bf8a9a101');
    expect(BLE_UUIDS.HISTORY_SYNC).toBe('7d5a0004-2d5c-4d2f-9f85-7d7bf8a9a101');
    expect(BLE_UUIDS.COMMAND).toBe('7d5a0005-2d5c-4d2f-9f85-7d7bf8a9a101');
    expect(BLE_DEVICE_NAME_PREFIX).toBe('WaterTracker-');
  });

  it('should parse ESP32 BleSummary JSON correctly', () => {
    const rawJson = JSON.stringify({
      deviceId: 'water_esp32_c3',
      dailyGoalMl: 2500,
      todayTotalMl: 850,
      currentWeight: 420.5,
      isStable: true,
      timeSynced: true,
      claimSecret: 'abcdef0123456789',
      wifiConnected: true,
      wifiConfigured: true,
      ip: '192.168.1.120',
      rssi: -62,
      ssid: 'MyHomeWiFi',
      latestEventId: 'water_esp32_c3-1710000-sess-1',
    });

    const summary = parseBleSummary(rawJson);
    expect(summary.deviceId).toBe('water_esp32_c3');
    expect(summary.dailyGoalMl).toBe(2500);
    expect(summary.todayTotalMl).toBe(850);
    expect(summary.currentWeight).toBe(420.5);
    expect(summary.isStable).toBe(true);
    expect(summary.timeSynced).toBe(true);
    expect(summary.claimSecret).toBe('abcdef0123456789');
    expect(summary.wifiConnected).toBe(true);
    expect(summary.ip).toBe('192.168.1.120');
    expect(summary.ssid).toBe('MyHomeWiFi');
  });

  it('should parse ESP32 BleWaterEvent JSON correctly', () => {
    const rawJson = JSON.stringify({
      eventId: 'water_esp32_c3-1710000-sess-1',
      occurredAt: 1710000000,
      type: 'drink',
      amountMl: 300,
      remainingMl: 200,
      todayTotalMl: 300,
      timeSynced: true,
    });

    const event = parseBleWaterEvent(rawJson);
    expect(event.eventId).toBe('water_esp32_c3-1710000-sess-1');
    expect(event.occurredAt).toBe(1710000000);
    expect(event.type).toBe('drink');
    expect(event.amountMl).toBe(300);
    expect(event.remainingMl).toBe(200);
    expect(event.todayTotalMl).toBe(300);
    expect(event.timeSynced).toBe(true);
  });

  it('should parse HistorySync complete and event notifications', () => {
    const completeJson = JSON.stringify({
      syncComplete: true,
      batchId: 'batch-1',
      count: 1,
      firstEventId: 'hist-1',
      lastEventId: 'hist-1',
    });
    const msg1 = parseBleHistorySync(completeJson);
    expect(msg1.isComplete).toBe(true);
    expect(msg1).toMatchObject({ batchId: 'batch-1', count: 1 });

    const eventJson = JSON.stringify({
      batchId: 'batch-1',
      sequence: 0,
      eventId: 'hist-1',
      occurredAt: 1709999000,
      type: 'refill',
      amountMl: 500,
      remainingMl: 500,
      todayTotalMl: 300,
      timeSynced: true,
    });
    const msg2 = parseBleHistorySync(eventJson);
    expect(msg2.isComplete).toBe(false);
    if (!msg2.isComplete) {
      expect(msg2.batchId).toBe('batch-1');
      expect(msg2.sequence).toBe(0);
      expect(msg2.event.eventId).toBe('hist-1');
      expect(msg2.event.type).toBe('refill');
      expect(msg2.event.amountMl).toBe(500);
    }
  });

  it('should parse BleCommandResponse correctly', () => {
    const tareResp = JSON.stringify({
      action: 'tare',
      success: true,
      currentWeight: 0.0,
    });
    const parsedTare = parseBleCommandResponse(tareResp);
    expect(parsedTare.action).toBe('tare');
    expect(parsedTare.success).toBe(true);
    expect(parsedTare.currentWeight).toBe(0.0);

    const rotateResp = JSON.stringify({
      action: 'rotate_claim',
      success: true,
      claimSecret: 'new_secret_12345',
    });
    const parsedRotate = parseBleCommandResponse(rotateResp);
    expect(parsedRotate.action).toBe('rotate_claim');
    expect(parsedRotate.claimSecret).toBe('new_secret_12345');
  });

  it('parses ack_history response fields', () => {
    expect(parseBleCommandResponse(JSON.stringify({
      action: 'ack_history',
      success: true,
      throughEventId: 'evt-2',
      remainingEventCount: 3,
    }))).toMatchObject({
      action: 'ack_history',
      success: true,
      throughEventId: 'evt-2',
      remainingEventCount: 3,
    });
  });

  it('should reject the original command request as a response', () => {
    expect(isBleCommandResponseForAction(JSON.stringify({ action: 'tare' }), 'tare')).toBe(false);
    expect(
      isBleCommandResponseForAction(JSON.stringify({ action: 'set_time', success: true }), 'tare')
    ).toBe(false);
    expect(
      isBleCommandResponseForAction(JSON.stringify({ action: 'tare', success: true }), 'tare')
    ).toBe(true);
    expect(
      isBleCommandResponseForAction('{"action":"tare","success":true}\u0000\u0000', 'tare')
    ).toBe(true);
  });

  it('should wait for the firmware response instead of returning the write payload', async () => {
    const service = new BleService();
    const commandValues = [
      JSON.stringify({ action: 'tare' }),
      JSON.stringify({ action: 'tare', success: true, currentWeight: 0 }),
    ];
    const summaryJson = JSON.stringify({
      deviceId: 'water_test',
      dailyGoalMl: 2000,
      todayTotalMl: 0,
      currentWeight: 0,
      isStable: false,
      timeSynced: true,
      claimSecret: 'test-secret',
      wifiConnected: false,
      wifiConfigured: false,
      ip: '0.0.0.0',
    });
    const commandChar = {
      writeValueWithResponse: vi.fn().mockResolvedValue(undefined),
      writeValue: vi.fn().mockResolvedValue(undefined),
      readValue: vi.fn().mockImplementation(async () => dataView(commandValues.shift() || commandValues[0])),
    };
    const summaryChar = {
      readValue: vi.fn().mockResolvedValue(dataView(summaryJson)),
    };

    (service as any).commandChar = commandChar;
    (service as any).summaryChar = summaryChar;

    await expect(service.tare()).resolves.toMatchObject({
      action: 'tare',
      success: true,
      currentWeight: 0,
    });
    expect(commandChar.writeValueWithResponse).toHaveBeenCalledTimes(1);
    expect(commandChar.writeValue).not.toHaveBeenCalled();
    expect(commandChar.readValue).toHaveBeenCalledTimes(2);
  });

  it('sends ack_history through the command transport', async () => {
    const service = new BleService();
    const response = {
      action: 'ack_history',
      success: true,
      throughEventId: 'evt-2',
      remainingEventCount: 1,
    };
    const sendCommand = vi.spyOn(service, 'sendCommand').mockResolvedValue(response);

    await expect(service.acknowledgeHistory('evt-2')).resolves.toEqual(response);
    expect(sendCommand).toHaveBeenCalledWith({
      action: 'ack_history',
      throughEventId: 'evt-2',
    });
  });

  it('rejects a successful ACK response with a mismatched cursor', async () => {
    const service = new BleService();
    vi.spyOn(service, 'sendCommand').mockResolvedValue({
      action: 'ack_history',
      success: true,
      throughEventId: 'evt-wrong',
    });

    await expect(service.acknowledgeHistory('evt-2')).rejects.toThrow('ACK 游標不相符');
  });

  it('keeps history sync pending until syncComplete and removes its listener', async () => {
    const service = new BleService();
    const historyChar = createHistoryCharacteristic();
    (service as any).historySyncChar = historyChar;
    const onEvent = vi.fn();
    const onComplete = vi.fn();
    let resolved = false;

    const sync = service.requestHistorySync('evt-before', onEvent, onComplete).then(() => {
      resolved = true;
    });
    await vi.waitFor(() => expect(historyChar.writeValue).toHaveBeenCalledTimes(1));

    historyChar.emit(JSON.stringify({
      batchId: 'batch-1',
      sequence: 0,
      eventId: 'evt-1',
      occurredAt: 1710000000,
      type: 'drink',
      amountMl: 200,
      remainingMl: 300,
      todayTotalMl: 200,
      timeSynced: true,
    }));
    await Promise.resolve();
    expect(onEvent).not.toHaveBeenCalled();
    expect(resolved).toBe(false);
    expect(historyChar.listenerCount()).toBe(1);

    historyChar.emit(JSON.stringify({
      syncComplete: true,
      batchId: 'batch-1',
      count: 1,
      firstEventId: 'evt-1',
      lastEventId: 'evt-1',
    }));
    await sync;

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'evt-1' }),
      { batchId: 'batch-1', sequence: 0 },
    );
    expect(onComplete).toHaveBeenCalledWith({
      batchId: 'batch-1',
      count: 1,
      firstEventId: 'evt-1',
      lastEventId: 'evt-1',
    });
    expect(resolved).toBe(true);
    expect(historyChar.listenerCount()).toBe(0);
    expect(historyChar.removeEventListener).toHaveBeenCalledTimes(1);
    expect(JSON.parse(new TextDecoder().decode(
      historyChar.writeValue.mock.calls[0][0],
    ))).toEqual({ action: 'history_sync', afterEventId: 'evt-before' });
  });

  it('rejects a history batch with a missing sequence and never delivers it', async () => {
    const service = new BleService();
    const historyChar = createHistoryCharacteristic();
    (service as any).historySyncChar = historyChar;
    const onEvent = vi.fn();
    const sync = service.requestHistorySync('', onEvent, vi.fn());
    await vi.waitFor(() => expect(historyChar.writeValue).toHaveBeenCalledTimes(1));

    historyChar.emit(JSON.stringify({
      batchId: 'batch-gap', sequence: 0, eventId: 'evt-1', occurredAt: 1,
      type: 'drink', amountMl: 100, remainingMl: 400, todayTotalMl: 100, timeSynced: true,
    }));
    historyChar.emit(JSON.stringify({
      batchId: 'batch-gap', sequence: 2, eventId: 'evt-3', occurredAt: 3,
      type: 'drink', amountMl: 100, remainingMl: 200, todayTotalMl: 300, timeSynced: true,
    }));
    historyChar.emit(JSON.stringify({
      syncComplete: true,
      batchId: 'batch-gap',
      count: 3,
      firstEventId: 'evt-1',
      lastEventId: 'evt-3',
    }));

    await expect(sync).rejects.toThrow('歷史批次缺漏');
    expect(onEvent).not.toHaveBeenCalled();
    expect(historyChar.listenerCount()).toBe(0);
  });

  it('rejects event notifications from a different batch', async () => {
    const service = new BleService();
    const historyChar = createHistoryCharacteristic();
    (service as any).historySyncChar = historyChar;
    const onEvent = vi.fn();
    const sync = service.requestHistorySync('', onEvent, vi.fn());
    await vi.waitFor(() => expect(historyChar.writeValue).toHaveBeenCalledTimes(1));

    historyChar.emit(JSON.stringify({
      batchId: 'batch-event', sequence: 0, eventId: 'evt-1', occurredAt: 1,
      type: 'drink', amountMl: 100, remainingMl: 400, todayTotalMl: 100, timeSynced: true,
    }));
    historyChar.emit(JSON.stringify({
      syncComplete: true,
      batchId: 'batch-complete',
      count: 1,
      firstEventId: 'evt-1',
      lastEventId: 'evt-1',
    }));

    await expect(sync).rejects.toThrow('歷史批次 ID 不相符');
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('rejects malformed history messages and removes its listener', async () => {
    const service = new BleService();
    const historyChar = createHistoryCharacteristic();
    (service as any).historySyncChar = historyChar;
    const sync = service.requestHistorySync('', vi.fn(), vi.fn());
    await vi.waitFor(() => expect(historyChar.writeValue).toHaveBeenCalledTimes(1));

    historyChar.emit('{not-json');

    await expect(sync).rejects.toThrow('解析 BLE History Sync 訊息失敗');
    expect(historyChar.listenerCount()).toBe(0);
    expect(historyChar.removeEventListener).toHaveBeenCalledTimes(1);
  });

  it('times out history sync after 15 seconds and removes its listener', async () => {
    vi.useFakeTimers();
    try {
      const service = new BleService();
      const historyChar = createHistoryCharacteristic();
      (service as any).historySyncChar = historyChar;
      const sync = service.requestHistorySync('', vi.fn(), vi.fn());
      const rejection = expect(sync).rejects.toThrow('歷史事件同步逾時');

      await vi.advanceTimersByTimeAsync(15000);
      await rejection;

      expect(historyChar.listenerCount()).toBe(0);
      expect(historyChar.removeEventListener).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('removes the history listener when writing the sync request fails', async () => {
    const service = new BleService();
    const historyChar = createHistoryCharacteristic();
    historyChar.writeValue.mockRejectedValueOnce(new Error('write failed'));
    (service as any).historySyncChar = historyChar;

    await expect(service.requestHistorySync('', vi.fn(), vi.fn())).rejects.toThrow('write failed');
    expect(historyChar.listenerCount()).toBe(0);
    expect(historyChar.removeEventListener).toHaveBeenCalledTimes(1);
  });

  it('keeps Mock history state, resumes after a cursor, and clears only an ACKed prefix', async () => {
    const service = new MockBleService();
    const receivedAfterCursor: string[] = [];

    await service.requestHistorySync(
      'mock-hist-1',
      (event) => receivedAfterCursor.push(event.eventId),
      vi.fn(),
    );
    expect(receivedAfterCursor).toEqual(['mock-hist-2', 'mock-hist-3']);

    await expect(service.acknowledgeHistory('mock-hist-2')).resolves.toMatchObject({
      action: 'ack_history',
      success: true,
      throughEventId: 'mock-hist-2',
      remainingEventCount: 1,
    });
    await expect(service.acknowledgeHistory('mock-hist-2')).resolves.toMatchObject({
      action: 'ack_history',
      success: true,
      throughEventId: 'mock-hist-2',
      remainingEventCount: 1,
    });

    const retained: string[] = [];
    await service.requestHistorySync('', (event) => retained.push(event.eventId), vi.fn());
    expect(retained).toEqual(['mock-hist-3']);

    await expect(service.acknowledgeHistory('unknown-event')).resolves.toMatchObject({
      action: 'ack_history',
      success: false,
      error: 'unknown_event_id',
    });
    const retainedAfterUnknownAck: string[] = [];
    await service.requestHistorySync('', (event) => retainedAfterUnknownAck.push(event.eventId), vi.fn());
    expect(retainedAfterUnknownAck).toEqual(['mock-hist-3']);
  });
});
