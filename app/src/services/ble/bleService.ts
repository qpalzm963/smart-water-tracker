import {
  BLE_DEVICE_NAME_PREFIX,
  BLE_UUIDS,
  isBleCommandResponseForAction,
  isWebBluetoothSupported,
  parseBleCommandResponse,
  parseBleHistorySync,
  parseBleSummary,
  parseBleWaterEvent,
} from './bleProtocol';
import {
  BleCommandResponse,
  BleConnectionStatus,
  BleHistoryEventMetadata,
  BleHistorySyncComplete,
  BleSummary,
  BleWaterEvent,
} from '../../types';

export type LiveEventListener = (event: BleWaterEvent) => void;
export type SummaryListener = (summary: BleSummary) => void;
export type StatusListener = (status: BleConnectionStatus, error?: string) => void;

const BLE_COMMAND_RESPONSE_TIMEOUT_MS = 3000;
const BLE_COMMAND_POLL_INTERVAL_MS = 100;

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export class BleService {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private service: BluetoothRemoteGATTService | null = null;

  private liveEventChar: BluetoothRemoteGATTCharacteristic | null = null;
  private summaryChar: BluetoothRemoteGATTCharacteristic | null = null;
  private historySyncChar: BluetoothRemoteGATTCharacteristic | null = null;
  private commandChar: BluetoothRemoteGATTCharacteristic | null = null;

  private status: BleConnectionStatus = 'disconnected';
  private summary: BleSummary | null = null;
  private commandQueue: Promise<void> = Promise.resolve();

  private liveEventListeners: Set<LiveEventListener> = new Set();
  private summaryListeners: Set<SummaryListener> = new Set();
  private statusListeners: Set<StatusListener> = new Set();

  public getStatus(): BleConnectionStatus {
    return this.status;
  }

  public getDeviceName(): string | null {
    return this.device?.name || null;
  }

  public getDeviceId(): string | null {
    return this.device?.id || null;
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

  private setStatus(status: BleConnectionStatus, error?: string) {
    this.status = status;
    this.statusListeners.forEach((listener) => listener(status, error));
  }

  public async scanAndConnect(): Promise<void> {
    if (!isWebBluetoothSupported()) {
      throw new Error('此瀏覽器或環境不支援 Web Bluetooth API。請使用 Chrome 或 Edge 瀏覽器。');
    }

    try {
      this.setStatus('scanning');
      const device = await navigator.bluetooth.requestDevice({
        filters: [
          { namePrefix: BLE_DEVICE_NAME_PREFIX },
          { services: [BLE_UUIDS.SERVICE] },
        ],
        optionalServices: [BLE_UUIDS.SERVICE],
      });

      this.device = device;
      device.addEventListener('gattserverdisconnected', this.handleDisconnected);

      await this.connectGatt(device);
    } catch (err: any) {
      this.setStatus('error', err.message);
      throw err;
    }
  }

  public async connectGatt(device: BluetoothDevice): Promise<void> {
    try {
      this.setStatus('connecting');
      if (!device.gatt) {
        throw new Error('裝置不支援 GATT 連線');
      }

      this.server = await device.gatt.connect();
      this.service = await this.server.getPrimaryService(BLE_UUIDS.SERVICE);

      // Get Characteristics
      try {
        this.liveEventChar = await this.service.getCharacteristic(BLE_UUIDS.LIVE_EVENT);
        await this.startLiveNotifications();
      } catch (err) {
        console.warn('無法獲取 Live Event Characteristic:', err);
      }

      try {
        this.summaryChar = await this.service.getCharacteristic(BLE_UUIDS.SUMMARY);
      } catch (err) {
        console.warn('無法獲取 Summary Characteristic:', err);
      }

      try {
        this.historySyncChar = await this.service.getCharacteristic(BLE_UUIDS.HISTORY_SYNC);
      } catch (err) {
        console.warn('無法獲取 History Sync Characteristic:', err);
      }

      try {
        this.commandChar = await this.service.getCharacteristic(BLE_UUIDS.COMMAND);
      } catch (err) {
        console.warn('無法獲取 Command Characteristic:', err);
      }

      this.setStatus('connected');

      // Initial Summary Read
      await this.readSummary();

      // Auto-sync device time on connection
      // Time sync is best-effort. A transient GATT read timeout should not
      // turn an otherwise usable connection into an error state.
      await this.syncDeviceTime().catch((err) => {
        console.warn('藍牙自動校時失敗，保留目前連線:', err);
      });
    } catch (err: any) {
      this.setStatus('error', err.message);
      throw err;
    }
  }

  public async disconnect(): Promise<void> {
    if (this.server && this.server.connected) {
      this.server.disconnect();
    }
    this.handleDisconnected();
  }

  private handleDisconnected = () => {
    this.server = null;
    this.service = null;
    this.liveEventChar = null;
    this.summaryChar = null;
    this.historySyncChar = null;
    this.commandChar = null;
    this.setStatus('disconnected');
  };

  private async startLiveNotifications(): Promise<void> {
    if (!this.liveEventChar) return;
    await this.liveEventChar.startNotifications();
    this.liveEventChar.addEventListener('characteristicvaluechanged', (event: any) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      if (!target.value) return;
      const decoder = new TextDecoder('utf-8');
      const jsonStr = decoder.decode(target.value);
      try {
        const waterEvent = parseBleWaterEvent(jsonStr);
        this.liveEventListeners.forEach((listener) => listener(waterEvent));
      } catch (e) {
        console.error('即時事件解析錯誤:', e);
      }
    });
  }

  public async readSummary(): Promise<BleSummary> {
    if (!this.summaryChar) {
      throw new Error('藍牙尚未連線或未找到 Summary 特徵值');
    }
    const value = await this.summaryChar.readValue();
    const decoder = new TextDecoder('utf-8');
    const jsonStr = decoder.decode(value);
    const summary = parseBleSummary(jsonStr);
    this.summary = summary;
    this.summaryListeners.forEach((listener) => listener(summary));
    return summary;
  }

  public async sendCommand(commandPayload: Record<string, any>): Promise<BleCommandResponse> {
    const command = this.commandQueue.then(() => this.sendCommandNow(commandPayload));
    // Keep the queue usable even when a command fails. The current command's
    // rejection is still returned to the caller below.
    this.commandQueue = command.then(
      () => undefined,
      () => undefined
    );
    return command;
  }

  private async sendCommandNow(commandPayload: Record<string, any>): Promise<BleCommandResponse> {
    const commandChar = this.commandChar;
    if (!commandChar) {
      throw new Error('藍牙尚未連線或未找到 Command 特徵值');
    }

    const expectedAction = typeof commandPayload.action === 'string' ? commandPayload.action : '';
    const encoder = new TextEncoder();
    const jsonStr = JSON.stringify(commandPayload);
    const encodedCommand = encoder.encode(jsonStr);
    if (typeof commandChar.writeValueWithResponse === 'function') {
      await commandChar.writeValueWithResponse(encodedCommand);
    } else {
      // Backward compatibility for older Web Bluetooth implementations.
      await commandChar.writeValue(encodedCommand);
    }

    // The firmware performs the HX711 tare before publishing the response. It
    // can take up to 500ms just to wait for the sensor, so reading once after
    // a short fixed delay can return the original request (which has no
    // `success` field). Poll until a matching, complete response is available.
    const decoder = new TextDecoder('utf-8');
    const deadline = Date.now() + BLE_COMMAND_RESPONSE_TIMEOUT_MS;
    let lastReadError = '';

    // Give the BLE host task a chance to publish the response before the
    // first read. This avoids immediately reading the JSON request that was
    // just written to the characteristic.
    await wait(BLE_COMMAND_POLL_INTERVAL_MS);

    while (Date.now() < deadline) {
      try {
        const val = await commandChar.readValue();
        const respStr = decoder.decode(val);
        if (!isBleCommandResponseForAction(respStr, expectedAction)) {
          await wait(Math.min(BLE_COMMAND_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
          continue;
        }

        const parsed = parseBleCommandResponse(respStr);
        // Refresh summary after command execution.
        await this.readSummary().catch(() => {});
        return parsed;
      } catch (err: any) {
        lastReadError = err?.message || '讀取命令回覆失敗';
        await wait(Math.min(BLE_COMMAND_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
      }
    }

    const errorDetail = lastReadError ? `（${lastReadError}）` : '';
    throw new Error(`裝置未在 ${BLE_COMMAND_RESPONSE_TIMEOUT_MS / 1000} 秒內回覆「${expectedAction}」指令${errorDetail}`);
  }

  public async tare(): Promise<BleCommandResponse> {
    return this.sendCommand({ action: 'tare' });
  }

  public async resetDaily(): Promise<BleCommandResponse> {
    return this.sendCommand({ action: 'reset_daily' });
  }

  public async syncDeviceTime(): Promise<BleCommandResponse> {
    const epoch = Math.floor(Date.now() / 1000);
    const tzOffsetMinutes = -new Date().getTimezoneOffset(); // e.g. UTC+8 = +480
    return this.sendCommand({
      action: 'set_time',
      epoch,
      tzOffsetMinutes,
    });
  }

  public async rotateClaimSecret(): Promise<BleCommandResponse> {
    return this.sendCommand({ action: 'rotate_claim' });
  }

  public async configureWifi(
    ssid: string,
    password: string,
    apiBaseUrl: string,
    deviceToken: string
  ): Promise<BleCommandResponse> {
    return this.sendCommand({
      action: 'configure_wifi',
      ssid,
      password,
      apiBaseUrl,
      deviceToken,
    });
  }

  public async clearWifi(): Promise<BleCommandResponse> {
    return this.sendCommand({ action: 'clear_wifi' });
  }

  public async acknowledgeHistory(throughEventId: string): Promise<BleCommandResponse> {
    const response = await this.sendCommand({ action: 'ack_history', throughEventId });
    if (response.success && response.throughEventId !== throughEventId) {
      throw new Error(
        `裝置 ACK 游標不相符：預期 ${throughEventId}，收到 ${response.throughEventId || '空值'}`,
      );
    }
    return response;
  }

  public requestHistorySync(
    afterEventId: string = '',
    onEvent: (event: BleWaterEvent, metadata: BleHistoryEventMetadata) => void,
    onComplete: (metadata: BleHistorySyncComplete) => void
  ): Promise<void> {
    const characteristic = this.historySyncChar;
    if (!characteristic) {
      return Promise.reject(new Error('藍牙尚未連線或未找到 History Sync 特徵值'));
    }

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let listenerAttached = false;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const received: Array<{ event: BleWaterEvent; metadata: BleHistoryEventMetadata }> = [];

      const cleanup = () => {
        if (timeout !== null) {
          clearTimeout(timeout);
          timeout = null;
        }
        if (listenerAttached) {
          characteristic.removeEventListener('characteristicvaluechanged', handler);
          listenerAttached = false;
        }
      };

      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      const handler: EventListener = (event: Event) => {
        if (settled) return;
        try {
          const target = event.target as BluetoothRemoteGATTCharacteristic;
          if (!target.value) return;
          const jsonStr = new TextDecoder('utf-8').decode(target.value);
          const syncMsg = parseBleHistorySync(jsonStr);
          if (syncMsg.isComplete) {
            if (received.length !== syncMsg.count) {
              throw new Error(`歷史批次缺漏：預期 ${syncMsg.count} 筆，收到 ${received.length} 筆`);
            }
            for (let index = 0; index < received.length; index += 1) {
              const item = received[index];
              if (item.metadata.batchId !== syncMsg.batchId) {
                throw new Error('歷史批次 ID 不相符');
              }
              if (item.metadata.sequence !== index) {
                throw new Error(`歷史批次序號不連續：預期 ${index}，收到 ${item.metadata.sequence}`);
              }
            }
            if (received.length > 0) {
              if (received[0].event.eventId !== syncMsg.firstEventId) {
                throw new Error('歷史批次第一筆事件 ID 不相符');
              }
              if (received[received.length - 1].event.eventId !== syncMsg.lastEventId) {
                throw new Error('歷史批次最後一筆事件 ID 不相符');
              }
            }

            cleanup();
            received.forEach(({ event: waterEvent, metadata }) => onEvent(waterEvent, metadata));
            onComplete({
              batchId: syncMsg.batchId,
              count: syncMsg.count,
              firstEventId: syncMsg.firstEventId,
              lastEventId: syncMsg.lastEventId,
            });
            settled = true;
            resolve();
          } else {
            received.push({
              event: syncMsg.event,
              metadata: { batchId: syncMsg.batchId, sequence: syncMsg.sequence },
            });
          }
        } catch (error) {
          fail(error);
        }
      };

      timeout = setTimeout(() => {
        fail(new Error('歷史事件同步逾時'));
      }, 15000);

      characteristic.startNotifications()
        .then(() => {
          if (settled) return;
          characteristic.addEventListener('characteristicvaluechanged', handler);
          listenerAttached = true;
          const request = JSON.stringify({ action: 'history_sync', afterEventId });
          return characteristic.writeValue(new TextEncoder().encode(request));
        })
        .catch(fail);
    });
  }
}

export const bleService = new BleService();
