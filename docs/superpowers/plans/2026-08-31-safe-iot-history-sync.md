# IoT 歷史事件安全自動同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** BLE 連線後自動把 ESP32 歷史事件可靠地保存至後端，並只清除後端已確認的連續事件範圍。

**Architecture:** App 以可持久化離線佇列接住 BLE 歷史事件，等待現有 `SyncEngine` 完成逐筆冪等上傳，再計算最長連續成功前綴並送出 `ack_history`。ESP32 在主迴圈驗證 ACK 游標，縮減 RAM/NVS ring 的有效範圍；未知或失敗 ACK 永遠不刪資料。

**Tech Stack:** ESP32-C3 Arduino/C++、Preferences NVS、ArduinoJson、Web Bluetooth、React 18、TypeScript、Vitest、Node/Express/SQLite、PlatformIO Unity

---

## File Map

- Modify `firmware/include/BleWaterService.h`: 公開 ACK 核心 API、ACK pending command 與狀態欄位。
- Modify `firmware/src/BleWaterService.cpp`: 實作 NVS/RAM 前綴清理及 `ack_history` command 回應。
- Modify `firmware/test/test_ble_water_service/test_main.cpp`: 驗證部分 ACK、全部 ACK、未知 ACK、重複 ACK與重開機。
- Modify `app/src/types/index.ts`: 擴充 BLE ACK response 欄位與 action type。
- Modify `app/src/services/ble/bleProtocol.ts`: 解析 ACK response。
- Modify `app/src/services/ble/bleService.ts`: 讓歷史同步 Promise 等到 `syncComplete`，並新增 ACK 方法。
- Modify `app/src/services/ble/mockBleService.ts`: 提供等價的歷史 ACK 行為。
- Modify `app/src/services/sync/offlineQueue.ts`: 提供 eventId 待傳查詢。
- Create `app/src/services/sync/historyCursorStore.ts`: 依穩定裝置 ID 保存最近 ACK 游標。
- Create `app/src/services/sync/historySyncCoordinator.ts`: 封裝批次接收、上傳、連續前綴與 ACK。
- Modify `app/src/contexts/BleContext.tsx`: 連線後自動同步，並讓手動同步共用同一工作。
- Modify `app/tests/syncEngine.test.ts`: 測試 queue eventId 查詢。
- Modify `app/tests/bleProtocol.test.ts`: 測試 ACK transport 與歷史同步完成 Promise。
- Create `app/tests/historySyncCoordinator.test.ts`: 測試全部成功、部分失敗、第一筆失敗與 ACK 失敗。

### Task 1: App 離線佇列查詢與 ACK 游標儲存

**Files:**
- Modify: `app/src/services/sync/offlineQueue.ts`
- Create: `app/src/services/sync/historyCursorStore.ts`
- Modify: `app/tests/syncEngine.test.ts`

- [ ] **Step 1: 寫入 queue 與 cursor store 的失敗測試**

在 `app/tests/syncEngine.test.ts` 加入：

```ts
import { HistoryCursorStore } from '../src/services/sync/historyCursorStore';

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
});
```

- [ ] **Step 2: 執行測試並確認缺少 API**

Run: `npm --workspace=app test -- tests/syncEngine.test.ts`

Expected: FAIL，顯示 `hasEventId is not a function` 或找不到 `historyCursorStore`。

- [ ] **Step 3: 實作 eventId 查詢**

在 `OfflineQueue` 加入：

```ts
public hasEventId(eventId: string): boolean {
  return this.queue.some((item) => item.payload.eventId === eventId);
}
```

- [ ] **Step 4: 實作 per-device cursor store**

建立 `app/src/services/sync/historyCursorStore.ts`：

```ts
const STORAGE_KEY = 'water_history_ack_cursors';

function storage(): Storage | null {
  try {
    return typeof globalThis !== 'undefined' && 'localStorage' in globalThis
      ? globalThis.localStorage
      : null;
  } catch {
    return null;
  }
}

export class HistoryCursorStore {
  public get(deviceId: string): string {
    if (!deviceId) return '';
    try {
      const raw = storage()?.getItem(STORAGE_KEY);
      const cursors = raw ? JSON.parse(raw) as Record<string, string> : {};
      return typeof cursors[deviceId] === 'string' ? cursors[deviceId] : '';
    } catch {
      return '';
    }
  }

  public set(deviceId: string, eventId: string): void {
    if (!deviceId || !eventId) return;
    const target = storage();
    if (!target) return;
    let cursors: Record<string, string> = {};
    try {
      const raw = target.getItem(STORAGE_KEY);
      cursors = raw ? JSON.parse(raw) : {};
    } catch {
      cursors = {};
    }
    cursors[deviceId] = eventId;
    target.setItem(STORAGE_KEY, JSON.stringify(cursors));
  }
}

export const historyCursorStore = new HistoryCursorStore();
```

