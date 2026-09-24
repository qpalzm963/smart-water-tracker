# 小貓釣魚 — macOS

「小貓釣魚」是 Smart Water Tracker 的 macOS 桌面版本，將喝水紀錄、智慧杯墊與釣魚收藏遊戲整合成常駐桌面的原生 App。

- **版本**：0.2.0
- **需求**：macOS 14+
- **技術**：Swift 5.9、SwiftUI + AppKit
- **相依套件**：無第三方套件
- **資料儲存**：本機 JSON

## 快速開始

需要 Xcode 15 以上或相容的 Swift 工具鏈。

```sh
cd macos
swift test
bash scripts/build-app.sh
open build/小貓釣魚.app
```

也可以直接雙擊 `build/小貓釣魚.app`。

> `build-app.sh` 會建立本機 ad-hoc 簽署的 App Bundle，目前尚未進行 Developer ID 公證或 App Store 發布。產物使用建置 Mac 的 CPU 架構。

開發時可直接用 Xcode 開啟 `Package.swift`。若要測試藍牙權限，請執行建置後的 `.app`，以使用 `Info.plist` 中的權限說明。

## 功能總覽

| 功能 | 說明 |
| --- | --- |
| 桌面池塘 | 無標題列的小視窗，可拖曳、縮放、置頂與隱藏 |
| 喝水紀錄 | 支援 100 / 200 / 300 ml、自訂水量與歷史紀錄 |
| 選單列 | 從水滴圖示快速查看今日飲水量、目標進度與新增紀錄 |
| 釣魚遊戲 | 喝水累積釣魚機會，包含收竿動畫與魚種收藏 |
| 魚缸與圖鑑 | 展示最近捕獲的魚、收藏狀態與捕獲資訊 |
| 天氣系統 | 依台灣 22 縣市載入天氣，影響池塘場景與限定魚 |
| 智慧杯墊 | 透過 Bluetooth LE 接收即時與歷史喝水事件 |
| 統計與資料 | 最近七天趨勢、紀錄刪除、JSON 匯出與本機備份 |
| 無障礙 | 支援 macOS「減少動態效果」設定 |

## 基本操作

### 桌面池塘

- 滑鼠移入池塘後，可使用隱藏、置頂、紀錄與展開按鈕。
- 空白處可以拖曳視窗，邊緣可以調整大小。
- 在池塘按右鍵可快速開啟紀錄、魚缸、置頂或隱藏池塘。
- 木棧台上的水杯會顯示今日飲水量與目標進度。
- 點擊水杯可新增紀錄；移入時會顯示距離下一次釣魚所需的水量。
- 有可用釣魚機會時，池塘會提供「收竿 ×N」操作。

### 選單列與完整視窗

App 不占用 Dock，可從右上角水滴選單列圖示操作：

- 查看今日總量與目標進度
- 快速新增 100 / 200 / 300 ml
- 輸入自訂水量
- 開啟完整視窗

完整視窗包含：

- 魚缸
- 收藏圖鑑
- 七日飲水趨勢
- 歷史紀錄
- JSON 匯出
- 天氣與智慧杯墊設定

## 釣魚規則

### 取得釣魚機會

- 手動喝水與智慧杯墊的**即時喝水事件**會累積進度。
- 每累積 **200 ml** 取得 1 次釣魚機會。
- 多出的水量會保留，例如 450 ml 會取得 2 次，並保留 50 ml。
- 未滿 200 ml 的剩餘進度會跨日與跨重啟保留。
- 已取得的釣魚機會不會過期。
- 每個本地日最多發放 **8 次**，已使用的次數仍計入當日上限。
- 達到每日上限後，喝水仍會正常記錄，但當日不再累積釣魚進度。

以下事件不會新增釣魚獎勵：

- 歷史補傳事件
- `refill` 補水事件
- 刪除既有喝水紀錄

刪除手動紀錄只會修正飲水總量，不會回溯既有釣魚次數或累積進度。

### 魚種與抽選

普通魚共五種：

| 魚種 | 權重 |
| --- | ---: |
| 蜜桃 | 32% |
| 日光 | 28% |
| 薄荷 | 22% |
| 藍莓 | 14% |
| 月光 | 4% |

特殊天氣另有三種限定魚：

- 雨天：雨滴魚
- 雷雨：雷光魚
- 起霧：霧紗魚

特殊天氣下，限定魚機率為 **20%**；其餘 **80%** 使用普通魚池比例抽選。雷雨不會混入雨滴魚。

按下收竿時就會鎖定當下的魚與有效天氣，並立即保存收藏；即使動畫途中關閉 App，也不會遺失已捕獲的魚。

## 天氣系統

在「設定與杯墊 → 池塘天氣」選擇台灣 22 縣市之一。城市設定會保存在本機，未選城市時維持普通池塘與普通魚池。

