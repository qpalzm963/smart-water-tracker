import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import authRoutes from './routes/auth';
import userRoutes from './routes/user';
import deviceRoutes from './routes/devices';
import waterRoutes from './routes/water';
import { errorHandler } from './middleware/errorHandler';
import { getRepositoryContainer, hasActiveRepositoryContainer, initializePersistence } from './repositories';
import { config, parseAllowedOrigins } from './config/env';

function getPublicDir(): string {
  const candidates = [
    path.join(__dirname, 'public'),
    path.join(__dirname, '../src/public'),
    path.join(process.cwd(), 'src/public'),
    path.join(process.cwd(), 'backend/src/public'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return path.join(__dirname, 'public');
}

let dbInitPromise: Promise<void> | null = null;

export function resetDbInitPromise(): void {
  dbInitPromise = null;
}

function ensureMongoReady(): Promise<void> {
  if (hasActiveRepositoryContainer()) {
    return Promise.resolve();
  }
  if (!dbInitPromise) {
    dbInitPromise = (async () => {
      await initializePersistence();
    })().catch((err) => {
      dbInitPromise = null;
      throw err;
    });
  }
  return dbInitPromise;
}

export function createCorsMiddleware(): express.RequestHandler {
  return cors((req, callback) => {
    const origin = req.headers.origin;

    // 1. Requests without Origin header (e.g. ESP32 firmware, curl, mobile apps, same-origin GET/HEAD)
    if (!origin) {
      return callback(null, { origin: true, credentials: true });
    }

    const host = (req.headers['x-forwarded-host'] as string) || req.headers.host;

    // Derive the server scheme: trust X-Forwarded-Proto (set by Vercel / load balancer), then
    // fall back to the connection's own TLS state. Never infer scheme from the Origin header.
    const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim()
      ?? (req.socket && (req.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http');

    // 2. Same-origin check: scheme AND host must both match (mirrors browser Same-Origin Policy).
    //    http://example.com vs https://example.com are DIFFERENT origins.
    if (host) {
      const expectedOrigin = `${proto}://${host}`;
      if (origin.toLowerCase() === expectedOrigin.toLowerCase()) {
        return callback(null, { origin: true, credentials: true });
      }
    }

    // 3. Explicitly configured ALLOWED_ORIGINS whitelist
    const allowed = process.env.ALLOWED_ORIGINS !== undefined
      ? parseAllowedOrigins(process.env.ALLOWED_ORIGINS)
      : config.allowedOrigins;

    if (allowed.length > 0) {
      if (allowed.includes('*')) {
        return callback(null, { origin: true });
      }
      if (allowed.includes(origin)) {
        return callback(null, { origin: true, credentials: true });
      }
      return callback(null, { origin: false });
    }

    // 4. Non-production environments (development / test) default allow localhost / 127.0.0.1
    const currentEnv = process.env.NODE_ENV || config.nodeEnv;
    if (currentEnv !== 'production') {
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return callback(null, { origin: true, credentials: true });
      }
    }

    // 5. Production without explicit ALLOWED_ORIGINS: disallow untrusted cross-origin requests
    return callback(null, { origin: false });
  });
}

export function createApp(): express.Express {
  const app = express();
  const publicDir = getPublicDir();

  // Trust proxy for serverless / load balancer headers
  app.set('trust proxy', 1);

  // Middleware
  app.use(createCorsMiddleware());
  app.use(express.json({ limit: '1mb' }));

  // Static Dashboard Assets (optional in production / serverless)
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
  }

  // Health Check Endpoint (responds immediately without waiting on DB)
  app.get('/api/v1/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'smart-water-tracker-backend',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      runtime: process.env.VERCEL ? 'vercel-serverless' : 'node-server',
    });
  });

  // Ensure DB connection and indexes are ready for API routes in serverless runtime
  app.use('/api/v1', async (_req, _res, next) => {
    try {
      await ensureMongoReady();
      next();
    } catch (err) {
      next(err);
    }
  });

  // API Routes
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/user', userRoutes);
  app.use('/api/v1/devices', deviceRoutes);
  app.use('/api/v1/water', waterRoutes);

  // Fallback for Single Page App Dashboard if local public dir exists
  app.get('/', (_req, res) => {
    const indexPath = path.join(publicDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(200).send('Smart Water Tracker Backend is running.');
    }
  });

  // Global Error Handler
  app.use(errorHandler);

  return app;
}

export default createApp;
