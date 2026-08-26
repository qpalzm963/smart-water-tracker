# SoftAP Browser Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an ESP32-C3 expose a QR-protected SoftAP captive portal that configures Wi-Fi, API URL, and Device Token without reflashing.

**Architecture:** `NetworkManager` remains the single owner of STA credentials and NVS writes. A new `ProvisioningPortal` owns the SoftAP, DNS responder, local HTTP API, and embedded browser page; `main.cpp` activates it when the device is unconfigured or has failed to join Wi-Fi for five minutes. The portal is stopped as soon as STA connects.

**Tech Stack:** ESP32 Arduino core `WiFi`, `DNSServer`, `WebServer`, `Preferences`, ArduinoJson, Unity/PlatformIO.

---

## File Structure

- Create `firmware/include/ProvisioningPortal.h`: portal public API, request validation result, and safe status model.
- Create `firmware/src/ProvisioningPortal.cpp`: SoftAP lifecycle, DNS/HTTP handlers, NVS setup secret, and embedded page.
- Modify `firmware/include/Config.h`: provisioning constants and setup-secret NVS key.
- Modify `firmware/include/NetworkManager.h` and `firmware/src/NetworkManager.cpp`: connection-failure duration and safe configuration state.
- Modify `firmware/src/main.cpp`: create, start, stop, and update the portal.
- Modify `firmware/test/test_network_and_uploader/test_main.cpp`: validation and safe-status regression tests.
- Modify `README.md`: first-time mobile provisioning and QR handoff instructions.

### Task 1: Add deterministic provisioning configuration and validation

**Files:**
- Modify: `firmware/include/Config.h`
- Create: `firmware/include/ProvisioningPortal.h`
- Create: `firmware/src/ProvisioningPortal.cpp`
- Test: `firmware/test/test_network_and_uploader/test_main.cpp`

- [ ] **Step 1: Write failing validation tests**

Add Unity cases covering valid data, each invalid field, and sensitive-output masking:

```cpp
ProvisioningRequest valid{
    "Home-2.4G", "password123", "http://13.230.182.44", "dvt_0123456789abcdef"};
TEST_ASSERT_TRUE(ProvisioningPortal::validate(valid).ok);
TEST_ASSERT_FALSE(ProvisioningPortal::validate({"", "password123", "http://host", "dvt_x"}).ok);
TEST_ASSERT_FALSE(ProvisioningPortal::validate({"ssid", "short", "http://host", "dvt_x"}).ok);
TEST_ASSERT_FALSE(ProvisioningPortal::validate({"ssid", "password123", "ftp://host", "dvt_x"}).ok);
TEST_ASSERT_FALSE(ProvisioningPortal::validate({"ssid", "password123", "http://host", "token"}).ok);
TEST_ASSERT_EQUAL_STRING("dvt_****cdef", ProvisioningPortal::maskToken("dvt_0123456789abcdef").c_str());
```

- [ ] **Step 2: Run the test to establish the initial failure**

Run: `cd firmware && pio test -e esp32-c3-supermini -f test_network_and_uploader`

Expected: compilation fails because `ProvisioningPortal` and `ProvisioningRequest` do not exist.

- [ ] **Step 3: Define constants and public types**

In `Config.h`, add `NVS_KEY_SETUP_SECRET`, `PROVISIONING_AP_PREFIX`, `PROVISIONING_PORTAL_IP`, `PROVISIONING_FAILURE_DELAY_MS` (300000), and bounded SSID/password limits. In `ProvisioningPortal.h`, define:

```cpp
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
```

Add pure static `validate`, `maskToken`, and `maskApiUrl` methods so unit tests do not need Wi-Fi hardware.

- [ ] **Step 4: Implement the minimum validation behavior**

Implement rules exactly as specified: SSID length 1–32; password empty or 8–63 characters; API URL begins `http://` or `https://`; Device Token begins `dvt_` and has at least 12 characters. Return one precise field error and never include submitted password or full token in the error.

