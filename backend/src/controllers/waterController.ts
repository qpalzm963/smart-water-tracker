import { Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { getRepositoryContainer } from '../repositories';
import {
  AuthenticatedRequest,
  DrinkRecord,
  DrinkRecordResponse,
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

export async function recordWaterEvent(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user?.id || req.device?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const payload = syncRecordSchema.parse(req.body);
    const { deviceRepository, waterRecordRepository, deletedWaterEventRepository } =
      await getRepositoryContainer();

    // Determine device ID with strict tenant ownership validation
    let deviceId: string | null = null;
    if (req.device) {
      // Device token caller: deviceId is strictly bound to the authenticated device token
      deviceId = req.device.id;
    } else if (payload.deviceId) {
      // User JWT caller: verify that the specified deviceId belongs to the authenticated user
      const ownedDevice = await deviceRepository.findById(payload.deviceId);
      if (!ownedDevice || ownedDevice.user_id !== userId) {
        res.status(403).json({ error: 'Device does not belong to current user' });
        return;
      }
      deviceId = ownedDevice.id;
    }

    // Determine event type
    const eventType = payload.type || 'drink';

    const hasOccurredAt =
      (typeof payload.occurredAt === 'number' && payload.occurredAt > 0) ||
      (typeof payload.occurredAt === 'string' && payload.occurredAt.trim() !== '' && payload.occurredAt !== '0');
    const timeSynced = payload.timeSynced !== false && hasOccurredAt;

    let occurredAtIso: string;
    if (!timeSynced) {
      occurredAtIso = new Date().toISOString();
    } else if (typeof payload.occurredAt === 'number') {
      const parsedDate = new Date(payload.occurredAt * 1000);
      if (isNaN(parsedDate.getTime())) {
        res.status(400).json({ error: 'Invalid occurredAt timestamp' });
        return;
      }
      occurredAtIso = parsedDate.toISOString();
    } else if (typeof payload.occurredAt === 'string') {
      const parsedDate = new Date(payload.occurredAt);
      if (isNaN(parsedDate.getTime())) {
        res.status(400).json({ error: 'Invalid occurredAt timestamp format' });
        return;
      }
      occurredAtIso = parsedDate.toISOString();
    } else {
      occurredAtIso = new Date().toISOString();
    }

    const syncedAtIso = new Date().toISOString();

    // Tombstone check: suppressed permanently deleted events
    if (payload.eventId) {
      const isDeleted = await deletedWaterEventRepository.isEventDeleted(userId, payload.eventId);
      if (isDeleted) {
        res.status(200).json({
          message: 'Record was permanently deleted and will not be recreated',
          duplicated: true,
          deleted: true,
        });
        return;
      }
    }

    // Idempotent deduplication check
    if (payload.eventId) {
      const existing = await waterRecordRepository.findByUserAndEventId(userId, payload.eventId);
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

    const { record, isDuplicate } = await waterRecordRepository.create({
      id: recordId,
      eventId: payload.eventId || null,
      userId,
      deviceId,
      eventType,
      amountMl: payload.amountMl,
      remainingMl,
      occurredAt: occurredAtIso,
      timeSynced,
      syncedAt: syncedAtIso,
    });

    if (isDuplicate) {
      res.status(200).json({
        message: 'Record already exists (idempotent)',
        record: formatRecordResponse(record),
        duplicated: true,
      });
      return;
    }

    // Update device last_seen_at if deviceId is known and belongs to this user
    if (deviceId) {
      await deviceRepository.updateLastSeen(deviceId, userId, syncedAtIso);
    }

    res.status(201).json({
      message: 'Record saved successfully',
      record: formatRecordResponse(record),
      duplicated: false,
    });
  } catch (err) {
    next(err);
  }
}

export async function listRecords(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
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

    const fromDate = from || startDate;
    const toDate = to || endDate;
    const recordType = type || eventType;

    const parsedFrom = fromDate
      ? fromDate.includes('T')
        ? fromDate
        : getTaipeiDayStartIso(fromDate)
      : undefined;
    const parsedTo = toDate
      ? toDate.includes('T')
        ? toDate
        : getTaipeiDayEndIso(toDate)
      : undefined;

    const { waterRecordRepository } = await getRepositoryContainer();
    const { records, total } = await waterRecordRepository.list({
      userId,
      fromDate: parsedFrom,
      toDate: parsedTo,
      eventType: recordType,
      deviceId,
      page,
      limit,
    });

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

export async function deleteRecord(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const { waterRecordRepository, deletedWaterEventRepository } =
      await getRepositoryContainer();

    const record = await waterRecordRepository.findById(req.params.id, userId);
    if (!record) {
      res.status(404).json({ error: 'Water record not found' });
      return;
    }

    if (record.event_id) {
      await deletedWaterEventRepository.recordDeletedEvent(userId, record.event_id);
    }

    await waterRecordRepository.deleteById(record.id, userId);

    res.status(200).json({ success: true, message: 'Water record permanently deleted' });
  } catch (err) {
    next(err);
  }
}

export async function getDailyStats(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { date } = dailyStatsQuerySchema.parse(req.query);
    const targetDate = date || getTaipeiDateString();
    const { userRepository, waterRecordRepository } = await getRepositoryContainer();

    const user = await userRepository.findById(userId);
    const goalMl = user?.daily_goal_ml || 2000;

    const dayStart = getTaipeiDayStartIso(targetDate);
    const dayEnd = getTaipeiDayEndIso(targetDate);

    const dayRecords = await waterRecordRepository.getDailyRecords(userId, dayStart, dayEnd);

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

export async function getWeeklyStats(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { userRepository, waterRecordRepository } = await getRepositoryContainer();
    const user = await userRepository.findById(userId);
    const goalMl = user?.daily_goal_ml || 2000;

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

    const records = await waterRecordRepository.getRecordsInRange(userId, startIso, endIso);

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

export async function getMonthlyStats(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { userRepository, waterRecordRepository } = await getRepositoryContainer();
    const user = await userRepository.findById(userId);
    const goalMl = user?.daily_goal_ml || 2000;

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

    const records = await waterRecordRepository.getRecordsInRange(userId, startIso, endIso);

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

    let currentStreak = 0;
    const todayIndex = days.length - 1;

    if (days[todayIndex].goalMet) {
      for (let i = todayIndex; i >= 0; i--) {
        if (days[i].goalMet) currentStreak++;
        else break;
      }
    } else {
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
