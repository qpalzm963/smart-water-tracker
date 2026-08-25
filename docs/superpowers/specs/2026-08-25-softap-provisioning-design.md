# SoftAP Browser Provisioning Design

## Goal

讓未完成手機 App 的使用者，能以手機掃描裝置上的 QR code、連上裝置專屬 Wi-Fi 熱點，並在瀏覽器設定家用 Wi-Fi、後端網址與 Device Token；後續手機 App 沿用相同資料格式，不需重燒韌體。

## Scope

- ESP32-C3 韌體提供 SoftAP、HTTP 設定頁與設定 API。
- 現有 BLE 與序列埠設定功能保持可用。
- 網路設定存於既有 NVS namespace。
- 本次不建立手機 App、不變更雲端 API、不修改硬體。

## Device Identity and QR Code

每台裝置在首度開機時建立並保存：

- `deviceId`：既有的 eFuse MAC 衍生 ID。
- `claimSecret`：既有 16 位十六進位硬體認領密鑰。
- `setupSecret`：新增 32 位十六進位隨機配網密鑰。

`setupSecret` 用於衍生 SoftAP 密碼，不保存實際 Wi-Fi 密碼，也不代表使用者帳號。機身 QR code 必須在交付前以受控製程寫入，內容至少包括 `deviceId` 與 `setupSecret`；Wi-Fi 熱點名稱使用 `WaterTracker-<deviceId 尾碼>`。

## User Flow

1. 使用者掃描機身 QR code，取得裝置 ID、熱點名稱與熱點密碼。
2. 未設定 Wi-Fi 的裝置自動啟動 SoftAP；已設定但持續連線失敗的裝置在五分鐘後重新啟動 SoftAP。
3. 使用者連上受 WPA2 保護的裝置熱點。
4. 手機瀏覽器開啟裝置的本機設定頁；captive-portal DNS 回應與常見探測 URL 都導向該頁。
5. 使用者輸入 2.4GHz SSID、Wi-Fi 密碼、API Base URL 與已從儀表板取得的 Device Token。
6. 裝置驗證、寫入 NVS，回應連線嘗試中的狀態；連上 Wi-Fi 後關閉 SoftAP。
7. 使用者可在儀表板以 QR 中的 `deviceId`／`claimSecret` 綁定裝置並取得 Device Token。

## Provisioning HTTP API v1

設定頁與未來 App 共用下列本機 API。回應不得含 Wi-Fi 密碼、完整 Device Token 或 `setupSecret`。

| Endpoint | Method | Request | Response |
| --- | --- | --- | --- |
| `/api/v1/provisioning/status` | GET | 無 | `deviceId`、AP 名稱、Wi-Fi 是否已設定、連線狀態、IP、遮罩後 API URL 與 Token 狀態 |
| `/api/v1/provisioning/configure` | POST | `ssid`、`password`、`apiBaseUrl`、`deviceToken` | `accepted`、欄位錯誤或連線狀態 |
| `/api/v1/provisioning/clear` | POST | 無 | 清除 NVS 網路與 Token，重新啟動 SoftAP |

輸入規則：SSID 必填且長度 1–32；密碼允許空字串（開放網路）或長度 8–63；API Base URL 必須是 `http://` 或 `https://` URL；Device Token 必填且以 `dvt_` 開頭。設定 API 只在 SoftAP 配網模式啟用。

## Firmware Architecture

- `NetworkManager` 保持 STA 連線、NVS 讀寫與重連，新增失敗計時與配網模式觸發通知。
- 新增 `ProvisioningPortal`，唯一負責 SoftAP、DNS、HTTP 路由、設定頁與輸入驗證。
- `main.cpp` 初始化 portal，並在迴圈中驅動 portal 與 network manager。
- `Config.h` 集中 SoftAP 名稱前綴、連線失敗期限、portal URL 與 NVS key。
- 靜態 HTML、CSS、JavaScript 編譯進韌體，避免首次配網依賴外網或手機 App。

## Security and Failure Handling

- SoftAP 使用唯一 WPA2 密碼；不建立開放熱點。
- 設定 API 不回傳或記錄 Wi-Fi 密碼、完整 Token、`setupSecret`。
- 首次配置與重試期間才啟用 portal；正常連線後停止 SoftAP、DNS 與 HTTP server。
- 設定失敗時保留既有有效設定，並把錯誤回傳設定頁；不清除設定直到使用者呼叫 clear。
- 裝置無法從 QR code 獲得絕對防護：QR code 遭拍照外流的人可在裝置配網模式時嘗試連線；交付時須視 QR code 為裝置所有權憑證。

## Testing

- PlatformIO 單元測試：SoftAP 密碼衍生、請求驗證、敏感欄位遮罩、失敗重試與 NVS 清除。
- 建置驗證：`pio run`。
- 實機驗證：首次開機、手機連線與瀏覽器設定、錯誤密碼重試、正確 Wi-Fi 連線、重開機後自動重連、連線失敗五分鐘後 portal 重開、設定頁不洩漏敏感值。

## Out of Scope

- iOS／Android 原生 App。
- HTTPS 憑證與自訂網域部署。
- QR code 實際印刷、標籤供應鏈與出貨流程。
