#include "BleWaterService.h"

#include <ArduinoJson.h>
#include <BLE2902.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <Preferences.h>
#include <sys/time.h>
#include <time.h>

#include "Config.h"
#include "DrinkTracker.h"
#include "ScaleManager.h"
#include "WaterNetworkManager.h"

class BleWaterService::Impl {
public:
    BLEServer* server = nullptr;
    BLECharacteristic* liveEvent = nullptr;
    BLECharacteristic* summary = nullptr;
    BLECharacteristic* historySync = nullptr;
    BLECharacteristic* command = nullptr;
};

namespace {
constexpr char CLAIM_SECRET_KEY[] = "claim_secret";

// 只保留最近 N 筆。NVS 分割區僅 20KB，還要放校準值與各種金鑰，
// 一次寫一個小 key 比重寫整塊 blob 對 flash 更友善。
constexpr size_t PERSIST_SLOTS = 32;
constexpr char PERSIST_HEAD_KEY[] = "evt_head";
constexpr char PERSIST_COUNT_KEY[] = "evt_cnt";

String persistSlotKey(size_t slot) {
    char key[8];
    snprintf(key, sizeof(key), "ev%02u", static_cast<unsigned>(slot));
    return String(key);
}

// id 內不含 '|'（格式為 deviceId-epoch-session-seq），可安全當分隔符。
String serializeEvent(const BleWaterEvent& event) {
    return event.id + "|" + String(static_cast<unsigned long>(event.occurredAt)) + "|" +
           String(static_cast<int>(event.type)) + "|" + String(event.amountMl) + "|" +
           String(event.remainingMl) + "|" + String(event.todayTotalMl);
}

bool deserializeEvent(const String& raw, BleWaterEvent& out) {
    int cut[5];
    int from = 0;
    for (int i = 0; i < 5; ++i) {
        cut[i] = raw.indexOf('|', from);
        if (cut[i] < 0) return false;
        from = cut[i] + 1;
    }
    out.id = raw.substring(0, cut[0]);
    out.occurredAt = static_cast<time_t>(raw.substring(cut[0] + 1, cut[1]).toInt());
    out.type = static_cast<EventType>(raw.substring(cut[1] + 1, cut[2]).toInt());
    out.amountMl = raw.substring(cut[2] + 1, cut[3]).toInt();
    out.remainingMl = raw.substring(cut[3] + 1, cut[4]).toInt();
    out.todayTotalMl = raw.substring(cut[4] + 1).toInt();
    return out.id.length() > 0;
}

String generateClaimSecret() {
    const uint64_t claim = (static_cast<uint64_t>(esp_random()) << 32) | static_cast<uint64_t>(esp_random());
    char claimBuf[17];
    snprintf(claimBuf, sizeof(claimBuf), "%016llx", static_cast<unsigned long long>(claim));
    return String(claimBuf);
}

String loadOrCreateClaimSecret() {
    Preferences prefs;
    if (!prefs.begin(PREFS_NAMESPACE, false)) {
        Serial.println("[BLE] 無法開啟認領金鑰儲存空間");
        return "";
    }

    String claimSecret = prefs.getString(CLAIM_SECRET_KEY, "");
    if (claimSecret.length() == 0) {
        claimSecret = generateClaimSecret();
        prefs.putString(CLAIM_SECRET_KEY, claimSecret);
    }
    prefs.end();
    return claimSecret;
}

bool persistClaimSecret(const String& claimSecret) {
    Preferences prefs;
    if (!prefs.begin(PREFS_NAMESPACE, false)) {
        Serial.println("[BLE] 無法儲存認領金鑰");
        return false;
    }
    const bool saved = prefs.putString(CLAIM_SECRET_KEY, claimSecret) > 0;
    prefs.end();
    return saved;
}
}  // namespace

class WaterSummaryCallbacks final : public BLECharacteristicCallbacks {
public:
    explicit WaterSummaryCallbacks(BleWaterService& service) : _service(service) {}

    void onRead(BLECharacteristic* characteristic) override {
        const String json = _service.summaryJson();
        characteristic->setValue(json.c_str());
    }

private:
    BleWaterService& _service;
};

