# Vercel Functions Backend Deployment Guide

This document describes how the Smart Water Tracker Express backend is adapted for and deployed to Vercel Serverless Functions, detailing deployment topologies, entry points, cold-start lifecycle, and connection reuse.

---

## 1. Architecture & Entry Points

The backend maintains a clean separation between the Express application composition root, traditional local server lifecycle, and serverless runtime entrypoints:

```
                          ┌────────────────────────┐
                          │   createApp() in       │
                          │   backend/src/app.ts   │
                          └───────────┬────────────┘
                                      │
                 ┌────────────────────┴────────────────────┐
                 ▼                                         ▼
   ┌───────────────────────────┐             ┌───────────────────────────┐
   │ Local Server Entry        │             │ Serverless Export         │
   │ backend/src/server.ts     │             │ backend/src/serverless.ts │
   │ - app.listen(port)        │             │ - exports Express app     │
   │ - graceful SIGTERM/SIGINT │             └─────────────┬─────────────┘
   │ - eager DB initialization │                           │
   └───────────────────────────┘                           │
                                   ┌───────────────────────┴───────────────────────┐
                                   ▼                                               ▼
                     ┌───────────────────────────┐                   ┌───────────────────────────┐
                     │ Monorepo Root Entry       │                   │ Subdirectory Entry        │
                     │ api/index.ts              │                   │ backend/api/index.ts      │
                     │ (Root Directory = `.`)    │                   │ (Root Directory =         │
                     │                           │                   │  `backend`)               │
                     └───────────────────────────┘                   └───────────────────────────┘
```

### Entry Point Files
- [`backend/src/serverless.ts`](../../backend/src/serverless.ts): Canonical serverless Express app instance without server listener loops.
- [`api/index.ts`](../../api/index.ts): Root entrypoint for unified monorepo Vercel deployments. Re-exports `backend/src/serverless`.
- [`backend/api/index.ts`](../../backend/api/index.ts): Subdirectory entrypoint for standalone backend Vercel projects (Root Directory = `backend`).
- [`backend/src/server.ts`](../../backend/src/server.ts): Traditional Node.js server entry for local development (`npm run dev`) and container execution.

---

## 2. Deployment Topologies

### Topology A: Unified Monorepo Project (Recommended)
Both frontend assets and backend serverless functions are deployed within a single Vercel project, establishing a strict **Same-Origin** contract.

- **Vercel Project Settings**:
  - **Root Directory**: `.` (monorepo root)
  - **Build Command**: `npm run app:build`
  - **Output Directory**: `app/dist`
  - **Install Command**: `npm install`
- **Routing Rules** (`vercel.json`):
  ```json
  {
    "rewrites": [
      { "source": "/api/(.*)", "destination": "/api/index" },
      { "source": "/((?!assets/|favicon.ico|.*\\..*).*)", "destination": "/index.html" }
    ]
  }
  ```
- **Advantages**:
  - Frontend makes relative requests (`/api/v1/...`).
  - Eliminates CORS preflight roundtrips on all browser-to-backend traffic.
  - Zero cross-origin cookie or header configuration issues.

### Topology B: Decoupled Multi-Project Setup
Frontend and backend are deployed as two independent Vercel projects.

- **Project 1: Frontend (`smart-water-tracker-app`)**:
  - Root Directory: `app`
  - Rewrites in `app/vercel.json`: `/api/v1/:path*` -> `https://smart-water-tracker-api.vercel.app/api/v1/:path*`
- **Project 2: Backend (`smart-water-tracker-api`)**:
  - Root Directory: `backend`
  - Function Entry: `backend/api/index.ts` automatically resolved by Vercel.

---

## 3. Serverless Lifecycle & Cold-Start Strategy

Serverless environments spin up ephemeral execution containers that freeze or terminate when idle. The backend implements three key design patterns for serverless reliability:

### 1. Instant Health Check Bypass
[`/api/v1/health`](../../backend/src/app.ts) is mounted before the database initialization middleware. It returns `200 OK` with `{ status: "ok", runtime: "vercel-serverless" }` immediately, allowing Vercel deployment health checks and uptime monitors to succeed even before MongoDB connects.

### 2. Lazy, Idempotent Database Readiness
API requests under `/api/v1/*` pass through the `ensureMongoReady()` middleware:
- If the repository container is already active (`hasActiveRepositoryContainer() === true`), the request passes through with 0ms overhead.
- On cold start, the first request triggers `initializePersistence()`.
- The initialization `Promise` is cached globally in module scope. Concurrent cold-start requests hitting the container simultaneously wait on the same single promise, preventing duplicate index building (`ensureIndexes`) or connection storm races.
- If initialization fails, the cached promise is cleared so subsequent requests can retry.

### 3. Connection Pool Reuse
- `getMongoClient()` pools and caches `MongoClient` instances across invocations in the same warm container.
- Configured with `minPoolSize: 0` (to avoid holding unused socket handles during idle freeze) and `maxPoolSize: 10`.
- Server selection timeout is set to `5000ms` to fail fast if MongoDB Atlas is unreachable.

---

## 4. Secret Hygiene & Logging

- **No Raw Connection Strings**: Full MongoDB connection strings containing usernames, passwords, or Atlas host credentials are never logged.
- **Sanitized Logging**: Only database names (`config.mongodbDbName`) and sanitized error messages (`[Database] MongoDB persistence initialized for: ...`) are printed.
- **Sanitized Error Responses**: In `errorHandler.ts`, any internal error containing connection URIs or device tokens (`dvt_*`) is sanitized before logging and masked in production.

---

## 5. Verification Checklist

- [x] Backend starts locally via `npm run dev` and `npm run start`.
- [x] `api/index.ts`, `backend/src/serverless.ts`, and `backend/api/index.ts` export valid Express applications.
- [x] `/api/v1/health` responds with `200 OK` and `runtime: "vercel-serverless"` without requiring active DB.
- [x] Unauthenticated and authenticated request paths succeed through the serverless entrypoint.
- [x] Concurrent cold-start requests initialize safely without duplicate key or connection errors.
- [x] All 6 backend test suites and 11 app test suites pass cleanly.
