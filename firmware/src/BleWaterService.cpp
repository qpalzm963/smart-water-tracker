#include "BleWaterService.h"

#include <ArduinoJson.h>
#include <BLE2902.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <Preferences.h>
#include <stddef.h>
#include <string.h>
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

// 有效容量 32 筆，另留 1 個 copy-on-write spare slot。先寫 spare，最後才以
// 單一 metadata blob 提交 head/count/ACK；斷電時舊 metadata 仍指向完整舊集合。
constexpr size_t PERSIST_CAPACITY = 32;
constexpr size_t PERSIST_PHYSICAL_SLOTS = PERSIST_CAPACITY + 1;
constexpr size_t MAX_EVENT_ID_LENGTH = 192;
constexpr char PERSIST_META_KEYS[][11] = {"evt_meta_a", "evt_meta_b"};
constexpr uint32_t PERSIST_META_MAGIC = 0x57415452;  // WATR
constexpr uint16_t PERSIST_META_VERSION = 1;

// 舊版資料只用於一次性遷移；新格式使用不同 slot key，不會在提交前覆寫舊資料。
constexpr size_t LEGACY_PERSIST_SLOTS = 32;
constexpr char LEGACY_PERSIST_HEAD_KEY[] = "evt_head";
constexpr char LEGACY_PERSIST_COUNT_KEY[] = "evt_cnt";
constexpr char LEGACY_LAST_ACKED_EVENT_KEY[] = "evt_ack";

struct PersistMetadata {
    uint32_t magic = PERSIST_META_MAGIC;
    uint16_t version = PERSIST_META_VERSION;
    uint16_t reserved = 0;
    uint32_t generation = 0;
    uint32_t head = 0;
    uint32_t count = 0;
    char lastAckedEventId[MAX_EVENT_ID_LENGTH + 1] = {};
    uint32_t checksum = 0;
};

uint32_t metadataChecksum(const PersistMetadata& metadata) {
    const uint8_t* bytes = reinterpret_cast<const uint8_t*>(&metadata);
    uint32_t hash = 2166136261u;
    for (size_t i = 0; i < offsetof(PersistMetadata, checksum); ++i) {
        hash ^= bytes[i];
        hash *= 16777619u;
    }
    return hash;
}

bool metadataIsValid(const PersistMetadata& metadata) {
    return metadata.magic == PERSIST_META_MAGIC &&
           metadata.version == PERSIST_META_VERSION &&
           metadata.head < PERSIST_PHYSICAL_SLOTS &&
           metadata.count <= PERSIST_CAPACITY &&
           metadata.checksum == metadataChecksum(metadata);
}

bool readMetadata(Preferences& prefs, uint8_t slot, PersistMetadata& metadata) {
    if (prefs.getBytesLength(PERSIST_META_KEYS[slot]) != sizeof(PersistMetadata)) {
        return false;
    }
    return prefs.getBytes(PERSIST_META_KEYS[slot], &metadata, sizeof(metadata)) == sizeof(metadata) &&
           metadataIsValid(metadata);
}

bool generationIsNewer(uint32_t candidate, uint32_t current) {
    return static_cast<int32_t>(candidate - current) > 0;
}

String persistSlotKey(size_t slot) {
    char key[8];
    snprintf(key, sizeof(key), "e2%02u", static_cast<unsigned>(slot));
    return String(key);
}

