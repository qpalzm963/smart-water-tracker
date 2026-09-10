# Smart Water Tracker Frontend (React + Vite)

This directory contains the Smart Water Tracker client web application built with React, TypeScript, and Vite.

## Vercel Deployment Guide

### Option 1: Standalone Frontend Project on Vercel
1. In the Vercel Dashboard, click **New Project** and import the `smart-water-tracker` repository.
2. In **Project Settings**:
   - **Root Directory**: Select `app`
   - **Framework Preset**: `Vite`
   - **Build Command**: `npm run build` (or leave default `vite build`)
   - **Output Directory**: `dist`
   - **Install Command**: `npm install`
3. **Environment Variables**:
   - `VITE_API_PROXY_TARGET`: (Optional, for local development proxy). In production, relative path `/api/v1` is routed to backend via Vercel rewrites (configured in root or proxy).
4. Deploy!

### SPA Routing & Asset Rewrites
`app/vercel.json` configures single-page application fallback rules so routes like `/history`, `/devices`, etc. load `index.html` seamlessly without 404 errors, while keeping static assets under `assets/` intact.

## Local Development
```bash
# In repo root
npm run app:dev

# Run tests
npm run app:test

# Build for production
npm run app:build
```
