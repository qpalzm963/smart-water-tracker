# 🥤 Smart Water Tracker (智慧喝水追蹤器)

以 **ESP32-C3 SuperMini + HX711 5KG 稱重模組** 打造的桌面智慧喝水追蹤系統，搭配雲端 **RESTful API 後端服務** 與手機 App / 網頁儀表板。

---

## 📁 Monorepo 專案結構

本專案採用 Monorepo 結構管理韌體、後端、前端 App 與教學工作坊：

```
smart-water-tracker/
├── package.json              # 根目錄 npm workspace 設定
├── app/                      # 📱 React + TypeScript + Vite 前端/客戶端 App (支援 Web Bluetooth)
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── src/
│   │   ├── assets/game/      # 喝水遊戲化 MVP 素材 (SVG)，見該目錄 README
│   │   ├── game/             # 每日 Boss 戰純函式規則、狀態持久化、useDailyGame hook
│   │   ├── services/         # API 客戶端、BLE 協議通訊、離線同步佇列 (Offline Sync)
│   │   ├── contexts/         # Auth, BLE, Water, Device 狀態管理
│   │   ├── views/            # Dashboard, BLE 控制, 歷程, 統計, 裝置管理, 設定
│   │   └── components/       # 導覽列與語意化功能元件
│   └── tests/                # Vitest 單元測試
├── firmware/                 # 🔌 ESP32-C3 稱重感測韌體 (PlatformIO)
│   ├── platformio.ini
│   ├── include/
│   ├── src/
│   └── test/
├── backend/                  # ☁️ Node.js + TypeScript + Express + SQLite 後端服務
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── app.ts            # Express 應用與 API 路由
│   │   ├── database/         # SQLite 資料庫與 Schema
│   │   ├── controllers/      # Auth, Device, Water 業務邏輯
│   │   ├── middleware/       # JWT 與 Device Token 雙重認證
│   │   └── public/           # 簡易網頁管理儀表板
│   └── tests/                # Jest + Supertest 自動化測試
└── workshop/                 # 🎓 實體手作工作坊教材與證書生成器
```

---

## ⚡ 快速開始

### 1. 前端客戶端 (App)

```bash
# 啟動前端開發伺服器 (預設 Port 5173，自動代理 /api 至後端)
npm run app:dev

# 執行前端自動化測試
npm run app:test

# 進行生產環境打包
npm run app:build
```

### 2. 後端服務 (Backend)

切換至 `backend` 目錄或在根目錄使用 npm scripts：

```bash
# 安裝依賴
npm install

# 啟動後端開發伺服器 (預設 Port 3000)
npm run backend:dev

# 執行後端自動化測試
npm run backend:test
```

啟動後可開啟瀏覽器訪問 `http://localhost:3000` 查看網頁管理儀表板。

### 2. 硬體韌體 (Firmware)

進入 `firmware` 目錄，使用 PlatformIO 進行編譯與燒錄：

```bash
cd firmware
pio run -t upload
pio device monitor
```

---

## 🔌 韌體設計與硬體接線

### ESP32-C3 SuperMini 接線

| HX711 稱重模組 | ESP32-C3 SuperMini | 說明 |
| :--- | :--- | :--- |
| **VCC** | **3V3** (或 5V) | 供電 (建議接 3.3V) |
| **GND** | **GND** | 接地 |
| **DT (Data)** | **GPIO 2** | 數據輸出訊號線 |
| **SCK (Clock)**| **GPIO 3** | 時脈控制訊號線 |

> **提示**：ESP32-C3 板載藍色 LED 位於 **GPIO 8**。

### 5KG 圓形秤架感測器 (4 線) 接 HX711

| 導線顏色 | HX711 稱重端子 | 說明 |
| :--- | :--- | :--- |
| **紅色 (Red)** | **E+** | 激勵正極 (Excitation +) |
| **黑色 (Black)** | **E-** | 激勵負極 (Excitation -) |
| **白色 (White)** | **A-** | 訊號負極 (Signal -) |
| **綠色 (Green)** | **A+** | 訊號正極 (Signal +) |

---

