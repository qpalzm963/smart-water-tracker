#include "WaterNetworkManager.h"
#include <WiFi.h>
#include <Preferences.h>
#include <time.h>
#include "Config.h"

// 選用的本機預設設定。LocalSecrets.h 不進版控；沒有它時這段完全不編譯。
#if __has_include("LocalSecrets.h")
#include "LocalSecrets.h"
#endif

WaterNetworkManager::WaterNetworkManager()
    : _isConfigured(false),
      _wasConnected(false),
      _lastReconnectAttempt(0),
      _lastTimeSyncAttempt(0) {}

void WaterNetworkManager::begin() {
    // Keep Wi-Fi settings out of NVS. Persisted mode/channel state survives reboots
    // and power cycles, so one accidental switch into AP+STA (a scan does exactly
    // that) leaves this ESP32-C3 unable to beacon on every later boot.
    WiFi.persistent(false);

    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);

    loadFromNvs();

#if defined(LOCAL_WIFI_SSID)
    // 尚未配網時帶入本機預設值，省去每次清除 NVS 後都要重跑一次手機配網。
    if (!_isConfigured) {
        Serial.println("[WIFI] NVS 無設定，套用 LocalSecrets.h 的預設 Wi-Fi");
        saveConfig(LOCAL_WIFI_SSID, LOCAL_WIFI_PASS, LOCAL_API_BASE_URL, LOCAL_DEVICE_TOKEN, false);
    }
#endif

    if (_isConfigured && _ssid.length() > 0) {
        Serial.printf("[WIFI] 從 NVS 讀取到 WiFi 設定，SSID: %s，開始連線...\n", _ssid.c_str());
        startConnecting();
        _disconnectedSinceMs = millis();
    } else {
        Serial.println("[WIFI] 尚未設定 WiFi，等待透過 BLE 配網或 Serial 配置");
    }
}

void WaterNetworkManager::loadFromNvs() {
    Preferences prefs;
    if (!prefs.begin(PREFS_NAMESPACE, true)) {
        Serial.println("[WIFI] 警告: 無法開啟 NVS 讀取網路設定");
        return;
    }

    _ssid = prefs.getString(NVS_KEY_WIFI_SSID, "");
    _password = prefs.getString(NVS_KEY_WIFI_PASS, "");
    _apiBaseUrl = prefs.getString(NVS_KEY_API_URL, "");
    _deviceToken = prefs.getString(NVS_KEY_DEVICE_TOKEN, "");
    prefs.end();

    _isConfigured = (_ssid.length() > 0);
}

bool WaterNetworkManager::saveConfig(const String& ssid, const String& password, const String& apiBaseUrl,
                                     const String& deviceToken, bool connectImmediately) {
    if (ssid.length() == 0) {
        Serial.println("[WIFI] 錯誤: SSID 不可為空");
        return false;
    }

    Preferences prefs;
    if (!prefs.begin(PREFS_NAMESPACE, false)) {
        Serial.println("[WIFI] 錯誤: 無法開啟 NVS 寫入網路設定");
        return false;
    }

    prefs.putString(NVS_KEY_WIFI_SSID, ssid);
    prefs.putString(NVS_KEY_WIFI_PASS, password);
    prefs.putString(NVS_KEY_API_URL, apiBaseUrl);
    prefs.putString(NVS_KEY_DEVICE_TOKEN, deviceToken);
    prefs.end();

    _ssid = ssid;
    _password = password;
    _apiBaseUrl = apiBaseUrl;
    _deviceToken = deviceToken;
    _isConfigured = true;
    _disconnectedSinceMs = millis();

    Serial.printf("[WIFI] 已成功儲存 WiFi 設定 (SSID: %s, API: %s, Token: %s)\n",
                  _ssid.c_str(),
                  _apiBaseUrl.c_str(),
                  _deviceToken.length() > 8 ? (_deviceToken.substring(0, 4) + "****").c_str() : "****");

    if (connectImmediately) {
        reconnect();
    }
    return true;
}

