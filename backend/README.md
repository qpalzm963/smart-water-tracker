# 🥤 Smart Water Tracker — Backend Service

智慧喝水追蹤器後端服務，基於 Node.js 24 原生 `node:sqlite`、TypeScript 與 Express.js 建置。專為低功耗物聯網環境（ESP32-C3）與雲端輕量 VPS 部署設計。

---

## ✨ 核心特色

- **零 C++ 編譯依賴**：採用 Node.js 24 原生 SQLite 模組 (`node:sqlite`)，記憶體佔用極低（約 35MB），無需 Python 或 Visual Studio build tools。
- **雙重認證架構 (Dual Auth)**：
  - **使用者**：帳號（username）+ bcrypt 雜湊密碼 + 30 天 JWT Token，支援 Rate Limiting 防禦暴力破解。
  - **ESP32 裝置**：非對稱長效 **Device Token** (`dvt_...`)，支援遮罩顯示與即時輪換 (`/devices/:id/token/rotate`)。
- **硬體佔有權防護 (Hardware Claiming Proof)**：
  - 裝置首次綁定支援 `claimCode`（由 ESP32 透過本機 BLE 提供、並保存於 NVS 的 16 位金鑰）。
  - 裝置轉移時，App 先以 BLE 輪替裝置金鑰，接著提交舊 `claimCode` 與新 `newClaimCode`；後端驗證舊值後保存新值，防止舊持有人無限互搶。
- **韌體事件對齊與冪等去重**：
  - 64 位元開機 Session ID (`deviceId-occurredAt-bootSessionId-seq`)，徹底消除未校時重開機造成的事件 ID 碰撞。
  - 支援喝水 (`drink`) 與補水 (`refill`) 事件分流處理。
  - 併發安全的原子性寫入，斷線重播不噴 500。
- **台北時區統計分析 (UTC+8)**：
  - 100% 透過 B-Tree 索引範圍掃描（`occurred_at >= ? AND occurred_at <= ?`）。
  - 日進度與達成率、7 日趨勢與日均量、30 日歷史與連續喝水天數 (Streak)。
- **自動 Schema 遷移 (Fail-Closed Migration)**：
  - 支援 `PRAGMA user_version` 自動無痛升級磁碟既有 DB；舊 email 帳號會自動補上 username。
- **單頁管理儀表板 (Web Dashboard)**：
  - 內建於 `/`，提供登入註冊、即時喝水進度環、在線綠點、Token 輪換與硬體事件模擬器。

---

## 📡 RESTful API 規格

### 1. 認證與使用者 (`/api/v1`)

| Method | Endpoint | 說明 | 驗證需求 |
|:---|:---|:---|:---|
| `GET` | `/health` | 伺服器健康檢查與運作時間 | 無 |
| `POST` | `/auth/register` | 註冊新帳號（支援 Rate Limit） | 無 |
| `POST` | `/auth/login` | 登入並取得 JWT Token（支援 Rate Limit） | 無 |
| `GET` | `/user/me` | 取得當前使用者個人資訊 | User JWT |
| `PUT` | `/user/me` | 更新每日目標水量或顯示名稱 | User JWT |

### 2. 裝置管理 (`/api/v1/devices`)

| Method | Endpoint | 說明 | 驗證需求 |
|:---|:---|:---|:---|
| `POST` | `/devices` | 綁定新裝置；轉讓時提交 `claimCode` 與 `newClaimCode` | User JWT |
| `GET` | `/devices` | 取得使用者所有裝置列表（Token 遮罩） | User JWT |
| `POST` | `/devices/:id/token/rotate` | 重新產生 Device Token（舊 Token 即時作廢） | User JWT |
| `DELETE` | `/devices/:id` | 解除裝置綁定並註銷憑證 | User JWT |
| `GET` | `/devices/:id/status` | 查詢裝置最後上線時間與連線狀態 (5分鐘內在線) | User JWT |

### 3. 喝水紀錄與統計 (`/api/v1/water`)

| Method | Endpoint | 說明 | 驗證需求 |
|:---|:---|:---|:---|
| `POST` | `/water/records` | 上傳喝水 / 補水事件（支援冪等去重） | Device Token 或 User JWT |
| `GET` | `/water/records` | 分頁查詢歷史喝水紀錄（支援時區區間篩選） | User JWT |
| `GET` | `/water/stats/daily` | 取得指定日（或今日）進度與計數 | User JWT |
| `GET` | `/water/stats/weekly` | 取得近 7 日每日水量趨勢與日均量 | User JWT |
| `GET` | `/water/stats/monthly` | 取得近 30 日歷史水量與連續喝水天數 (Streak) | User JWT |

---

## 🧪 測試與建置

```bash
# 執行所有後端自動化測試 (包含 Migration 與 Concurrency 測試)
npm run backend:test

# 編譯 TypeScript 至 dist/
npm run backend:build

# 啟動開發伺服器 (熱重載)
npm run backend:dev
```
