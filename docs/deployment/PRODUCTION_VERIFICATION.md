# Production End-to-End Acceptance & Verification Guide

This document defines the complete end-to-end acceptance criteria, verification matrix, manual and automated testing procedures, and observability guidelines for the Smart Water Tracker full-stack production deployment on Vercel and MongoDB Atlas (Issue #10).

---

## 1. Acceptance Matrix (Issue #10 - 15 Criteria)

> [!NOTE]
> This PR establishes the deployment documentation, disaster recovery runbooks, and automated smoke testing tooling. Items marked `Pending live deployment verification` are to be executed and signed off on the live Vercel and MongoDB Atlas environments once production credentials and DNS are provisioned. Issue #10 remains open until live verification evidence is documented.

| ID | Issue #10 Acceptance Criteria | Verification Scope & Expected Behavior | Verification Status |
|---|---|---|---|
| **AC-1** | **Production URL 可正常開啟與登入** | Vercel production URL opens SPA cleanly without blank screen; user can log in via frontend UI | `Pending live deployment verification` (Run Step 1 & 2) |
| **AC-2** | **新帳號 register/login 正常** | `POST /api/v1/auth/register` creates user with bcrypt hash; `POST /api/v1/auth/login` authenticates case-insensitively and returns valid JWT | `Verified in test suite` / `Pending live verification` (Run Step 3) |
| **AC-3** | **JWT authenticated requests 正常** | Protected routes (`/api/v1/user/me`, `/api/v1/devices`, `/api/v1/water/*`) accept valid Bearer tokens and return 401 on expired/invalid/missing tokens | `Verified in test suite` / `Pending live verification` (Run Step 4) |
| **AC-4** | **Device create/claim/read flow 正常** | Hardware binding (`POST /api/v1/devices`) returns device token; device listing (`GET /api/v1/devices`) masks token; claim code transfers ownership | `Verified in test suite` / `Pending live verification` (Run Step 5) |
| **AC-5** | **Water record create/read/update/delete/sync 核心流程正常** | **Event Lifecycle Contract**:<br>• **Create/Sync**: Ingests drink events via `POST /api/v1/water/records` with Device Token or User JWT; handles `timeSynced: false` server timestamp fallback and idempotent `eventId` deduplication.<br>• **Read**: Retrieves paginated history via `GET /api/v1/water/records` and aggregated metrics via `GET /api/v1/water/stats/daily`.<br>• **Update Policy**: Water records are append-only immutable event logs. In-place modification is intentionally disallowed to preserve hardware sync auditability. Corrections follow a **Delete-and-Reingest** pattern.<br>• **Delete**: Permanent record deletion via `DELETE /api/v1/water/records/:id`, which registers a tombstone in `deleted_water_events` to suppress resurrecting events from offline BLE hardware sync queues. | `Verified in test suite` / `Pending live verification` (Run Step 6) |
| **AC-6** | **Production DB 寫入後跨 deployment / cold start 仍存在** | Records and users written to MongoDB Atlas persist across Vercel function cold starts and new deployments without data loss | `Pending live deployment verification` (Run Step 7) |
| **AC-7** | **MongoDB indexes / unique constraints 在 production 正常生效** | Unique constraints enforced on `username` (case-insensitive), `deviceToken`, `{userId, eventId}` (composite), and TTL index on `rate_limits.expiresAt` | `Verified in test suite` / `Pending live verification` (Run Step 8) |
| **AC-8** | **`/api/v1/health` 正常** | Responds with HTTP 200 immediately without waiting on DB connection, reports `status: "ok"` and `runtime: "vercel-serverless"` | `Verified in test suite` / `Pending live verification` (Run Step 1) |
| **AC-9** | **Rate limit 超限時回傳預期 429** | Shared MongoDB atomic counter throttles rapid login (>20/min) and register (>15/15min) requests across serverless instances with HTTP 429 and `retry-after` header | `Verified in test suite` / `Pending live verification` (Run Step 9) |
| **AC-10** | **Frontend 任意 route refresh 不會 404** | Direct URL navigation and page refresh on client-side routes (`/history`, `/devices`, `/stats`) returns `index.html` (HTTP 200) via SPA rewrite | `Pending live deployment verification` (Run Step 10) |
| **AC-11** | **HTTPS origin 下可執行 Web Bluetooth 基本流程（於支援瀏覽器）** | Production domain runs over HTTPS; Web Bluetooth API available in supported browsers (Chrome/Edge); BLE device scan picker triggers on user gesture | `Manual verification required` (Run Step 11) |
| **AC-12** | **無 production secret 被輸出到 client bundle / repository / logs** | No database passwords, JWT secrets, or device tokens leaked in `app/dist/` client bundles, git history, or serverless execution logs; sanitized error handlers active | `Verified (Code & Build Audit)` (Run Step 12) |
| **AC-13** | **README 或 deployment runbook 記錄部署步驟、必要 env keys、rollback 方法** | Detailed step-by-step guides in `README.md`, `docs/deployment/vercel-production.md`, and `docs/deployment/ROLLBACK.md` | `Verified (Documentation)` |
| **AC-14** | **Runbook 記錄 MongoDB Atlas backup/export 與改接 self-hosted MongoDB 的必要步驟** | Documented in `docs/deployment/ROLLBACK.md` Section 4 & 5 (mongodump, mongorestore, Docker hardening, least-privilege user, TLS, network isolation) | `Verified (Documentation)` |
| **AC-15** | **全 repo test/build 維持通過** | `npm test` passes all 101 backend tests across 9 suites and 107 frontend tests across 11 suites; `npm run backend:build` and `npm run app:build` succeed with 0 errors | `Verified via CI` |

---

## 2. Step-by-Step Live Verification Procedures

Follow these procedures once the application is deployed to a live Vercel Preview or Production environment with connected MongoDB Atlas.

### Step 1: Health & Runtime Check (AC-8)
```bash
curl -i https://<your-production-domain>/api/v1/health
```
**Expected Response:**
```json
HTTP/2 200
content-type: application/json; charset=utf-8

{
  "status": "ok",
  "service": "smart-water-tracker-backend",
  "uptime": 45.67,
  "timestamp": "2026-09-11T10:00:00.000Z",
  "runtime": "vercel-serverless"
}
```
- [ ] Status is `200 OK`.
- [ ] `runtime` is `"vercel-serverless"`.

---

### Step 2: SPA Entry & Web Login (AC-1)
1. Open `https://<your-production-domain>` in a web browser.
2. Confirm the frontend loads without a blank screen or console JavaScript errors.
3. Log in with a registered user account and verify that the dashboard view appears.
- [ ] SPA loads cleanly.
- [ ] Login completes and renders Dashboard.

---

### Step 3: User Registration & Case-Insensitive Login (AC-2)
```bash
# Register
curl -i -X POST https://<your-production-domain>/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"LiveUser1","password":"StrongPassword123!","displayName":"Live User"}'

# Login with lowercase username
curl -i -X POST https://<your-production-domain>/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"liveuser1","password":"StrongPassword123!"}'
```
- [ ] Register returns HTTP `201 Created` with JWT token.
- [ ] Case-insensitive login returns HTTP `200 OK` with JWT token.

---

### Step 4: JWT Authenticated Requests (AC-3)
```bash
# Valid Token
curl -i https://<your-production-domain>/api/v1/user/me \
  -H "Authorization: Bearer <JWT_TOKEN>"

# Missing / Invalid Token
curl -i https://<your-production-domain>/api/v1/user/me
```
- [ ] Valid token returns HTTP `200 OK` with user profile.
- [ ] Missing token returns HTTP `401 Unauthorized`.

---

### Step 5: Device Lifecycle & Claim Flow (AC-4)
```bash
# Bind device
curl -i -X POST https://<your-production-domain>/api/v1/devices \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"live_cup_001","name":"Office Cup"}'

# List devices (verify masked token)
curl -i https://<your-production-domain>/api/v1/devices \
  -H "Authorization: Bearer <JWT_TOKEN>"
```
- [ ] Device bind returns HTTP `201 Created` with `deviceToken`.
- [ ] Device list displays device with masked token (e.g. `dvt_***`).

---

### Step 6: Water Record CRUD & Sync Flow (AC-5)
```bash
# 1. Create drink record via Device Token (with deduplication support)
curl -i -X POST https://<your-production-domain>/api/v1/water/records \
  -H "Authorization: Bearer <DEVICE_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"eventId":"evt_live_100","type":"drink","amountMl":300,"timeSynced":true,"occurredAt":1773300000}'

# 2. Idempotent Deduplication (re-send same eventId)
curl -i -X POST https://<your-production-domain>/api/v1/water/records \
  -H "Authorization: Bearer <DEVICE_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"eventId":"evt_live_100","type":"drink","amountMl":300,"timeSynced":true,"occurredAt":1773300000}'

# 3. Read Records & Daily Stats via User JWT
curl -i https://<your-production-domain>/api/v1/water/records?limit=5 \
  -H "Authorization: Bearer <JWT_TOKEN>"
curl -i https://<your-production-domain>/api/v1/water/stats/daily \
  -H "Authorization: Bearer <JWT_TOKEN>"

# 4. Delete Record (Registers tombstone to prevent resurrection)
curl -i -X DELETE https://<your-production-domain>/api/v1/water/records/<RECORD_ID> \
  -H "Authorization: Bearer <JWT_TOKEN>"

# 5. Verify Tombstone Suppression (Re-submitting deleted eventId returns deleted: true)
curl -i -X POST https://<your-production-domain>/api/v1/water/records \
  -H "Authorization: Bearer <DEVICE_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"eventId":"evt_live_100","type":"drink","amountMl":300,"timeSynced":true,"occurredAt":1773300000}'
```
- [ ] Initial create returns HTTP `201 Created` with `duplicated: false`.
- [ ] Re-send returns HTTP `200 OK` with `duplicated: true`.
- [ ] Daily stats reflects 300 ml.
- [ ] Delete returns HTTP `200 OK`.
- [ ] Resubmitting deleted event is suppressed (`deleted: true`).

---

### Step 7: Database Cold-Start Persistence Check (AC-6)
1. In Vercel Dashboard, trigger a new deployment or wait 15 minutes for function containers to freeze.
2. Query `/api/v1/water/records` with the previously issued token.
3. Confirm that previously written records remain intact.
- [ ] Data persists across container cold starts.

---

### Step 8: Indexes & Uniqueness Check (AC-7)
Attempt duplicate registration with same username (different case):
```bash
curl -i -X POST https://<your-production-domain>/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"LIVEUSER1","password":"AnotherPassword123!"}'
```
- [ ] Returns HTTP `400 Bad Request` or `409 Conflict` (Duplicate username constraint violation).

---

### Step 9: Serverless Rate Limiting Throttling Check (AC-9)
```bash
for i in {1..25}; do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<your-production-domain>/api/v1/auth/login \
    -H "Content-Type: application/json" \
    -d '{"username":"throttletest","password":"WrongPassword123!"}'
done
```
- [ ] Requests 1–20 return HTTP `401`.
- [ ] Request 21+ returns HTTP `429 Too Many Requests`.

---

### Step 10: Client-Side SPA Routing & Refresh Check (AC-10)
```bash
curl -I https://<your-production-domain>/history
curl -I https://<your-production-domain>/devices
curl -I https://<your-production-domain>/stats
```
- [ ] Direct requests return `HTTP/2 200` with `content-type: text/html` (no 404).

---

### Step 11: Web Bluetooth Verification (AC-11)
1. Open Google Chrome or Microsoft Edge on a BLE-capable desktop or Android device.
2. Navigate to `https://<your-production-domain>/devices`.
3. Click **Bind Device via Bluetooth**.
- [ ] Native Bluetooth pairing modal appears requesting access to the Smart Water Cup service (`0000ffe0-0000-1000-8000-00805f9b34fb`).

---

### Step 12: Secret Hygiene Audit (AC-12)
Execute against the compiled frontend build:
```bash
grep -rn "MONGODB_URI" app/dist/ || echo "PASS: No MONGODB_URI found"
grep -rn "JWT_SECRET" app/dist/ || echo "PASS: No JWT_SECRET found"
grep -rn "mongodb+srv" app/dist/ || echo "PASS: No MongoDB connection string found"
```
- [ ] Zero secrets present in client assets.

---

## 3. Automated Production Smoke Test & Tenant Lifecycle

The automated smoke test script (`backend/src/scripts/productionSmokeTest.ts`) provides quick, programmatic verification across health, auth, device binding, record creation, dedup, and listing.

### Execution Policy:
1. **Dedicated Account Requirement**:
   Against non-local deployments (Staging, Preview, or Production), the script **requires** `SMOKE_USERNAME` and `SMOKE_PASSWORD` environment variables. This prevents accumulating abandoned `smoke_*` user accounts in the database.
   ```bash
   SMOKE_USERNAME="dedicated_smoke_tester" \
   SMOKE_PASSWORD="StrongSmokePassword123!" \
   TARGET_URL="https://smart-water-tracker.vercel.app" \
   npm run test:smoke
   ```

2. **Ephemeral Account Opt-In**:
   For teardown staging or disposable preview databases, ephemeral accounts can be enabled via explicit flag:
   ```bash
   ALLOW_EPHEMERAL_USER=true TARGET_URL="https://preview-deploy.vercel.app" npm run test:smoke
   ```

3. **Cleanup & Tombstone Retention**:
   The script tracks all created device tokens and water record IDs, executing best-effort cleanup in a `try/finally` block even if tests fail midway:
   - Device bindings are deleted via `DELETE /api/v1/devices/:id`.
   - Drink records are deleted via `DELETE /api/v1/water/records/:id`.
   - *Note*: Deleting drink records generates tombstones in `deleted_water_events` by design (to prevent resurrection during BLE offline sync). These tombstones are strictly scoped to the dedicated smoke tenant and do not impact normal user data or global reporting.