- [ ] **Step 5: 重跑測試**

Run: `npm --workspace=app test -- tests/syncEngine.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交 App 儲存基礎**

```bash
git add app/src/services/sync/offlineQueue.ts app/src/services/sync/historyCursorStore.ts app/tests/syncEngine.test.ts
git commit -m "feat: 新增歷史同步游標與待傳查詢"
```

### Task 2: ESP32 ACK 核心與 NVS 前綴清理

**Files:**
- Modify: `firmware/include/BleWaterService.h`
- Modify: `firmware/src/BleWaterService.cpp`
- Modify: `firmware/test/test_ble_water_service/test_main.cpp`

- [ ] **Step 1: 寫入 ACK 核心失敗測試**

在韌體測試加入：

```cpp
void test_acknowledge_removes_only_contiguous_prefix_and_survives_reboot() {
    BleWaterService service("water_ack_test");
    service.clearPersistedEvents();
    service.recordDrink(1721389200, 100, 500, 100);
    const String first = service.latestEventId();
    service.recordDrink(1721389201, 120, 380, 220);
    const String second = service.latestEventId();
    service.recordDrink(1721389202, 140, 240, 360);
    const String third = service.latestEventId();

    TEST_ASSERT_TRUE(service.acknowledgeEventsThrough(second));
    const std::vector<BleWaterEvent> retained = service.eventsAfter("");
    TEST_ASSERT_EQUAL_UINT32(1, retained.size());
    TEST_ASSERT_EQUAL_STRING(third.c_str(), retained[0].id.c_str());
    TEST_ASSERT_TRUE(service.acknowledgeEventsThrough(second));
    TEST_ASSERT_FALSE(service.acknowledgeEventsThrough("unknown-event"));

    BleWaterService rebooted("water_ack_test");
    rebooted.restorePersistedEvents();
    const std::vector<BleWaterEvent> restored = rebooted.eventsAfter("");
    TEST_ASSERT_EQUAL_UINT32(1, restored.size());
    TEST_ASSERT_EQUAL_STRING(third.c_str(), restored[0].id.c_str());
    rebooted.clearPersistedEvents();
}

