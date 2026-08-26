#pragma once

#include <Arduino.h>

class WaterNetworkManager {
public:
    WaterNetworkManager();

    // 初始化：讀取 NVS 設定並嘗試連線
    void begin();

    // 週期性呼叫 (由 main loop 驅動，非阻塞)。配網熱點顯示期間暫停自動重連。
    void update(bool allowReconnect = true);

    // 是否已配置 WiFi SSID
    bool isConfigured() const;

    // 目前 WiFi 是否已連線並取得 IP
    bool isConnected() const;

    // 儲存 WiFi 與雲端配置到 NVS；瀏覽器配網可延後連線，先讓 HTTP 回應送達手機。
    bool saveConfig(const String& ssid, const String& password, const String& apiBaseUrl,
                    const String& deviceToken, bool connectImmediately = true);

    // 清除 NVS 中的 WiFi 設定並斷開連線
    void clearConfig();

    // 手動觸發重新連線
    void reconnect();

    // 取得各項資訊
    String getSsid() const { return _ssid; }
    String getApiBaseUrl() const { return _apiBaseUrl; }
    String getDeviceToken() const { return _deviceToken; }
    String getIpAddress() const;
    int getRssi() const;

    // 已設定但斷線時，回傳斷線持續時間；未斷線或未設定時回傳 0。
    unsigned long disconnectedForMs() const;

private:
    void loadFromNvs();
    void startConnecting();
    void syncTimeNtp();

    String _ssid;
    String _password;
    String _apiBaseUrl;
    String _deviceToken;

    bool _isConfigured = false;
    bool _wasConnected = false;
    unsigned long _disconnectedSinceMs = 0;
    unsigned long _lastReconnectAttempt = 0;
    unsigned long _lastTimeSyncAttempt = 0;
};
