#include "DrinkTracker.h"

// 把 epoch 換算成當地日期代碼 YYYYMMDD
static int dayStampFrom(time_t sec) {
    struct tm timeinfo;
    localtime_r(&sec, &timeinfo);
    return (timeinfo.tm_year + 1900) * 10000 + (timeinfo.tm_mon + 1) * 100 + timeinfo.tm_mday;
}

DrinkTracker::DrinkTracker(ScaleManager& scale)
    : _scale(scale),
      _state(TRACKER_UNKNOWN),
      _stateEntryTime(0),
      _baselineWeight(0.0f),
      _currentStableWeight(0.0f),
      _todayTotalMl(0),
      _dailyGoalMl(DEFAULT_DAILY_GOAL_ML),
      _reminderMinutes(DEFAULT_REMINDER_MINUTES),
      _minDrinkThreshold(MIN_DRINK_THRESHOLD_G),
      _emptyCupThreshold(EMPTY_CUP_THRESHOLD_G),
      _lastDrinkTimestamp(0),
      _reminderTriggered(false),
      _todayStamp(0),
      _historyCount(0),
      _historyHead(0),
      _onEventCallback(nullptr),
      _onReminderCallback(nullptr) {
}

void DrinkTracker::begin() {
    loadSettings();
    _lastDrinkTimestamp = millis();

    // 此刻 ScaleManager 還沒跑過任何一次 update()，讀出來必定是 0。
    // 若拿它當基準重，秤上原本就放著的杯子會在第一次穩定時被結算成一次補水。
    // 改由 TRACKER_UNKNOWN 等到第一筆穩定的杯子重量再建立基準重與初始狀態。
    _baselineWeight = 0.0f;
    _state = TRACKER_UNKNOWN;
    _stateEntryTime = millis();
    Serial.printf("[DrinkTracker] 追蹤器啟動. 等待第一筆穩定的杯子重量以建立基準重 (目標: %dml)\n",
                  _dailyGoalMl);
}

const char* DrinkTracker::getStateString() const {
    switch (_state) {
        case TRACKER_UNKNOWN:       return "初始化中 (等待穩定讀數)";
        case TRACKER_IDLE:          return "待機 (水杯靜置)";
        case TRACKER_CUP_LIFTED:    return "水杯拿起";
        case TRACKER_DRINKING:      return "喝水中";
        case TRACKER_CUP_RETURNED:  return "水杯放回 (等待穩定)";
        case TRACKER_PROCESSING:    return "結算水量中";
        default:                    return "未知狀態";
    }
}