class WaterCommandCallbacks final : public BLECharacteristicCallbacks {
public:
    explicit WaterCommandCallbacks(BleWaterService& service) : _service(service) {}

    void onWrite(BLECharacteristic* characteristic) override {
        const String value = String(characteristic->getValue().c_str());
        JsonDocument request;
        const DeserializationError error = deserializeJson(request, value);
        if (error) {
            Serial.println("[BLE] 命令 JSON 格式錯誤");
            return;
        }

        const char* action = request["action"] | "";
        if (strcmp(action, "tare") == 0) {
            _service._pendingCommand = BleWaterService::PENDING_TARE;
        } else if (strcmp(action, "reset_daily") == 0) {
            _service._pendingCommand = BleWaterService::PENDING_RESET_DAILY;
        } else if (strcmp(action, "rotate_claim") == 0) {
            _service._pendingCommand = BleWaterService::PENDING_ROTATE_CLAIM;
        } else if (strcmp(action, "configure_wifi") == 0) {
            _service._pendingWifiSsid = String(request["ssid"] | "");
            _service._pendingWifiPass = String(request["password"] | "");
            _service._pendingApiUrl = String(request["apiBaseUrl"] | "");
            _service._pendingDevToken = String(request["deviceToken"] | "");
            _service._pendingCommand = BleWaterService::PENDING_CONFIGURE_WIFI;
        } else if (strcmp(action, "clear_wifi") == 0) {
            _service._pendingCommand = BleWaterService::PENDING_CLEAR_WIFI;
        } else if (strcmp(action, "set_time") == 0) {
            const long long epoch = request["epoch"] | 0LL;
            if (epoch < TIME_SYNCED_EPOCH_MIN) {
                Serial.printf("[BLE] 忽略不合理的 set_time epoch: %lld\n", epoch);
                return;
            }
            _service._pendingEpoch = static_cast<time_t>(epoch);
            _service._pendingTzOffsetMinutes = request["tzOffsetMinutes"] | 0;
            _service._pendingCommand = BleWaterService::PENDING_SET_TIME;
        }
    }

private:
    BleWaterService& _service;
};

class WaterHistorySyncCallbacks final : public BLECharacteristicCallbacks {
public:
    explicit WaterHistorySyncCallbacks(BleWaterService& service) : _service(service) {}

    void onWrite(BLECharacteristic* characteristic) override {
        const String value = String(characteristic->getValue().c_str());
        JsonDocument request;
        const DeserializationError error = deserializeJson(request, value);
        if (error) {
            Serial.println("[BLE] historySync JSON 格式錯誤，將從最早可用事件開始重送");
            _service.replayAfter("");
            return;
        }

        const char* afterEventId = request["afterEventId"] | "";
        _service.replayAfter(String(afterEventId));
    }

private:
    BleWaterService& _service;
};

class WaterServerCallbacks final : public BLEServerCallbacks {
public:
    void onConnect(BLEServer* pServer) override {
        Serial.println("[BLE] 手機已連線");
    }

    void onDisconnect(BLEServer* pServer) override {
        Serial.println("[BLE] 手機已中斷連線，重新啟動廣播 (Advertising)...");
        BLEDevice::startAdvertising();
    }
};

BleWaterService::BleWaterService(const String& deviceId) : _deviceId(deviceId) {
    // 64-bit boot session ID
    const uint64_t session = (static_cast<uint64_t>(micros()) << 32) ^ static_cast<uint64_t>(0xA5A5A5A55A5A5A5AULL);
    char buf[17];
    snprintf(buf, sizeof(buf), "%016llx", static_cast<unsigned long long>(session));
    _bootSessionId = String(buf);

}

