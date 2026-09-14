#include <Arduino.h>
#include <sys/time.h>
#include <unity.h>

#include "DrinkTracker.h"
#include "ScaleManager.h"

// 注意：DrinkTracker 的設定與今日累計存在 NVS，本測試會讀寫同一個 namespace，
// 並且會改動系統時間。請在開發板上執行，不要對正在使用中的裝置跑。

// 以假的秤取代 HX711，讓狀態機可以在沒有真實讀數的情況下被逐步驅動。
class FakeScale : public ScaleManager {
public:
    float weight = 0.0f;
    bool stable = false;

    float getFilteredWeight() override { return weight; }
    bool isStable() override { return stable; }
};

// 2026-08-28 12:00 UTC 與隔天 09:00 UTC
static const time_t DAY1_NOON = 1787918400;
static const time_t DAY2_MORNING = DAY1_NOON + 86400 - 3 * 3600;

static int g_eventCount = 0;
static EventType g_lastEventType = EVENT_DRINK;
static int g_lastAmountMl = 0;

static void captureEvent(EventType type, int amountMl, int /*remainingMl*/) {
    g_eventCount++;
    g_lastEventType = type;
    g_lastAmountMl = amountMl;
}

static void setClock(time_t epoch) {
    struct timeval tv;
    tv.tv_sec = epoch;
    tv.tv_usec = 0;
    settimeofday(&tv, nullptr);
}

// 狀態機的轉換條件帶有時間門檻 (拿起防誤觸 400ms、放回等穩定 1000ms)，
// 因此必須讓真實時間推進，不能只連續呼叫 update()。
static void pump(DrinkTracker& tracker, int iterations, int stepMs) {
    for (int i = 0; i < iterations; i++) {
        tracker.update();
        delay(stepMs);
    }
}

// 走完整狀態機喝一次水：靜置 -> 拿起 -> 喝掉一些 -> 放回。回傳喝掉的量。
static int doOneDrink(DrinkTracker& tracker, FakeScale& scale) {
    const float base = tracker.getEmptyCupThreshold() + 275.0f;
    const int drankMl = (int)(tracker.getMinDrinkThreshold() + 65.0f);
    const float liftedWeight = tracker.getEmptyCupThreshold() - 50.0f;

    scale.weight = base;
    scale.stable = true;
    pump(tracker, 10, 50);

    scale.weight = liftedWeight;
    pump(tracker, 20, 50);

    scale.weight = base - drankMl;
    pump(tracker, 40, 50);
    return drankMl;
}

void test_legacy_cup_threshold_is_migrated() {
    Preferences prefs;
    prefs.begin(PREFS_NAMESPACE, false);
    prefs.putFloat("empty_cup", 25.0f);
    prefs.remove("cup_thr_ver");
    prefs.end();

    FakeScale scale;
    DrinkTracker tracker(scale);
    tracker.begin();

    TEST_ASSERT_FLOAT_WITHIN(0.01f, EMPTY_CUP_THRESHOLD_G,
                             tracker.getEmptyCupThreshold());
}

void test_custom_cup_threshold_is_preserved_during_migration() {
    Preferences prefs;
    prefs.begin(PREFS_NAMESPACE, false);
    prefs.putFloat("empty_cup", -150.0f);
    prefs.remove("cup_thr_ver");
    prefs.end();

    FakeScale scale;
    DrinkTracker tracker(scale);
    tracker.begin();

    TEST_ASSERT_FLOAT_WITHIN(0.01f, -150.0f,
                             tracker.getEmptyCupThreshold());
}

// 開機當下 ScaleManager 還沒取得任何讀數。若直接把基準重設為那個 0，
// 秤上原本就放著的杯子會在第一次穩定時被結算成一筆補水事件。
void test_boot_with_cup_already_on_scale_emits_no_event() {
    FakeScale scale;
    DrinkTracker tracker(scale);
    tracker.onDrinkEvent(captureEvent);
    g_eventCount = 0;

    tracker.begin();  // 此時 scale.weight 仍是 0：尚未 update() 過

    scale.weight = tracker.getEmptyCupThreshold() + 275.0f;
    scale.stable = true;
    pump(tracker, 60, 50);

    TEST_ASSERT_EQUAL_INT(0, g_eventCount);
    TEST_ASSERT_EQUAL_INT(TRACKER_IDLE, tracker.getState());
}

// 開機時秤上沒有杯子，之後才放上空杯，也不能被判成補水。
// 本專案的使用流程是空杯先去皮，因此裸秤會是負重量而不是 0g。
void test_boot_with_empty_scale_then_place_empty_cup_emits_no_event() {
    FakeScale scale;
    DrinkTracker tracker(scale);
    tracker.onDrinkEvent(captureEvent);
    g_eventCount = 0;

    tracker.begin();
    tracker.setEmptyCupThreshold(-100.0f);

    scale.weight = -464.1f;
    scale.stable = true;
    pump(tracker, 10, 50);
    TEST_ASSERT_EQUAL_INT(TRACKER_UNKNOWN, tracker.getState());

    scale.weight = 3.0f;
    pump(tracker, 60, 50);

    TEST_ASSERT_EQUAL_INT(0, g_eventCount);
    TEST_ASSERT_EQUAL_INT(TRACKER_IDLE, tracker.getState());
}