void DrinkTracker::update() {
    float currentWeight = _scale.getFilteredWeight();
    bool isStable = _scale.isStable();
    unsigned long now = millis();

    // 檢查跨日自動重設。只有在系統時間校時過之後才可能成立；
    // 本裝置唯一的時間來源是手機透過 BLE 送來的 set_time。
    time_t nowSec = time(nullptr);
    if (nowSec > TIME_SYNCED_EPOCH_MIN) {
        const int stamp = dayStampFrom(nowSec);
        if (_todayStamp == 0) {
            // 第一次取得有效時間：沿用現有累計，只把日期補記起來
            _todayStamp = stamp;
            saveSettings();
        } else if (stamp != _todayStamp) {
            Serial.printf("[DrinkTracker] 🌙 跨日 (%d -> %d)，自動重設今日喝水累計 (前一日: %dml)\n",
                          _todayStamp, stamp, _todayTotalMl);
            _todayStamp = stamp;
            _todayTotalMl = 0;
            saveSettings();
        }
    }

    switch (_state) {
        case TRACKER_UNKNOWN:
            // 空秤的穩定讀值代表「目前沒有杯子」，不能當成喝水中的狀態。
            // 必須等杯子放上來後才建立基準，否則空秤 0g -> 空杯重量會被判成補水。
            if (isStable && currentWeight >= _emptyCupThreshold) {
                _baselineWeight = currentWeight;
                _state = TRACKER_IDLE;
                _stateEntryTime = now;
            }
            break;

        case TRACKER_IDLE:
            // 待機中：若讀數穩定且高於空秤，持續微幅校正基準重量（適應環境溫漂或緩慢揮發）
            if (isStable && currentWeight >= _emptyCupThreshold) {
                _baselineWeight = currentWeight;
            }

            // 判定水杯是否被拿起 (低於空秤閾值)
            if (currentWeight < _emptyCupThreshold) {
                Serial.printf("[DrinkTracker] 偵測到水杯拿起 (拿起前基準重: %.1fg)\n", _baselineWeight);
                _state = TRACKER_CUP_LIFTED;
                _stateEntryTime = now;
            }

            // 檢查久未喝水提醒
            if (isReminderDue()) {
                _reminderTriggered = true;
                Serial.printf("[DrinkTracker] ⏰ 提醒觸發：已超過 %d 分鐘未喝水！\n", _reminderMinutes);
                if (_onReminderCallback) {
                    _onReminderCallback();
                }
            }
            break;

        case TRACKER_CUP_LIFTED:
            // 防誤觸緩衝
            if (now - _stateEntryTime > 400) {
                _state = TRACKER_DRINKING;
                _stateEntryTime = now;
            }
            break;

        case TRACKER_DRINKING:
            // 判定水杯是否放回 (重量高於空秤閾值)
            if (currentWeight >= _emptyCupThreshold) {
                Serial.printf("[DrinkTracker] 偵測到水杯放回，等待穩定... (當前讀數: %.1fg)\n", currentWeight);
                _state = TRACKER_CUP_RETURNED;
                _stateEntryTime = now;
            }
            break;

        case TRACKER_CUP_RETURNED:
            // 水杯放回後，需等待讀數穩定至少 1 秒
            if (currentWeight < _emptyCupThreshold) {
                // 如果又被拿起來，退回 DRINKING
                _state = TRACKER_DRINKING;
                _stateEntryTime = now;
            } else if (isStable && (now - _stateEntryTime > 1000)) {
                _currentStableWeight = currentWeight;
                _state = TRACKER_PROCESSING;
            }
            break;

        case TRACKER_PROCESSING: {
            float delta = _baselineWeight - _currentStableWeight;

            if (delta >= _minDrinkThreshold) {
                // 喝水事件
                int amountMl = (int)round(delta);
                int remainingMl = (int)round(_currentStableWeight);
                _todayTotalMl += amountMl;
                _lastDrinkTimestamp = now;
                _reminderTriggered = false;

                Serial.printf("[DrinkTracker] 🥤 偵測到喝水！本次喝水: %dml, 剩餘: %dml, 今日累計: %d/%dml\n",
                              amountMl, remainingMl, _todayTotalMl, _dailyGoalMl);

                addRecord(EVENT_DRINK, amountMl, remainingMl);
                saveSettings();

                if (_onEventCallback) {
                    _onEventCallback(EVENT_DRINK, amountMl, remainingMl);
                }
            } else if ((_currentStableWeight - _baselineWeight) >= REFILL_THRESHOLD_G) {
                // 加水事件
                int refillMl = (int)round(_currentStableWeight - _baselineWeight);
                int remainingMl = (int)round(_currentStableWeight);
                _lastDrinkTimestamp = now;
                _reminderTriggered = false;

                Serial.printf("[DrinkTracker] 🚰 偵測到補水！補水量: +%dml, 杯內總重: %dml\n",
                              refillMl, remainingMl);

                addRecord(EVENT_REFILL, refillMl, remainingMl);

                if (_onEventCallback) {
                    _onEventCallback(EVENT_REFILL, refillMl, remainingMl);
                }
            } else {
                Serial.printf("[DrinkTracker] 重量微幅變化 (%.1fg -> %.1fg, 差異: %.1fg)，略過\n",
                              _baselineWeight, _currentStableWeight, delta);
            }

            // 更新基準重量為當前放回後穩定重量
            _baselineWeight = _currentStableWeight;
            _state = TRACKER_IDLE;
            _stateEntryTime = now;
            break;
        }
    }
}

unsigned long DrinkTracker::getMinutesSinceLastDrink() const {
    return (millis() - _lastDrinkTimestamp) / 60000UL;
}