void BleWaterService::begin(const String& deviceId, ScaleManager* scale, DrinkTracker* tracker, WaterNetworkManager* netManager) {
    _deviceId = deviceId;
    _scale = scale;
    _tracker = tracker;
    _netManager = netManager;

    // Generate 64-bit random boot session ID and hardware claim secret
    const uint64_t session = (static_cast<uint64_t>(esp_random()) << 32) | static_cast<uint64_t>(esp_random());
    char buf[17];
    snprintf(buf, sizeof(buf), "%016llx", static_cast<unsigned long long>(session));
    _bootSessionId = String(buf);

    _claimSecret = loadOrCreateClaimSecret();
    restorePersistedEvents();

    const String suffix = _deviceId.length() >= 4
        ? _deviceId.substring(_deviceId.length() - 4)
        : _deviceId;
    const String advertisedName = String(BleProtocol::DEVICE_NAME_PREFIX) + suffix;

    BLEDevice::init(advertisedName.c_str());
    BLEDevice::setMTU(517);
    _impl = new Impl();
    _impl->server = BLEDevice::createServer();
    _impl->server->setCallbacks(new WaterServerCallbacks());
    BLEService* service = _impl->server->createService(BleProtocol::SERVICE_UUID);

    _impl->liveEvent = service->createCharacteristic(
        BleProtocol::LIVE_EVENT_UUID, BLECharacteristic::PROPERTY_NOTIFY);
    _impl->liveEvent->addDescriptor(new BLE2902());

    _impl->summary = service->createCharacteristic(
        BleProtocol::SUMMARY_UUID, BLECharacteristic::PROPERTY_READ);
    _impl->summary->setCallbacks(new WaterSummaryCallbacks(*this));
    _impl->summary->setValue(summaryJson().c_str());

    _impl->historySync = service->createCharacteristic(
        BleProtocol::HISTORY_SYNC_UUID,
        BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_NOTIFY);
    _impl->historySync->addDescriptor(new BLE2902());
    _impl->historySync->setCallbacks(new WaterHistorySyncCallbacks(*this));

    _impl->command = service->createCharacteristic(
        BleProtocol::COMMAND_UUID,
        BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR | BLECharacteristic::PROPERTY_READ);
    _impl->command->setCallbacks(new WaterCommandCallbacks(*this));

    service->start();
    BLEAdvertising* advertising = BLEDevice::getAdvertising();
    advertising->addServiceUUID(BleProtocol::SERVICE_UUID);
    advertising->setScanResponse(true);
    advertising->setMinPreferred(0x06);
    advertising->setMinPreferred(0x12);
    BLEDevice::startAdvertising();
    Serial.printf("[BLE] 服務已啟動: %s (%s, session: %s)\n", advertisedName.c_str(), _deviceId.c_str(), _bootSessionId.c_str());
}

void BleWaterService::persistEvent(const BleWaterEvent& event) {
    Preferences prefs;
    if (!prefs.begin(PREFS_NAMESPACE, false)) {
        Serial.println("[BLE] 無法寫入事件備份，重開機後這筆會遺失");
        return;
    }
    prefs.putString(persistSlotKey(_persistHead).c_str(), serializeEvent(event));
    _persistHead = (_persistHead + 1) % PERSIST_SLOTS;
    if (_persistCount < PERSIST_SLOTS) {
        ++_persistCount;
    }
    prefs.putUInt(PERSIST_HEAD_KEY, static_cast<uint32_t>(_persistHead));
    prefs.putUInt(PERSIST_COUNT_KEY, static_cast<uint32_t>(_persistCount));
    prefs.end();
}

