#pragma once

#include <Arduino.h>
#include <vector>
#include "DrinkTracker.h"
#include "WaterNetworkManager.h"
#include "Config.h"

struct CloudWaterEvent {
    String eventId;
    EventType type;
    int amountMl;
    int remainingMl;
    int todayTotalMl;
    time_t occurredAt;
    bool timeSynced;
};

class CloudUploader {
public:
    explicit CloudUploader(WaterNetworkManager& networkManager);

    // 發送喝水/補水事件 (若斷線或失敗則自動進入離線佇列)
    bool postEvent(EventType type, int amountMl, int remainingMl, int todayTotalMl,
                   time_t occurredAt, const String& eventId, bool timeSynced);

    // 週期性處理 (由 main loop 驅動，重傳離線佇列)
    void update();

    // 取得當前離線佇列長度
    size_t getPendingQueueSize() const { return _queue.size(); }

    // 清空離線佇列
    void clearQueue() { _queue.clear(); }

private:
    bool sendHttpRequest(const CloudWaterEvent& event);
    void enqueueEvent(const CloudWaterEvent& event);
    String buildEndpointUrl() const;

    WaterNetworkManager& _netManager;
    std::vector<CloudWaterEvent> _queue;
    unsigned long _lastRetryAttempt = 0;
};