- [ ] **Step 5: Re-run validation tests**

Run: `cd firmware && pio test -e esp32-c3-supermini -f test_network_and_uploader`

Expected: all portal validation and existing queue tests pass.

- [ ] **Step 6: Commit the validation unit**

```bash
git add firmware/include/Config.h firmware/include/ProvisioningPortal.h firmware/src/ProvisioningPortal.cpp firmware/test/test_network_and_uploader/test_main.cpp
git commit -m "feat: 新增配網欄位驗證"
```

### Task 2: Implement secure SoftAP lifecycle and captive portal

**Files:**
- Modify: `firmware/include/ProvisioningPortal.h`
- Modify: `firmware/src/ProvisioningPortal.cpp`
- Modify: `firmware/include/NetworkManager.h`
- Modify: `firmware/src/NetworkManager.cpp`
- Test: `firmware/test/test_network_and_uploader/test_main.cpp`

- [ ] **Step 1: Add failing lifecycle tests**

Add tests for the pure decision function:

```cpp
TEST_ASSERT_TRUE(ProvisioningPortal::shouldRun(true, false, 0));
TEST_ASSERT_FALSE(ProvisioningPortal::shouldRun(false, false, 299999));
TEST_ASSERT_TRUE(ProvisioningPortal::shouldRun(false, false, 300000));
TEST_ASSERT_FALSE(ProvisioningPortal::shouldRun(false, true, 300000));
```

- [ ] **Step 2: Run the lifecycle test to establish failure**

Run: `cd firmware && pio test -e esp32-c3-supermini -f test_network_and_uploader`

Expected: compile failure because `shouldRun` is absent.

- [ ] **Step 3: Add connection-failure tracking to NetworkManager**

Add `unsigned long disconnectedSinceMs() const` and update it only while the device is configured and disconnected. Reset it to zero on a successful connection and in `clearConfig`. Do not expose `_password` through a getter or log.

- [ ] **Step 4: Implement portal start, update, and stop**

Use core `DNSServer` and `WebServer` only. On `start(deviceId)`:

1. Read or create a 32-hex-character `setupSecret` in NVS.
2. Start WPA2 SoftAP using `WaterTracker-<last four device ID chars>` and `setupSecret` as its password.
3. Configure AP IP `192.168.4.1`, start DNS wildcard resolution, and create routes.

Routes must be:

- `GET /` serves the embedded page.
- `GET /api/v1/provisioning/status` returns JSON with only safe fields.
- `POST /api/v1/provisioning/configure` parses JSON, validates it, calls `NetworkManager::saveConfig`, returns `202` on acceptance, and never echoes secrets.
- `POST /api/v1/provisioning/clear` calls `NetworkManager::clearConfig` and returns `204`.
- all other paths return the embedded page to support captive-portal probes.

`update()` calls DNS and HTTP handlers only while active. `stop()` stops DNS/server, disables AP mode, and clears in-memory secrets.

- [ ] **Step 5: Implement the lifecycle decision function**

Return true when Wi-Fi is unconfigured, or when it is configured, disconnected, and `disconnectedForMs >= PROVISIONING_FAILURE_DELAY_MS`. Return false when STA is connected.

- [ ] **Step 6: Run tests and firmware build**

Run:

```bash
cd firmware
pio test -e esp32-c3-supermini -f test_network_and_uploader
pio run -e esp32-c3-supermini
```

Expected: all Unity tests pass and the firmware builds with only Arduino-core libraries.

- [ ] **Step 7: Commit the SoftAP unit**

```bash
git add firmware/include/ProvisioningPortal.h firmware/src/ProvisioningPortal.cpp firmware/include/NetworkManager.h firmware/src/NetworkManager.cpp firmware/test/test_network_and_uploader/test_main.cpp
git commit -m "feat: 新增 SoftAP 配網入口"
```

