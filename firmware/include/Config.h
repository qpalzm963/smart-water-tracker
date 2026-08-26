#pragma once
#include <Arduino.h>

// ==========================================
// 硬體腳位設定 (ESP32-C3 SuperMini)
// ==========================================
#define PIN_HX711_DT       2   // HX711 數據引腳 (Data Pin)
#define PIN_HX711_SCK      3   // HX711 時脈引腳 (Clock Pin)
#define PIN_STATUS_LED     8   // ESP32-C3 SuperMini 板載藍色 LED (低電位觸發 Active Low)

// ==========================================
// 預設演算法與運作參數
// ==========================================
#define DEFAULT_CALIBRATION_FACTOR   420.0f  // 預設校準係數 (可透過 Serial CAL: 指令更新)
#define DEFAULT_DAILY_GOAL_ML        2000    // 每日飲水目標 (毫升)
#define DEFAULT_REMINDER_MINUTES     45      // 久未喝水提醒間隔 (分鐘)
#define MIN_DRINK_THRESHOLD_G        15.0f   // 判定為喝水的最小重量減少量 (克/毫升)
#define REFILL_THRESHOLD_G           35.0f   // 判定為加水的重量增加量 (克/毫升)
#define EMPTY_CUP_THRESHOLD_G        25.0f   // 空秤閾值 (低於此重量視為杯子已拿開)
#define STABILITY_TOLERANCE_G        1.5f    // 讀數穩定判定公差 (克)
#define STABLE_SAMPLES_REQUIRED      4       // 連續穩定取樣次數

// ==========================================
// 儲存設定
// ==========================================
// 判定系統時間是否已校時過的下限 (2020-09-13)。未校時的 time() 只會回傳開機秒數。
#define TIME_SYNCED_EPOCH_MIN       1600000000

#define PREFS_NAMESPACE             "water_app"
#define NVS_KEY_WIFI_SSID           "wifi_ssid"
#define NVS_KEY_WIFI_PASS           "wifi_pass"
#define NVS_KEY_API_URL             "api_url"
#define NVS_KEY_DEVICE_TOKEN        "dev_token"
#define NVS_KEY_SETUP_SECRET        "setup_secret"

// ==========================================
// 運作模式
// ==========================================
// 1 = 裝置只做 BLE，由手機負責打後端 API 同步。
//     關閉配網熱點與裝置端雲端直傳，Wi-Fi 完全不啟動。
//     公司網路是 WPA2 Enterprise，ESP32-C3 無法加入，故預設走此模式。
// 0 = 裝置自行連 Wi-Fi 並直傳雲端（需要 2.4GHz + 一般密碼的網路）。
#define WATER_BLE_ONLY              1

// ==========================================
// 手機瀏覽器配網入口
// ==========================================
#define PROVISIONING_AP_PREFIX          "WaterTracker-"
#define PROVISIONING_AP_IP_OCTET        4
#define PROVISIONING_FAILURE_DELAY_MS   300000UL
#define PROVISIONING_MAX_SSID_LENGTH    32
#define PROVISIONING_MIN_PASSWORD_LENGTH 8
#define PROVISIONING_MAX_PASSWORD_LENGTH 63
#define PROVISIONING_START_RETRY_MS     5000UL   // 熱點啟動失敗後的重試間隔

// ==========================================
// 網路與 NTP 設定
// ==========================================
#define NTP_SERVER_PRIMARY          "pool.ntp.org"
#define NTP_SERVER_SECONDARY        "time.nist.gov"
#define DEFAULT_TZ_OFFSET_SEC       (8 * 3600)  // 台北時區 UTC+8
#define DEFAULT_DAYLIGHT_OFFSET_SEC 0
#define WIFI_RECONNECT_INTERVAL_MS  15000       // 斷線重連檢查間隔 (15 秒)

// ==========================================
// 雲端直傳與離線緩存設定
// ==========================================
#define MAX_OFFLINE_UPLOAD_QUEUE    32          // 離線待上傳事件佇列上限
#define UPLOAD_RETRY_INTERVAL_MS    10000       // 離線佇列重傳間隔 (10 秒)
#define HTTP_REQUEST_TIMEOUT_MS     8000        // HTTP 請求超時時間
