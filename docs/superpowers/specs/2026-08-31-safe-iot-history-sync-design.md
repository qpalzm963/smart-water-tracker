# IoT 歷史事件安全自動同步設計規格

## 目標

讓 App 在 BLE 連線成功後，自動將 ESP32 保留的歷史事件同步到後端；只有後端已成功保存或確認為重複事件時，App 才通知 ESP32 清除對應的連續事件範圍。任何 BLE、網路或 API 失敗都不得造成尚未保存的事件從裝置消失。

## 已確認範圍

- BLE 連線成功後自動執行歷史同步。
- 保留既有手動同步入口，作為使用者主動重試方式。
- App 收到事件後先寫入現有 `localStorage` 離線佇列，再嘗試上傳。
- 沿用後端既有 `eventId` 冪等去重；HTTP 成功與重複事件都可視為已保存。
- 新增 `ack_history` BLE 指令，讓 App 指定 `throughEventId`。
- ESP32 只清除從最舊事件到 `throughEventId` 的連續範圍。
- 保留目前裝置上的歷史事件，不執行整批 NVS 清除或 flash erase。
- 沿用後端既有刪除 tombstone，避免使用者刪除的誤判事件因重送而復活。

## 不在本輪範圍

- 不新增後端批次上傳 API。
- 不修改喝水／補水判斷演算法。
- 不提供任意 eventId 的裝置端單筆刪除指令。
- 不讓即時 BLE 通知直接觸發裝置清除；即時事件必須等下一輪歷史同步確認。
- 不變更 NVS 32 筆事件容量或事件序列化格式。
- 不清除既有 19 筆歷史事件。

## 方案選擇

採用「批次同步＋連續 ACK」。App 取得一批依時間排序的歷史事件後，逐筆放入離線佇列並執行現有同步引擎。同步完成後，App 只從該批最舊事件開始檢查，找出已不在離線佇列中的最長連續前綴，並 ACK 這個前綴的最後一筆。

不採用每筆上傳後立即 ACK，因為它會增加 BLE 往返次數，也更容易在斷線時產生順序狀態。更不採用「BLE 收到即刪除」，因為 App 尚未取得後端保存證明時可能永久遺失資料。

## 元件與責任

### ESP32 `BleWaterService`

- `WaterHistorySyncCallbacks` 維持處理 `history_sync`，並回傳由舊到新的事件序列與 `syncComplete`。
- `WaterCommandCallbacks` 新增 `ack_history`，將 `throughEventId` 排入主迴圈處理，避免 BLE callback 直接寫 NVS。
- `processPendingCommands()` 執行 ACK，回覆 `success`、`throughEventId` 與剩餘事件數。
- `acknowledgeEventsThrough()` 只在游標存在時縮減 RAM 與 NVS ring 的有效範圍，移除游標以前（含游標）的事件。
- NVS 保存最近一次成功 ACK 的 eventId。重複送出相同 ACK 時回覆成功且不再修改資料。
- 未知、空白或不在保留範圍內的 ACK 回覆失敗，且不得刪除任何事件。

### App BLE 傳輸層

- `BleCommandAction` 增加 `ack_history`。
- `BleCommandResponse` 增加 `throughEventId` 與 `remainingEventCount`。
- `BleService.acknowledgeHistory(throughEventId)` 透過既有 command characteristic 發送 ACK，沿用命令序列與逾時輪詢。
- Mock BLE driver 提供相同方法，讓 Context 與測試不需要依驅動類型分支。

### App 自動同步協調器

- BLE 連線完成並讀取 Summary、完成校時後，Context 自動啟動一次歷史同步。
- 同一時間最多存在一個歷史同步工作；自動與手動觸發共用同一個 Promise，避免重複註冊 characteristic listener。
- 每一筆歷史事件都先呼叫 `offlineQueue.enqueue()`；同 eventId 由既有佇列去重。
- 收到 `syncComplete` 後呼叫 `syncEngine.triggerSync()`，等待該輪上傳結束。
- 依本批事件順序檢查 queue，找出最長的已成功連續前綴；只有此前綴非空時才送 ACK。
- ACK 成功後，依 BLE Summary 的 `deviceId` 保存本機 `lastAckedEventId`，供下一次 `history_sync.afterEventId` 使用。
- ACK 失敗不移除 App 已成功上傳的狀態；下次同步由後端 `eventId` 去重後再次安全 ACK。

### 離線佇列

- 新增依 `eventId` 查詢是否仍待傳的方法，不改變現有 enqueue、remove 與 retry 行為。
- API 上傳成功後，事件仍由 `SyncEngine` 從 queue 移除。
- API 失敗時，事件保留並增加 retryCount；本輪 ACK 最多只能到第一個失敗事件之前。

## 資料流程

