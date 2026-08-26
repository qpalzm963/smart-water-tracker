#include "CloudUploader.h"
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <WiFiClient.h>
#include <ArduinoJson.h>

CloudUploader::CloudUploader(WaterNetworkManager& networkManager)
    : _netManager(networkManager),
      _lastRetryAttempt(0) {}

String CloudUploader::buildEndpointUrl() const {
    String base = _netManager.getApiBaseUrl();
    base.trim();
    if (base.length() == 0) {
        return "";
    }
    if (base.endsWith("/")) {
        base = base.substring(0, base.length() - 1);
    }
    if (base.endsWith("/api/v1/water/records")) {
        return base;
    }
    if (base.endsWith("/api/v1")) {
        return base + "/water/records";
    }
    return base + "/api/v1/water/records";
}

bool CloudUploader::sendHttpRequest(const CloudWaterEvent& event) {
    const String endpoint = buildEndpointUrl();
    const String token = _netManager.getDeviceToken();

    if (endpoint.length() == 0) {
        Serial.println("[CLOUD] 尚未設定後端 API 網址，取消發送");
        return false;
    }

    if (token.length() == 0) {
        Serial.println("[CLOUD] 尚未設定 Device Token，取消發送");
        return false;
    }

    if (!_netManager.isConnected()) {
        return false;
    }

    JsonDocument doc;
    doc["eventId"] = event.eventId;
    doc["type"] = (event.type == EVENT_REFILL) ? "refill" : "drink";
    doc["amountMl"] = event.amountMl;
    doc["remainingMl"] = event.remainingMl;
    doc["todayTotalMl"] = event.todayTotalMl;
    doc["occurredAt"] = static_cast<long long>(event.occurredAt);
    doc["timeSynced"] = event.timeSynced;

    String body;
    serializeJson(doc, body);

    HTTPClient http;
    http.setTimeout(HTTP_REQUEST_TIMEOUT_MS);

    bool success = false;
    if (endpoint.startsWith("https://")) {
        WiFiClientSecure secureClient;
        secureClient.setInsecure();
        if (http.begin(secureClient, endpoint)) {
            http.addHeader("Content-Type", "application/json");
            http.addHeader("Authorization", "Bearer " + token);
            const int httpCode = http.POST(body);
            if (httpCode >= 200 && httpCode < 300) {
                Serial.printf("[CLOUD] ✅ HTTPS 上傳成功 (HTTP %d, eventId: %s)\n",
                              httpCode, event.eventId.c_str());
                success = true;
            } else {
                Serial.printf("[CLOUD] ⚠️ HTTPS 上傳失敗 (HTTP %d, 回應: %s)\n",
                              httpCode, http.getString().c_str());
            }
            http.end();
        }
    } else {
        WiFiClient client;
        if (http.begin(client, endpoint)) {
            http.addHeader("Content-Type", "application/json");
            http.addHeader("Authorization", "Bearer " + token);
            const int httpCode = http.POST(body);
            if (httpCode >= 200 && httpCode < 300) {
                Serial.printf("[CLOUD] ✅ HTTP 上傳成功 (HTTP %d, eventId: %s)\n",
                              httpCode, event.eventId.c_str());
                success = true;
            } else {
                Serial.printf("[CLOUD] ⚠️ HTTP 上傳失敗 (HTTP %d, 回應: %s)\n",
                              httpCode, http.getString().c_str());
            }
            http.end();
        }
    }

    return success;
}

void CloudUploader::enqueueEvent(const CloudWaterEvent& event) {
    if (_queue.size() >= MAX_OFFLINE_UPLOAD_QUEUE) {
        Serial.println("[CLOUD] 離線佇列已滿，移除最舊的一筆事件");
        _queue.erase(_queue.begin());
    }
    _queue.push_back(event);
    Serial.printf("[CLOUD] 事件已加入離線待傳佇列 (當前佇列長度: %u)\n",
                  static_cast<unsigned int>(_queue.size()));
}

bool CloudUploader::postEvent(EventType type, int amountMl, int remainingMl, int todayTotalMl,
                             time_t occurredAt, const String& eventId, bool timeSynced) {
    CloudWaterEvent event;
    event.eventId = eventId;
    event.type = type;
    event.amountMl = amountMl;
    event.remainingMl = remainingMl;
    event.todayTotalMl = todayTotalMl;
    event.occurredAt = occurredAt;
    event.timeSynced = timeSynced;

    // 若當前已連線且佇列為空，直接嘗試上傳
    if (_netManager.isConnected() && _queue.empty()) {
        if (sendHttpRequest(event)) {
            return true;
        }
    }

    // 若未連線或發送失敗，排入離線佇列
    enqueueEvent(event);
    return false;
}

void CloudUploader::update() {
    if (_queue.empty() || !_netManager.isConnected()) {
        return;
    }

    const unsigned long now = millis();
    if (now - _lastRetryAttempt < UPLOAD_RETRY_INTERVAL_MS) {
        return;
    }
    _lastRetryAttempt = now;

    const CloudWaterEvent event = _queue.front();
    Serial.printf("[CLOUD] 嘗試補傳離線事件 (eventId: %s, 剩餘: %u)...\n",
                  event.eventId.c_str(), static_cast<unsigned int>(_queue.size()));

    if (sendHttpRequest(event)) {
        _queue.erase(_queue.begin());
        Serial.printf("[CLOUD] 離線事件補傳成功，佇列剩餘: %u\n",
                      static_cast<unsigned int>(_queue.size()));
    } else {
        Serial.println("[CLOUD] 離線事件補傳失敗，稍後重試");
    }
}
