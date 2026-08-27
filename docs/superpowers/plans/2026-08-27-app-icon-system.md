# App Icon System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every emoji from the React App and replace functional symbols with a consistent Lucide icon system plus a custom water-drop brand mark.

**Architecture:** Keep icon selection local to each page so intent remains readable, add one focused `WaterDropMark` brand component, and use shared CSS classes for title/icon alignment and semantic statuses. Preserve all existing handlers, Context access, API calls, BLE behavior, and navigation.

**Tech Stack:** React 18, TypeScript, Lucide React, CSS, inline SVG, Vitest, Vite.

---

## File Map

- Create `app/src/components/WaterDropMark.tsx`: reusable inline SVG brand mark.
- Modify `app/src/components/Toast.tsx`: semantic Lucide status icons.
- Modify `app/src/views/AuthView.tsx`: brand mark instead of cup emoji.
- Modify `app/src/views/DashboardView.tsx`: remove decorative water-drop emoji from copy.
- Modify `app/src/views/HistoryView.tsx`: history, refresh, drink, and refill icons.
- Modify `app/src/views/StatsView.tsx`: chart, refresh, calendar, streak, and goal-state icons.
- Modify `app/src/views/DevicesView.tsx`: device, refresh, copy, rotate, delete, and online-state icons.
- Modify `app/src/views/SettingsView.tsx`: settings, goal, queue, refresh, delete, and sync-state icons.
- Modify `app/src/views/BleDeviceView.tsx`: Bluetooth, device-control, Wi-Fi, status, and event icons.
- Modify `app/src/App.css`: shared icon alignment, semantic state, spinner, and brand-mark styles.
- Modify `app/index.html`: SVG path favicon without emoji text.

### Task 1: Shared Brand and Status Icons

**Files:**
- Create: `app/src/components/WaterDropMark.tsx`
- Modify: `app/src/components/Toast.tsx`
- Modify: `app/src/views/AuthView.tsx`
- Modify: `app/src/views/DashboardView.tsx`
- Modify: `app/index.html`

- [ ] **Step 1: Create the brand mark**

```tsx
import React from 'react';

interface WaterDropMarkProps {
  className?: string;
  title?: string;
}

export const WaterDropMark: React.FC<WaterDropMarkProps> = ({ className, title }) => (
  <svg className={className} viewBox="0 0 48 48" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true}>
    {title && <title>{title}</title>}
    <path d="M24 4C18 13 10 21 10 30a14 14 0 0 0 28 0C38 21 30 13 24 4Z" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
    <path d="M18 31c1.2 3.2 3.5 4.8 7 5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);
```

- [ ] **Step 2: Replace Toast emoji with semantic Lucide icons**

Import `CircleCheck`, `CircleX`, and `Info`. Select the component by `type`, render it at 20px with `aria-hidden="true"`, and preserve the current message and click-to-close behavior.

```tsx
const icons = { success: CircleCheck, error: CircleX, info: Info };
const Icon = icons[type];
return (
  <div className={`toast-notification toast-${type}`} onClick={onClose} role="status">
    <Icon className="toast-icon" size={20} aria-hidden="true" />
    <span className="toast-text">{message}</span>
  </div>
);
```

- [ ] **Step 3: Use the brand mark on Auth and remove Dashboard decoration**

Import `WaterDropMark` into `AuthView` and render `<WaterDropMark className="auth-brand-mark" title="智慧喝水追蹤器" />`. Change the Dashboard subtitle to `今天也要記得補充水分`.

- [ ] **Step 4: Replace the favicon**

Use an encoded inline SVG with a blue droplet path and no `<text>` node:

```html
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cpath d='M32 5C24 18 13 28 13 41a19 19 0 0 0 38 0C51 28 40 18 32 5Z' fill='none' stroke='%232f80ed' stroke-width='5'/%3E%3C/svg%3E" />
```

- [ ] **Step 5: Build and scan shared files**

Run: `npm run app:build && rg -n "[🥤💧✅❌ℹ️]" app/src/components app/src/views/AuthView.tsx app/src/views/DashboardView.tsx app/index.html`

Expected: build PASS and the scan returns no matches.

### Task 2: History and Statistics Views

**Files:**
- Modify: `app/src/views/HistoryView.tsx`
- Modify: `app/src/views/StatsView.tsx`

- [ ] **Step 1: Replace History icons**