void WaterNetworkManager::clearConfig() {
    Preferences prefs;
    if (prefs.begin(PREFS_NAMESPACE, false)) {
        prefs.remove(NVS_KEY_WIFI_SSID);
        prefs.remove(NVS_KEY_WIFI_PASS);
        prefs.remove(NVS_KEY_API_URL);
        prefs.remove(NVS_KEY_DEVICE_TOKEN);
        prefs.end();
    }

    _ssid = "";
    _password = "";
    _apiBaseUrl = "";
    _deviceToken = "";
    _isConfigured = false;
    _wasConnected = false;
    _disconnectedSinceMs = 0;

    WiFi.disconnect(true, true);
    Serial.println("[WIFI] 已清除 WiFi 設定並斷開連線");
}

void WaterNetworkManager::startConnecting() {
    if (!_isConfigured || _ssid.length() == 0) {
        return;
    }
    WiFi.mode(WIFI_STA);
    WiFi.disconnect();
    WiFi.begin(_ssid.c_str(), _password.c_str());
    _lastReconnectAttempt = millis();
}

void WaterNetworkManager::reconnect() {
    Serial.println("[WIFI] 正在重新連接 WiFi...");
    startConnecting();
}

void WaterNetworkManager::syncTimeNtp() {
    Serial.printf("[WIFI] 透過 NTP 進行時間校準 (%s)...\n", NTP_SERVER_PRIMARY);
    configTime(DEFAULT_TZ_OFFSET_SEC, DEFAULT_DAYLIGHT_OFFSET_SEC, NTP_SERVER_PRIMARY, NTP_SERVER_SECONDARY);
    _lastTimeSyncAttempt = millis();
}

void WaterNetworkManager::update(bool allowReconnect) {
    const bool nowConnected = isConnected();

    // 狀態轉變為「已連線」
    if (nowConnected && !_wasConnected) {
        _wasConnected = true;
        _disconnectedSinceMs = 0;
        Serial.printf("[WIFI] 連線成功! IP 位址: %s (訊號 RSSI: %d dBm)\n",
                      getIpAddress().c_str(), getRssi());
        syncTimeNtp();
    }
    // 狀態轉變為「已斷線」
    else if (!nowConnected && _wasConnected) {
        _wasConnected = false;
        _disconnectedSinceMs = millis();
        Serial.println("[WIFI] 連線已中斷");
    }

    // 斷線時的非阻塞自動重連機制
    if (allowReconnect && _isConfigured && !nowConnected) {
        if (_disconnectedSinceMs == 0) {
            _disconnectedSinceMs = millis();
        }
        const unsigned long now = millis();
        if (now - _lastReconnectAttempt >= WIFI_RECONNECT_INTERVAL_MS) {
            _lastReconnectAttempt = now;
            if (WiFi.status() != WL_CONNECTED) {
                Serial.printf("[WIFI] 嘗試自動重新連線至 %s...\n", _ssid.c_str());
                WiFi.begin(_ssid.c_str(), _password.c_str());
            }
        }
    }
}

unsigned long WaterNetworkManager::disconnectedForMs() const {
    if (!_isConfigured || isConnected() || _disconnectedSinceMs == 0) {
        return 0;
    }
    return millis() - _disconnectedSinceMs;
}

bool WaterNetworkManager::isConfigured() const {
    return _isConfigured;
}

bool WaterNetworkManager::isConnected() const {
    return WiFi.status() == WL_CONNECTED;
}

String WaterNetworkManager::getIpAddress() const {
    if (isConnected()) {
        return WiFi.localIP().toString();
    }
    return "0.0.0.0";
}

int WaterNetworkManager::getRssi() const {
    if (isConnected()) {
        return WiFi.RSSI();
    }
    return 0;
}
