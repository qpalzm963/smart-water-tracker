#pragma once

#include <Arduino.h>
#include <vector>

#include "BleProtocol.h"
#include "DrinkTracker.h"

struct BleWaterEvent {
    String id;
    time_t occurredAt;
    EventType type;
    int amountMl;
    int remainingMl;
    int todayTotalMl;
};

// Backward-compatible typedef for tests and existing references
typedef BleWaterEvent BleDrinkEvent;

class ScaleManager;
class DrinkTracker;
class WaterNetworkManager;

// Owns the BLE transport and an in-RAM replay buffer. The most recent events are
// also mirrored into NVS so a reboot does not lose anything the phone has not
// fetched yet — with no Wi-Fi upload path, BLE is the only way data leaves the
// device.
class BleWaterService {
public:
    explicit BleWaterService(const String& deviceId = "");

    void begin(const String& deviceId, ScaleManager* scale = nullptr, DrinkTracker* tracker = nullptr, WaterNetworkManager* netManager = nullptr);
    void updateSummary(int todayTotalMl, int dailyGoalMl, float currentWeight = 0.0f, bool isStable = true);
    void recordEvent(EventType type, time_t occurredAt, int amountMl, int remainingMl, int todayTotalMl);
    void recordDrink(time_t occurredAt, int amountMl, int remainingMl, int todayTotalMl);
    void recordRefill(time_t occurredAt, int amountMl, int remainingMl, int todayTotalMl);
    void tare();
    bool rotateClaimSecret();

    // BLE callback 跑在 BLE host task。tare 會 bit-bang HX711、reset_daily 會寫 NVS，
    // 兩者都與主迴圈競爭同一份硬體/儲存，因此 callback 只排隊、由 loop() 呼叫本函式執行。
    void processPendingCommands();

    // 事件備份的生命週期。begin() 會呼叫 restore；clear 供裝置重置與測試隔離使用。
    void restorePersistedEvents();
    void clearPersistedEvents();

    std::vector<BleWaterEvent> eventsAfter(const String& afterEventId) const;
    String latestEventId() const;
    String deviceId() const { return _deviceId; }
    String bootSessionId() const { return _bootSessionId; }
    String claimSecret() const { return _claimSecret; }

private:
    friend class WaterSummaryCallbacks;
    friend class WaterHistorySyncCallbacks;
    friend class WaterCommandCallbacks;

    enum PendingCommand : uint8_t {
        PENDING_NONE = 0,
        PENDING_TARE,
        PENDING_RESET_DAILY,
        PENDING_SET_TIME,
        PENDING_ROTATE_CLAIM,
        PENDING_CONFIGURE_WIFI,
        PENDING_CLEAR_WIFI,
    };

    String _deviceId;
    String _bootSessionId;
    String _claimSecret;
    // payload 一律先寫，最後才寫 _pendingCommand —— 後者是「發佈」動作
    volatile time_t _pendingEpoch = 0;
    volatile int _pendingTzOffsetMinutes = 0;
    String _pendingWifiSsid;
    String _pendingWifiPass;
    String _pendingApiUrl;
    String _pendingDevToken;
    volatile PendingCommand _pendingCommand = PENDING_NONE;
    ScaleManager* _scale = nullptr;
    DrinkTracker* _tracker = nullptr;
    WaterNetworkManager* _netManager = nullptr;
    BleWaterEvent _events[BleProtocol::EVENT_BUFFER_SIZE];
    size_t _eventCount = 0;
    size_t _eventHead = 0;
    uint32_t _nextSequence = 0;
    size_t _persistHead = 0;
    size_t _persistCount = 0;
    int _todayTotalMl = 0;
    int _dailyGoalMl = 0;
    float _currentWeight = 0.0f;
    bool _isScaleStable = true;

    class Impl;
    Impl* _impl = nullptr;

    void persistEvent(const BleWaterEvent& event);

    void applyDeviceTime(time_t epoch, int tzOffsetMinutes);
    static bool isClockSynced();

    String eventJson(const BleWaterEvent& event) const;
    String summaryJson() const;
    void publishLiveEvent(const BleWaterEvent& event);
    void replayAfter(const String& afterEventId);
    void notifySyncComplete();
};
