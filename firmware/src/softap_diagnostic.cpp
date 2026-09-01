#include <Arduino.h>
#include <WiFi.h>

namespace {
constexpr char kSsid[] = "WaterTracker-DIAG";
constexpr uint8_t kChannel = 6;
unsigned long lastStatusMs = 0;
}

void setup() {
    Serial.begin(115200);
    delay(500);
    WiFi.mode(WIFI_STA);
    delay(20);
    WiFi.mode(WIFI_OFF);
    delay(100);
    WiFi.mode(WIFI_AP);
    WiFi.setSleep(false);
    WiFi.setTxPower(WIFI_POWER_19_5dBm);
    WiFi.onEvent([](WiFiEvent_t event, WiFiEventInfo_t info) {
        if (event == ARDUINO_EVENT_WIFI_AP_STACONNECTED) {
            Serial.println("[DIAG] client connected");
        } else if (event == ARDUINO_EVENT_WIFI_AP_STADISCONNECTED) {
            Serial.printf("[DIAG] client disconnected, aid=%d\n", info.wifi_ap_stadisconnected.aid);
        }
    });

    const bool started = WiFi.softAP(kSsid, nullptr, kChannel, false, 4);
    Serial.printf("[DIAG] AP started=%s ssid=%s channel=%u ip=%s\n",
                  started ? "true" : "false", kSsid, kChannel, WiFi.softAPIP().toString().c_str());
}

void loop() {
    if (millis() - lastStatusMs >= 5000) {
        lastStatusMs = millis();
        Serial.printf("[DIAG] mode=%d clients=%u ip=%s\n", static_cast<int>(WiFi.getMode()),
                      WiFi.softAPgetStationNum(), WiFi.softAPIP().toString().c_str());
    }
    delay(20);
}
