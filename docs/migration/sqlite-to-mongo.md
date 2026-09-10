# SQLite to MongoDB Migration Runbook

This guide describes the idempotent data migration procedure from the legacy SQLite database (`water_tracker.db`) to MongoDB Atlas (or a self-hosted MongoDB instance).

---

## 1. Prerequisites
- Target MongoDB cluster running with network access allowed (e.g. Atlas IP Access list or Vercel integration).
- Connection string with read/write credentials available via `MONGODB_URI` environment variable.
- Node.js 20+ with project dependencies installed.

---

## 2. Pre-Migration Backup

Before executing migration, create an immutable snapshot of the SQLite database:

```bash
# 1. Create a timestamped backup directory
mkdir -p ./backups

# 2. Copy the SQLite database and any active WAL/journal files
cp ./backend/data/water_tracker.db "./backups/water_tracker_$(date +%Y%m%d_%H%M%S).db"
cp ./backend/data/water_tracker.db-wal "./backups/" 2>/dev/null || true
cp ./backend/data/water_tracker.db-shm "./backups/" 2>/dev/null || true

# 3. Verify backup file integrity
ls -lh ./backups/
```

---

## 3. Dry-Run Verification

Always run in `--dry-run` mode first to inspect the record counts and identify potential conflicts without modifying MongoDB:

```bash
npm run backend:migrate:mongo -- \
  --source ./backend/data/water_tracker.db \
  --target-uri "mongodb+srv://user:pass@cluster.mongodb.net" \
  --target-db water_tracker \
  --dry-run
```

Expected output format:
```
=====================================================
📦 SQLite to MongoDB Migration Summary [DRY RUN]
📁 Source: /path/to/backend/data/water_tracker.db
🎯 Target DB: water_tracker
⏱️ Duration: 125ms
-----------------------------------------------------
Collection             | Source | Inserted | Skipped | Failed
-----------------------+--------+----------+---------+-------
users                  |      5 |        5 |       0 |      0
devices                |      3 |        3 |       0 |      0
drink_records          |    120 |      120 |       0 |      0
deleted_water_events   |      2 |        2 |       0 |      0
=====================================================
```

---

## 4. Live Migration Execution

Once the dry-run numbers match expectations, execute the live migration:

```bash
npm run backend:migrate:mongo -- \
  --source ./backend/data/water_tracker.db \
  --target-uri "$MONGODB_URI" \
  --target-db water_tracker
```

### Idempotency Guarantee
The migration uses upsert operations (`updateOne` with `$setOnInsert`) keyed on `_id`. Running the migration tool repeatedly against the same database is safe:
- Unchanged existing records are marked as **Skipped** and are not duplicated or overwritten.
- Multi-tenant unique constraints (`userId + eventId`) are strictly preserved.

---

## 5. Post-Migration Verification

Run count and sample integrity checks:

```bash
# Run backend test suite
npm run backend:test

# Check health endpoint
curl -s http://localhost:3000/api/v1/health
```

### Verification Checklist:
- [ ] Users count in SQLite equals `users` document count in MongoDB.
- [ ] Device tokens retain their original `dvt_...` strings.
- [ ] Drink records match in total count and volume sum (`amount_ml`).
- [ ] Deleted water events tombstones exist in MongoDB.
- [ ] Repeating the migration command yields `Inserted: 0` and all records `Skipped`.

---

## 6. Rollback Procedure

If issues are detected during verification or rollout:

1. **Stop Application Traffic**:
   - In Vercel, revert deployment to the previous commit or promote the previous preview deployment.
2. **Restore SQLite Persistence** (if needed):
   - Restore SQLite from `./backups/water_tracker_<timestamp>.db`.
3. **Purge Partial MongoDB Collections** (if fresh re-run is desired):
   ```bash
   # Connect via mongosh
   mongosh "$MONGODB_URI"
   use water_tracker
   db.users.drop()
   db.devices.drop()
   db.drink_records.drop()
   db.deleted_water_events.drop()
   ```
4. **Re-run Migration** after fixing root cause.
