# Mobile Dashboard UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current desktop-style Dashboard with a centered, production-ready mobile hydration home screen that preserves existing API, BLE, offline-sync, and navigation behavior.

**Architecture:** Keep Context access and orchestration in `DashboardView`, move visual sections into focused prop-driven components, and place deterministic formatting/calculation logic in a small tested view-model module. Rework `Navbar` into a mobile bottom tab bar while retaining its existing `ActiveTab` interface so the rest of `App` does not need a routing rewrite.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, Lucide React, CSS, inline SVG.

---

## File Map

- Create `app/src/views/dashboard/dashboardViewModel.ts`: progress calculation, time greeting, BLE display state, record sorting, and quick-log payload construction.
- Create `app/src/views/dashboard/WaterGlassIllustration.tsx`: decorative scalable water-glass SVG driven by progress.
- Create `app/src/views/dashboard/HydrationHero.tsx`: daily total, progress ring, glass, and BLE summary row.
- Create `app/src/views/dashboard/QuickDrinkGrid.tsx`: four quick-log controls and their local busy/success feedback.
- Create `app/src/views/dashboard/TodayRecordsCard.tsx`: latest-record list and empty state.
- Create `app/src/views/dashboard/HydrationReminder.tsx`: low-priority reminder strip.
- Modify `app/src/views/DashboardView.tsx`: compose the new sections and keep Context/API actions at the page boundary.
- Modify `app/src/components/Navbar.tsx`: mobile bottom navigation with Home, Stats, Add, Devices, and Profile.
- Modify `app/src/App.css`: centered phone shell, dashboard visual system, responsive safeguards, focus states, and reduced-motion behavior.
- Create `app/tests/dashboardViewModel.test.ts`: deterministic tests for calculations, ordering, BLE labels, and payloads.

### Task 1: Dashboard View Model

**Files:**
- Create: `app/src/views/dashboard/dashboardViewModel.ts`
- Test: `app/tests/dashboardViewModel.test.ts`

- [ ] **Step 1: Write failing view-model tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  buildDrinkPayload,
  getBleDisplay,
  getGreeting,
  getProgress,
  getRecentRecords,
} from '../src/views/dashboard/dashboardViewModel';
import { DrinkRecord } from '../src/types';

