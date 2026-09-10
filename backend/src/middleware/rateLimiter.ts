import { Request, Response, NextFunction } from 'express';
import rateLimit, {
  Store,
  Options,
  IncrementResponse,
  MemoryStore,
  ipKeyGenerator,
} from 'express-rate-limit';
import { getMongoDb } from '../database/mongo';
import { MONGO_COLLECTIONS, MongoRateLimitDoc } from '../database/mongoCollections';
import { sanitizeErrorMessage } from '../utils/sanitize';

/**
 * Accurately extract client IP behind proxies (Vercel, Cloudflare, load balancers).
 */
export function getClientIp(req: Request): string {
  // 1. Direct real IP header provided by edge proxies (e.g. Vercel x-real-ip)
  const xRealIp = req.headers['x-real-ip'];
  if (typeof xRealIp === 'string' && xRealIp.trim().length > 0) {
    return xRealIp.trim();
  }

  // 2. Standard X-Forwarded-For chain: client, proxy1, proxy2...
  const xForwardedFor = req.headers['x-forwarded-for'];
  if (typeof xForwardedFor === 'string' && xForwardedFor.trim().length > 0) {
    const firstIp = xForwardedFor.split(',')[0].trim();
    if (firstIp.length > 0) {
      return firstIp;
    }
  } else if (Array.isArray(xForwardedFor) && xForwardedFor.length > 0) {
    const firstIp = xForwardedFor[0].trim();
    if (firstIp.length > 0) {
      return firstIp;
    }
  }

  // 3. Fall back to Express req.ip (trust proxy enabled) or socket remoteAddress
  return req.ip || req.socket?.remoteAddress || '127.0.0.1';
}

/**
 * MongoDB-backed shared rate limit store with TTL auto-cleanup and fail-open resilience.
 *
 * Uses a single aggregation-pipeline findOneAndUpdate (MongoDB 4.2+) so the
 * window-open vs window-start decision is a single atomic operation:
 *   - If a document for this key exists and its resetTime is still in the future →
 *     increment totalHits.
 *   - Otherwise (new key OR expired window) → reset totalHits to 1 and start a new window.
 *
 * This eliminates the previous two-round-trip race where two concurrent "first" requests
 * could both miss the increment filter and then fight over the upsert, leading to one of
 * them being silently clobbered and the counter showing 1 instead of 2.
 */
export class MongoRateLimitStore implements Store {
  windowMs: number;
  private fallbackStore: MemoryStore;

  constructor(windowMs = 60 * 1000) {
    this.windowMs = windowMs;
    this.fallbackStore = new MemoryStore();
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
    this.fallbackStore.init(options);
  }

  async increment(key: string): Promise<IncrementResponse> {
    const now = new Date();
    const newResetTime = new Date(now.getTime() + this.windowMs);
    // expiresAt is 60 s past resetTime so the MongoDB TTL index can clean it up
    // after the window itself has fully closed.
    const newExpiresAt = new Date(newResetTime.getTime() + 60_000);

    try {
      const db = await getMongoDb();
      const collection = db.collection<MongoRateLimitDoc>(MONGO_COLLECTIONS.RATE_LIMITS);

      // Single atomic aggregation-pipeline update (MongoDB 4.2+).
      // $cond checks whether the stored resetTime is still in the future:
      //   YES (active window)  → increment totalHits, keep existing resetTime / expiresAt.
      //   NO  (new / expired)  → reset totalHits to 1, open a fresh window.
      const doc = await collection.findOneAndUpdate(
        { _id: key },
        [
          {
            $set: {
              isActive: { $gt: ['$resetTime', now] },
            },
          },
          {
            $set: {
              totalHits: {
                $cond: ['$isActive', { $add: ['$totalHits', 1] }, 1],
              },
              resetTime: {
                $cond: ['$isActive', '$resetTime', newResetTime],
              },
              expiresAt: {
                $cond: ['$isActive', '$expiresAt', newExpiresAt],
              },
            },
          },
          {
            $unset: 'isActive',
          },
        ],
        { upsert: true, returnDocument: 'after' },
      );

      return {
        totalHits: doc?.totalHits ?? 1,
        resetTime: doc?.resetTime ?? newResetTime,
      };
    } catch (err) {
      // Fail-open: log a sanitized warning — never log raw err.message which could
      // contain the MongoDB URI (including credentials) from driver-level errors.
      const safePrefix = key.split(':')[0] || 'rate_limit';
      console.warn(
        `[RateLimiter] Shared Mongo store unavailable for "${safePrefix}": ${sanitizeErrorMessage(err)}. Falling back to in-memory store.`,
      );
      return this.fallbackStore.increment(key);
    }
  }

  async decrement(key: string): Promise<void> {
    try {
      const db = await getMongoDb();
      const collection = db.collection<MongoRateLimitDoc>(MONGO_COLLECTIONS.RATE_LIMITS);
      await collection.updateOne(
        { _id: key, totalHits: { $gt: 0 } },
        { $inc: { totalHits: -1 } },
      );
    } catch {
      await this.fallbackStore.decrement(key);
    }
  }

  async resetKey(key: string): Promise<void> {
    try {
      const db = await getMongoDb();
      const collection = db.collection<MongoRateLimitDoc>(MONGO_COLLECTIONS.RATE_LIMITS);
      await collection.deleteOne({ _id: key });
    } catch {
      await this.fallbackStore.resetKey(key);
    }
  }

  async resetAll(): Promise<void> {
    try {
      const db = await getMongoDb();
      const collection = db.collection<MongoRateLimitDoc>(MONGO_COLLECTIONS.RATE_LIMITS);
      await collection.deleteMany({});
    } catch {
      await this.fallbackStore.resetAll();
    }
  }
}

export interface RateLimiterOptions {
  windowMs: number;
  max: number;
  message: string;
  prefix: string;
  store?: Store;
  /** When true, bypasses rate limiting in test environment (NODE_ENV === 'test') */
  skipInTest?: boolean;
}

/**
 * Factory for creating express-rate-limit middleware with a MongoDB shared store.
 * Uses ipKeyGenerator() per express-rate-limit recommendations to normalize IPv6
 * addresses to /56 subnet CIDR — preventing IPv6 rotation bypasses.
 */
export function createRateLimiter(opts: RateLimiterOptions) {
  const store = opts.store ?? new MongoRateLimitStore(opts.windowMs);

  return rateLimit({
    windowMs: opts.windowMs,
    max: opts.max,
    store,
    keyGenerator: (req: Request) => `${opts.prefix}:${ipKeyGenerator(getClientIp(req))}`,
    passOnStoreError: true, // Fail-open: allow request if store throws unhandled error
    ...(opts.skipInTest ? { skip: () => process.env.NODE_ENV === 'test' } : {}),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: opts.message },
    handler: (_req: Request, res: Response, _next: NextFunction, options) => {
      res.status(options.statusCode).json(options.message);
    },
  });
}

// Pre-configured rate limiters matching security requirements
// skipInTest: true preserves unbounded auth in test suites (matches old inline limiter behaviour)
export const loginLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 attempts per minute
  message: 'Too many login attempts. Please try again after 1 minute.',
  prefix: 'rl:login',
  skipInTest: true,
});

export const registerLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // 15 registrations per 15 minutes
  message: 'Too many registration attempts. Please try again later.',
  prefix: 'rl:register',
  skipInTest: true,
});
