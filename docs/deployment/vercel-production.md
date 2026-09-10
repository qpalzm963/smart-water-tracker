# Vercel Production Deployment & API Rewrite Guide

This document describes how the Smart Water Tracker full-stack application is deployed to Vercel, including same-origin API routing, environment variable configuration, and database environment isolation.

---

## 1. Architecture Overview

```
Browser Client
   │
   │  HTTPS same-origin requests (e.g. https://water.example.com)
   ▼
Vercel Edge Network
   ├── /api/* ────────────────────────► Serverless Function (api/index.ts -> Express)
   │                                           │
   │                                           ▼
   │                                   MongoDB Atlas / Self-Hosted
   │
   └── /* (All other routes & assets) ─► Static Vite SPA (app/dist)
```

### Key Advantages
1. **Same-Origin Simplicity**: Frontend uses relative paths (`/api/v1/...`). No CORS preflight overhead on same-origin traffic and no hardcoded backend domains in client bundles.
2. **Preview Branch Isolation**: Every pull request generates an isolated Preview deployment.
3. **Database Security**: Database credentials exist solely in Vercel environment variables and are never committed to version control.

---

## 2. Monorepo Project Settings in Vercel

1. In Vercel Dashboard, import repository `qpalzm963/smart-water-tracker`.
2. Configure **Project Settings**:
   - **Root Directory**: `.` (leave as root)
   - **Framework Preset**: `Vite` (or `Other`)
   - **Build Command**: `npm run app:build`
   - **Output Directory**: `app/dist`
   - **Install Command**: `npm install`
3. Root `vercel.json` automatically maps:
   - `/api/(.*)` to Serverless Function `api/index.ts`.
   - All SPA routes to `index.html` with static asset bypass.

---

## 3. Environment Variables Configuration

Configure the following environment variables in **Project Settings > Environment Variables**:

| Variable | Scopes | Example Value | Description |
|---|---|---|---|
| `NODE_ENV` | Production, Preview | `production` | Enables production security guards |
| `JWT_SECRET` | Production | `[64-byte random hex]` | Strong random key (min 16 chars, no default) |
| `JWT_SECRET` | Preview | `[different random hex]` | Isolated secret for preview environments |
| `MONGODB_URI` | Production, Preview | `mongodb+srv://user:pass@cluster.mongodb.net` | Standard MongoDB connection string |
| `MONGODB_DB_NAME`| Production | `water_tracker` | Dedicated production database |
| `MONGODB_DB_NAME`| Preview | `water_tracker_preview` | Isolated database to prevent test pollution |
| `ALLOWED_ORIGINS`| Production (Optional) | `https://custom-domain.com` | Specific CORS origins if cross-origin access needed |

> [!WARNING]
> In production (`NODE_ENV=production`), the server enforces that `JWT_SECRET` must not contain default development strings and must be at least 16 characters long. If invalid, the process will fail closed immediately.

---

## 4. MongoDB Atlas Network Configuration
1. In MongoDB Atlas, navigate to **Network Access**.
2. Add IP Address `0.0.0.0/0` (Allow access from anywhere) or install the official **MongoDB Atlas integration for Vercel**.
3. Create a dedicated Database User with `readWrite` role scoped to `water_tracker` and `water_tracker_preview`.
4. The connection string uses standard MongoDB URI syntax and is 100% compatible with future self-hosted MongoDB clusters.

---

## 5. Verification Checklist
- [ ] `/api/v1/health` on production URL returns `200 OK` with `runtime: "vercel-serverless"`.
- [ ] Browser Network inspection confirms `/api/v1/*` requests are same-origin (no CORS errors).
- [ ] Refreshing frontend routes (e.g. `/history`, `/devices`) renders correctly without 404.
- [ ] Registering a user writes to `water_tracker` in production, and `water_tracker_preview` in preview PRs.
- [ ] No secrets appear in `dist/assets/*.js` client bundles.