Import `Droplets`, `GlassWater`, `History`, `LoaderCircle`, and `RefreshCw`. Use `title-with-icon` for the heading, `icon-spin` on loading, plain text inside `<option>`, and `badge-with-icon` for event types.

```tsx
<h2 className="title-with-icon"><History aria-hidden="true" />喝水歷程紀錄</h2>
<button className="btn btn-secondary" disabled={isLoading}>
  {isLoading ? <LoaderCircle className="icon-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
  {isLoading ? '載入中...' : '重新整理'}
</button>
<option value="drink">僅喝水 (Drink)</option>
<option value="refill">僅補水 (Refill)</option>
<span className={`badge badge-with-icon ${record.eventType === 'drink' ? 'badge-primary' : 'badge-success'}`}>
  {record.eventType === 'drink' ? <GlassWater aria-hidden="true" /> : <Droplets aria-hidden="true" />}
  {record.eventType === 'drink' ? '喝水' : '補水'}
</span>
```

- [ ] **Step 2: Replace Stats icons**

Import `CalendarDays`, `ChartNoAxesColumnIncreasing`, `CircleCheck`, `Flame`, and `RefreshCw`. Use icons beside visible labels; remove icon characters from tabs and status strings.

```tsx
<h2 className="title-with-icon"><ChartNoAxesColumnIncreasing aria-hidden="true" />飲水統計與連續達標分析</h2>
<button className="btn btn-secondary" onClick={() => refreshAll()} disabled={isLoading}>
  <RefreshCw className={isLoading ? 'icon-spin' : undefined} aria-hidden="true" />重新計算
</button>
<button className={`auth-tab ${tab === 'weekly' ? 'active' : ''}`}><CalendarDays aria-hidden="true" />過去 7 日週統計</button>
<span className="metric-label title-with-icon"><Flame aria-hidden="true" />當前連續達標 (Streak)</span>
<span className={`badge badge-with-icon ${isMet ? 'badge-success' : 'badge-muted'}`}>
  {isMet && <CircleCheck aria-hidden="true" />}{isMet ? '達標' : `${percent}%`}
</span>
```

- [ ] **Step 3: Build and scan both views**

Run: `npm run app:build && rg -n "[📜📊🔄📅🗓️🎯✅🔥🥤🚰]" app/src/views/HistoryView.tsx app/src/views/StatsView.tsx`

Expected: build PASS and the scan returns no matches.

### Task 3: Devices and Settings Views

**Files:**
- Modify: `app/src/views/DevicesView.tsx`
- Modify: `app/src/views/SettingsView.tsx`

- [ ] **Step 1: Replace Devices icons**

Import `CircleCheck`, `Clipboard`, `Cpu`, `RefreshCw`, `RotateCw`, `Trash2`, and `X`. Replace heading/button decorations, use `status-inline` with a semantic dot for online state, use `X` for the token banner close button, and keep all confirmation behavior unchanged.

```tsx
<h2 className="title-with-icon"><Cpu aria-hidden="true" />智慧水杯裝置管理</h2>
<button className="btn btn-secondary" onClick={() => refreshDevices()} disabled={isLoading}><RefreshCw className={isLoading ? 'icon-spin' : undefined} aria-hidden="true" />重新整理</button>
<span className={`status-inline ${d.isOnline ? 'status-inline--success' : 'status-inline--muted'}`}><span className="status-inline__dot" aria-hidden="true" />{d.isOnline ? '線上' : '離線'}</span>
<button className="btn btn-secondary btn-sm" onClick={() => handleRotateToken(d.id)}><RotateCw aria-hidden="true" />輪替 Token</button>
<button className="btn btn-danger btn-sm" onClick={() => handleUnbind(d.id)}><Trash2 aria-hidden="true" />解除綁定</button>
```

- [ ] **Step 2: Replace Settings icons**

Import `Archive`, `Cloud`, `LoaderCircle`, `RefreshCw`, `Settings`, `Target`, and `Trash2`. Render section headings with icons, spinner for active sync, semantic dot for idle, and icons inside manual-sync and clear buttons.

- [ ] **Step 3: Build and scan both views**

Run: `npm run app:build && rg -n "[📱🔄🟢⚪🗑️🎉📋⚙️💧📦]" app/src/views/DevicesView.tsx app/src/views/SettingsView.tsx`

Expected: build PASS and the scan returns no matches.

### Task 4: BLE Control View

