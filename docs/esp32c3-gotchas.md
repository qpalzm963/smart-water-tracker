# ESP32-C3 SuperMini 踩雷筆記

2026-08-26 追查「SoftAP 配網手機掃不到熱點」時累積的紀錄。這些幾乎都不是程式邏輯問題，
而是硬體與工具層面的陷阱，症狀又長得像韌體 bug，非常容易重複踩。

---

## 硬體

### USB 線材會偽裝成韌體問題 ⚠️ 最高優先

一條供電邊緣的 USB 線會造成這一整組症狀，而且看起來完全像軟體壞掉：

- 燒錄正常、紅色電源燈正常亮
- **韌體一開始執行，USB 就掉線**（bootloader 模式下卻很穩定）
- SoftAP 的 beacon 發不出去，但 `WiFi.softAP()` 回傳 true、驅動設定全部正確
- 序列埠讀不到、`pio test` 逾時

原因是執行中的韌體耗電遠高於閒置的 bootloader，Wi-Fi/BLE 啟動時更有電流尖峰。
供電撐不住時晶片會 brownout：USB 掉線、RF 發不出去，但還有電所以紅燈照亮、也還能回 bootloader。

**判斷方式**：`esptool` 永遠能用（只需要 bootloader）但任何需要「韌體實際執行」的觀測全部失敗
→ 先換線，不要查程式。

也不要透過擴充座／hub 接板子，尤其是帶影像輸出的，供電能力通常不足。

### 這塊板子只支援 2.4GHz 且僅支援 WPA2 Personal

無法加入 WPA2 Enterprise（802.1X）企業網路，`WiFi.begin(ssid, password)` 也只支援 PSK。
部署環境若是企業網路，配網流程再怎麼修都沒用 —— 需要手機熱點（iPhone 要開「最大相容性」
強制 2.4GHz）、訪客網路，或改走 BLE-only（見 `WATER_BLE_ONLY`）。

---

## 工具

### `pio test` 執行中不要按 RESET

PlatformIO 會提示 "please reset board"，但那是給外接 USB-serial 晶片的板子用的。
這塊板子的 USB 是晶片內建的，**按 RESET 會讓 USB 重新列舉，測試程式開著的埠當場失效**，
輸出變成 `read failed: [Errno 6] Device not configured`。

測試跑起來之後不要碰板子。

### 手動開序列埠常會把晶片踢進 download 模式

用 raw pyserial、`cat /dev/cu.*` 或 `pio device monitor`（含 `--dtr 0 --rts 0`）開埠時，
多次觀察到 `rst:0x15 (USB_UART_CHIP_RESET), boot:0x5 (DOWNLOAD)` —— app 完全不執行。
DTR/RTS 對應 EN 與 GPIO9，時序很敏感。

要在不干擾執行的前提下觀測韌體，最可靠的通道是**用 esptool 讀 flash**
（它本來就在 download 模式運作）：把診斷寫進未使用的 coredump 分割區
（`huge_app.csv` 的 0x3F0000），再 `esptool.py read_flash 0x3F0000 0x1000` + `strings` 讀回。

### macOS 的 Wi-Fi 掃描不可信

- `system_profiler SPAirPortDataType` 只回傳**快取**結果，不會觸發即時掃描
- macOS 15+ 已移除 `airport -s`
- CoreWLAN 會間歇回傳**殘缺**結果（掃到 5 個網路卻漏掉整個頻道），
  把「AP 不存在」和「掃描失敗」混為一談
- 沒有 Location 權限時 SSID 與 BSSID 都是 `nil`，`supportsSecurity()` 也會亂報
  （開放式 AP 被回報成 WPA2）

**要確認熱點可不可見，用手機。** 拿 RSSI 強度去猜「這個訊號是不是我們的」會出事 ——
關掉 AP 的基準線可能顯示那個強訊號根本是別台裝置。

---

## 韌體

### 週期性寫 flash 會殺掉 Wi-Fi beacon

ESP32-C3 是單核心，flash 操作期間會關閉 instruction cache。每 2 秒寫一次就足以餓死
WiFi task，讓 SoftAP beacon 變成間歇（外部掃描 12 次只命中 1 次）；移除後立刻恢復
（24/24 命中，-36 dBm）。

用 flash 當診斷通道時**只在開機時寫一次**，絕不要放進 `loop()` 或 Wi-Fi 事件回呼
—— 埋在關聯/DHCP 事件裡的寫入會直接打斷手機連線。

### `WiFi.scanNetworks()` 會強制切進 AP+STA

Arduino core 的 `WiFiScan.cpp:75` 內部呼叫 `WiFi.enableSTA(true)`。這塊板子在 AP+STA
模式下不會穩定廣播 beacon，等同於**一按掃描就讓配網熱點消失**。

AP-only 的配網設計與「掃描附近 Wi-Fi」無法並存，已移除該端點與按鈕。

### Wi-Fi 設定預設會寫進 NVS，壞狀態跨斷電存活

模式與頻道預設持久化。一次意外切進 AP+STA 之後，**後續每次開機都帶著壞掉的狀態，
重開機與拔插電源都救不回來**，清空 NVS 才會恢復。

已在 `WaterNetworkManager::begin()` 加上 `WiFi.persistent(false)`。

---

## 方法論

**每個觀測通道都要先用「已知good」的對照組校準，才能拿它的輸出下結論。**

這次追查中，連續五個量測工具給出錯誤結論（macOS 快取掃描、被卡死程序吃光的序列埠、
從未驗證過的 LED 腳位、殘缺的 CoreWLAN 掃描、用 RSSI 猜 AP 歸屬），每一次都讓範圍
往錯誤方向縮小，並錯誤地否定了正確的假設。

新工具上線時先問「已知good的情況下它會給出什麼」，並準備「已知absent」的基準線做差分。
工具給出自相矛盾的數據時（例如已知good比基準線還低），立刻停手修工具，不要繼續加工具。
