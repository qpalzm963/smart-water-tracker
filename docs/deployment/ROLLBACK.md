# Production Rollback & Disaster Recovery Runbook

This document defines the emergency procedures and step-by-step runbooks for rolling back frontend assets, serverless backend functions, environment variable configurations, and MongoDB database states in the Smart Water Tracker production environment.

---

## 1. Rollback Trigger Criteria

Initiate a rollback immediately if any of the following occur during or after a deployment:
- **Service Outage**: `/api/v1/health` returns `5xx` or fails to respond within 5 seconds.
- **Critical Auth Failure**: Users cannot log in or register due to unexpected JWT or bcrypt errors.
- **Hardware Sync Breakdown**: ESP32 devices fail to sync water records (`/api/v1/water/records` returning `500`).
- **Data Integrity / Corruption Risk**: Database writes are failing, dropping events, or violating tenant isolation.
- **Secret Leak**: Production secrets are detected in client bundles or public build logs.

---

## 2. Frontend & Serverless Backend Rollback (Vercel Instant Rollback)

Because the frontend SPA and backend serverless function (`/api/index.ts`) are deployed as a unified atomic deployment on Vercel, rolling back reverts both simultaneously.

### Method A: Vercel Dashboard (Fastest, < 30 seconds)
1. Open the [Vercel Dashboard](https://vercel.com/) and navigate to the `smart-water-tracker` project.
2. Go to the **Deployments** tab.
3. Locate the last known good deployment (marked with a green checkmark before the regression).
4. Click the three dots (`...`) menu on that deployment and select **Instant Rollback**.
5. In the confirmation dialog, confirm the target domain assignments. Traffic will immediately switch to the selected deployment without rebuilding.

### Method B: Vercel CLI
If the dashboard is inaccessible, execute via terminal:

```bash
# 1. List recent deployments to identify the previous stable deployment URL
npx vercel list --prod

# 2. Promote the stable deployment immediately to production
npx vercel rollback <deployment-id-or-url>
```

---

## 3. Environment Variable Rollback & Emergency Rotation

If an issue is caused by incorrect or compromised environment variables:

### Rollback Configuration
1. In Vercel Project Settings, navigate to **Environment Variables**.
2. Update the offending variable:
   - `MONGODB_URI`: Restore previous known working cluster URI.
   - `MONGODB_DB_NAME`: Restore previous database name (`water_tracker`).
   - `ALLOWED_ORIGINS`: Reset to empty (same-origin default) if CORS issues arise.
3. **Important**: Changing environment variables in Vercel requires triggering a redeploy or instant rollback to take effect:
   ```bash
   npx vercel redeploy
   ```

### Emergency Secret Rotation (JWT_SECRET)
If `JWT_SECRET` is suspected to be compromised:
1. Generate a new 64-character hex secret:
   ```bash
   openssl rand -hex 32
   ```
2. In Vercel Settings > Environment Variables, replace `JWT_SECRET` for **Production**.
3. Redeploy the project.
4. *Impact*: All existing user sessions will be invalidated; users will be required to log in again. ESP32 devices using long-lived device tokens (`dvt_...`) stored in MongoDB will **not** be disrupted, as device tokens are stored in the database, not signed by JWT.

---

## 4. MongoDB Database Rollback & Recovery

### Scenario A: Rollback Index Changes
If an index creation fails or causes query degradation:
1. Connect to the cluster via `mongosh`:
   ```bash
   mongosh "<MONGODB_URI>"
   use water_tracker;
   ```
2. View existing indexes:
   ```javascript
   db.drink_records.getIndexes();
   ```
3. Drop the problematic index:
   ```javascript
   db.drink_records.dropIndex("problematic_index_name");
   ```

### Scenario B: Point-in-Time Recovery (PITR) via MongoDB Atlas
If data was accidentally corrupted or deleted:
1. In MongoDB Atlas, go to **Database Deployments** -> Select Cluster.
2. Click **Backup** in the top navigation.
3. Select **Point-in-Time Restore** (or choose a scheduled snapshot prior to the incident).
4. Select **Restore to a New Cluster** (Recommended: do not overwrite in-place to avoid data loss of records created during the incident).
5. Once the restored cluster is ready, update `MONGODB_URI` in Vercel to point to the restored cluster.

### Scenario C: Snapshot Backup and Restore via `mongodump` / `mongorestore`

#### Creating an Immediate Backup Snapshot:
```bash
mongodump --uri="<MONGODB_URI>" --db=water_tracker --out=./backups/backup_$(date +%Y%m%d_%H%M%S)
```

#### Restoring from a Previous Backup Snapshot:
```bash
mongorestore --uri="<MONGODB_URI>" --db=water_tracker --drop ./backups/backup_20260910_stable/water_tracker
```
> [!CAUTION]
> The `--drop` flag will drop existing collections before restoring. Only use this when performing a full restoration to a known snapshot.

---

## 5. Self-Hosted MongoDB Transition Runbook

The application uses standard MongoDB driver specifications with zero proprietary Atlas bindings. If migrating away from Atlas to a self-hosted MongoDB instance (e.g. Docker on VPS, AWS EC2, or dedicated hardware):

### Step 1: Dump Atlas Data
```bash
mongodump --uri="mongodb+srv://<user>:<password>@<atlas-cluster>.mongodb.net/water_tracker" --out=./atlas_dump
```

### Step 2: Spin Up Self-Hosted MongoDB with Security Hardening

> [!CAUTION]
> **Never expose MongoDB port 27017 directly to the public internet** with root credentials and unencrypted plaintext traffic. Always enforce:
> 1. Dedicated, least-privilege application user scoped only to the `water_tracker` database.
> 2. Network-level firewall restrictions (allow only trusted Vercel egress IPs, a secure VPN/VPC tunnel, or reverse proxy with mTLS).
> 3. TLS encryption in transit.

Example hardened `docker-compose.yml`:
```yaml
version: '3.8'
services:
  mongodb:
    image: mongo:7.0
    restart: always
    environment:
      # Root admin used strictly for initial database administration
      MONGO_INITDB_ROOT_USERNAME: db_admin
      MONGO_INITDB_ROOT_PASSWORD: <strong_random_admin_password>
      MONGO_INITDB_DATABASE: water_tracker
    volumes:
      - mongo_data:/data/db
      - ./init-mongo.js:/docker-entrypoint-initdb.d/init-mongo.js:ro
      - ./certs:/etc/ssl/certs:ro
    # Bind to localhost or private network interface only; use cloud firewall or tunnel for ingress
    ports:
      - '127.0.0.1:27017:27017'
    command: [
      "--tlsMode", "requireTLS",
      "--tlsCertificateKeyFile", "/etc/ssl/certs/mongodb.pem",
      "--tlsCAFile", "/etc/ssl/certs/ca.pem"
    ]

volumes:
  mongo_data:
```

Example initialization script (`init-mongo.js`) to create a least-privilege application user:
```javascript
// Creates dedicated application user with readWrite privileges strictly on water_tracker
db = db.getSiblingDB('water_tracker');
db.createUser({
  user: 'water_app_user',
  pwd: '<strong_random_app_password>',
  roles: [
    { role: 'readWrite', db: 'water_tracker' }
  ]
});
```

### Step 3: Restore Data to Self-Hosted Instance
Restore data using the application-level user or admin user through a local/secure connection:
```bash
mongorestore --uri="mongodb://db_admin:<admin_password>@127.0.0.1:27017/water_tracker?authSource=admin&tls=true&tlsCAFile=./certs/ca.pem" --db=water_tracker ./atlas_dump/water_tracker
```

### Step 4: Update Vercel Environment Variables
Configure the application-scoped credential in Vercel project settings (accessible via secure domain or tunnel with TLS):
```
MONGODB_URI=mongodb://water_app_user:<app_password>@<your-secure-host>:27017/water_tracker?authSource=water_tracker&tls=true
```
Redeploy Vercel to apply changes and verify with `npm run test:smoke`.

---

## 6. Post-Rollback Verification Checklist

After executing any rollback, systematically confirm system health:
- [ ] **Health Endpoint**: `curl -s https://<your-domain>/api/v1/health` returns `HTTP 200` with `status: "ok"`.
- [ ] **Auth Verification**: Log in with an existing user; verify token is issued and `/api/v1/user/me` responds with user profile.
- [ ] **Device Status**: Verify `/api/v1/devices` returns registered devices.
- [ ] **Ingestion Smoke**: Send a drink event to `/api/v1/water/records`; verify HTTP 201 and verify record appears in `/api/v1/water/stats/daily`.
- [ ] **Rate Limiter Health**: Verify auth endpoints respond without 500 errors and return standard rate limit headers.
- [ ] **Client UI**: Refresh `/dashboard`, `/history`, and `/devices` in the browser; ensure no blank screens or 404s.