## 📶 網路配網與雲端直傳 (WiFi & Cloud Upload)

> **⚠️ 預設為 BLE-only 模式，本節功能目前停用。**
>
> `Config.h` 的 `WATER_BLE_ONLY` 預設為 `1`：不啟動配網熱點、不做裝置端雲端直傳，
> Wi-Fi 完全不初始化，單一 2.4GHz radio 全部留給 BLE。資料由手機透過 BLE 取走後，
> 再由手機呼叫後端 API。
>
> 這是因為 ESP32-C3 只支援 2.4GHz 且僅支援一般密碼制 (WPA2 Personal)，
> 無法加入 WPA2 Enterprise 企業網路。若有 2.4GHz + 一般密碼的網路可用，
> 把 `WATER_BLE_ONLY` 設為 `0` 即可啟用本節所有功能。

ESP32-C3 支援 **BLE 輔助配網** 與 **WiFi 獨立雲端直傳**：

### 1. BLE 配網指令
透過 BLE `COMMAND_UUID` 發送 JSON 指令：
* **配網與配置雲端**：
  ```json
  {
    "action": "configure_wifi",
    "ssid": "Home_WiFi_2.4G",
    "password": "wifi_password",
    "apiBaseUrl": "http://192.168.1.100:3000",
    "deviceToken": "dvt_abcdef123456..."
  }
  ```
* **清除 WiFi 設定**：
  ```json
  {"action": "clear_wifi"}
  ```

### 2. Serial 診斷指令

| 指令 | 說明 |
| :--- | :--- |
| `WIFI:STATUS` | 顯示目前 WiFi 連線、IP、訊號強度與離線待傳佇列長度 |
| `WIFI:CLEAR` | 清除 NVS 中儲存的 WiFi 設定與離線佇列 |
| `WIFI:SET:<ssid>,<pass>,<url>,<token>` | 透過序列埠直接配置 WiFi 與雲端資訊 |
| `TARE` | 去皮歸零 |
| `CAL:<克數>` | 以已知重量校準，例如 `CAL:500` |
| `RAW` | 顯示 HX711 狀態與原始 24-bit ADC 讀數 |
| `STATUS` | 顯示重量、狀態機、今日總計與系統時間 |
| `RESET` | 重設今日累計飲水量 |

---

## 📡 API 規格總覽

| 端點 | 方法 | 認證方式 | 說明 |
| :--- | :--- | :--- | :--- |
| `/api/v1/health` | GET | 無 | 伺服器健康檢查 |
| `/api/v1/auth/register` | POST | 無 | 用戶註冊 |
| `/api/v1/auth/login` | POST | 無 | 用戶登入並發放 JWT |
| `/api/v1/user/me` | GET / PUT | JWT | 取得 / 更新個人檔案與喝水目標 |
| `/api/v1/devices` | POST / GET | JWT | 綁定智慧水杯 (生成 Device Token) / 列出裝置 |
| `/api/v1/devices/:id` | DELETE | JWT | 解除裝置綁定 (撤銷 Token) |
| `/api/v1/devices/:id/status` | GET | JWT | 取得裝置最後上傳時間與在線狀態 |
| `/api/v1/water/records` | POST | Device Token | 裝置/App 上傳喝水與加水事件 (具備 eventId 冪等去重) |
| `/api/v1/water/records` | GET | JWT | 查詢喝水歷程 (支援日期區間與分頁) |
| `/api/v1/water/stats/daily` | GET | JWT | 當日喝水目標達成率與喝水/補水次數 |
| `/api/v1/water/stats/weekly` | GET | JWT | 過去 7 日飲水趨勢與達標天數 |
| `/api/v1/water/stats/monthly`| GET | JWT | 過去 30 日月統計與喝水連續天數 (Streak) |

---

## 🎓 實體手作工作坊

本專案提供 5 小時實體工作坊課程與教學套件（定價 NT$ 2,500，含完整硬體材料包）：
- **工作坊說明與線上報名頁**：[workshop/index.html](workshop/index.html)
- **主辦人籌備與開課指南**：[workshop/README.md](workshop/README.md)