### Task 3: Add the browser configuration page and main-loop integration

**Files:**
- Modify: `firmware/include/ProvisioningPortal.h`
- Modify: `firmware/src/ProvisioningPortal.cpp`
- Modify: `firmware/src/main.cpp`
- Test: `firmware/test/test_network_and_uploader/test_main.cpp`

- [ ] **Step 1: Add the safe status serialization test**

Construct a status with a token and password, serialize it through the portal, then assert that it contains `tokenConfigured: true`, contains the masked token only, and does not contain the password or full token.

- [ ] **Step 2: Run the test to establish failure**

Run: `cd firmware && pio test -e esp32-c3-supermini -f test_network_and_uploader`

Expected: failure because no safe status serializer exists.

- [ ] **Step 3: Build the embedded responsive page**

Serve a self-contained UTF-8 HTML page from flash. The page must:

- explain that only 2.4GHz Wi-Fi is supported;
- display safe device and connection status from `/status`;
- have fields for SSID, password, API Base URL, and Device Token;
- submit JSON to `/configure`, disable duplicate submissions, and poll status every two seconds after acceptance;
- show field-specific validation errors;
- never prefill or render saved password/token.

- [ ] **Step 4: Integrate lifecycle in main.cpp**

Create `ProvisioningPortal provisioningPortal(networkManager);` after the network manager. In `setup`, call `provisioningPortal.begin(deviceId)`. In `loop`, run `networkManager.update()` first, then call `start`, `update`, or `stop` according to `shouldRun(networkManager.isConfigured(), networkManager.isConnected(), networkManager.disconnectedSinceMs())`. Keep `CloudUploader` and BLE commands unchanged.

- [ ] **Step 5: Run unit tests and build**

Run:

```bash
cd firmware
pio test -e esp32-c3-supermini
pio run -e esp32-c3-supermini
```

Expected: every existing firmware test passes and the final image builds.

- [ ] **Step 6: Commit the integration unit**

```bash
git add firmware/include/ProvisioningPortal.h firmware/src/ProvisioningPortal.cpp firmware/src/main.cpp firmware/test/test_network_and_uploader/test_main.cpp
git commit -m "feat: 整合瀏覽器配網流程"
```

### Task 4: Verify on hardware and update operating documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add the browser provisioning guide**

Document QR scan, connection to `WaterTracker-xxxx`, captive portal access at `http://192.168.4.1`, the four form values, the production API base URL `http://13.230.182.44`, and the rule that Device Token must come from the dashboard rather than source control.

- [ ] **Step 2: Add recovery and security guidance**

Document the five-minute reconnection timeout, portal behavior after successful connection, `WIFI:STATUS`, `WIFI:CLEAR`, 2.4GHz-only limitation, and QR-code handling as a device credential.

- [ ] **Step 3: Flash and execute the acceptance checklist**

Run:

```bash
cd firmware
pio run -e esp32-c3-supermini -t upload
pio device monitor -b 115200
```

Verify: no stored credentials opens WPA2 SoftAP; QR-provided password joins it; the form rejects invalid fields; valid credentials connect the device; `WIFI:STATUS` reports connection; a reboot reconnects; wrong saved Wi-Fi reopens portal after five minutes; form/status responses never reveal password or full token.

- [ ] **Step 4: Commit documentation**

```bash
git add README.md
git commit -m "docs: 補上手機 SoftAP 配網指引"
```

## Self-Review

- Spec coverage: Tasks 1–3 implement all specified identity, SoftAP, DNS, HTTP API, lifecycle, security, and validation requirements; Task 4 covers the user flow and real-device verification.
- No placeholders: commands, files, method names, routes, data rules, and expected outcomes are explicit.
- Type consistency: `ProvisioningRequest`, `ProvisioningValidationResult`, `NetworkManager::disconnectedSinceMs`, and the three `/api/v1/provisioning/*` endpoints retain the same names throughout the plan.
