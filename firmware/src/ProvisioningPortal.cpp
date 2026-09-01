#include "ProvisioningPortal.h"

#include <DNSServer.h>
#include <Preferences.h>
#include <WebServer.h>
#include <WiFi.h>
#include <ArduinoJson.h>
#include <esp_system.h>

#include "Config.h"
#include "WaterNetworkManager.h"


namespace {
constexpr uint16_t kDnsPort = 53;
constexpr uint16_t kHttpPort = 80;
const IPAddress kPortalIp(192, 168, PROVISIONING_AP_IP_OCTET, 1);

const char kPortalPage[] PROGMEM = R"HTML(
<!doctype html><html lang="zh-Hant"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WaterTracker 配網</title><style>
body{font-family:-apple-system,BlinkMacSystemFont,"Noto Sans TC",sans-serif;background:#f4f8f8;color:#193434;margin:0;padding:24px}
main{max-width:460px;margin:auto;background:#fff;padding:24px;border-radius:16px;box-shadow:0 8px 24px #0001}h1{margin-top:0}label{display:block;margin-top:14px;font-weight:600}input{box-sizing:border-box;width:100%;padding:11px;margin-top:6px;border:1px solid #b9caca;border-radius:8px;font-size:16px}button{width:100%;margin-top:20px;padding:12px;border:0;border-radius:8px;background:#117c72;color:white;font-size:16px;font-weight:700}.hint,#message{font-size:14px;line-height:1.5}.hint{color:#476363}#message{margin-top:16px;min-height:22px}.error{color:#b42318}.ok{color:#087443}
</style><main><h1>設定智慧水杯</h1><p class="hint" id="status">正在讀取裝置狀態…</p><form id="form"><label>Wi‑Fi 名稱（僅支援 2.4GHz）<input name="ssid" maxlength="32" required autocomplete="off"></label><label>Wi‑Fi 密碼<input name="password" type="password" maxlength="63" autocomplete="new-password"></label><label>API Base URL<input name="apiBaseUrl" type="url" required placeholder="http://13.230.182.44"></label><label>Device Token<input name="deviceToken" required placeholder="dvt_..."></label><button id="submit" type="submit">儲存並連線</button></form><p id="message" aria-live="polite"></p></main>
<script>
const status=document.querySelector('#status'),message=document.querySelector('#message'),form=document.querySelector('#form'),submit=document.querySelector('#submit');
async function refresh(){try{const r=await fetch('/api/v1/provisioning/status');const s=await r.json();status.textContent=`裝置 ${s.deviceId}｜Wi‑Fi：${s.wifiConnected?'已連線':'尚未連線'}`;if(s.wifiConnected){message.className='ok';message.textContent='已連線成功，裝置將關閉設定熱點。'}}catch(_){status.textContent='無法讀取裝置狀態';}}
form.addEventListener('submit',async e=>{e.preventDefault();submit.disabled=true;message.className='';message.textContent='正在儲存並嘗試連線…';const data=Object.fromEntries(new FormData(form));try{const r=await fetch('/api/v1/provisioning/configure',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const body=await r.json();if(!r.ok)throw new Error(body.error||'設定失敗');message.className='ok';message.textContent='設定已儲存，正在連線；請稍候。';}catch(err){message.className='error';message.textContent=err.message;submit.disabled=false;}});
refresh();setInterval(refresh,2000);
</script></html>)HTML";

bool isHttpUrl(const String& value) {
    return value.startsWith("http://") || value.startsWith("https://");
}
}  // namespace

class ProvisioningPortal::Impl {
public:
    DNSServer dns;
    WebServer server{kHttpPort};
    bool routesConfigured = false;
    String lastWifiEvent = "not_observed";
};

ProvisioningPortal::ProvisioningPortal(WaterNetworkManager& networkManager)
    : _networkManager(networkManager), _impl(new Impl()) {}

void ProvisioningPortal::begin(const String& deviceId) {
    _deviceId = deviceId;
    // Registered once: Arduino appends to a handler list, so registering inside
    // start() would stack up a new callback on every retry.
    WiFi.onEvent([this](WiFiEvent_t event, WiFiEventInfo_t info) {
        if (event == ARDUINO_EVENT_WIFI_AP_STACONNECTED) {
            _impl->lastWifiEvent = "ap_client_connected";
        } else if (event == ARDUINO_EVENT_WIFI_AP_STADISCONNECTED) {
            _impl->lastWifiEvent = "ap_client_disconnected";
        }
    });
    _setupSecret = loadOrCreateSetupSecret();
    const String suffix = deviceId.length() > 4 ? deviceId.substring(deviceId.length() - 4) : deviceId;
    _apSsid = String(PROVISIONING_AP_PREFIX) + suffix;
}

void ProvisioningPortal::start() {
    if (_active || _setupSecret.length() < PROVISIONING_MIN_PASSWORD_LENGTH) {
        return;
    }
    // Back off between attempts. Without this a failed softAP() leaves _active
    // false and main's loop retries every 10 ms.
    const unsigned long now = millis();
    if (_lastStartAttemptMs != 0 && now - _lastStartAttemptMs < PROVISIONING_START_RETRY_MS) {
        return;
    }
    _lastStartAttemptMs = now;

    // ESP32-C3 on this board does not beacon reliably in AP+STA mode.
    // Keep provisioning in AP-only mode; switch to STA only after the browser
    // has received the configuration response.
    WiFi.mode(WIFI_AP);
    WiFi.setSleep(false);
    WiFi.setTxPower(WIFI_POWER_19_5dBm);
    // The hotspot is intentionally open only during provisioning; device credentials
    // are still required by the configuration form before Wi-Fi settings are saved.
    if (!WiFi.softAP(_apSsid.c_str(), nullptr, 6, false, 4)) {
        Serial.println("[PORTAL] 無法啟動配網熱點");
        return;
    }

    configureRoutes();
    _impl->dns.start(kDnsPort, "*", kPortalIp);
    _impl->server.begin();
    _active = true;
    Serial.printf("[PORTAL] 配網熱點已啟動: %s | 請掃描機身 QR code 辨識裝置\n", _apSsid.c_str());
}

void ProvisioningPortal::stop() {
    if (!_active) {
        return;
    }
    _impl->dns.stop();
    _impl->server.stop();
    WiFi.softAPdisconnect(true);
    _active = false;
    Serial.println("[PORTAL] 配網熱點已關閉");
}

void ProvisioningPortal::update() {
    if (!_active) {
        return;
    }
    _impl->dns.processNextRequest();
    _impl->server.handleClient();
    if (_pendingConnection) {
        _pendingConnection = false;
        stop();
        _networkManager.reconnect();
    }
}

bool ProvisioningPortal::isActive() const {
    return _active;
}

String ProvisioningPortal::getApSsid() const {
    return _apSsid;
}

String ProvisioningPortal::getSetupSecret() const {
    return _setupSecret;
}

String ProvisioningPortal::getQrPayload() const {
    JsonDocument document;
    document["v"] = 1;
    document["deviceId"] = _deviceId;
    document["apSsid"] = _apSsid;
    document["setupSecret"] = _setupSecret;
    String payload;
    serializeJson(document, payload);
    return payload;
}

String ProvisioningPortal::diagnosticStatus() const {
    return String("active=") + (_active ? "true" : "false") +
           " mode=" + String(static_cast<int>(WiFi.getMode())) +
           " apIp=" + WiFi.softAPIP().toString() +
           " clients=" + String(WiFi.softAPgetStationNum()) +
           " lastEvent=" + _impl->lastWifiEvent;
}

ProvisioningValidationResult ProvisioningPortal::validate(const ProvisioningRequest& request) {
    if (request.ssid.length() == 0 || request.ssid.length() > PROVISIONING_MAX_SSID_LENGTH) {
        return {false, "Wi-Fi 名稱長度必須為 1 到 32 個字元"};
    }
    if (request.password.length() != 0 &&
        (request.password.length() < PROVISIONING_MIN_PASSWORD_LENGTH ||
         request.password.length() > PROVISIONING_MAX_PASSWORD_LENGTH)) {
        return {false, "Wi-Fi 密碼必須為 8 到 63 個字元，或留空以使用開放網路"};
    }
    if (!isHttpUrl(request.apiBaseUrl)) {
        return {false, "API Base URL 必須以 http:// 或 https:// 開頭"};
    }
    if (!request.deviceToken.startsWith("dvt_") || request.deviceToken.length() < 12) {
        return {false, "Device Token 格式不正確"};
    }
    return {true, ""};
}

bool ProvisioningPortal::shouldRun(bool wifiConfigured, bool wifiConnected, unsigned long disconnectedForMs) {
    return !wifiConfigured || (!wifiConnected && disconnectedForMs >= PROVISIONING_FAILURE_DELAY_MS);
}

String ProvisioningPortal::maskToken(const String& token) {
    if (token.length() <= 8) {
        return token.length() == 0 ? "" : "****";
    }
    return token.substring(0, 4) + "****" + token.substring(token.length() - 4);
}

String ProvisioningPortal::maskApiUrl(const String& url) {
    if (url.length() == 0) {
        return "";
    }
    return url;
}

String ProvisioningPortal::loadOrCreateSetupSecret() {
    Preferences prefs;
    if (!prefs.begin(PREFS_NAMESPACE, false)) {
        Serial.println("[PORTAL] 無法開啟配網密鑰儲存空間");
        return "";
    }

    String secret = prefs.getString(NVS_KEY_SETUP_SECRET, "");
    if (secret.length() != 32) {
        char value[33];
        snprintf(value, sizeof(value), "%08lx%08lx%08lx%08lx",
                 static_cast<unsigned long>(esp_random()), static_cast<unsigned long>(esp_random()),
                 static_cast<unsigned long>(esp_random()), static_cast<unsigned long>(esp_random()));
        secret = String(value);
        prefs.putString(NVS_KEY_SETUP_SECRET, secret);
    }
    prefs.end();
    return secret;
}

void ProvisioningPortal::configureRoutes() {
    if (_impl->routesConfigured) {
        return;
    }
    _impl->server.on("/", HTTP_GET, [this]() { handlePortalPage(); });
    _impl->server.on("/api/v1/provisioning/status", HTTP_GET, [this]() { handleStatus(); });
    _impl->server.on("/api/v1/provisioning/configure", HTTP_POST, [this]() { handleConfigure(); });
    _impl->server.on("/api/v1/provisioning/clear", HTTP_POST, [this]() { handleClear(); });
    _impl->server.onNotFound([this]() { handlePortalPage(); });
    _impl->routesConfigured = true;
}

void ProvisioningPortal::handleStatus() {
    _impl->server.send(200, "application/json; charset=utf-8", statusJson());
}

void ProvisioningPortal::handleConfigure() {
    JsonDocument document;
    const DeserializationError error = deserializeJson(document, _impl->server.arg("plain"));
    if (error) {
        _impl->server.send(400, "application/json; charset=utf-8", "{\"error\":\"請提供有效 JSON\"}");
        return;
    }

    const ProvisioningRequest request{
        String(document["ssid"] | ""), String(document["password"] | ""),
        String(document["apiBaseUrl"] | ""), String(document["deviceToken"] | "")};
    const ProvisioningValidationResult validation = validate(request);
    if (!validation.ok) {
        JsonDocument response;
        response["error"] = validation.error;
        String body;
        serializeJson(response, body);
        _impl->server.send(400, "application/json; charset=utf-8", body);
        return;
    }

    if (!_networkManager.saveConfig(request.ssid, request.password, request.apiBaseUrl, request.deviceToken, false)) {
        _impl->server.send(500, "application/json; charset=utf-8", "{\"error\":\"無法儲存設定\"}");
        return;
    }
    _impl->server.send(202, "application/json; charset=utf-8", "{\"accepted\":true}");
    _pendingConnection = true;
}

void ProvisioningPortal::handleClear() {
    _networkManager.clearConfig();
    _impl->server.send(204, "text/plain", "");
}


void ProvisioningPortal::handlePortalPage() {
    _impl->server.send_P(200, "text/html; charset=utf-8", kPortalPage);
}

String ProvisioningPortal::statusJson() const {
    JsonDocument document;
    document["deviceId"] = _deviceId;
    document["apSsid"] = _apSsid;
    document["wifiConfigured"] = _networkManager.isConfigured();
    document["wifiConnected"] = _networkManager.isConnected();
    document["ip"] = _networkManager.getIpAddress();
    document["apiBaseUrl"] = maskApiUrl(_networkManager.getApiBaseUrl());
    document["tokenConfigured"] = _networkManager.getDeviceToken().length() > 0;
    document["deviceToken"] = maskToken(_networkManager.getDeviceToken());
    String body;
    serializeJson(document, body);
    return body;
}
