#include <Arduino.h>
#include "Config.h"
#include "ScaleManager.h"
#include "DrinkTracker.h"
#include "Notifier.h"
#include "BleWaterService.h"
#include "WaterNetworkManager.h"
#include "CloudUploader.h"
#include "ProvisioningPortal.h"

#if !defined(UNIT_TEST) && !defined(PIO_UNIT_TESTING)

// 核心物件實例
ScaleManager scale;
DrinkTracker tracker(scale);
Notifier notifier;
WaterNetworkManager networkManager;
CloudUploader cloudUploader(networkManager);
ProvisioningPortal provisioningPortal(networkManager);
BleWaterService bleWaterService;
// ESP32-C3 shares one 2.4 GHz radio between BLE and Wi-Fi. Kept as a switch so the
// SoftAP can be tested with BLE out of the picture.
constexpr bool kDisableBleForSoftApDiagnostic = false;
bool bleEnabled = false;

// 事件回呼處理
void onTrackerEvent(EventType type, int amountMl, int remainingMl) {
    const time_t nowSec = time(nullptr);
#if !WATER_BLE_ONLY
    const bool timeSynced = nowSec > TIME_SYNCED_EPOCH_MIN;
#endif

    if (type == EVENT_DRINK) {
        Serial.printf("[MAIN] 收到喝水事件: +%dml, 杯中剩餘: %dml, 今日總計: %dml\n",
                      amountMl, remainingMl, tracker.getTodayTotalMl());
        notifier.notifyDrink();
        if (bleEnabled) bleWaterService.recordDrink(nowSec, amountMl, remainingMl, tracker.getTodayTotalMl());
#if !WATER_BLE_ONLY
        cloudUploader.postEvent(EVENT_DRINK, amountMl, remainingMl, tracker.getTodayTotalMl(),
                                nowSec, bleWaterService.latestEventId(), timeSynced);
#endif
    } else if (type == EVENT_REFILL) {
        Serial.printf("[MAIN] 收到補水事件: +%dml, 杯中剩餘: %dml\n",
                      amountMl, remainingMl);
        notifier.notifyRefill();
        if (bleEnabled) bleWaterService.recordRefill(nowSec, amountMl, remainingMl, tracker.getTodayTotalMl());
#if !WATER_BLE_ONLY
        cloudUploader.postEvent(EVENT_REFILL, amountMl, remainingMl, tracker.getTodayTotalMl(),
                                nowSec, bleWaterService.latestEventId(), timeSynced);
#endif
    }
}

void onTrackerReminder() {
    Serial.printf("[MAIN] 收到久未喝水提醒 (已超過 %d 分鐘未喝水)\n",
                  tracker.getReminderIntervalMinutes());
    notifier.notifyReminder();
}

void setup() {

    // ESP32-C3 在 80MHz 下無法可靠廣播 SoftAP；保留預設 160MHz，
    // 以確保首次配網的 Wi-Fi 熱點可被手機掃到。

    Serial.begin(115200);
    delay(1000);
    Serial.println("\n==========================================");
    Serial.println("   智慧喝水偵測器 (ESP32-C3 SuperMini)     ");
    Serial.println("==========================================");

    // 1. 初始化通知與指示燈
    notifier.begin(PIN_STATUS_LED);

    // 2. 初始化稱重感測器
    if (!scale.begin(PIN_HX711_DT, PIN_HX711_SCK)) {
        Serial.println("[MAIN] ⚠️ HX711 感測器未就緒，請檢查接線！");
    }

    // 3. 綁定追蹤器回呼並啟動
    tracker.onDrinkEvent(onTrackerEvent);
    tracker.onReminder(onTrackerReminder);

    tracker.begin();

    // 4. 初始化網路與自動連線 (非阻塞)
#if !WATER_BLE_ONLY
    networkManager.begin();
#else
    // BLE-only: 完全不碰 Wi-Fi，讓單一 2.4GHz radio 專供 BLE 使用。
    Serial.println("[MAIN] BLE-only 模式，Wi-Fi 與雲端直傳停用，改由手機同步");
#endif

    // 5. 啟動 BLE 藍牙服務
    String deviceId = "water_" + String((uint32_t)ESP.getEfuseMac(), HEX);
#if !WATER_BLE_ONLY
    provisioningPortal.begin(deviceId);
#endif
    if (!kDisableBleForSoftApDiagnostic) {
        bleWaterService.begin(deviceId, &scale, &tracker, &networkManager);
        bleWaterService.updateSummary(tracker.getTodayTotalMl(), tracker.getDailyGoalMl(),
                                      scale.getFilteredWeight(), scale.isStable());
        bleEnabled = true;
    }

    Serial.println("[MAIN] 系統初始化完成，開始監控飲水狀態...");
}

