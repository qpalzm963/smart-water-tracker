#include <Arduino.h>
#include <unity.h>

#include "WaterNetworkManager.h"
#include "CloudUploader.h"
#include "Config.h"
#include "ProvisioningPortal.h"

void test_provisioning_request_validation() {
    const ProvisioningRequest valid{
        "Home-2.4G", "password123", "http://13.230.182.44", "dvt_0123456789abcdef"};
    TEST_ASSERT_TRUE(ProvisioningPortal::validate(valid).ok);

    TEST_ASSERT_FALSE(ProvisioningPortal::validate({"", "password123", "http://host", "dvt_0123456789"}).ok);
    TEST_ASSERT_FALSE(ProvisioningPortal::validate({"ssid", "short", "http://host", "dvt_0123456789"}).ok);
    TEST_ASSERT_FALSE(ProvisioningPortal::validate({"ssid", "password123", "ftp://host", "dvt_0123456789"}).ok);
    TEST_ASSERT_FALSE(ProvisioningPortal::validate({"ssid", "password123", "http://host", "token"}).ok);
}

void test_provisioning_safe_display_and_lifecycle() {
    TEST_ASSERT_EQUAL_STRING("dvt_****cdef", ProvisioningPortal::maskToken("dvt_0123456789abcdef").c_str());
    TEST_ASSERT_EQUAL_STRING("****", ProvisioningPortal::maskToken("dvt_x").c_str());

    TEST_ASSERT_TRUE(ProvisioningPortal::shouldRun(false, false, 0));
    TEST_ASSERT_FALSE(ProvisioningPortal::shouldRun(true, false, PROVISIONING_FAILURE_DELAY_MS - 1));
    TEST_ASSERT_TRUE(ProvisioningPortal::shouldRun(true, false, PROVISIONING_FAILURE_DELAY_MS));
    TEST_ASSERT_FALSE(ProvisioningPortal::shouldRun(true, true, PROVISIONING_FAILURE_DELAY_MS));
}

void test_network_manager_config_persistence() {
    WaterNetworkManager net;
    net.clearConfig();
    TEST_ASSERT_FALSE(net.isConfigured());

    const bool saved = net.saveConfig("TestSSID", "TestPass123", "http://192.168.1.50:3000", "dvt_testtoken123456");
    TEST_ASSERT_TRUE(saved);
    TEST_ASSERT_TRUE(net.isConfigured());
    TEST_ASSERT_EQUAL_STRING("TestSSID", net.getSsid().c_str());
    TEST_ASSERT_EQUAL_STRING("http://192.168.1.50:3000", net.getApiBaseUrl().c_str());
    TEST_ASSERT_EQUAL_STRING("dvt_testtoken123456", net.getDeviceToken().c_str());

    // Clean up
    net.clearConfig();
    TEST_ASSERT_FALSE(net.isConfigured());
}

void test_cloud_uploader_offline_queue_capacity() {
    WaterNetworkManager net;
    CloudUploader uploader(net);
    uploader.clearQueue();

    TEST_ASSERT_EQUAL_UINT32(0, uploader.getPendingQueueSize());

    // Enqueue more than MAX_OFFLINE_UPLOAD_QUEUE items
    for (int i = 0; i < MAX_OFFLINE_UPLOAD_QUEUE + 5; ++i) {
        String eventId = "evt_" + String(i);
        uploader.postEvent(EVENT_DRINK, 100 + i, 400, 500, 1787918400 + i, eventId, true);
    }

    // Queue size should be capped at MAX_OFFLINE_UPLOAD_QUEUE
    TEST_ASSERT_EQUAL_UINT32(MAX_OFFLINE_UPLOAD_QUEUE, uploader.getPendingQueueSize());

    uploader.clearQueue();
    TEST_ASSERT_EQUAL_UINT32(0, uploader.getPendingQueueSize());
}

void setup() {
    delay(2000);
    UNITY_BEGIN();
    RUN_TEST(test_provisioning_request_validation);
    RUN_TEST(test_provisioning_safe_display_and_lifecycle);
    RUN_TEST(test_network_manager_config_persistence);
    RUN_TEST(test_cloud_uploader_offline_queue_capacity);
    UNITY_END();
}

void loop() {}
