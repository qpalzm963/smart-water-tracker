# SQLite to MongoDB Schema Mapping & ID Strategy

This document outlines the database persistence architecture migration from SQLite to MongoDB Atlas / self-hosted MongoDB for Smart Water Tracker.

---

## 1. ID Strategy (ObjectId vs. String UUID)

### Decision
All primary entity IDs retain their **String UUID** (or hardware/system string ID) mapped directly into the MongoDB document's `_id: string` field.

### Rationale
1. **API Contract Compatibility**: Existing mobile/web clients and ESP32 firmware exchange UUID strings for `userId`, `deviceId`, and `record.id`. Using string `_id` prevents breaking API contracts or introducing unnecessary conversions.
2. **Hardware Stability**: Physical device identifiers (e.g. `water_test_...` or MAC-derived IDs) remain consistent without requiring translation layers.
3. **Idempotent Data Migration**: Moving existing rows from SQLite to MongoDB retains the identical IDs so foreign key references, sync tokens, and historical records align 1:1.

---

## 2. Collection Schema & Field Mappings

### Collection: `users`
Represents user accounts.

| SQLite Column | SQLite Type | MongoDB Field | MongoDB Type | Notes |
|---|---|---|---|---|
| `id` | TEXT (PK) | `_id` | String | User UUID |
| `username` | TEXT (UNIQUE) | `username` | String | Case-insensitive collation unique index |
| `email` | TEXT (UNIQUE) | `email` | String | Case-insensitive unique index (sparse) |
| `password_hash`| TEXT | `passwordHash` | String | Bcrypt hash |
| `display_name` | TEXT | `displayName` | String \| null | User display name |
| `daily_goal_ml`| INTEGER | `dailyGoalMl` | Number | Default: 2000 |
| `created_at` | TEXT | `createdAt` | String | ISO 8601 UTC timestamp |
| `updated_at` | TEXT | `updatedAt` | String | ISO 8601 UTC timestamp |

### Collection: `devices`
Represents connected water cup devices and their security tokens.

| SQLite Column | SQLite Type | MongoDB Field | MongoDB Type | Notes |
|---|---|---|---|---|
| `id` | TEXT (PK) | `_id` | String | Device hardware identifier |
| `user_id` | TEXT (FK) | `userId` | String | References `users._id` |
| `device_token` | TEXT (UNIQUE) | `deviceToken` | String | Unique bearer token (`dvt_...`) |
| `claim_code` | TEXT | `claimCode` | String \| null | Rotation secret for hardware claiming |
| `name` | TEXT | `name` | String \| null | Friendly device name |
| `last_seen_at` | TEXT | `lastSeenAt` | String \| null | ISO 8601 timestamp |
| `created_at` | TEXT | `createdAt` | String | ISO 8601 timestamp |

### Collection: `drink_records`
Represents individual drinking and refilling log events.

| SQLite Column | SQLite Type | MongoDB Field | MongoDB Type | Notes |
|---|---|---|---|---|
| `id` | TEXT (PK) | `_id` | String | Record UUID |
| `event_id` | TEXT | `eventId` | String \| null | Cup event sequence identifier |
| `user_id` | TEXT (FK) | `userId` | String | References `users._id` |
| `device_id` | TEXT (FK) | `deviceId` | String \| null | References `devices._id` |
| `event_type` | TEXT | `eventType` | String | `'drink' \| 'refill'` |
| `amount_ml` | INTEGER | `amountMl` | Number | Milliliters consumed or added |
| `remaining_ml`| INTEGER | `remainingMl` | Number \| null | Remaining cup volume |
| `occurred_at` | TEXT | `occurredAt` | String | Normalized to ISO-8601 UTC (`YYYY-MM-DDTHH:mm:ss.sssZ`) |
| *(None / New)* | - | `timeSynced` | Boolean | **Mongo-only new field**. Derived during SQLite migration as `true` for legacy records; ESP32 sends boolean on upload. |
| `synced_at` | TEXT | `syncedAt` | String | Normalized to ISO-8601 UTC (`YYYY-MM-DDTHH:mm:ss.sssZ`) |

### Collection: `deleted_water_events`
Tombstone records preventing deleted events from being re-uploaded upon Bluetooth resynchronization.

| SQLite Column | SQLite Type | MongoDB Field | MongoDB Type | Notes |
|---|---|---|---|---|
| `user_id` | TEXT (PK 1/2) | `userId` | String | References `users._id` |
| `event_id` | TEXT (PK 2/2) | `eventId` | String | Event ID suppressed |
| - | - | `_id` | String | Composite `${userId}:${eventId}` |
| `deleted_at` | TEXT | `deletedAt` | String | ISO 8601 timestamp |

---

## 3. Indexes & Constraints

| Collection | Index Fields | Options | Purpose |
|---|---|---|---|
| `users` | `{ username: 1 }` | `unique: true`, collation strength 2 | Case-insensitive unique username |
| `users` | `{ email: 1 }` | `unique: true`, `sparse: true`, collation strength 2 | Case-insensitive unique email |
| `devices` | `{ deviceToken: 1 }` | `unique: true` | Fast token authentication & uniqueness |
| `devices` | `{ userId: 1 }` | - | Fast user device listing |
| `drink_records`| `{ userId: 1, eventId: 1 }` | `unique: true`, `partialFilterExpression: { eventId: { $type: "string" } }` | Multi-tenant idempotent event deduplication |
| `drink_records`| `{ userId: 1, occurredAt: 1 }` | - | Date range filtering & aggregation |
| `drink_records`| `{ userId: 1, timeSynced: 1, occurredAt: 1 }` | - | Daily/Weekly/Monthly stats queries |
| `deleted_water_events` | `{ userId: 1, eventId: 1 }` | `unique: true` | Tombstone existence check |
| `deleted_water_events` | `{ userId: 1 }` | - | Cleanup cascades on user deletion |

---

## 4. Timestamp Normalization (SQLite to MongoDB)

SQLite standard `datetime('now')` expressions generate strings formatted as:
`YYYY-MM-DD HH:MM:SS` (without trailing timezone indicator).

In MongoDB, to ensure lexicographical comparisons, consistent ISO string parsing in JavaScript (`new Date(str)`), and index sorting across range queries:
- All timestamp strings (`createdAt`, `updatedAt`, `lastSeenAt`, `occurredAt`, `syncedAt`, `deletedAt`) are normalized to **ISO-8601 UTC strings**:
  `YYYY-MM-DDTHH:mm:ss.sssZ` (e.g., `2026-09-10T09:30:00.000Z`).
- Migration scripts and API ingestion controllers format timestamps using `new Date(val).toISOString()` before inserting or querying.

---

## 5. Serverless Connection Lifecycle & Concurrent Cold-Start Protection

In serverless runtimes (e.g. Vercel Functions):
- **Promise-Based Connection Caching**: Rather than caching only the resolved `MongoClient`, the connection layer caches `Promise<MongoClient>`. If multiple concurrent requests arrive during a cold start, all callers share the identical in-flight connection promise, eliminating race conditions and avoiding duplicate connection pool allocation.
- **Fail-Safe Cleanup**: If the connection attempt rejects, the cached promise is discarded so subsequent invocations can retry.
- **Pool Tuning**: Connections configure `maxPoolSize: 10`, `minPoolSize: 1`, and `serverSelectionTimeoutMS: 5000` to handle transient network hiccups safely.