void test_acknowledge_last_event_empties_history() {
    BleWaterService service("water_ack_all");
    service.clearPersistedEvents();
    service.recordDrink(1721389300, 100, 500, 100);
    service.recordDrink(1721389301, 100, 400, 200);
    TEST_ASSERT_TRUE(service.acknowledgeEventsThrough(service.latestEventId()));
    TEST_ASSERT_EQUAL_UINT32(0, service.eventsAfter("").size());
    service.clearPersistedEvents();
}
```

並在 `setup()` 先執行這兩個測試。

- [ ] **Step 2: 編譯測試並確認缺少 ACK API**

Run: `cd firmware && pio test -e esp32-c3-supermini -f test_ble_water_service`

Expected: FAIL，顯示 `acknowledgeEventsThrough` 尚未宣告。

- [ ] **Step 3: 宣告 ACK 狀態與 API**

在 `BleWaterService.h` 的 public 區加入：

```cpp
bool acknowledgeEventsThrough(const String& throughEventId);
```

在 private 欄位加入：

```cpp
String _lastAckedEventId;
```

- [ ] **Step 4: 實作安全前綴縮減**

在 `BleWaterService.cpp` namespace 內加入：

```cpp
constexpr char LAST_ACKED_EVENT_KEY[] = "evt_ack";
```

在 `restorePersistedEvents()` 讀取：

```cpp
_lastAckedEventId = prefs.getString(LAST_ACKED_EVENT_KEY, "");
```

實作方法；`_eventHead` 與 `_persistHead` 保持不變，只縮減 count：

```cpp
bool BleWaterService::acknowledgeEventsThrough(const String& throughEventId) {
    if (throughEventId.length() == 0) return false;
    if (throughEventId == _lastAckedEventId) return true;

    const size_t oldest = (_eventHead + BleProtocol::EVENT_BUFFER_SIZE - _eventCount) % BleProtocol::EVENT_BUFFER_SIZE;
    size_t acknowledged = 0;
    bool found = false;
    for (size_t offset = 0; offset < _eventCount; ++offset) {
        ++acknowledged;
        if (_events[(oldest + offset) % BleProtocol::EVENT_BUFFER_SIZE].id == throughEventId) {
            found = true;
            break;
        }
    }
    if (!found) return false;

    const size_t ramOnlyPrefix = _eventCount > _persistCount ? _eventCount - _persistCount : 0;
    size_t persistedAcknowledged = acknowledged > ramOnlyPrefix
        ? acknowledged - ramOnlyPrefix
        : 0;
    if (persistedAcknowledged > _persistCount) persistedAcknowledged = _persistCount;
    const size_t persistedOldest = (_persistHead + PERSIST_SLOTS - _persistCount) % PERSIST_SLOTS;

    Preferences prefs;
    if (!prefs.begin(PREFS_NAMESPACE, false)) return false;
    for (size_t offset = 0; offset < persistedAcknowledged; ++offset) {
        prefs.remove(persistSlotKey((persistedOldest + offset) % PERSIST_SLOTS).c_str());
    }
    const size_t newPersistCount = _persistCount - persistedAcknowledged;
    const bool countSaved = prefs.putUInt(PERSIST_COUNT_KEY, static_cast<uint32_t>(newPersistCount)) > 0;
    const bool ackSaved = prefs.putString(LAST_ACKED_EVENT_KEY, throughEventId) > 0;
    prefs.end();
    if (!countSaved || !ackSaved) return false;

    _persistCount = newPersistCount;
    _eventCount -= acknowledged;
    _lastAckedEventId = throughEventId;
    return true;
}
```

在 `clearPersistedEvents()` 移除 `LAST_ACKED_EVENT_KEY` 並清空 `_lastAckedEventId`。

- [ ] **Step 5: 執行韌體 ACK 測試**

Run: `cd firmware && pio test -e esp32-c3-supermini -f test_ble_water_service`

Expected: PASS，包含 5 個 BLE water service 測試。

- [ ] **Step 6: 提交 ACK 核心**

```bash
git add firmware/include/BleWaterService.h firmware/src/BleWaterService.cpp firmware/test/test_ble_water_service/test_main.cpp
git commit -m "feat: 新增裝置歷史事件 ACK 清理"
```

### Task 3: ESP32 `ack_history` BLE 指令

**Files:**
- Modify: `firmware/include/BleWaterService.h`
- Modify: `firmware/src/BleWaterService.cpp`

- [ ] **Step 1: 擴充 pending command 狀態**

在 enum 與欄位加入：

```cpp
PENDING_ACK_HISTORY,
String _pendingAckEventId;
```

- [ ] **Step 2: 讓 BLE callback 只排隊 ACK**

在 `WaterCommandCallbacks::onWrite()` 加入：

```cpp
} else if (strcmp(action, "ack_history") == 0) {
    _service._pendingAckEventId = String(request["throughEventId"] | "");
    _service._pendingCommand = BleWaterService::PENDING_ACK_HISTORY;
```

- [ ] **Step 3: 在主迴圈執行並發布完整回應**

在 `processPendingCommands()` 的 Wi-Fi 分支之前加入：

```cpp
} else if (pending == PENDING_ACK_HISTORY) {
    response["action"] = "ack_history";
    response["throughEventId"] = _pendingAckEventId;
    response["success"] = acknowledgeEventsThrough(_pendingAckEventId);
    response["remainingEventCount"] = static_cast<unsigned>(_eventCount);
    if (!response["success"].as<bool>()) {
        response["error"] = "unknown_event_id";
    }
```

- [ ] **Step 4: 編譯完整韌體**

Run: `cd firmware && pio run -e esp32-c3-supermini`

Expected: SUCCESS，沒有 ArduinoJson 或 private member 編譯錯誤。

- [ ] **Step 5: 提交 BLE ACK 指令**

```bash
git add firmware/include/BleWaterService.h firmware/src/BleWaterService.cpp
git commit -m "feat: 加入 BLE 歷史事件 ACK 指令"
```

### Task 4: App BLE transport 等待同步完成並支援 ACK

**Files:**
- Modify: `app/src/types/index.ts`
- Modify: `app/src/services/ble/bleProtocol.ts`
- Modify: `app/src/services/ble/bleService.ts`
- Modify: `app/tests/bleProtocol.test.ts`

- [ ] **Step 1: 寫入 ACK response parser 測試**

```ts
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
```

- [ ] **Step 2: 執行測試並確認新欄位尚未解析**

Run: `npm --workspace=app test -- tests/bleProtocol.test.ts`

Expected: FAIL，ACK 欄位為 `undefined`。

- [ ] **Step 3: 擴充 BLE types 與 parser**

在 `BleCommandAction` 加入 `'ack_history'`，並在 `BleCommandResponse` 加入：

```ts
throughEventId?: string;
remainingEventCount?: number;
```

在 parser return 物件加入：

```ts
throughEventId: data.throughEventId,
remainingEventCount: data.remainingEventCount !== undefined
  ? Number(data.remainingEventCount)
  : undefined,
```

- [ ] **Step 4: 新增 transport ACK 方法**

在 `BleService` 加入：

```ts
public async acknowledgeHistory(throughEventId: string): Promise<BleCommandResponse> {
  return this.sendCommand({ action: 'ack_history', throughEventId });
}
```

- [ ] **Step 5: 讓 `requestHistorySync()` 真正等待 `syncComplete`**

將 handler 包在 Promise 中，加入 15 秒 timeout；收到 `syncComplete` 時移除 listener、清除 timeout 並 resolve，解析或 write 失敗時 cleanup 後 reject：

```ts
return new Promise<void>((resolve, reject) => {
  const characteristic = this.historySyncChar!;
  let timeout: ReturnType<typeof setTimeout>;
  let handler: EventListener;
  const cleanup = () => {
    clearTimeout(timeout);
    characteristic.removeEventListener('characteristicvaluechanged', handler);
  };
  handler = (event: Event) => {
    try {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      if (!target.value) return;
      const message = parseBleHistorySync(new TextDecoder('utf-8').decode(target.value));
      if (message.isComplete) {
        cleanup();
        onComplete();
        resolve();
      } else if (message.event) {
        onEvent(message.event);
      }
    } catch (error) {
      cleanup();
      reject(error);
    }
  };
  timeout = setTimeout(() => {
    cleanup();
    reject(new Error('歷史事件同步逾時'));
  }, 15000);
  characteristic.startNotifications()
    .then(() => {
      characteristic.addEventListener('characteristicvaluechanged', handler);
      return characteristic.writeValue(new TextEncoder().encode(
        JSON.stringify({ action: 'history_sync', afterEventId }),
      ));
    })
    .catch((error) => {
      cleanup();
      reject(error);
    });
});
```

- [ ] **Step 6: 加入 characteristic fake，驗證 Promise 在 complete 前不 resolve**

在 `bleProtocol.test.ts` 建立可觸發 `characteristicvaluechanged` 的 fake，先送一筆事件，確認 Promise 尚未完成，再送 `{ syncComplete: true }` 並確認完成與 listener 被移除。

- [ ] **Step 7: 重跑 transport 測試與 build**

Run: `npm --workspace=app test -- tests/bleProtocol.test.ts && npm run app:build`

Expected: PASS；TypeScript build 成功。

- [ ] **Step 8: 提交 BLE transport**

```bash
git add app/src/types/index.ts app/src/services/ble/bleProtocol.ts app/src/services/ble/bleService.ts app/tests/bleProtocol.test.ts
git commit -m "feat: 支援歷史同步完成等待與 ACK"
```

### Task 5: 批次連續 ACK 協調器

**Files:**
- Create: `app/src/services/sync/historySyncCoordinator.ts`
- Create: `app/tests/historySyncCoordinator.test.ts`

- [ ] **Step 1: 寫入四種 ACK 邊界測試**

使用三筆 `evt-1`、`evt-2`、`evt-3` 的 fake driver、`OfflineQueue` 與 fake uploader，測試：

```ts
it('ACKs the last event when all uploads succeed', async () => {
  const result = await coordinator.sync();
  expect(driver.acknowledgeHistory).toHaveBeenCalledWith('evt-3');
  expect(result.acknowledgedThrough).toBe('evt-3');
});

it('ACKs only the prefix before a failed event', async () => {
  uploader.uploadRecord.mockImplementation(async (payload) => {
    if (payload.eventId === 'evt-2') throw new Error('offline');
    return { message: 'ok' };
  });
  await coordinator.sync();
  expect(driver.acknowledgeHistory).toHaveBeenCalledWith('evt-1');
  expect(queue.hasEventId('evt-2')).toBe(true);
});

it('does not ACK when the first event fails', async () => {
  uploader.uploadRecord.mockRejectedValue(new Error('offline'));
  await coordinator.sync();
  expect(driver.acknowledgeHistory).not.toHaveBeenCalled();
});

it('does not advance the cursor when device ACK fails', async () => {
  driver.acknowledgeHistory.mockResolvedValue({ action: 'ack_history', success: false });
  await expect(coordinator.sync()).rejects.toThrow('裝置拒絕歷史 ACK');
  expect(cursors.get('water_test')).toBe('');
});
```

另外驗證連續呼叫兩次 `sync()` 會回傳同一個 in-flight Promise。

- [ ] **Step 2: 執行測試並確認 coordinator 不存在**

Run: `npm --workspace=app test -- tests/historySyncCoordinator.test.ts`

Expected: FAIL，找不到模組。

- [ ] **Step 3: 實作依賴介面與結果型別**

建立 `historySyncCoordinator.ts`，定義：

```ts
export interface HistorySyncDriver {
  getCachedSummary(): BleSummary | null;
  requestHistorySync(
    afterEventId: string,
    onEvent: (event: BleWaterEvent) => void,
    onComplete: () => void,
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
```

- [ ] **Step 4: 實作單一 in-flight 批次工作**

以 options object 保存依賴，實作核心流程：

```ts
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
  this.inFlight = this.run().finally(() => { this.inFlight = null; });
  return this.inFlight;
}

private async run(): Promise<HistorySyncOutcome> {
  const deviceId = this.driver.getCachedSummary()?.deviceId;
  if (!deviceId) throw new Error('無法取得穩定裝置 ID');

  const batch: BleWaterEvent[] = [];
  await this.driver.requestHistorySync(this.cursors.get(deviceId), (event) => {
    batch.push(event);
    this.queue.enqueue({
      eventId: event.eventId,
      eventType: event.type,
      amountMl: event.amountMl,
      remainingMl: event.remainingMl,
      occurredAt: event.occurredAt > 0 ? new Date(event.occurredAt * 1000).toISOString() : undefined,
      timeSynced: event.timeSynced,
    });
    this.onEvent?.(event);
  }, () => undefined);

  await this.engine.triggerSync();
  let acknowledgedThrough: string | null = null;
  for (const event of batch) {
    if (this.queue.hasEventId(event.eventId)) break;
    acknowledgedThrough = event.eventId;
  }

  if (acknowledgedThrough) {
    const response = await this.driver.acknowledgeHistory(acknowledgedThrough);
    if (!response.success) throw new Error(response.error || '裝置拒絕歷史 ACK');
    this.cursors.set(deviceId, acknowledgedThrough);
  }
  return { received: batch.length, acknowledgedThrough, pending: this.queue.getCount() };
}
}
```

檔案頂端從既有模組匯入 `BleCommandResponse`、`BleSummary`、`BleWaterEvent`、`OfflineQueue`、`SyncEngine` 與 `HistoryCursorStore`。

- [ ] **Step 5: 實作並測試「連線成功、同步失敗不斷線」helper**

在同一檔案加入：

```ts
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
```

測試 `connect` rejection 會向外拋出；`sync` rejection 只呼叫 `onSyncError`，整體仍 resolve。

- [ ] **Step 6: 執行協調器測試**

Run: `npm --workspace=app test -- tests/historySyncCoordinator.test.ts`

Expected: PASS，ACK 邊界、in-flight 共用與自動連線錯誤邊界全部通過。

- [ ] **Step 7: 提交協調器**

```bash
git add app/src/services/sync/historySyncCoordinator.ts app/tests/historySyncCoordinator.test.ts
git commit -m "feat: 新增歷史事件連續 ACK 協調器"
```

### Task 6: Mock 與 React Context 自動同步整合

**Files:**
- Modify: `app/src/services/ble/mockBleService.ts`
- Modify: `app/src/contexts/BleContext.tsx`

- [ ] **Step 1: 讓 Mock driver 支援 ACK 並保留未 ACK 事件**

把 mock 歷史陣列提升為 class 欄位，`requestHistorySync(afterEventId)` 只回傳游標之後事件；加入：

```ts
public async acknowledgeHistory(throughEventId: string): Promise<BleCommandResponse> {
  const index = this.historyEvents.findIndex((event) => event.eventId === throughEventId);
  if (index < 0) {
    return { action: 'ack_history', success: false, error: 'unknown_event_id' };
  }
  this.historyEvents.splice(0, index + 1);
  return {
    action: 'ack_history',
    success: true,
    throughEventId,
    remainingEventCount: this.historyEvents.length,
  };
}
```

- [ ] **Step 2: 在 Context 建立可替換 driver 的 coordinator**

使用 `useMemo`：

```ts
const historyCoordinator = useMemo(() => new HistorySyncCoordinator({
  driver: activeDriver,
  queue: offlineQueue,
  engine: syncEngine,
  cursors: historyCursorStore,
  onEvent: (event) => setLiveEvents((prev) => [event, ...prev].slice(0, 50)),
}), [activeDriver]);
```

保留即時事件既有 `handleWaterEvent()` 行為；歷史事件由 coordinator 入 queue，避免每收到一筆就啟動一輪 sync。

- [ ] **Step 3: 讓手動同步共用 coordinator**

```ts
const syncHistory = async () => {
  await historyCoordinator.sync();
};
```

- [ ] **Step 4: 連線完成後 best-effort 自動同步**

```ts
const connect = async () => {
  await connectWithAutomaticHistorySync(
    () => activeDriver.scanAndConnect(),
    () => historyCoordinator.sync(),
    (error) => {
    console.warn('自動歷史同步尚未完成，事件保留等待重試:', error);
    },
  );
};
```

連線本身成功時，即使 API 離線也不把 BLE status 改成 error。

- [ ] **Step 5: 執行所有 App 測試與 build**

Run: `npm run app:test && npm run app:build`

Expected: 全部 Vitest PASS，TypeScript/Vite build 成功。

- [ ] **Step 6: 提交自動同步整合**

```bash
git add app/src/services/ble/mockBleService.ts app/src/contexts/BleContext.tsx
git commit -m "feat: BLE 連線後自動安全同步歷史事件"
```

### Task 7: 全面回歸、燒錄與實機安全驗收

**Files:**
- Verify only: `backend/tests/api.test.ts`
- Verify only: `firmware/test/test_ble_water_service/test_main.cpp`
- Verify only: `app/tests/historySyncCoordinator.test.ts`

- [ ] **Step 1: 執行 App 與後端回歸測試**

Run: `npm run app:test && npm run app:build && npm run backend:test && npm run backend:build`

Expected: 所有命令 exit 0；後端 eventId 去重與 tombstone 測試保持通過。

- [ ] **Step 2: 執行韌體測試與 production build**

Run: `cd firmware && pio test -e esp32-c3-supermini -f test_ble_water_service && pio run -e esp32-c3-supermini`

Expected: Unity 測試 PASS，firmware SUCCESS。

- [ ] **Step 3: 確認 USB port，不清除 flash**

Run: `cd firmware && pio device list`

Expected: 找到 ESP32-C3 USB serial port。禁止執行 `erase_flash`；保留現有歷史事件。

- [ ] **Step 4: 只上傳新 firmware**

Run: `cd firmware && pio run -e esp32-c3-supermini -t upload --upload-port /dev/cu.usbmodem1101`

Expected: `SUCCESS`。若實際 port 不同，使用 Step 3 回傳的明確 ESP32 port。

- [ ] **Step 5: 監看開機與 NVS 還原**

Run: `cd firmware && pio device monitor -p /dev/cu.usbmodem1101 -b 115200`

Expected: 出現 BLE 啟動與「已從 NVS 還原 N 筆未同步事件」，沒有格式化或清除 NVS 訊息。

- [ ] **Step 6: 實機執行自動同步**

啟動 backend 與 app，連線 WaterTracker。確認：

```text
1. 不按「歷史事件重送」也會收到歷史事件。
2. 後端相同 eventId 最多一筆。
3. App 上傳成功後送出 ack_history。
4. ESP32 回覆 remainingEventCount，未出現 unknown_event_id。
```

- [ ] **Step 7: USB 重開並驗證 ACK 持久化**

重新插拔 USB，再連線 App。Expected：已 ACK 事件不再重送；若有未 ACK 事件，只重送剩餘部分。

- [ ] **Step 8: 檢查最終 diff 與工作樹**

Run: `git status --short && git diff --check`

Expected: 沒有 whitespace error；只保留使用者原有未提交變更與本計畫明確修改的檔案。
