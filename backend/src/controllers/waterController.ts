import { Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { getDatabase } from '../database/db';
import {
  AuthenticatedRequest,
  Device,
  DrinkRecord,
  DrinkRecordResponse,
  User,
} from '../types';

/**
 * Format a Date or timestamp string into YYYY-MM-DD in Asia/Taipei timezone.
 */
export function getTaipeiDateString(dateInput: Date | string | number = new Date()): string {
  const d = typeof dateInput === 'object' ? dateInput : new Date(dateInput);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * Returns the ISO UTC string for 00:00:00.000 in Asia/Taipei (+08:00) for a given YYYY-MM-DD date.
 */
export function getTaipeiDayStartIso(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00.000+08:00`).toISOString();
}

/**
 * Returns the ISO UTC string for 23:59:59.999 in Asia/Taipei (+08:00) for a given YYYY-MM-DD date.
 */
export function getTaipeiDayEndIso(dateStr: string): string {
  return new Date(`${dateStr}T23:59:59.999+08:00`).toISOString();
}

function formatRecordResponse(r: DrinkRecord): DrinkRecordResponse {
  return {
    id: r.id,
    eventId: r.event_id,
    userId: r.user_id,
    deviceId: r.device_id,
    eventType: r.event_type,
    amountMl: r.amount_ml,
    remainingMl: r.remaining_ml,
    occurredAt: r.occurred_at,
    syncedAt: r.synced_at,
  };
}

const syncRecordSchema = z.object({
  eventId: z.string().optional(),
  deviceId: z.string().optional(),
  type: z.enum(['drink', 'refill']).optional().default('drink'),
  amountMl: z
    .number()
    .int('Amount must be an integer')
    .min(1, 'Amount must be at least 1 ml')
    .max(5000, 'Amount cannot exceed 5000 ml per event'),
  remainingMl: z.number().int().min(0).max(10000).optional().nullable(),
  todayTotalMl: z.number().int().optional(),
  occurredAt: z.union([z.number(), z.string()]).optional(),
  timeSynced: z.boolean().optional(),
});

const queryRecordsSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  type: z.enum(['drink', 'refill']).optional(),
  eventType: z.enum(['drink', 'refill']).optional(),
  deviceId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const dailyStatsQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
    .optional(),
});

export function recordWaterEvent(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  try {
    const userId = req.user?.id || req.device?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const payload = syncRecordSchema.parse(req.body);
    const db = getDatabase();

    // Determine device ID with strict tenant ownership validation
    let deviceId: string | null = null;
    if (req.device) {
      // Device token caller: deviceId is strictly bound to the authenticated device token
      deviceId = req.device.id;
    } else if (payload.deviceId) {
      // User JWT caller: verify that the specified deviceId belongs to the authenticated user
      const ownedDevice = db
        .prepare('SELECT id FROM devices WHERE id = ? AND user_id = ?')
        .get(payload.deviceId, userId) as unknown as Pick<Device, 'id'> | undefined;

      if (!ownedDevice) {
        res.status(403).json({ error: 'Device does not belong to current user' });
        return;
      }
      deviceId = ownedDevice.id;
    }

    // Determine event type
    const eventType = payload.type || 'drink';

    // Parse occurredAt
    let occurredAtIso: string;
    if (payload.timeSynced === false || payload.occurredAt === 0 || !payload.occurredAt) {
      occurredAtIso = new Date().toISOString();
    } else if (typeof payload.occurredAt === 'number') {
      const parsedDate = new Date(payload.occurredAt * 1000);
      if (isNaN(parsedDate.getTime())) {
        res.status(400).json({ error: 'Invalid occurredAt timestamp' });
        return;
      }
      occurredAtIso = parsedDate.toISOString();
    } else {
      const parsedDate = new Date(payload.occurredAt);
      if (isNaN(parsedDate.getTime())) {
        res.status(400).json({ error: 'Invalid occurredAt timestamp format' });
        return;
      }
      occurredAtIso = parsedDate.toISOString();
    }

    const syncedAtIso = new Date().toISOString();

    // A successful response stops device retry loops while keeping a record
    // the user permanently deleted from being recreated.
    if (payload.eventId) {
      const deletedEvent = db
        .prepare('SELECT 1 FROM deleted_water_events WHERE user_id = ? AND event_id = ?')
        .get(userId, payload.eventId);

      if (deletedEvent) {
        res.status(200).json({
          message: 'Record was permanently deleted and will not be recreated',
          duplicated: true,
          deleted: true,
        });
        return;
      }
    }

    // Idempotent deduplication check (strictly scoped by user_id to prevent cross-account leaks)
    if (payload.eventId) {
      const existing = db
        .prepare('SELECT * FROM drink_records WHERE user_id = ? AND event_id = ?')
        .get(userId, payload.eventId) as unknown as DrinkRecord | undefined;

      if (existing) {
        res.status(200).json({
          message: 'Record already exists (idempotent)',
          record: formatRecordResponse(existing),
          duplicated: true,
        });
        return;
      }
    }

    const recordId = uuidv4();
    const remainingMl = payload.remainingMl !== undefined ? payload.remainingMl : null;

    // Atomic insert with race condition / concurrency protection
    try {
      db.prepare(
        `INSERT INTO drink_records (id, event_id, user_id, device_id, event_type, amount_ml, remaining_ml, occurred_at, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        recordId,
        payload.eventId || null,
        userId,
        deviceId,
        eventType,
        payload.amountMl,
        remainingMl,
        occurredAtIso,
        syncedAtIso
      );
    } catch (insertErr: any) {
      // If concurrent request with same eventId inserted first, return existing record gracefully (200 OK)
      if (payload.eventId && insertErr?.message?.includes('UNIQUE constraint failed')) {
        const existing = db
          .prepare('SELECT * FROM drink_records WHERE user_id = ? AND event_id = ?')
          .get(userId, payload.eventId) as unknown as DrinkRecord | undefined;

        if (existing) {
          res.status(200).json({
            message: 'Record already exists (idempotent)',
            record: formatRecordResponse(existing),
            duplicated: true,
          });
          return;
        }
      }
      throw insertErr;
    }

    // Update device last_seen_at if deviceId is known and belongs to this user
    if (deviceId) {
      db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ? AND user_id = ?').run(
        syncedAtIso,
        deviceId,
        userId
      );
    }

    const recordResponse: DrinkRecordResponse = {
      id: recordId,
      eventId: payload.eventId || null,
      userId,
      deviceId,
      eventType,
      amountMl: payload.amountMl,
      remainingMl,
      occurredAt: occurredAtIso,
      syncedAt: syncedAtIso,
    };

    res.status(201).json({
      message: 'Record saved successfully',
      record: recordResponse,
      duplicated: false,
    });
  } catch (err) {
    next(err);
  }
}

