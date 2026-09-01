#include <Arduino.h>
#include <unity.h>

#include "BleWaterService.h"

namespace {
constexpr char TEST_PREFS_NAMESPACE[] = "water_ble_test";
}

void test_acknowledge_removes_only_contiguous_prefix_and_survives_reboot() {
    BleWaterService service("water_ack_test", TEST_PREFS_NAMESPACE);
    service.clearPersistedEvents();
    service.recordDrink(1721389200, 100, 500, 100);
    const String first = service.latestEventId();
    service.recordDrink(1721389201, 120, 380, 220);
    const String second = service.latestEventId();
    service.recordDrink(1721389202, 140, 240, 360);
    const String third = service.latestEventId();

    TEST_ASSERT_NOT_EQUAL(first, second);
    TEST_ASSERT_TRUE(service.acknowledgeEventsThrough(second));
    const std::vector<BleWaterEvent> retained = service.eventsAfter("");
    TEST_ASSERT_EQUAL_UINT32(1, retained.size());
    TEST_ASSERT_EQUAL_STRING(third.c_str(), retained[0].id.c_str());
    TEST_ASSERT_TRUE(service.acknowledgeEventsThrough(second));

    const std::vector<BleWaterEvent> beforeUnknownAck = service.eventsAfter("");
    TEST_ASSERT_FALSE(service.acknowledgeEventsThrough("unknown-event"));
    const std::vector<BleWaterEvent> afterUnknownAck = service.eventsAfter("");
    TEST_ASSERT_EQUAL_UINT32(beforeUnknownAck.size(), afterUnknownAck.size());
    TEST_ASSERT_EQUAL_STRING(beforeUnknownAck[0].id.c_str(), afterUnknownAck[0].id.c_str());

    service.recordDrink(1721389203, 80, 160, 440);
    const String fourth = service.latestEventId();
    const std::vector<BleWaterEvent> retainedAfterNewEvent = service.eventsAfter("");
    TEST_ASSERT_EQUAL_UINT32(2, retainedAfterNewEvent.size());
    TEST_ASSERT_EQUAL_STRING(third.c_str(), retainedAfterNewEvent[0].id.c_str());
    TEST_ASSERT_EQUAL_STRING(fourth.c_str(), retainedAfterNewEvent[1].id.c_str());

    BleWaterService rebooted("water_ack_test", TEST_PREFS_NAMESPACE);
    rebooted.restorePersistedEvents();
    const std::vector<BleWaterEvent> restored = rebooted.eventsAfter("");
    TEST_ASSERT_EQUAL_UINT32(2, restored.size());
    TEST_ASSERT_EQUAL_STRING(third.c_str(), restored[0].id.c_str());
    TEST_ASSERT_EQUAL_STRING(fourth.c_str(), restored[1].id.c_str());
    TEST_ASSERT_TRUE(rebooted.acknowledgeEventsThrough(second));
    rebooted.clearPersistedEvents();

    BleWaterService afterClear("water_ack_test", TEST_PREFS_NAMESPACE);
    afterClear.restorePersistedEvents();
    TEST_ASSERT_FALSE(afterClear.acknowledgeEventsThrough(second));
}

void test_acknowledge_last_event_empties_history() {
    BleWaterService service("water_ack_all", TEST_PREFS_NAMESPACE);
    service.clearPersistedEvents();
    service.recordDrink(1721389300, 100, 500, 100);
    service.recordDrink(1721389301, 100, 400, 200);
    TEST_ASSERT_TRUE(service.acknowledgeEventsThrough(service.latestEventId()));
    TEST_ASSERT_EQUAL_UINT32(0, service.eventsAfter("").size());
    service.clearPersistedEvents();
}

void test_history_replay_returns_only_events_after_cursor() {
    BleWaterService service("water_c3_a1b2", TEST_PREFS_NAMESPACE);
    service.recordDrink(1721389200, 250, 450, 250);
    const String firstId = service.latestEventId();
    service.recordDrink(1721389201, 200, 250, 450);

    const std::vector<BleWaterEvent> replay = service.eventsAfter(firstId);
    TEST_ASSERT_EQUAL_UINT32(1, replay.size());
    TEST_ASSERT_EQUAL_STRING(service.latestEventId().c_str(), replay[0].id.c_str());
}

