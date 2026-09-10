# SQLite to MongoDB Migration Runbook

This guide describes the production-ready, idempotent data migration procedure from the legacy SQLite database (`water_tracker.db`) to MongoDB Atlas (or a self-hosted MongoDB instance).

---

## 1. Prerequisites
- Target MongoDB cluster running with network access allowed (e.g. Atlas IP Access list or Vercel integration).
- Connection string with read/write credentials available via `MONGODB_URI` environment variable.
- Target database should be a **dedicated, fresh database** (e.g. `water_tracker` or `water_tracker_prod`) to ensure safe rollbacks without collateral impact on unrelated data.
- Node.js 20+ with project dependencies installed (`npm install`).

---

## 2. Pre-Migration Backup & WAL Consistency

The SQLite database operates in Write-Ahead Logging (`WAL`) mode. Under WAL mode, copying `.db`, `.db-wal`, and `.db-shm` files separately while writes are occurring can produce an inconsistent, corrupted snapshot.

### Step 2.1: Stop Writes / Maintenance Mode
Temporarily stop backend service traffic or put the app in maintenance mode to prevent incoming writes during migration.

### Step 2.2: Create a Consistent Snapshot with `VACUUM INTO`
`VACUUM INTO` creates a clean, atomic, fully-checkpointed single-file snapshot even if uncheckpointed WAL frames exist:

```bash
# 1. Create a timestamped backup directory
mkdir -p ./backups

# 2. Generate an atomic SQLite snapshot via VACUUM INTO
# Option A: using sqlite3 CLI
sqlite3 ./backend/data/water_tracker.db "VACUUM INTO './backups/water_tracker_$(date +%Y%m%d_%H%M%S).db'"

# Option B: using Node.js built-in SQLite
node --experimental-sqlite -e "
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync('./backend/data/water_tracker.db');
  db.exec(\`VACUUM INTO './backups/water_tracker_\${Date.now()}.db'\`);
"

# 3. Verify backup file integrity
ls -lh ./backups/
```

*(Alternative if `VACUUM INTO` is unavailable: Run `PRAGMA wal_checkpoint(TRUNCATE);` before copying `./backend/data/water_tracker.db`)*.

---

## 3. Dry-Run & Preflight Conflict Detection

Always run in `--dry-run` mode first. The migration tool performs preflight unique conflict detection against target MongoDB without modifying target data:

- **Skipped**: Identical `_id` with matching data fields (safe re-run).
- **Conflicted**:
  - Same `_id` with differing payload.
  - Different `_id` colliding with unique index constraints (`username`, `email`, `deviceToken`, or `{ userId, eventId }`).
- **Imported**: Projected documents eligible for insertion.

```bash
npm run backend:migrate:mongo -- \
  --source ./backend/data/water_tracker.db \
  --target-uri "mongodb+srv://user:pass@cluster.mongodb.net" \
  --target-db water_tracker \
  --dry-run
```

Expected dry-run output format:
```
🚀 Starting migration tool (dryRun=true)...
Target: mongodb+srv://user:****@cluster.mongodb.net
=====================================================
📦 SQLite to MongoDB Migration Summary [DRY RUN]
📁 Source: /path/to/backend/data/water_tracker.db
🎯 Target DB: water_tracker
⏱️ Duration: 110ms
🚦 Status: ✅ SUCCESS
-----------------------------------------------------
Collection             | Source | Imported | Skipped | Conflicted | Failed
-----------------------+--------+----------+---------+------------+-------
users                  |      2 |        2 |       0 |          0 |      0
devices                |      2 |        2 |       0 |          0 |      0
drink_records          |      3 |        3 |       0 |          0 |      0
deleted_water_events   |      1 |        1 |       0 |          0 |      0
-----------------------------------------------------
=====================================================
```

> **Note**: If conflicts or errors are detected during dry-run, `Status` will be `❌ FAILED`, and individual conflict reasons will be displayed. Resolve conflicting accounts or data before proceeding to live migration.

---

## 4. Live Migration Execution

Once the dry-run summary verifies zero conflicts and expected record counts, execute live migration:

```bash
npm run backend:migrate:mongo -- \
  --source ./backend/data/water_tracker.db \
  --target-uri "$MONGODB_URI" \
  --target-db water_tracker
```

### Idempotency Guarantee
The migration script checks existing documents and indexes before writing:
- Source IDs (`_id`) and timestamps are preserved identically.
- Re-running the migration command is completely idempotent: already imported documents will be marked as **Skipped** with 0 duplicates created.
- `time_synced` column compatibility: If `drink_records` in SQLite lacks `time_synced` (production schema), the tool defaults `timeSynced = true` per MongoDB schema specifications.

---

## 5. Automated Post-Migration Verification

In live mode, the tool automatically executes built-in data integrity verification before completing:

```
-----------------------------------------------------
🔍 Automated Post-Migration Verification: ✅ PASSED
   - Users: SQLite=2, Mongo=2
   - Devices: SQLite=2, Mongo=2
   - Drink Records: SQLite=3, Mongo=3
   - Total Drink Amount: SQLite=1050ml, Mongo=1050ml
   - Deleted Events: SQLite=1, Mongo=1
-----------------------------------------------------
```

### Verification Criteria:
1. **Entity Counts**: Total MongoDB document count must be greater than or equal to source SQLite count for all collections.
2. **Volume Checksum**: The sum of `amount_ml` across all drink records must match between SQLite and MongoDB.
3. **Key-field Preservations**: Device tokens, usernames, and composite `{ userId, eventId }` unique boundaries are verified.
4. **Exit Code**: If any count or volume checksum check fails, `report.success` is set to `false` and the script exits with non-zero exit code (`1`).

---

## 6. Rollback Procedure

If unexpected discrepancies are discovered during post-migration verification or staging rollout:

### Step 6.1: Divert Traffic Back to SQLite
- In Vercel / hosting environment, revert `MONGODB_URI` environment variable or roll back deployment to the previous stable release.

### Step 6.2: Scoped MongoDB Rollback
Because migrations should target a **dedicated / isolated database**:
```javascript
// Connect to MongoDB using mongosh
mongosh "$MONGODB_URI"

// Switch to the target migration database
use water_tracker

// Option A: Drop the entire dedicated database (recommended for isolated target DB)
db.dropDatabase()

// Option B: Scoped collection drops (if database contains other collections)
db.drink_records.drop()
db.deleted_water_events.drop()
db.devices.drop()
db.users.drop()
```

### Step 6.3: Verify SQLite Integrity
Verify SQLite database consistency from the pre-migration snapshot:
```bash
sqlite3 ./backend/data/water_tracker.db "PRAGMA integrity_check;"
```

### Step 6.4: Post-Rollback Clean State
Once the cause of failure is diagnosed and addressed, re-run Section 3 (Dry-Run) and Section 4 (Live Migration).