describe('dashboardViewModel', () => {
  it('calculates display progress and caps the ring at 100%', () => {
    expect(getProgress(1200, 2000)).toEqual({ percent: 60, ringPercent: 60 });
    expect(getProgress(2400, 2000)).toEqual({ percent: 120, ringPercent: 100 });
    expect(getProgress(100, 0)).toEqual({ percent: 0, ringPercent: 0 });
  });

  it('returns a time-aware Traditional Chinese greeting', () => {
    expect(getGreeting(new Date('2026-08-27T08:00:00'))).toBe('早安');
    expect(getGreeting(new Date('2026-08-27T14:00:00'))).toBe('午安');
    expect(getGreeting(new Date('2026-08-27T20:00:00'))).toBe('晚安');
  });

  it('formats BLE states without inventing a weight', () => {
    expect(getBleDisplay('connected', 328.25)).toEqual({
      label: '智慧水杯已連線',
      value: '328 g',
      tone: 'connected',
    });
    expect(getBleDisplay('connecting')).toMatchObject({ label: '智慧水杯連線中', value: '' });
    expect(getBleDisplay('disconnected')).toMatchObject({ label: '智慧水杯未連線', value: '前往連線' });
  });

  it('sorts records newest first and limits the result', () => {
    const records = [
      { id: 'old', occurredAt: '2026-08-27T09:30:00Z' },
      { id: 'new', occurredAt: '2026-08-27T13:45:00Z' },
      { id: 'mid', occurredAt: '2026-08-27T11:00:00Z' },
      { id: 'latest', occurredAt: '2026-08-27T15:30:00Z' },
    ] as DrinkRecord[];
    expect(getRecentRecords(records).map((record) => record.id)).toEqual(['latest', 'new', 'mid']);
  });

  it('builds a drink payload with the selected amount', () => {
    expect(buildDrinkPayload(250, new Date('2026-08-27T09:30:00Z'))).toEqual({
      eventType: 'drink',
      amountMl: 250,
      occurredAt: '2026-08-27T09:30:00.000Z',
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm run test --workspace app -- dashboardViewModel.test.ts`

Expected: FAIL because `dashboardViewModel.ts` does not exist.

- [ ] **Step 3: Implement the view-model helpers**

```ts
import { BleConnectionStatus, DrinkRecord, UploadRecordPayload } from '../../types';

export const QUICK_AMOUNTS = [150, 250, 350, 500] as const;

export const getProgress = (totalMl: number, goalMl: number) => {
  const percent = goalMl > 0 ? Math.max(0, Math.round((totalMl / goalMl) * 100)) : 0;
  return { percent, ringPercent: Math.min(100, percent) };
};

export const getGreeting = (now = new Date()) => {
  const hour = now.getHours();
  if (hour < 12) return '早安';
  if (hour < 18) return '午安';
  return '晚安';
};

export const getBleDisplay = (status: BleConnectionStatus, weight?: number) => {
  if (status === 'connected') {
    return {
      label: '智慧水杯已連線',
      value: typeof weight === 'number' ? `${Math.round(weight)} g` : '',
      tone: 'connected' as const,
    };
  }
  if (status === 'connecting' || status === 'scanning') {
    return { label: '智慧水杯連線中', value: '', tone: 'connecting' as const };
  }
  return { label: '智慧水杯未連線', value: '前往連線', tone: 'disconnected' as const };
};

export const getRecentRecords = (records: DrinkRecord[]) =>
  [...records]
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
    .slice(0, 3);

export const buildDrinkPayload = (amountMl: number, now = new Date()): UploadRecordPayload => ({
  eventType: 'drink',
  amountMl,
  occurredAt: now.toISOString(),
});
```

- [ ] **Step 4: Run the view-model tests**

Run: `npm run test --workspace app -- dashboardViewModel.test.ts`

Expected: PASS with 5 tests.

- [ ] **Step 5: Commit the helper and tests**

```bash
git add app/src/views/dashboard/dashboardViewModel.ts app/tests/dashboardViewModel.test.ts
git commit -m "test: 新增飲水首頁狀態測試"
```

### Task 2: Build the Dashboard Visual Components

**Files:**
- Create: `app/src/views/dashboard/WaterGlassIllustration.tsx`
- Create: `app/src/views/dashboard/HydrationHero.tsx`
- Create: `app/src/views/dashboard/QuickDrinkGrid.tsx`
- Create: `app/src/views/dashboard/TodayRecordsCard.tsx`
- Create: `app/src/views/dashboard/HydrationReminder.tsx`

- [ ] **Step 1: Create the animated SVG glass**

Implement `WaterGlassIllustration` with props `{ progress: number }`. Clamp progress to `0..100`, calculate a water surface between `y=42` and `y=116`, clip it to the glass body, mark the SVG `aria-hidden="true"`, and use CSS class names `water-glass`, `water-glass__water`, and `water-glass__shine`. The component must contain only SVG presentation and no Context access.

```tsx
import React from 'react';

export const WaterGlassIllustration: React.FC<{ progress: number }> = ({ progress }) => {
  const clamped = Math.min(100, Math.max(0, progress));
  const waterY = 116 - clamped * 0.74;
  return (
    <svg className="water-glass" viewBox="0 0 160 150" aria-hidden="true">
      <defs>
        <clipPath id="glass-clip">
          <path d="M34 22h92l-9 106c-1 12-12 18-37 18s-36-6-37-18L34 22Z" />
        </clipPath>
      </defs>
      <g clipPath="url(#glass-clip)">
        <rect className="water-glass__water" x="30" y={waterY} width="100" height={150 - waterY} rx="10" />
        <ellipse className="water-glass__surface" cx="80" cy={waterY} rx="49" ry="7" />
      </g>
      <path className="water-glass__body" d="M34 22h92l-9 106c-1 12-12 18-37 18s-36-6-37-18L34 22Z" />
      <ellipse className="water-glass__rim" cx="80" cy="22" rx="46" ry="9" />
      <path className="water-glass__shine" d="M49 40c1 25 3 53 6 76" />
    </svg>
  );
};
```

- [ ] **Step 2: Create `HydrationHero`**

The component accepts total, goal, percent, ringPercent, BLE label/value/tone, and `onOpenBle`. Render a CSS conic-gradient ring, the SVG glass, and a semantic button for the BLE status row. Format water values with `Intl.NumberFormat('zh-TW')`. Do not read Context inside the component.

- [ ] **Step 3: Create `QuickDrinkGrid`**

Accept `{ amounts, busyAmount, successAmount, onDrink }`. Render one button per amount with a simple CSS cup glyph, `aria-label="記錄喝水 250 毫升"`, disabled state for any in-flight request, and a check icon for the most recently successful amount.

- [ ] **Step 4: Create `TodayRecordsCard`**

Accept `{ records, onViewAll }`. Render at most three rows with `amountMl`, localized `HH:mm`, and a distinct `refill` modifier class. If empty, render `今天還沒有紀錄，先喝一杯水吧。` and a button that triggers `onViewAll`.

- [ ] **Step 5: Create `HydrationReminder`**

Render a decorative droplet icon, heading `小提醒`, and body `每一口都在靠近今天的目標` in a low-priority banner. Mark decorative icons hidden from assistive technology.

- [ ] **Step 6: Type-check the new components**

Run: `npm run build --workspace app`

Expected: PASS because the new components are valid independent modules even before `DashboardView` imports them.

- [ ] **Step 7: Commit the visual components**

```bash
git add app/src/views/dashboard
git commit -m "feat: 建立飲水首頁視覺元件"
```

### Task 3: Compose the New Dashboard

**Files:**
- Modify: `app/src/views/DashboardView.tsx`

- [ ] **Step 1: Replace the desktop card grid with the mobile composition**

Keep `useAuth`, `useWater`, and `useBle` in the page. Remove custom refill form and tare controls from the homepage. Compose the page in this order: greeting header with an accessible notification icon, `HydrationHero`, `QuickDrinkGrid`, `TodayRecordsCard`, `HydrationReminder`. While `isLoading` is true and no daily data has loaded, add `dashboard-home--loading` so the cards can use a non-blocking pulse treatment instead of replacing the page with a spinner.

```tsx
const { percent, ringPercent } = getProgress(totalMl, goalMl);
const bleDisplay = getBleDisplay(bleStatus, bleSummary?.currentWeight);
const recentRecords = getRecentRecords(records);
```

The quick-log handler must set `busyAmount`, call `logWaterRecord(buildDrinkPayload(amount))`, show `已記錄 ${amount} ml`, set `successAmount`, and clear busy state in `finally`. If `syncStatus.pendingCount` increases after the call, use the info Toast copy `已暫存 ${amount} ml，連線後會自動同步`. Use a short timeout to clear the success marker and clear that timeout on unmount.

- [ ] **Step 2: Wire navigation**

- Hero BLE row → `onNavigate('ble')`
- Today record action → `onNavigate('history')`
- Do not add new routes or change `ActiveTab`.

- [ ] **Step 3: Run the view-model tests and production build**

Run: `npm run test --workspace app -- dashboardViewModel.test.ts && npm run build --workspace app`

Expected: tests PASS and Vite emits `dist` successfully.

- [ ] **Step 4: Commit the composed page**

```bash
git add app/src/views/DashboardView.tsx
git commit -m "feat: 改造行動版飲水首頁"
```

### Task 4: Replace the Header Navigation with a Bottom Tab Bar

**Files:**
- Modify: `app/src/components/Navbar.tsx`
- Modify: `app/src/App.tsx`

- [ ] **Step 1: Rewrite `Navbar` as five mobile actions**

Use Lucide icons `House`, `ChartNoAxesColumnIncreasing`, `Plus`, `Cpu`, and `UserRound`. Preserve `activeTab` and `onSelectTab`. Map tabs to `dashboard`, `stats`, `devices`, and `settings`; render the center plus as a button that invokes a new `onAdd` prop. Keep the pending offline count as a small badge on the center action. Remove desktop brand, logout, device-name, and BLE pills from this component because those functions remain accessible from Settings, Devices, and the hero BLE row.

- [ ] **Step 2: Add the manual-entry panel state to `MainLayout`**

Add `handleOpenQuickDrink` to `MainLayout` and pass it as the `onAdd` prop. It must switch to Dashboard and focus the existing quick-drink section, avoiding duplicate API logic or a second manual-entry form.

```ts
const handleOpenQuickDrink = () => {
  setActiveTab('dashboard');
  requestAnimationFrame(() => {
    document.getElementById('quick-drink')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
};
```

- [ ] **Step 3: Run build**

Run: `npm run build --workspace app`

Expected: PASS with no unused imports or prop mismatches.

- [ ] **Step 4: Commit navigation changes**

```bash
git add app/src/components/Navbar.tsx app/src/App.tsx
git commit -m "feat: 改用手機底部導覽"
```

### Task 5: Apply the Mobile Visual System

**Files:**
- Modify: `app/src/App.css`

- [ ] **Step 1: Add the centered phone shell**

Set `body` to the warm off-white background, `.app-container` to `width: min(100%, 430px)`, centered with a subtle desktop edge shadow, and `.main-content` to mobile padding with bottom space for navigation. Preserve generic form/table styles used by the other views.

- [ ] **Step 2: Style the dashboard hierarchy**

Add styles for `.dashboard-home`, `.dashboard-greeting`, `.hydration-hero`, `.hydration-ring`, `.water-glass`, `.smart-cup-row`, `.quick-drink-card`, `.quick-drink-grid`, `.quick-drink-button`, `.today-records`, `.record-row`, and `.hydration-reminder`. Use 4/8px multiples, 20–28px card radii, 44px minimum controls, and blue-tinted shadows.

- [ ] **Step 3: Style the bottom navigation**

Make `.navbar` fixed to the bottom of the centered phone shell, render five equal columns, and lift the center plus into a 64px circular blue action. Ensure safe-area padding with `env(safe-area-inset-bottom)` and visible `:focus-visible` outlines.

- [ ] **Step 4: Add responsive and reduced-motion safeguards**

At widths under 375px, reduce card padding and metric font size without horizontal scrolling. Under `prefers-reduced-motion: reduce`, disable ring/water transitions, success bounce, and smooth scrolling.

- [ ] **Step 5: Verify the app build and all tests**

Run: `npm run app:test && npm run app:build`

Expected: all Vitest suites PASS and the Vite production build succeeds.

- [ ] **Step 6: Commit the visual system**

```bash
git add app/src/App.css
git commit -m "style: 完成行動版飲水首頁視覺"
```

### Task 6: Browser Verification and Polish

**Files:**
- Inspect: `app/src/App.css`
- Inspect: `app/src/views/dashboard/*.tsx`
- Inspect: `app/src/views/DashboardView.tsx`
- Modify only the inspected files that fail a verification item below.

- [ ] **Step 1: Start the application**

Run backend and frontend with the repository scripts, then open the authenticated Dashboard at 390×844. If backend auth data is unavailable, use the existing development/mock path rather than hard-coding production data.

- [ ] **Step 2: Verify the core flow**

Confirm greeting, progress, BLE state, four quick amounts, three recent records, reminder, and five bottom actions. Click 250 ml once and verify one request, busy feedback, success Toast, and refreshed total.

- [ ] **Step 3: Verify edge states**

Check 0%, above 100%, BLE disconnected, BLE connecting, no records, long display name, 375px width, and desktop centering. Confirm no horizontal scroll and no content hidden behind the bottom navigation.

- [ ] **Step 4: Run final checks**

Run: `npm run app:test && npm run app:build && git diff --check`

Expected: tests PASS, build succeeds, and `git diff --check` returns no output.

- [ ] **Step 5: Review the final diff without including unrelated work**

Run: `git status --short` and inspect only the files listed in this plan. Do not stage pre-existing changes in `.github/workflows/ci.yml`, root package files, README files, or unrelated untracked content.