**Files:**
- Modify: `app/src/views/BleDeviceView.tsx`

- [ ] **Step 1: Import the BLE icon set**

Import `AlertTriangle`, `Bluetooth`, `Clock3`, `Download`, `Droplets`, `FlaskConical`, `GlassWater`, `KeyRound`, `LoaderCircle`, `RefreshCw`, `Scale`, `Search`, `Unplug`, `Wifi`, and `WifiOff` from `lucide-react`.

- [ ] **Step 2: Replace headings, controls, and event badges**

Use `title-with-icon`, `btn` children, and `badge-with-icon` consistently. Loading states use `LoaderCircle.icon-spin`; drink/refill events use `GlassWater` and `Droplets`; unsupported-browser warning uses `AlertTriangle` with visible text.

```tsx
<h2 className="title-with-icon"><Bluetooth aria-hidden="true" />藍牙智慧水杯控制面板</h2>
<span className="title-with-icon"><FlaskConical aria-hidden="true" />模擬硬體模式 (Simulated Hardware)</span>
<div className="alert alert-warning title-with-icon"><AlertTriangle aria-hidden="true" /><span>您的瀏覽器不支援 Web Bluetooth API...</span></div>
<button className="btn btn-secondary" onClick={handleTare}><Scale aria-hidden="true" />去皮歸零 (Tare)</button>
<button className="btn btn-secondary" onClick={handleSyncHistory}><Download aria-hidden="true" />歷史事件重送 (History Sync)</button>
<span className={`badge badge-with-icon ${ev.type === 'drink' ? 'badge-primary' : 'badge-success'}`}>
  {ev.type === 'drink' ? <GlassWater aria-hidden="true" /> : <Droplets aria-hidden="true" />}
  {ev.type === 'drink' ? '喝水' : '補水'}
</span>
```

- [ ] **Step 3: Replace status emoji with semantic status markup**

Use `status-inline` plus a dot for stable/time/Wi-Fi states, with visible text values `穩定`, `晃動中`, `已校時`, `未校時`, `已連線`, `已配網未連線`, and `未設定`. Do not rely on color alone.

- [ ] **Step 4: Build and scan BLE view**

Run: `npm run app:build && rg -n "[📶⚠️🔍⏳🔌🟢🟡🔴⚪⚖️⏰🔄🔑📥🧪🥤🚰📡]" app/src/views/BleDeviceView.tsx`

Expected: build PASS and the scan returns no matches.

### Task 5: Shared Styling and Verification

**Files:**
- Modify: `app/src/App.css`
- Test: all existing `app/tests/*.test.ts`

- [ ] **Step 1: Add shared icon styles**

```css
.title-with-icon,
.badge-with-icon,
.status-inline {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.title-with-icon > svg { width: 1.1em; height: 1.1em; flex: 0 0 auto; }
.btn > svg { width: 1.1rem; height: 1.1rem; flex: 0 0 auto; }
.badge-with-icon > svg { width: 0.85rem; height: 0.85rem; }
.auth-brand-mark { width: 52px; height: 52px; color: var(--water-blue); }
.status-inline__dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.status-inline--success { color: #16836c; }
.status-inline--warning { color: #b7791f; }
.status-inline--danger { color: #dc2626; }
.status-inline--muted { color: var(--water-muted); }
.icon-spin { animation: spin 0.8s linear infinite; }
```

- [ ] **Step 2: Run the full emoji scan**

Run: `rg -n "[💧🥤🚰🎯⚖️📝📜📶🔄✅❌ℹ️👋📊📱⚙️🔍⏳🟢🟡🔴⚪🗑️🎉📋📦🧪🔌⏰🔑📥📡🔥📅🗓️⚠️]" app/src app/index.html`

Expected: no output.

- [ ] **Step 3: Run tests and production build**

Run: `npm run app:test && npm run app:build`

Expected: 18 tests PASS and Vite production build succeeds.

- [ ] **Step 4: Verify page rendering**

Open Login, Dashboard, History, Stats, BLE, Devices, and Settings at 375px and desktop-centered width. Confirm title alignment, button wrapping, status text, Toast icons, and no horizontal overflow or console errors.

- [ ] **Step 5: Review only in-scope files**

Run: `git status --short` and confirm no unrelated pre-existing root changes are staged. Because `app/` began as untracked user content, do not create an implementation commit unless the user explicitly requests one.
