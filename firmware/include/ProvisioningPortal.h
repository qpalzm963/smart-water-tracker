#pragma once

#include <Arduino.h>

class WaterNetworkManager;

struct ProvisioningRequest {
    String ssid;
    String password;
    String apiBaseUrl;
    String deviceToken;
};

struct ProvisioningValidationResult {
    bool ok;
    String error;
};

class ProvisioningPortal {
public:
    explicit ProvisioningPortal(WaterNetworkManager& networkManager);

    void begin(const String& deviceId);
    void start();
    void stop();
    void update();

    bool isActive() const;
    String getApSsid() const;
    String getSetupSecret() const;
    String getQrPayload() const;
    String diagnosticStatus() const;

    static ProvisioningValidationResult validate(const ProvisioningRequest& request);
    static bool shouldRun(bool wifiConfigured, bool wifiConnected, unsigned long disconnectedForMs);
    static String maskToken(const String& token);
    static String maskApiUrl(const String& url);

private:
    String loadOrCreateSetupSecret();
    void configureRoutes();
    void handleStatus();
    void handleConfigure();
    void handleClear();
    void handlePortalPage();
    String statusJson() const;

    WaterNetworkManager& _networkManager;
    String _deviceId;
    String _apSsid;
    String _setupSecret;
    bool _active = false;
    bool _pendingConnection = false;
    unsigned long _lastStartAttemptMs = 0;

    class Impl;
    Impl* _impl = nullptr;
};