void BleWaterService::restorePersistedEvents() {
    Preferences prefs;
    if (!prefs.begin(PREFS_NAMESPACE, true)) {
        return;
    }
    _persistHead = prefs.getUInt(PERSIST_HEAD_KEY, 0) % PERSIST_SLOTS;
    _persistCount = prefs.getUInt(PERSIST_COUNT_KEY, 0);
    if (_persistCount > PERSIST_SLOTS) {
        _persistCount = PERSIST_SLOTS;
    }

    // 由最舊往最新放回 RAM ring，順序與 eventsAfter() 的走訪一致。
    const size_t oldest = (_persistHead + PERSIST_SLOTS - _persistCount) % PERSIST_SLOTS;
    size_t restored = 0;
    for (size_t offset = 0; offset < _persistCount; ++offset) {
        const String raw = prefs.getString(persistSlotKey((oldest + offset) % PERSIST_SLOTS).c_str(), "");
        BleWaterEvent event;
        if (raw.length() == 0 || !deserializeEvent(raw, event)) {
            continue;
        }
        _events[_eventHead] = event;
        _eventHead = (_eventHead + 1) % BleProtocol::EVENT_BUFFER_SIZE;
        if (_eventCount < BleProtocol::EVENT_BUFFER_SIZE) {
            ++_eventCount;
        }
        ++restored;
    }
    prefs.end();
    if (restored > 0) {
        Serial.printf("[BLE] 已從 NVS 還原 %u 筆未同步事件\n", static_cast<unsigned>(restored));
    }
}

void BleWaterService::clearPersistedEvents() {
    Preferences prefs;
    if (!prefs.begin(PREFS_NAMESPACE, false)) {
        return;
    }
    for (size_t slot = 0; slot < PERSIST_SLOTS; ++slot) {
        prefs.remove(persistSlotKey(slot).c_str());
    }
    prefs.remove(PERSIST_HEAD_KEY);
    prefs.remove(PERSIST_COUNT_KEY);
    prefs.end();
    _persistHead = 0;
    _persistCount = 0;
}

bool BleWaterService::rotateClaimSecret() {
    const String replacement = generateClaimSecret();
    if (!persistClaimSecret(replacement)) {
        return false;
    }
    _claimSecret = replacement;

    if (_impl != nullptr && _impl->summary != nullptr) {
        _impl->summary->setValue(summaryJson().c_str());
    }
    Serial.println("[BLE] 硬體配對金鑰已更新");
    return true;
}

void BleWaterService::tare() {
    if (_scale != nullptr) {
        _scale->tare(3);
        _currentWeight = _scale->getFilteredWeight();
        _isScaleStable = _scale->isStable();
    } else {
        _currentWeight = 0.0f;
    }
    if (_impl != nullptr && _impl->summary != nullptr) {
        _impl->summary->setValue(summaryJson().c_str());
    }
    Serial.printf("[BLE] 執行去皮完成，當前重量: %.1fg\n", _currentWeight);
}

bool BleWaterService::isClockSynced() {
    return time(nullptr) > TIME_SYNCED_EPOCH_MIN;
}

void BleWaterService::applyDeviceTime(time_t epoch, int tzOffsetMinutes) {
    struct timeval tv;
    tv.tv_sec = epoch;
    tv.tv_usec = 0;
    settimeofday(&tv, nullptr);

    // POSIX 的 TZ 字串符號與日常寫法相反：UTC+8 要寫成 "UTC-8"
    char tz[16];
    snprintf(tz, sizeof(tz), "UTC%+d:%02d", -(tzOffsetMinutes / 60), abs(tzOffsetMinutes % 60));
    setenv("TZ", tz, 1);
    tzset();

    Serial.printf("[BLE] 裝置時間已同步: epoch=%lld, TZ=%s\n", static_cast<long long>(epoch), tz);
}