String legacyPersistSlotKey(size_t slot) {
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

String loadOrCreateClaimSecret(const String& prefsNamespace) {
    Preferences prefs;
    if (!prefs.begin(prefsNamespace.c_str(), false)) {
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

bool persistClaimSecret(const String& prefsNamespace, const String& claimSecret) {
    Preferences prefs;
    if (!prefs.begin(prefsNamespace.c_str(), false)) {
        Serial.println("[BLE] 無法儲存認領金鑰");
        return false;
    }
    const bool saved = prefs.putString(CLAIM_SECRET_KEY, claimSecret) > 0;
    prefs.end();
    return saved;
}

bool copyCommandText(char* destination, size_t capacity, const char* source) {
    if (source == nullptr || strlen(source) >= capacity) {
        return false;
    }
    strlcpy(destination, source, capacity);
    return true;
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

        BleWaterService::PendingCommandEnvelope envelope;
        const char* action = request["action"] | "";
        if (strcmp(action, "tare") == 0) {
            envelope.command = BleWaterService::PENDING_TARE;
        } else if (strcmp(action, "reset_daily") == 0) {
            envelope.command = BleWaterService::PENDING_RESET_DAILY;
        } else if (strcmp(action, "rotate_claim") == 0) {
            envelope.command = BleWaterService::PENDING_ROTATE_CLAIM;
        } else if (strcmp(action, "ack_history") == 0) {
            envelope.command = BleWaterService::PENDING_ACK_HISTORY;
            if (!copyCommandText(
                    envelope.eventId,
                    sizeof(envelope.eventId),
                    request["throughEventId"] | "")) {
                Serial.println("[BLE] ack_history eventId 過長");
                return;
            }
        } else if (strcmp(action, "configure_wifi") == 0) {
            envelope.command = BleWaterService::PENDING_CONFIGURE_WIFI;
            if (!copyCommandText(envelope.wifiSsid, sizeof(envelope.wifiSsid), request["ssid"] | "") ||
                !copyCommandText(envelope.wifiPass, sizeof(envelope.wifiPass), request["password"] | "") ||
                !copyCommandText(envelope.apiUrl, sizeof(envelope.apiUrl), request["apiBaseUrl"] | "") ||
                !copyCommandText(envelope.devToken, sizeof(envelope.devToken), request["deviceToken"] | "")) {
                Serial.println("[BLE] configure_wifi 欄位過長");
                return;
            }
        } else if (strcmp(action, "clear_wifi") == 0) {
            envelope.command = BleWaterService::PENDING_CLEAR_WIFI;
        } else if (strcmp(action, "set_time") == 0) {
            const long long epoch = request["epoch"] | 0LL;
            if (epoch < TIME_SYNCED_EPOCH_MIN) {
                Serial.printf("[BLE] 忽略不合理的 set_time epoch: %lld\n", epoch);
                return;
            }
            envelope.command = BleWaterService::PENDING_SET_TIME;
            envelope.epoch = epoch;
            envelope.tzOffsetMinutes = request["tzOffsetMinutes"] | 0;
        } else {
            Serial.printf("[BLE] 未知命令: %s\n", action);
            return;
        }

        if (!_service.enqueueCommand(envelope)) {
            Serial.println("[BLE] 命令佇列已滿，拒絕新命令");
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
        BleWaterService::PendingCommandEnvelope envelope;
        envelope.command = BleWaterService::PENDING_HISTORY_SYNC;
        const char* afterEventId = error ? "" : (request["afterEventId"] | "");
        if (!copyCommandText(envelope.eventId, sizeof(envelope.eventId), afterEventId)) {
            Serial.println("[BLE] history_sync cursor 過長");
            return;
        }
        if (!_service.enqueueCommand(envelope)) {
            Serial.println("[BLE] 命令佇列已滿，無法開始歷史同步");
        }
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

BleWaterService::BleWaterService(const String& deviceId, const String& prefsNamespace)
    : _deviceId(deviceId), _prefsNamespace(prefsNamespace) {
    // 64-bit boot session ID
    const uint64_t session = (static_cast<uint64_t>(micros()) << 32) ^ static_cast<uint64_t>(0xA5A5A5A55A5A5A5AULL);
    char buf[17];
    snprintf(buf, sizeof(buf), "%016llx", static_cast<unsigned long long>(session));
    _bootSessionId = String(buf);
    _commandQueue = xQueueCreate(4, sizeof(PendingCommandEnvelope));
}

BleWaterService::~BleWaterService() {
    if (_commandQueue != nullptr) {
        vQueueDelete(_commandQueue);
        _commandQueue = nullptr;
    }
}

bool BleWaterService::enqueueCommand(const PendingCommandEnvelope& envelope) {
    return _commandQueue != nullptr && xQueueSend(_commandQueue, &envelope, 0) == pdTRUE;
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

    _claimSecret = loadOrCreateClaimSecret(_prefsNamespace);
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

bool BleWaterService::commitPersistMetadata(
    size_t head,
    size_t count,
    const String& lastAckedEventId) {
    if (head >= PERSIST_PHYSICAL_SLOTS || count > PERSIST_CAPACITY ||
        lastAckedEventId.length() > MAX_EVENT_ID_LENGTH) {
        return false;
    }

    PersistMetadata metadata;
    metadata.generation = _persistGeneration + 1;
    metadata.head = static_cast<uint32_t>(head);
    metadata.count = static_cast<uint32_t>(count);
    strlcpy(metadata.lastAckedEventId, lastAckedEventId.c_str(), sizeof(metadata.lastAckedEventId));
    metadata.checksum = metadataChecksum(metadata);

    const uint8_t targetSlot = _persistMetaSlot == 0 ? 1 : 0;
    Preferences prefs;
    if (!prefs.begin(_prefsNamespace.c_str(), false)) {
        return false;
    }
    const bool written =
        prefs.putBytes(PERSIST_META_KEYS[targetSlot], &metadata, sizeof(metadata)) == sizeof(metadata);
    PersistMetadata verified;
    const bool verifiedOk = written && readMetadata(prefs, targetSlot, verified) &&
                            verified.generation == metadata.generation &&
                            verified.head == metadata.head && verified.count == metadata.count &&
                            strcmp(verified.lastAckedEventId, metadata.lastAckedEventId) == 0;
    prefs.end();
    if (!verifiedOk) {
        return false;
    }

    _persistGeneration = metadata.generation;
    _persistMetaSlot = targetSlot;
    return true;
}

bool BleWaterService::persistEvent(const BleWaterEvent& event) {
    if (!_persistStateHealthy) {
        Serial.println("[BLE] NVS 事件狀態不完整，拒絕覆寫並保留可復原資料");
        return false;
    }
    Preferences prefs;
    if (!prefs.begin(_prefsNamespace.c_str(), false)) {
        Serial.println("[BLE] 無法寫入事件備份，重開機後這筆會遺失");
        return false;
    }
    const String serialized = serializeEvent(event);
    const bool slotSaved = prefs.putString(persistSlotKey(_persistHead).c_str(), serialized) ==
                           serialized.length();
    const String verified = slotSaved ? prefs.getString(persistSlotKey(_persistHead).c_str(), "") : "";
    prefs.end();
    if (!slotSaved || verified != serialized) {
        Serial.println("[BLE] 事件 slot 寫入驗證失敗，保留舊 metadata");
        return false;
    }

    const size_t nextHead = (_persistHead + 1) % PERSIST_PHYSICAL_SLOTS;
    const size_t nextCount = _persistCount < PERSIST_CAPACITY ? _persistCount + 1 : PERSIST_CAPACITY;
    if (!commitPersistMetadata(nextHead, nextCount, _lastAckedEventId)) {
        Serial.println("[BLE] 事件 metadata 提交失敗，舊事件集合仍有效");
        return false;
    }
    _persistHead = nextHead;
    _persistCount = nextCount;
    return true;
}

void BleWaterService::restorePersistedEvents() {
    Preferences prefs;
    if (!prefs.begin(_prefsNamespace.c_str(), true)) {
        return;
    }

    PersistMetadata metadataA;
    PersistMetadata metadataB;
    const bool validA = readMetadata(prefs, 0, metadataA);
    const bool validB = readMetadata(prefs, 1, metadataB);

    std::vector<BleWaterEvent> restoredEvents;
    if (validA || validB) {
        const bool useB = validB && (!validA || generationIsNewer(metadataB.generation, metadataA.generation));
        const PersistMetadata& selected = useB ? metadataB : metadataA;
        _persistMetaSlot = useB ? 1 : 0;
        _persistGeneration = selected.generation;
        _persistHead = selected.head;
        _persistCount = selected.count;
        _lastAckedEventId = String(selected.lastAckedEventId);

        const size_t oldest =
            (_persistHead + PERSIST_PHYSICAL_SLOTS - _persistCount) % PERSIST_PHYSICAL_SLOTS;
        for (size_t offset = 0; offset < _persistCount; ++offset) {
            const String raw = prefs.getString(
                persistSlotKey((oldest + offset) % PERSIST_PHYSICAL_SLOTS).c_str(), "");
            BleWaterEvent event;
            if (raw.length() == 0 || !deserializeEvent(raw, event)) {
                Serial.printf("[BLE] NVS 事件 slot %u 損毀，停止還原以避免跨洞 ACK\n",
                              static_cast<unsigned>(offset));
                _persistStateHealthy = false;
                break;
            }
            restoredEvents.push_back(event);
        }
        prefs.end();
    } else {
        // 從舊版 32-slot 格式讀入 RAM；使用不同的新 key 寫完全部 slot 後，
        // 再以單次 metadata commit 切換，遷移途中斷電仍可讀舊格式。
        const size_t legacyHead = prefs.getUInt(LEGACY_PERSIST_HEAD_KEY, 0) % LEGACY_PERSIST_SLOTS;
        size_t legacyCount = prefs.getUInt(LEGACY_PERSIST_COUNT_KEY, 0);
        if (legacyCount > LEGACY_PERSIST_SLOTS) legacyCount = LEGACY_PERSIST_SLOTS;
        _lastAckedEventId = prefs.getString(LEGACY_LAST_ACKED_EVENT_KEY, "");
        const size_t legacyOldest =
            (legacyHead + LEGACY_PERSIST_SLOTS - legacyCount) % LEGACY_PERSIST_SLOTS;
        for (size_t offset = 0; offset < legacyCount; ++offset) {
            const String raw = prefs.getString(
                legacyPersistSlotKey((legacyOldest + offset) % LEGACY_PERSIST_SLOTS).c_str(), "");
            BleWaterEvent event;
            if (raw.length() == 0 || !deserializeEvent(raw, event)) {
                _persistStateHealthy = false;
                break;
            }
            restoredEvents.push_back(event);
        }
        prefs.end();

        if (!restoredEvents.empty() || _lastAckedEventId.length() > 0) {
            Preferences writer;
            bool slotsSaved = writer.begin(_prefsNamespace.c_str(), false);
            if (slotsSaved) {
                for (size_t slot = 0; slot < restoredEvents.size(); ++slot) {
                    const String serialized = serializeEvent(restoredEvents[slot]);
                    if (writer.putString(persistSlotKey(slot).c_str(), serialized) != serialized.length()) {
                        slotsSaved = false;
                        break;
                    }
                }
                writer.end();
            }
            if (slotsSaved &&
                commitPersistMetadata(
                    restoredEvents.size() % PERSIST_PHYSICAL_SLOTS,
                    restoredEvents.size(),
                    _lastAckedEventId)) {
                _persistHead = restoredEvents.size() % PERSIST_PHYSICAL_SLOTS;
                _persistCount = restoredEvents.size();
                Serial.println("[BLE] 已安全遷移舊版事件 metadata");
                Preferences cleanup;
                if (cleanup.begin(_prefsNamespace.c_str(), false)) {
                    for (size_t slot = 0; slot < LEGACY_PERSIST_SLOTS; ++slot) {
                        cleanup.remove(legacyPersistSlotKey(slot).c_str());
                    }
                    cleanup.remove(LEGACY_PERSIST_HEAD_KEY);
                    cleanup.remove(LEGACY_PERSIST_COUNT_KEY);
                    cleanup.remove(LEGACY_LAST_ACKED_EVENT_KEY);
                    cleanup.end();
                }
            } else if (!restoredEvents.empty()) {
                Serial.println("[BLE] 舊版事件遷移未完成，舊 metadata 保持不變");
                _persistStateHealthy = false;
            }
        }
    }

    for (const BleWaterEvent& event : restoredEvents) {
        _events[_eventHead] = event;
        _eventHead = (_eventHead + 1) % BleProtocol::EVENT_BUFFER_SIZE;
        if (_eventCount < BleProtocol::EVENT_BUFFER_SIZE) {
            ++_eventCount;
        }
    }
    if (!restoredEvents.empty()) {
        Serial.printf("[BLE] 已從 NVS 還原 %u 筆未同步事件\n",
                      static_cast<unsigned>(restoredEvents.size()));
    }
}

void BleWaterService::clearPersistedEvents() {
    Preferences prefs;
    if (!prefs.begin(_prefsNamespace.c_str(), false)) {
        return;
    }
    for (size_t slot = 0; slot < PERSIST_PHYSICAL_SLOTS; ++slot) {
        prefs.remove(persistSlotKey(slot).c_str());
    }
    for (size_t slot = 0; slot < LEGACY_PERSIST_SLOTS; ++slot) {
        prefs.remove(legacyPersistSlotKey(slot).c_str());
    }
    prefs.remove(PERSIST_META_KEYS[0]);
    prefs.remove(PERSIST_META_KEYS[1]);
    prefs.remove(LEGACY_PERSIST_HEAD_KEY);
    prefs.remove(LEGACY_PERSIST_COUNT_KEY);
    prefs.remove(LEGACY_LAST_ACKED_EVENT_KEY);
    prefs.end();
    _persistHead = 0;
    _persistCount = 0;
    _persistGeneration = 0;
    _persistMetaSlot = 0;
    _persistStateHealthy = true;
    _lastAckedEventId = "";
    _eventHead = 0;
    _eventCount = 0;
}

bool BleWaterService::acknowledgeEventsThrough(const String& throughEventId) {
    if (!_persistStateHealthy || throughEventId.length() == 0) {
        return false;
    }
    if (throughEventId == _lastAckedEventId) {
        return true;
    }

    const size_t oldest = (_eventHead + BleProtocol::EVENT_BUFFER_SIZE - _eventCount) %
                          BleProtocol::EVENT_BUFFER_SIZE;
    size_t acknowledged = 0;
    bool found = false;
    for (size_t offset = 0; offset < _eventCount; ++offset) {
        ++acknowledged;
        if (_events[(oldest + offset) % BleProtocol::EVENT_BUFFER_SIZE].id == throughEventId) {
            found = true;
            break;
        }
    }
    if (!found) {
        return false;
    }

    // RAM 可保留 64 筆、NVS 僅保留最新 32 筆；先扣除只存在 RAM 的舊前綴，
    // 才能算出這次 ACK 實際涵蓋多少個 NVS slot。
    const size_t ramOnlyPrefix = _eventCount > _persistCount ? _eventCount - _persistCount : 0;
    size_t persistedAcknowledged = acknowledged > ramOnlyPrefix
        ? acknowledged - ramOnlyPrefix
        : 0;
    if (persistedAcknowledged > _persistCount) {
        persistedAcknowledged = _persistCount;
    }
    const size_t newPersistCount = _persistCount - persistedAcknowledged;
    // count 與 ACK cursor 位於同一 metadata blob；read-back 驗證完成前不改 RAM。
    if (!commitPersistMetadata(_persistHead, newPersistCount, throughEventId)) {
        return false;
    }

    _persistCount = newPersistCount;
    _eventCount -= acknowledged;
    _lastAckedEventId = throughEventId;
    return true;
}

bool BleWaterService::rotateClaimSecret() {
    const String replacement = generateClaimSecret();
    if (!persistClaimSecret(_prefsNamespace, replacement)) {
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
    if (_commandQueue == nullptr) {
        return;
    }
    PendingCommandEnvelope envelope;
    if (xQueueReceive(_commandQueue, &envelope, 0) != pdTRUE) {
        return;
    }
    const PendingCommand pending = envelope.command;
    if (pending == PENDING_NONE) {
        return;
    }

    if (pending == PENDING_HISTORY_SYNC) {
        replayAfter(envelope.eventId);
        return;
    }

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
        applyDeviceTime(envelope.epoch, envelope.tzOffsetMinutes);
        response["action"] = "set_time";
        response["epoch"] = static_cast<long long>(time(nullptr));
    } else if (pending == PENDING_ACK_HISTORY) {
        response["action"] = "ack_history";
        response["throughEventId"] = envelope.eventId;
        response["success"] = acknowledgeEventsThrough(envelope.eventId);
        response["remainingEventCount"] = static_cast<unsigned>(_eventCount);
        if (!response["success"].as<bool>()) {
            response["error"] = "unknown_event_id";
        }
    } else if (pending == PENDING_CONFIGURE_WIFI) {
        bool ok = false;
        if (_netManager != nullptr) {
            ok = _netManager->saveConfig(envelope.wifiSsid, envelope.wifiPass, envelope.apiUrl, envelope.devToken);
        }
        response["action"] = "configure_wifi";
        response["success"] = ok;
        response["ssid"] = envelope.wifiSsid;
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
    } else if (pending == PENDING_RESET_DAILY) {
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

String BleWaterService::historyEventJson(
    const BleWaterEvent& event,
    const String& batchId,
    size_t sequence) const {
    JsonDocument document;
    document["batchId"] = batchId;
    document["sequence"] = static_cast<unsigned>(sequence);
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
    const String batchId = _bootSessionId + "-" + String(_nextHistoryBatch++);
    const String firstEventId = events.empty() ? "" : events.front().id;
    const String lastEventId = events.empty() ? "" : events.back().id;
    Serial.printf("[BLE] 開始重送歷史事件，共 %u 筆\n", static_cast<unsigned int>(events.size()));
    for (size_t sequence = 0; sequence < events.size(); ++sequence) {
        const String json = historyEventJson(events[sequence], batchId, sequence);
        _impl->historySync->setValue(json.c_str());
        _impl->historySync->notify();
        delay(30);
    }
    notifySyncComplete(batchId, events.size(), firstEventId, lastEventId);
}

void BleWaterService::notifySyncComplete(
    const String& batchId,
    size_t eventCount,
    const String& firstEventId,
    const String& lastEventId) {
    if (_impl == nullptr || _impl->historySync == nullptr) {
        return;
    }
    JsonDocument document;
    document["syncComplete"] = true;
    document["batchId"] = batchId;
    document["count"] = static_cast<unsigned>(eventCount);
    if (eventCount == 0) {
        document["firstEventId"] = nullptr;
        document["lastEventId"] = nullptr;
    } else {
        document["firstEventId"] = firstEventId;
        document["lastEventId"] = lastEventId;
    }
    String json;
    serializeJson(document, json);
    _impl->historySync->setValue(json.c_str());
    _impl->historySync->notify();
    Serial.println("[BLE] 歷史事件重送完畢 (syncComplete)");
}
