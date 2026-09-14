#pragma once
#include <Arduino.h>
#include <Preferences.h>
#include "Config.h"
#include "ScaleManager.h"

enum TrackerState {
    TRACKER_UNKNOWN,
    TRACKER_IDLE,          // 水杯放置中，狀態穩定
    TRACKER_CUP_LIFTED,    // 水杯已拿起 (低於杯子存在閾值)
    TRACKER_DRINKING,      // 喝水中 (水杯持續在手中)
    TRACKER_CUP_RETURNED,  // 水杯已放回，等待數值穩定
    TRACKER_PROCESSING     // 結算水量變化
};

enum EventType {
    EVENT_DRINK,
    EVENT_REFILL
};

struct DrinkRecord {
    time_t unixTimestamp;    // UNIX 時間戳
    char timeStr[20];        // 格式化時間 (例 "19:35:10")
    int amountMl;            // 飲水量或加水量 (毫升)
    int remainingMl;         // 杯中剩餘水量 (估計值)
    EventType type;          // 事件種類
};

class DrinkTracker {
public:
    DrinkTracker(ScaleManager& scale);
    void begin();

    // 狀態機更新循環 (在 loop 中呼叫)
    void update();

    // 狀態與統計查詢
    TrackerState getState() const { return _state; }
    const char* getStateString() const;
    int getTodayTotalMl() const { return _todayTotalMl; }
    int getDailyGoalMl() const { return _dailyGoalMl; }
    void setDailyGoalMl(int goal);

    int getReminderIntervalMinutes() const { return _reminderMinutes; }
    void setReminderIntervalMinutes(int minutes);

    float getMinDrinkThreshold() const { return _minDrinkThreshold; }
    void setMinDrinkThreshold(float g);

    float getEmptyCupThreshold() const { return _emptyCupThreshold; }
    void setEmptyCupThreshold(float g);

    unsigned long getLastDrinkTimestamp() const { return _lastDrinkTimestamp; }
    unsigned long getMinutesSinceLastDrink() const;
    bool isReminderDue() const;
    void dismissReminder();

    // 今日喝水量重設
    void resetDailyTotal();

    // 歷史紀錄存取
    int getHistoryCount() const { return _historyCount; }
    DrinkRecord getHistoryRecord(int index) const;

    // 回呼函式設定 (當偵測到喝水、加水或提醒時觸發)
    typedef void (*EventCallback)(EventType type, int amountMl, int remainingMl);
    typedef void (*ReminderCallback)();

    void onDrinkEvent(EventCallback cb) { _onEventCallback = cb; }
    void onReminder(ReminderCallback cb) { _onReminderCallback = cb; }

private:
    ScaleManager& _scale;
    Preferences _prefs;

    TrackerState _state;
    unsigned long _stateEntryTime;

    float _baselineWeight;      // 拿起前的基準重量
    float _currentStableWeight;  // 放回後測得的穩定重量

    int _todayTotalMl;
    int _dailyGoalMl;
    int _reminderMinutes;
    float _minDrinkThreshold;
    // 杯子存在判定閾值。空杯去皮後，拿走杯子可能產生負重量，因此允許為負值。
    float _emptyCupThreshold;

    unsigned long _lastDrinkTimestamp;
    bool _reminderTriggered;
    // 今日累計所屬的日期 (YYYYMMDD)，0 代表尚未校時過。
    // 用完整日期而非 tm_mday，才不會在相隔整月時撞號；存進 NVS 才能跨重開機判斷。
    int _todayStamp;

    // 歷史紀錄環狀佇列
    static const int MAX_HISTORY = 30;
    DrinkRecord _history[MAX_HISTORY];
    int _historyCount;
    int _historyHead;

    void addRecord(EventType type, int amountMl, int remainingMl);
    void loadSettings();
    void saveSettings();

    EventCallback _onEventCallback;
    ReminderCallback _onReminderCallback;
};