void BleWaterService::processPendingCommands() {
    const PendingCommand pending = _pendingCommand;
    if (pending == PENDING_NONE) {
        return;
    }
    _pendingCommand = PENDING_NONE;

    // 回應內容與格式維持不變，只是改在實際執行完成後才寫回 command characteristic。
    JsonDocument response;
    response["success"] = true;
    if (pending == PENDING_TARE) {
        tare();
        response["action"] = "tare";
        response["currentWeight"] = _currentWeight;
    } else if (pending == PENDING_ROTATE_CLAIM) {
        if (!rotateClaimSecret()) {
            response["success"] = false;
            response["error"] = "claim_secret_persist_failed";
        }
        response["action"] = "rotate_claim";
        if (response["success"].as<bool>()) {
            response["claimSecret"] = _claimSecret;
        }
    } else if (pending == PENDING_SET_TIME) {
        applyDeviceTime(_pendingEpoch, _pendingTzOffsetMinutes);
        response["action"] = "set_time";
        response["epoch"] = static_cast<long long>(time(nullptr));
    } else if (pending == PENDING_CONFIGURE_WIFI) {
        bool ok = false;
        if (_netManager != nullptr) {
            ok = _netManager->saveConfig(_pendingWifiSsid, _pendingWifiPass, _pendingApiUrl, _pendingDevToken);
        }
        response["action"] = "configure_wifi";
        response["success"] = ok;
        response["ssid"] = _pendingWifiSsid;
        if (_impl != nullptr && _impl->summary != nullptr) {
            _impl->summary->setValue(summaryJson().c_str());
        }
    } else if (pending == PENDING_CLEAR_WIFI) {
        if (_netManager != nullptr) {
            _netManager->clearConfig();
        }
        response["action"] = "clear_wifi";
        response["success"] = true;
        if (_impl != nullptr && _impl->summary != nullptr) {
            _impl->summary->setValue(summaryJson().c_str());
        }
    } else {
        Serial.println("[BLE] 執行重設今日喝水量，已重設為 0 ml");
        if (_tracker != nullptr) {
            _tracker->resetDailyTotal();
        }
        _todayTotalMl = 0;
        updateSummary(0, _dailyGoalMl, _currentWeight, _isScaleStable);
        response["action"] = "reset_daily";
    }

    if (_impl != nullptr && _impl->command != nullptr) {
        String json;
        serializeJson(response, json);
        _impl->command->setValue(json.c_str());
    }
}

void BleWaterService::updateSummary(int todayTotalMl, int dailyGoalMl, float currentWeight, bool isStable) {
    _todayTotalMl = todayTotalMl;
    _dailyGoalMl = dailyGoalMl;
    _currentWeight = currentWeight;
    _isScaleStable = isStable;
    if (_impl != nullptr && _impl->summary != nullptr) {
        _impl->summary->setValue(summaryJson().c_str());
    }
}

void BleWaterService::recordEvent(EventType type, time_t occurredAt, int amountMl, int remainingMl, int todayTotalMl) {
    if (amountMl <= 0 || remainingMl < 0 || todayTotalMl < 0) {
        Serial.println("[BLE] 忽略無效水事件");
        return;
    }

    // 未校時的 time() 只是開機秒數，送出去會被當成 1970 年。
    // 明確標成 0 (未知)，並由 eventJson 的 timeSynced 告訴手機。
    if (occurredAt < TIME_SYNCED_EPOCH_MIN) {
        occurredAt = 0;
    }

    BleWaterEvent event;
    event.occurredAt = occurredAt;
    event.type = type;
    event.amountMl = amountMl;
    event.remainingMl = remainingMl;
    event.todayTotalMl = todayTotalMl;
    // Format: deviceId-occurredAt-bootSessionId-seq (64-bit boot session ensures zero collision)
    event.id = _deviceId + "-" + String(static_cast<unsigned long>(occurredAt)) + "-" + _bootSessionId + "-" + String(_nextSequence++);

    _events[_eventHead] = event;
    _eventHead = (_eventHead + 1) % BleProtocol::EVENT_BUFFER_SIZE;
    if (_eventCount < BleProtocol::EVENT_BUFFER_SIZE) {
        ++_eventCount;
    }
    persistEvent(event);
    _todayTotalMl = todayTotalMl;
    updateSummary(_todayTotalMl, _dailyGoalMl);
    publishLiveEvent(event);
}

void BleWaterService::recordDrink(time_t occurredAt, int amountMl, int remainingMl, int todayTotalMl) {
    recordEvent(EVENT_DRINK, occurredAt, amountMl, remainingMl, todayTotalMl);
}

void BleWaterService::recordRefill(time_t occurredAt, int amountMl, int remainingMl, int todayTotalMl) {
    recordEvent(EVENT_REFILL, occurredAt, amountMl, remainingMl, todayTotalMl);
}