export function listRecords(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const {
      from,
      to,
      startDate,
      endDate,
      type,
      eventType,
      deviceId,
      page,
      limit,
    } = queryRecordsSchema.parse(req.query);
    const db = getDatabase();

    const fromDate = from || startDate;
    const toDate = to || endDate;
    const recordType = type || eventType;

    const conditions: string[] = ['user_id = ?'];
    const params: (string | number)[] = [userId];

    if (fromDate) {
      conditions.push('occurred_at >= ?');
      params.push(fromDate.includes('T') ? fromDate : getTaipeiDayStartIso(fromDate));
    }

    if (toDate) {
      conditions.push('occurred_at <= ?');
      params.push(toDate.includes('T') ? toDate : getTaipeiDayEndIso(toDate));
    }

    if (recordType) {
      conditions.push('event_type = ?');
      params.push(recordType);
    }

    if (deviceId) {
      conditions.push('device_id = ?');
      params.push(deviceId);
    }

    const whereClause = conditions.join(' AND ');

    const countRow = db
      .prepare(`SELECT COUNT(*) as total FROM drink_records WHERE ${whereClause}`)
      .get(...params) as unknown as { total: number };
    const total = countRow.total;

    const offset = (page - 1) * limit;
    const records = db
      .prepare(
        `SELECT * FROM drink_records
         WHERE ${whereClause}
         ORDER BY occurred_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as unknown as DrinkRecord[];

    const formattedRecords: DrinkRecordResponse[] = records.map(formatRecordResponse);

    res.status(200).json({
      records: formattedRecords,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    next(err);
  }
}

export function deleteRecord(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const db = getDatabase();

  try {
    db.exec('BEGIN IMMEDIATE;');

    const record = db
      .prepare('SELECT id, event_id FROM drink_records WHERE id = ? AND user_id = ?')
      .get(req.params.id, userId) as unknown as Pick<DrinkRecord, 'id' | 'event_id'> | undefined;

    if (!record) {
      db.exec('ROLLBACK;');
      res.status(404).json({ error: 'Water record not found' });
      return;
    }

    if (record.event_id) {
      db.prepare(
        `INSERT OR IGNORE INTO deleted_water_events (user_id, event_id)
         VALUES (?, ?)`
      ).run(userId, record.event_id);
    }

    db.prepare('DELETE FROM drink_records WHERE id = ? AND user_id = ?').run(record.id, userId);
    db.exec('COMMIT;');

    res.status(200).json({ success: true, message: 'Water record permanently deleted' });
  } catch (err) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      // The transaction may have failed before it began.
    }
    next(err);
  }
}

export function getDailyStats(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { date } = dailyStatsQuerySchema.parse(req.query);
    const targetDate = date || getTaipeiDateString();
    const db = getDatabase();

    const user = db.prepare('SELECT daily_goal_ml FROM users WHERE id = ?').get(userId) as unknown as
      | Pick<User, 'daily_goal_ml'>
      | undefined;
    const goalMl = user?.daily_goal_ml || 2000;

    // Use indexed time bounds for the target date in Taipei timezone
    const dayStart = getTaipeiDayStartIso(targetDate);
    const dayEnd = getTaipeiDayEndIso(targetDate);

    const dayRecords = db
      .prepare(
        `SELECT event_type, amount_ml FROM drink_records
         WHERE user_id = ? AND occurred_at >= ? AND occurred_at <= ?
         ORDER BY occurred_at ASC`
      )
      .all(userId, dayStart, dayEnd) as unknown as Pick<DrinkRecord, 'event_type' | 'amount_ml'>[];

    let totalDrinkMl = 0;
    let drinkCount = 0;
    let refillCount = 0;

    for (const rec of dayRecords) {
      if (rec.event_type === 'drink') {
        totalDrinkMl += rec.amount_ml;
        drinkCount++;
      } else if (rec.event_type === 'refill') {
        refillCount++;
      }
    }

    const progress = Math.min(Math.round((totalDrinkMl / goalMl) * 100) / 100, 1.0);
    const goalMet = totalDrinkMl >= goalMl;

    res.status(200).json({
      date: targetDate,
      totalMl: totalDrinkMl,
      goalMl,
      progress,
      goalMet,
      drinkCount,
      refillCount,
    });
  } catch (err) {
    next(err);
  }
}

export function getWeeklyStats(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const db = getDatabase();
    const user = db.prepare('SELECT daily_goal_ml FROM users WHERE id = ?').get(userId) as unknown as
      | Pick<User, 'daily_goal_ml'>
      | undefined;
    const goalMl = user?.daily_goal_ml || 2000;

    // Build 7 days array ending today
    const days: {
      date: string;
      totalMl: number;
      goalMet: boolean;
      drinkCount: number;
      refillCount: number;
    }[] = [];
    const now = new Date();

    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = getTaipeiDateString(d);
      days.push({
        date: dateStr,
        totalMl: 0,
        goalMet: false,
        drinkCount: 0,
        refillCount: 0,
      });
    }

    const startIso = getTaipeiDayStartIso(days[0].date);
    const endIso = getTaipeiDayEndIso(days[6].date);

    // Fetch drink and refill records in this 7-day range using the database index.
    const records = db
      .prepare(
        `SELECT event_type, amount_ml, occurred_at FROM drink_records
         WHERE user_id = ? AND occurred_at >= ? AND occurred_at <= ?`
      )
      .all(userId, startIso, endIso) as unknown as Pick<DrinkRecord, 'event_type' | 'amount_ml' | 'occurred_at'>[];

    // Aggregate by Taipei date
    const dateMap = new Map<string, number>();
    const countMap = new Map<string, { drinkCount: number; refillCount: number }>();
    for (const rec of records) {
      const dateStr = getTaipeiDateString(rec.occurred_at);
      const counts = countMap.get(dateStr) || { drinkCount: 0, refillCount: 0 };
      if (rec.event_type === 'drink') {
        dateMap.set(dateStr, (dateMap.get(dateStr) || 0) + rec.amount_ml);
        counts.drinkCount++;
      } else if (rec.event_type === 'refill') {
        counts.refillCount++;
      }
      countMap.set(dateStr, counts);
    }

    let totalWeekMl = 0;
    let goalMetDays = 0;

    for (const day of days) {
      const totalMl = dateMap.get(day.date) || 0;
      day.totalMl = totalMl;
      day.goalMet = totalMl >= goalMl;
      const counts = countMap.get(day.date);
      day.drinkCount = counts?.drinkCount || 0;
      day.refillCount = counts?.refillCount || 0;

      totalWeekMl += totalMl;
      if (day.goalMet) goalMetDays++;
    }

    const averageMl = Math.round(totalWeekMl / 7);

    res.status(200).json({
      days,
      averageMl,
      goalMetDays,
      totalWeekMl,
      goalMl,
    });
  } catch (err) {
    next(err);
  }
}

export function getMonthlyStats(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const db = getDatabase();
    const user = db.prepare('SELECT daily_goal_ml FROM users WHERE id = ?').get(userId) as unknown as
      | Pick<User, 'daily_goal_ml'>
      | undefined;
    const goalMl = user?.daily_goal_ml || 2000;

    // Build 30 days array ending today
    const days: {
      date: string;
      totalMl: number;
      goalMet: boolean;
      drinkCount: number;
      refillCount: number;
    }[] = [];
    const now = new Date();

    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = getTaipeiDateString(d);
      days.push({
        date: dateStr,
        totalMl: 0,
        goalMet: false,
        drinkCount: 0,
        refillCount: 0,
      });
    }

    const startIso = getTaipeiDayStartIso(days[0].date);
    const endIso = getTaipeiDayEndIso(days[29].date);

    // Fetch drink and refill records in this 30-day range using the database index.
    const records = db
      .prepare(
        `SELECT event_type, amount_ml, occurred_at FROM drink_records
         WHERE user_id = ? AND occurred_at >= ? AND occurred_at <= ?`
      )
      .all(userId, startIso, endIso) as unknown as Pick<DrinkRecord, 'event_type' | 'amount_ml' | 'occurred_at'>[];

    const dateMap = new Map<string, number>();
    const countMap = new Map<string, { drinkCount: number; refillCount: number }>();
    for (const rec of records) {
      const dateStr = getTaipeiDateString(rec.occurred_at);
      const counts = countMap.get(dateStr) || { drinkCount: 0, refillCount: 0 };
      if (rec.event_type === 'drink') {
        dateMap.set(dateStr, (dateMap.get(dateStr) || 0) + rec.amount_ml);
        counts.drinkCount++;
      } else if (rec.event_type === 'refill') {
        counts.refillCount++;
      }
      countMap.set(dateStr, counts);
    }

    let totalMonthMl = 0;
    for (const day of days) {
      const totalMl = dateMap.get(day.date) || 0;
      day.totalMl = totalMl;
      day.goalMet = totalMl >= goalMl;
      const counts = countMap.get(day.date);
      day.drinkCount = counts?.drinkCount || 0;
      day.refillCount = counts?.refillCount || 0;
      totalMonthMl += totalMl;
    }

    // Calculate Best Streak in the 30-day window
    let bestStreak = 0;
    let tempStreak = 0;
    for (const day of days) {
      if (day.goalMet) {
        tempStreak++;
        if (tempStreak > bestStreak) bestStreak = tempStreak;
      } else {
        tempStreak = 0;
      }
    }

    // Calculate Current Streak ending today (or yesterday if today isn't completed yet)
    let currentStreak = 0;
    const todayIndex = days.length - 1;

    // If today is met, count backward from today
    if (days[todayIndex].goalMet) {
      for (let i = todayIndex; i >= 0; i--) {
        if (days[i].goalMet) currentStreak++;
        else break;
      }
    } else {
      // If today is not met yet, count backward from yesterday
      for (let i = todayIndex - 1; i >= 0; i--) {
        if (days[i].goalMet) currentStreak++;
        else break;
      }
    }

    const averageMl = Math.round(totalMonthMl / 30);

    res.status(200).json({
      days,
      averageMl,
      totalMonthMl,
      currentStreak,
      bestStreak,
      goalMl,
    });
  } catch (err) {
    next(err);
  }
}