void handleSerialCommands() {
    if (!Serial.available()) return;
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    if (cmd.length() == 0) return;

    if (cmd.equalsIgnoreCase("TARE")) {
        scale.tare(15);
        Serial.println("[MAIN] 已執行去皮歸零");
    } else if (cmd.startsWith("CAL:")) {
        float weight = cmd.substring(4).toFloat();
        if (weight > 0) {
            if (scale.calibrateWithKnownWeight(weight)) {
                Serial.printf("[MAIN] 校準成功! 已知重量: %.1fg\n", weight);
            } else {
                Serial.println("[MAIN] 校準失敗");
            }
        }
    } else if (cmd.equalsIgnoreCase("RAW")) {
        Serial.printf("[MAIN] HX711 狀態: %s | 準備就緒: %s | 24-bit ADC 讀數: %ld | 濾波重: %.1fg\n",
                      scale.isConnected() ? "已連線" : "未連線/逾時",
                      scale.isReady() ? "就緒" : "等待中",
                      scale.getRawValue(),
                      scale.getFilteredWeight());
    } else if (cmd.equalsIgnoreCase("STATUS")) {
        const time_t nowSec = time(nullptr);
        Serial.printf("----------------------------------------\n");
        Serial.printf("[STATUS] 重量: %.1fg (原始: %.1f) | 狀態: %s | 今日總計: %dml\n",
                      scale.getFilteredWeight(), scale.getWeight(),
                      tracker.getStateString(), tracker.getTodayTotalMl());
        if (nowSec > TIME_SYNCED_EPOCH_MIN) {
            struct tm timeinfo;
            localtime_r(&nowSec, &timeinfo);
            Serial.printf("[STATUS] 裝置時間: %04d-%02d-%02d %02d:%02d:%02d\n",
                          timeinfo.tm_year + 1900, timeinfo.tm_mon + 1, timeinfo.tm_mday,
                          timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
        } else {
            Serial.println("[STATUS] 裝置時間: 尚未校時 (等待手機透過 BLE 送出 set_time 或 WiFi NTP)");
        }
        Serial.printf("----------------------------------------\n");
    } else if (cmd.equalsIgnoreCase("RESET")) {
        tracker.resetDailyTotal();
        Serial.println("[MAIN] 今日飲水量已重設");
    } else if (cmd.equalsIgnoreCase("WIFI:STATUS")) {
        Serial.println("----------------------------------------");
        Serial.printf("[WIFI] 已配置: %s | 連線狀態: %s\n",
                      networkManager.isConfigured() ? "是" : "否",
                      networkManager.isConnected() ? "已連線" : "未連線");
        Serial.printf("[WIFI] SSID: %s | IP: %s | RSSI: %d dBm\n",
                      networkManager.getSsid().c_str(),
                      networkManager.getIpAddress().c_str(),
                      networkManager.getRssi());
        Serial.printf("[WIFI] API Base: %s\n", networkManager.getApiBaseUrl().c_str());
        Serial.printf("[WIFI] 離線待上傳佇列長度: %u\n",
                      static_cast<unsigned int>(cloudUploader.getPendingQueueSize()));
        Serial.println("----------------------------------------");
    } else if (cmd.equalsIgnoreCase("WIFI:CLEAR")) {
        networkManager.clearConfig();
        cloudUploader.clearQueue();
        Serial.println("[MAIN] 已清除 WiFi 設定與離線待傳佇列");
    } else if (cmd.equalsIgnoreCase("SETUP:QR")) {
        // 僅供交付前以 USB Serial 製作機身 QR 標籤，切勿提供給一般使用者。
        Serial.printf("[SETUP] QR payload: %s\n", provisioningPortal.getQrPayload().c_str());
    } else if (cmd.equalsIgnoreCase("PORTAL:STATUS")) {
        Serial.printf("[PORTAL] %s\n", provisioningPortal.diagnosticStatus().c_str());
    } else if (cmd.startsWith("WIFI:SET:")) {
        // 格式: WIFI:SET:ssid,password,apiUrl,deviceToken
        String params = cmd.substring(9);
        int c1 = params.indexOf(',');
        int c2 = params.indexOf(',', c1 + 1);
        int c3 = params.indexOf(',', c2 + 1);
        if (c1 > 0 && c2 > c1 && c3 > c2) {
            String ssid = params.substring(0, c1);
            String pass = params.substring(c1 + 1, c2);
            String url = params.substring(c2 + 1, c3);
            String token = params.substring(c3 + 1);
            networkManager.saveConfig(ssid, pass, url, token);
            Serial.println("[MAIN] WiFi 與雲端設定已儲存");
        } else {
            Serial.println("[MAIN] 語法錯誤。用法: WIFI:SET:<ssid>,<password>,<apiUrl>,<deviceToken>");
        }
    }
}

void loop() {
    // 處理 Serial 命令 (校準、診斷、WiFi 設定)
    handleSerialCommands();

    // 週期性更新感測器讀數與濾波
    scale.update();

    // 週期性更新喝水狀態機
    tracker.update();

#if !WATER_BLE_ONLY
    const bool shouldRunPortal = ProvisioningPortal::shouldRun(
        networkManager.isConfigured(), networkManager.isConnected(), networkManager.disconnectedForMs());
    if (shouldRunPortal && !provisioningPortal.isActive()) {
        provisioningPortal.start();
    } else if (!shouldRunPortal && provisioningPortal.isActive()) {
        provisioningPortal.stop();
    }

    // 週期性更新 WiFi 網路狀態與 NTP 校時。熱點顯示期間不可啟用 STA，
    // 否則 ESP32-C3 會回到不廣播 beacon 的 AP+STA 模式。
    networkManager.update(!provisioningPortal.isActive());
    provisioningPortal.update();

    // 週期性重試雲端離線佇列
    cloudUploader.update();
#endif

    // 執行 BLE 排隊進來的命令 (tare / reset_daily / set_time / configure_wifi / clear_wifi)，
    // 確保只在主迴圈碰 HX711 與 NVS
    if (bleEnabled) bleWaterService.processPendingCommands();

    // Keep the GATT summary current without touching the drink-detection path.
    if (bleEnabled) bleWaterService.updateSummary(tracker.getTodayTotalMl(), tracker.getDailyGoalMl(),
                                                  scale.getFilteredWeight(), scale.isStable());

    // 處理 LED 燈效與非阻塞動畫
    notifier.update();


    // 微小讓步給背景任務
    delay(10);
}

#endif  // !UNIT_TEST && !PIO_UNIT_TESTING