1. App 連線 ESP32，取得 Summary 中的穩定 `deviceId`。
2. App 讀取該裝置本機保存的 `lastAckedEventId`，發送 `history_sync`。
3. ESP32 從游標之後重送；若游標已因先前 ACK 被清除而不在 ring 中，沿用現有安全行為，重送全部仍保留事件。
4. App 依接收順序將事件寫入離線佇列。
5. ESP32 發送 `syncComplete`。
6. App 等待 `SyncEngine` 將可上傳事件寫入後端。
7. App 找出從本批第一筆開始、已不在 queue 的最長連續前綴。
8. App 對此前綴最後一筆發送 `ack_history`。
9. ESP32 驗證 eventId 後縮減 RAM ring 與 NVS ring 的有效 count，只保留 ACK 之後的事件。
10. App 保存 ACK 游標。若仍有失敗事件，下一次網路恢復、週期同步或手動同步會繼續處理。

## 重要順序規則

- ACK 游標代表「這一筆以及它之前的所有裝置事件都已安全保存」。
- 不允許略過中間失敗事件後 ACK 更新事件。
- 即時事件即使已上傳，也不單獨 ACK；它會保留在 ESP32，直到下一批歷史同步成為可驗證的連續前綴。
- 後端回覆 tombstone 抑制的事件仍屬成功處理，允許 ACK，因為該 eventId 已被後端永久記錄為不應重建。
- App 本機游標只用於減少重送；ESP32 的實際保留資料才是資料安全來源。

## NVS 清理演算法

`acknowledgeEventsThrough(throughEventId)` 先依目前 RAM ring 的由舊到新順序尋找游標：

- 找不到游標：若等於 NVS 中最近一次 ACK，回覆冪等成功；否則回覆失敗且不寫入。
- 找到游標：計算 ACK 的連續事件數；RAM ring 維持 head 不變並縮減 count，使 oldest 自動前移。
- 每次歷史批次都帶 `batchId` 與從 0 開始的 `sequence`；完成通知帶 `count`、`firstEventId`、`lastEventId`。App 驗證完整連續後才允許上傳與 ACK，缺包、錯序或跨批次一律保留裝置資料並重試。
- NVS ring 使用 32 筆有效容量加 1 個 copy-on-write spare slot；事件先寫 spare，再以雙 metadata slot 的 generation/checksum 原子提交 head、count 與最近 ACK eventId。
- ACK 只提交一份包含新 count 與 ACK cursor 的 metadata blob；read-back 驗證成功後才更新 RAM 並回覆成功。
- ACK 最後一筆時，事件 count 變為 0，但校準、Wi-Fi、claim secret 等其他 NVS key 不受影響。

## 失敗處理

- BLE 歷史同步中斷：App 不送 ACK；ESP32 保留全部事件。
- App 寫入離線佇列失敗：視為同步失敗，不送 ACK。
- API 部分失敗：只 ACK 第一個失敗事件之前的連續成功前綴。
- API 全部失敗：不送 ACK。
- ACK 指令逾時或 BLE 斷線：不更新本機 ACK 游標；ESP32 下次可能重送，後端依 eventId 去重。
- ESP32 收到未知 ACK：回覆 `unknown_event_id`，不刪資料。
- 重複 ACK：回覆成功，保持目前資料不變。
- App 重複收到事件：離線佇列與後端兩層都依 eventId 去重。

## 相容性與部署順序

先部署 App 與測試，再燒錄支援 `ack_history` 的韌體。新版 App 若連到舊韌體，歷史事件仍可上傳，但 ACK 會逾時，裝置不會清除資料；這是安全降級。新版韌體與舊 App 相容，因為既有 `history_sync` 契約不變，只是裝置不會收到 ACK。

## 測試與驗收

### 韌體單元測試

- ACK 中間事件後只保留更新事件，且重開機還原結果一致。
- ACK 最後事件後事件數為 0。
- 未知 ACK 不改變 RAM 與 NVS。
- 重複 ACK 回覆成功且不改變資料。
- 新增事件後仍可在 ACK 保留事件之後正常接續。

### App 單元測試

- 離線 queue 可依 eventId 查詢待傳狀態。
- 全部上傳成功時 ACK 批次最後一筆。
- 中間一筆失敗時，只 ACK 失敗前一筆。
- 第一筆失敗時不送 ACK。
- ACK 失敗時不保存本機游標。
- BLE 連線成功自動觸發一次同步，重複觸發共用同一工作。
- 手動同步仍可使用。

### 整合驗收

- 保留目前裝置歷史資料，燒錄新版韌體後連線 App。
- 確認 App 自動同步，後端 eventId 沒有重複資料。
- 確認 ACK 後 ESP32 剩餘事件數下降或歸零。
- 斷網重測：事件保留在 App queue 與 ESP32；恢復網路後可完成同步與清理。
- USB 重開 ESP32 後確認已 ACK 事件不再重送，未 ACK 事件仍存在。

## 完成條件

- App 連線後不需按按鈕即可完成歷史同步。
- 後端未確認的事件永遠不會因 ACK 被刪除。
- 重送同一 eventId 不會在後端建立重複紀錄。
- ESP32 僅清除 ACK 連續範圍，不清除其他 NVS 資料。
- 韌體、App 與後端既有測試保持通過，新增 ACK 與自動同步測試通過。