// 修掉上面的誤判之後，真正的喝水仍然要能被偵測到。
void test_drink_is_detected_after_cup_returns() {
    FakeScale scale;
    DrinkTracker tracker(scale);
    tracker.onDrinkEvent(captureEvent);
    g_eventCount = 0;

    setClock(DAY1_NOON);
    tracker.begin();
    const int drankMl = doOneDrink(tracker, scale);

    TEST_ASSERT_EQUAL_INT(1, g_eventCount);
    TEST_ASSERT_EQUAL_INT(EVENT_DRINK, g_lastEventType);
    TEST_ASSERT_EQUAL_INT(drankMl, g_lastAmountMl);
}

// 使用者先把空杯去皮後，拿走杯子會得到明顯負重量；喝完放回的空杯則回到接近 0g。
// 兩者都不能被舊的固定正閾值正確區分，這個案例確保空杯放回仍會完成結算。
void test_tared_empty_cup_is_detected_after_return() {
    FakeScale scale;
    DrinkTracker tracker(scale);
    tracker.onDrinkEvent(captureEvent);
    g_eventCount = 0;

    setClock(DAY1_NOON);
    tracker.begin();
    tracker.setEmptyCupThreshold(-100.0f);

    // 空杯去皮後裝入約 303g 水，空杯本身回到約 3g。
    scale.weight = 303.0f;
    scale.stable = true;
    pump(tracker, 10, 50);

    // 完全拿走杯子時，實測讀值約為 -464.1g。
    scale.weight = -464.1f;
    pump(tracker, 20, 50);

    // 喝完放回空杯，讀值回到約 3g；應在穩定後產生 300ml 喝水事件。
    scale.weight = 3.0f;
    pump(tracker, 40, 50);

    TEST_ASSERT_EQUAL_INT(1, g_eventCount);
    TEST_ASSERT_EQUAL_INT(EVENT_DRINK, g_lastEventType);
    TEST_ASSERT_EQUAL_INT(300, g_lastAmountMl);
}

// 使用者最容易遇到的情境：晚上關機、隔天開機。舊的做法把日期只留在 RAM，
// 開機時一律沿用當下日期，昨天的累計就會被當成今天的。
void test_daily_total_resets_after_reboot_across_midnight() {
    setClock(DAY1_NOON);
    int drankMl = 0;
    {
        FakeScale scale;
        DrinkTracker tracker(scale);
        tracker.begin();
        drankMl = doOneDrink(tracker, scale);
        TEST_ASSERT_EQUAL_INT(drankMl, tracker.getTodayTotalMl());
    }  // 物件銷毀 = 模擬斷電重開機，設定與累計留在 NVS

    setClock(DAY2_MORNING);
    FakeScale scale2;
    DrinkTracker tracker2(scale2);
    tracker2.begin();
    TEST_ASSERT_EQUAL_INT(drankMl, tracker2.getTodayTotalMl());  // 剛載入時沿用 NVS

    pump(tracker2, 5, 50);
    TEST_ASSERT_EQUAL_INT(0, tracker2.getTodayTotalMl());        // 察覺跨日後歸零
}

// 裝置沒有 WiFi/NTP，開機當下沒有任何時間來源，
// 要等手機透過 BLE 的 set_time 校時之後才知道今天是哪一天。
void test_daily_total_resets_when_clock_syncs_late() {
    setClock(DAY1_NOON);
    int drankMl = 0;
    {
        FakeScale scale;
        DrinkTracker tracker(scale);
        tracker.begin();
        drankMl = doOneDrink(tracker, scale);
    }

    setClock(1000);  // 重開機，且尚未校時
    FakeScale scale2;
    DrinkTracker tracker2(scale2);
    tracker2.begin();
    pump(tracker2, 20, 50);
    TEST_ASSERT_EQUAL_INT(drankMl, tracker2.getTodayTotalMl());  // 沒有時間就不准亂動

    setClock(DAY2_MORNING);  // 手機連上來送 set_time
    pump(tracker2, 5, 50);
    TEST_ASSERT_EQUAL_INT(0, tracker2.getTodayTotalMl());
}

void setup() {
    delay(2000);
    UNITY_BEGIN();
    RUN_TEST(test_legacy_cup_threshold_is_migrated);
    RUN_TEST(test_custom_cup_threshold_is_preserved_during_migration);
    RUN_TEST(test_boot_with_cup_already_on_scale_emits_no_event);
    RUN_TEST(test_boot_with_empty_scale_then_place_empty_cup_emits_no_event);
    RUN_TEST(test_drink_is_detected_after_cup_returns);
    RUN_TEST(test_tared_empty_cup_is_detected_after_return);
    RUN_TEST(test_daily_total_resets_after_reboot_across_midnight);
    RUN_TEST(test_daily_total_resets_when_clock_syncs_late);
    UNITY_END();
}

void loop() {}