void test_refill_event_recording_and_64bit_boot_session() {
    BleWaterService service1("water_c3_a1b2", TEST_PREFS_NAMESPACE);
    service1.recordRefill(0, 500, 600, 250); // Unsynced time (0)
    const String id1 = service1.latestEventId();

    const std::vector<BleWaterEvent> events = service1.eventsAfter("");
    TEST_ASSERT_EQUAL_UINT32(1, events.size());
    TEST_ASSERT_EQUAL(EVENT_REFILL, events[0].type);
    TEST_ASSERT_EQUAL_INT(500, events[0].amountMl);

    BleWaterService service2("water_c3_a1b2", TEST_PREFS_NAMESPACE); // Simulated reboot (new 64-bit session)
    service2.recordRefill(0, 500, 600, 250);
    const String id2 = service2.latestEventId();

    // Even with occurredAt = 0 and seq = 0, event IDs from different boot sessions must be distinct!
    TEST_ASSERT_NOT_EQUAL(id1, id2);
    TEST_ASSERT_GREATER_THAN(20, id1.length());

    const String claimBeforeRotation = service1.claimSecret();
    TEST_ASSERT_TRUE(service1.rotateClaimSecret());
    TEST_ASSERT_NOT_EQUAL(claimBeforeRotation, service1.claimSecret());
    TEST_ASSERT_NOT_EQUAL(service1.claimSecret(), "");
}

// 沒有 Wi-Fi 上傳路徑之後，BLE 是資料離開裝置的唯一管道。裝置在手機取走事件前
// 重開機時，那些事件必須還在——否則就是永久遺失。
void test_events_survive_reboot_for_phone_sync() {
    BleWaterService before("water_c3_a1b2", TEST_PREFS_NAMESPACE);
    before.clearPersistedEvents();
    before.recordDrink(1721389200, 250, 450, 250);
    const String firstId = before.latestEventId();
    before.recordDrink(1721389201, 200, 250, 450);
    const String secondId = before.latestEventId();

    // 模擬重開機: 全新實例，RAM buffer 是空的
    BleWaterService after("water_c3_a1b2", TEST_PREFS_NAMESPACE);
    TEST_ASSERT_EQUAL_UINT32(0, after.eventsAfter("").size());

    after.restorePersistedEvents();

    const std::vector<BleWaterEvent> all = after.eventsAfter("");
    TEST_ASSERT_EQUAL_UINT32(2, all.size());
    TEST_ASSERT_EQUAL_STRING(firstId.c_str(), all[0].id.c_str());
    TEST_ASSERT_EQUAL_STRING(secondId.c_str(), all[1].id.c_str());
    TEST_ASSERT_EQUAL_INT(250, all[0].amountMl);
    TEST_ASSERT_EQUAL_INT(450, all[0].remainingMl);
    TEST_ASSERT_EQUAL(EVENT_DRINK, all[0].type);

    // 手機的 cursor 來自重開機前，補送仍必須從正確位置接續
    const std::vector<BleWaterEvent> afterCursor = after.eventsAfter(firstId);
    TEST_ASSERT_EQUAL_UINT32(1, afterCursor.size());
    TEST_ASSERT_EQUAL_STRING(secondId.c_str(), afterCursor[0].id.c_str());

    after.clearPersistedEvents();
}

void setup() {
    delay(2000);
    UNITY_BEGIN();
    RUN_TEST(test_acknowledge_removes_only_contiguous_prefix_and_survives_reboot);
    RUN_TEST(test_acknowledge_last_event_empties_history);
    RUN_TEST(test_events_survive_reboot_for_phone_sync);
    RUN_TEST(test_history_replay_returns_only_events_after_cursor);
    RUN_TEST(test_refill_event_recording_and_64bit_boot_session);
    UNITY_END();
}

void loop() {}