std::vector<BleWaterEvent> BleWaterService::eventsAfter(const String& afterEventId) const {
    std::vector<BleWaterEvent> ordered;
    ordered.reserve(_eventCount);
    const size_t oldest = (_eventHead + BleProtocol::EVENT_BUFFER_SIZE - _eventCount) % BleProtocol::EVENT_BUFFER_SIZE;
    bool foundCursor = afterEventId.length() == 0;

    for (size_t offset = 0; offset < _eventCount; ++offset) {
        const BleWaterEvent& event = _events[(oldest + offset) % BleProtocol::EVENT_BUFFER_SIZE];
        if (foundCursor) {
            ordered.push_back(event);
        } else if (event.id == afterEventId) {
            foundCursor = true;
        }
    }

    // A cursor outside the RAM buffer means the client fell behind. Replay all
    // retained events; the client still deduplicates by event ID.
    if (!foundCursor && afterEventId.length() > 0) {
        return eventsAfter("");
    }
    return ordered;
}

String BleWaterService::latestEventId() const {
    if (_eventCount == 0) {
        return "";
    }
    const size_t newest = (_eventHead + BleProtocol::EVENT_BUFFER_SIZE - 1) % BleProtocol::EVENT_BUFFER_SIZE;
    return _events[newest].id;
}

String BleWaterService::eventJson(const BleWaterEvent& event) const {
    JsonDocument document;
    document["eventId"] = event.id;
    document["occurredAt"] = static_cast<long>(event.occurredAt);
    document["type"] = (event.type == EVENT_REFILL) ? "refill" : "drink";
    document["amountMl"] = event.amountMl;
    document["remainingMl"] = event.remainingMl;
    document["todayTotalMl"] = event.todayTotalMl;
    document["timeSynced"] = event.occurredAt > 0;

    String json;
    serializeJson(document, json);
    return json;
}

String BleWaterService::summaryJson() const {
    JsonDocument document;
    document["deviceId"] = _deviceId;
    document["dailyGoalMl"] = _dailyGoalMl;
    document["todayTotalMl"] = _todayTotalMl;
    document["currentWeight"] = _currentWeight;
    document["isStable"] = _isScaleStable;
    document["timeSynced"] = isClockSynced();
    document["claimSecret"] = _claimSecret;
    if (_netManager != nullptr) {
        document["wifiConnected"] = _netManager->isConnected();
        document["wifiConfigured"] = _netManager->isConfigured();
        document["ip"] = _netManager->getIpAddress();
        document["rssi"] = _netManager->getRssi();
        document["ssid"] = _netManager->getSsid();
    } else {
        document["wifiConnected"] = false;
        document["wifiConfigured"] = false;
        document["ip"] = "0.0.0.0";
    }
    const String latestId = latestEventId();
    if (latestId.length() == 0) {
        document["latestEventId"] = nullptr;
    } else {
        document["latestEventId"] = latestId;
    }

    String json;
    serializeJson(document, json);
    return json;
}

void BleWaterService::publishLiveEvent(const BleWaterEvent& event) {
    if (_impl == nullptr || _impl->liveEvent == nullptr) {
        return;
    }
    const String json = eventJson(event);
    _impl->liveEvent->setValue(json.c_str());
    _impl->liveEvent->notify();
}

void BleWaterService::replayAfter(const String& afterEventId) {
    if (_impl == nullptr || _impl->historySync == nullptr) {
        return;
    }
    const std::vector<BleWaterEvent> events = eventsAfter(afterEventId);
    Serial.printf("[BLE] 開始重送歷史事件，共 %u 筆\n", static_cast<unsigned int>(events.size()));
    for (const BleWaterEvent& event : events) {
        const String json = eventJson(event);
        _impl->historySync->setValue(json.c_str());
        _impl->historySync->notify();
        delay(30);
    }
    notifySyncComplete();
}

void BleWaterService::notifySyncComplete() {
    if (_impl == nullptr || _impl->historySync == nullptr) {
        return;
    }
    JsonDocument document;
    document["syncComplete"] = true;
    String json;
    serializeJson(document, json);
    _impl->historySync->setValue(json.c_str());
    _impl->historySync->notify();
    Serial.println("[BLE] 歷史事件重送完畢 (syncComplete)");
}