天氣資料由 [Open-Meteo](https://open-meteo.com/en/docs) 提供：

- 使用縣市代表位置的氣象模型資料，不使用裝置定位。
- 正常每 30 分鐘更新一次。
- 更新失敗時每 5 分鐘重試。
- Mac 從睡眠喚醒時會檢查是否需要更新。
- 天氣快取可跨重啟使用，最長保留 2 小時。
- 切換城市時會清除舊城市天氣，避免舊請求結果覆蓋新設定。

目前特殊場景包含雨天、雷雨與起霧。晴天、多雲及尚未支援特殊場景的天氣仍使用普通魚池，但會正常顯示天氣狀態。

系統開啟「減少動態效果」時，天氣與收竿動畫會改為較靜態的呈現。

> 此本機試用版使用 Open-Meteo 公開非商用 API。若要商業發行，需依供應商方案重新確認端點與授權。

## 智慧杯墊與 Bluetooth LE

macOS App 沿用 `firmware/include/BleProtocol.h` 定義的五個 GATT UUID，不修改既有韌體與後端協定。

流程：

1. 使用者在「設定與杯墊」搜尋並選擇裝置。
2. App 才會請求 Bluetooth 權限並建立連線。
3. 訂閱即時與歷史事件。
4. 讀取 summary、寫入 `set_time`，再要求重播裝置保留事件。
5. 使用 peripheral ID + event ID 持久化去重，避免即時與補傳重複計算。

注意事項：

- `refill` 會顯示在紀錄中，但不增加飲水量，也不發放釣魚獎勵。
- 歷史補傳可以補回紀錄，但不重新發放獎勵。
- 韌體目前只在 RAM 保留最近 64 筆事件，裝置重開後無法由 App 恢復已遺失事件。
- 未校時事件會標示為「杯墊 · 接收時間」，不推測原始喝水時間。
- 杯墊離線時仍可手動記錄；同一次喝水請避免同時手動與自動記錄。

## 資料、備份與版本相容

資料預設存放於：

```text
~/Library/Application Support/CatPond/state.json
```

App 使用原子寫入。若讀到損壞或不支援版本的資料，不會覆寫原檔，並會在 UI 顯示錯誤。

目前資料格式為 **v2**：

- 從 v1 升級時保留既有喝水紀錄、魚隻與釣魚次數。
- 第一次儲存 v2 時，原始 v1 會備份為 `state-v1-backup.json`。
- 新版魚種與欄位採可選欄位維持舊資料相容。
- 若新版資料已包含舊版無法辨識的魚種，不建議直接降版。

備份時可複製整個：

```text
~/Library/Application Support/CatPond/
```

還原前請先結束 App。

目前資料只保存在本機，尚未串接既有雲端帳號或 API，因此沒有跨裝置同步。

## 開發與測試

### 專案結構

```text
macos/
├── Sources/
│   ├── CatPond/       # App、SwiftUI/AppKit UI、Bluetooth、天氣與素材
│   └── PondCore/      # 飲水、釣魚、動畫與天氣核心規則
├── Tests/
│   ├── CatPondTests/
│   └── PondCoreTests/
├── Design/            # UI、素材與動畫設計文件
├── scripts/
│   └── build-app.sh   # Release 建置與 App Bundle 打包
├── Info.plist
├── Package.swift
└── README.md
```

### 執行測試

```sh
swift test
```

測試涵蓋：

- 飲水累積與每日釣魚上限
- 事件去重、重啟與裝置隔離
- 手動／杯墊／補傳／refill 行為
- 收竿保存與動畫時間
- v1 → v2 資料升級與損壞檔案保護
- 天氣碼、快取、城市切換與 API 異常
- 天氣限定魚與抽選比例
- 喝水回饋與減少動態效果

### 使用隔離資料進行 UI 驗證

先結束正在執行的 App，再於 `macos` 目錄執行：

```sh
CATPOND_DATA_DIR="$PWD/build/qa-data" ./build/小貓釣魚.app/Contents/MacOS/CatPond
```

產生天氣、收竿與魚種的 QA 預覽：

```sh
CATPOND_QA_ARTIFACTS="$PWD/build/weather-qa" \
swift test --filter WeatherIntegrationTests/testRenderWeatherScenesAndAllFishAssets
```

## 美術與設計文件

核可示意稿：

- [approved-concept.png](Design/approved-concept.png)
- [approved-fish.png](Design/approved-fish.png)
- [approved-reel-storyboard.png](Design/approved-reel-storyboard.png)

詳細設計文件：

- [魚缸與完整視窗 UI](Design/aquarium-ui.md)
- [美術素材與生成方式](Design/artwork.md)
- [收竿動畫](Design/reel-animation.md)
- [天氣場景與限定魚](Design/weather.md)

實際執行素材位於 `Sources/CatPond/Resources/`。魚、水波、水杯、魚線與貓咪動畫由 sprite、程式繪圖與關鍵姿勢組合完成，執行時不依賴外部生成工具。

## 目前限制

- 尚未進行 Developer ID 公證或 App Store 發布。
- 目前沒有雲端同步。
- Bluetooth 通訊已依韌體協定實作，但仍需搭配實體杯墊持續驗證 MTU、通知與重連行為。
- 建置產物為目前 Mac 的 CPU 架構，尚未製作 Universal Binary。
