# App 圖示系統調整規格

## 目標

移除前端所有 emoji 圖示與裝飾性 emoji 文案，建立一致、克制、可縮放的產品圖示語言，降低介面的生成式設計感，同時保留清楚的操作辨識與狀態回饋。

## 已確認方向

- 調整範圍涵蓋整個 React App：登入、首頁、歷程、統計、BLE、裝置、設定、Toast 與 favicon。
- 一般功能圖示使用專案既有的 `lucide-react`。
- 品牌用途的水滴、水杯可使用自訂 SVG 或現有 CSS/SVG 水杯插畫。
- 文案不以 emoji 作為句首、裝飾或狀態標記。
- 不改動 API、資料結構、BLE 協議、導航架構或業務邏輯。

## 圖示規則

### 功能圖示

- 導覽與頁面標題：使用 20–24px Lucide 圖示。
- 按鈕：使用 16–20px 圖示，圖示放在文字前方。
- 純圖示按鈕：點擊區至少 44×44px，必須提供 `aria-label`。
- 同類動作固定使用同一圖示，例如重新整理一律使用 `RefreshCw`、刪除一律使用 `Trash2`。

### 品牌圖示

- 登入頁與 favicon 使用簡潔水滴標誌，不使用飲料杯 emoji。
- 首頁水杯仍使用既有自訂 SVG，因為它承載動態水位資訊。
- 品牌圖示只作識別，不混用作一般按鈕圖示。

### 狀態呈現

- 成功：`CircleCheck` 或 `Check`＋文字＋綠色。
- 錯誤：`CircleX` 或 `TriangleAlert`＋文字＋紅色。
- 警告／處理中：`LoaderCircle`、`Clock3` 或 `TriangleAlert`＋文字＋黃色／藍色。
- 線上／穩定：小型實心狀態點＋文字；不使用彩色圓形 emoji。
- 狀態不可只靠顏色表達，圖示旁必須有文字。

## 各頁替換

- `AuthView`：水杯 emoji 改為品牌水滴 SVG。
- `DashboardView`：移除問候句尾水滴 emoji，其餘沿用 Lucide 與自訂 SVG。
- `HistoryView`：標題、重新整理、喝水／補水類型改用 `History`、`RefreshCw`、`GlassWater`、`Droplets`。
- `StatsView`：標題、重新計算、月統計、達標狀態改用 `ChartNoAxesColumnIncreasing`、`RefreshCw`、`CalendarDays`、`CircleCheck`／純文字。
- `BleDeviceView`：掃描、連線、穩定、校時、Wi-Fi、去皮、重設、模擬事件改用對應 Lucide 圖示與語意狀態點。
- `DevicesView`：標題、重新整理、線上狀態、Token 輪替與解除綁定改用 `Cpu`、`RefreshCw`、狀態點、`RotateCw`、`Trash2`。
- `SettingsView`：標題、每日目標、同步、清空改用 `Settings`、`Target`、`RefreshCw`、`Trash2`。
- `Toast`：使用 `CircleCheck`、`CircleX`、`Info`，維持現有成功／錯誤／資訊色彩。
- `index.html`：favicon 改為內嵌水滴 SVG path，不嵌入 emoji 字元。

## 元件策略

- 新增小型 `StatusIcon` 或在現有元件內直接映射 Toast 狀態；避免建立過度抽象的通用圖示框架。
- 按鈕沿用 `.btn` 的 flex 佈局，新增統一的 SVG 尺寸與 `flex-shrink: 0` 規則。
- 頁面標題可新增 `.title-with-icon` 類別，統一圖示、文字對齊與間距。
- 狀態點沿用現有 `.status-dot`，補上文字與可辨識的 class。

## 無障礙

- 與可見文字重複的裝飾圖示使用 `aria-hidden="true"`。
- 純圖示控制必須有 `aria-label` 或可見的輔助文字。
- Loading 圖示加入動畫時遵守 `prefers-reduced-motion`。
- 下拉選單選項只保留文字，避免在原生 `<option>` 中插入 SVG 或 emoji。

## 驗證

- 使用 Unicode 掃描確認 `app/src` 與 `app/index.html` 不再含既有 emoji。
- TypeScript production build 通過。
- 所有前端 Vitest 測試通過。
- 瀏覽登入、首頁、歷程、統計、BLE、裝置與設定頁，確認沒有缺圖、按鈕錯位或僅靠顏色傳達狀態。
- 375px 與桌面置中尺寸不產生水平溢出。

## 不在範圍

- 重新設計各頁資訊架構。
- 更換字體、品牌色或首頁卡片版型。
- 新增圖示套件或下載第三方圖示資產。
- 修改後端、韌體或資料庫。