bool DrinkTracker::isReminderDue() const {
    if (_reminderMinutes <= 0) return false;
    if (_reminderTriggered) return false;
    return (millis() - _lastDrinkTimestamp) >= ((unsigned long)_reminderMinutes * 60000UL);
}

void DrinkTracker::dismissReminder() {
    _lastDrinkTimestamp = millis();
    _reminderTriggered = false;
}

void DrinkTracker::resetDailyTotal() {
    _todayTotalMl = 0;
    // 手動重設也要重新蓋上今天的日期戳，否則下一輪 update() 會再判一次跨日
    const time_t nowSec = time(nullptr);
    if (nowSec > TIME_SYNCED_EPOCH_MIN) {
        _todayStamp = dayStampFrom(nowSec);
    }
    saveSettings();
    Serial.println("[DrinkTracker] 今日喝水量已重設為 0 ml");
}

void DrinkTracker::addRecord(EventType type, int amountMl, int remainingMl) {
    DrinkRecord record;
    time_t nowSec = time(nullptr);
    record.unixTimestamp = nowSec;
    if (nowSec > TIME_SYNCED_EPOCH_MIN) {
        struct tm timeinfo;
        localtime_r(&nowSec, &timeinfo);
        snprintf(record.timeStr, sizeof(record.timeStr), "%02d:%02d:%02d",
                 timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
    } else {
        snprintf(record.timeStr, sizeof(record.timeStr), "+%lus", millis() / 1000);
    }
    record.amountMl = amountMl;
    record.remainingMl = remainingMl;
    record.type = type;

    _history[_historyHead] = record;
    _historyHead = (_historyHead + 1) % MAX_HISTORY;
    if (_historyCount < MAX_HISTORY) {
        _historyCount++;
    }
}

DrinkRecord DrinkTracker::getHistoryRecord(int index) const {
    if (index < 0 || index >= _historyCount) {
        DrinkRecord empty = {0, 0, 0, EVENT_DRINK};
        return empty;
    }
    // 從最新到最舊排列
    int actualIndex = (_historyHead - 1 - index + MAX_HISTORY) % MAX_HISTORY;
    return _history[actualIndex];
}

void DrinkTracker::setDailyGoalMl(int goal) {
    if (goal > 0 && goal <= 10000) {
        _dailyGoalMl = goal;
        saveSettings();
    }
}

void DrinkTracker::setReminderIntervalMinutes(int minutes) {
    if (minutes >= 0 && minutes <= 360) {
        _reminderMinutes = minutes;
        saveSettings();
    }
}

void DrinkTracker::setMinDrinkThreshold(float g) {
    if (g >= 5.0f && g <= 100.0f) {
        _minDrinkThreshold = g;
        saveSettings();
    }
}

void DrinkTracker::setEmptyCupThreshold(float g) {
    if (g >= 5.0f && g <= 500.0f) {
        _emptyCupThreshold = g;
        saveSettings();
    }
}

void DrinkTracker::saveSettings() {
    _prefs.begin(PREFS_NAMESPACE, false);
    _prefs.putInt("daily_goal", _dailyGoalMl);
    _prefs.putInt("reminder_min", _reminderMinutes);
    _prefs.putFloat("min_drink", _minDrinkThreshold);
    _prefs.putFloat("empty_cup", _emptyCupThreshold);
    _prefs.putInt("today_total", _todayTotalMl);
    _prefs.putInt("today_ymd", _todayStamp);
    _prefs.end();
}

void DrinkTracker::loadSettings() {
    _prefs.begin(PREFS_NAMESPACE, true);
    _dailyGoalMl = _prefs.getInt("daily_goal", DEFAULT_DAILY_GOAL_ML);
    _reminderMinutes = _prefs.getInt("reminder_min", DEFAULT_REMINDER_MINUTES);
    _minDrinkThreshold = _prefs.getFloat("min_drink", MIN_DRINK_THRESHOLD_G);
    _emptyCupThreshold = _prefs.getFloat("empty_cup", EMPTY_CUP_THRESHOLD_G);
    _todayTotalMl = _prefs.getInt("today_total", 0);
    _todayStamp = _prefs.getInt("today_ymd", 0);
    _prefs.end();
}
