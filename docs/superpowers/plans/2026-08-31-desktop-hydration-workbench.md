# 桌面飲水工作台實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended; not used here) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將登入後首頁落實為已核准的桌面 Web「飲水工作台」，讓使用者先看懂今日進度，再快速記錄一杯水。

**Architecture:** 保留現有 Context、API、離線佇列、BLE 與 `ActiveTab` 資料流，只重組 Dashboard DOM 與桌面 CSS。今日進度、快速記錄、紀錄列表與週摘要各自維持單一元件責任；首頁不再掛載 3D／科技 HUD 視覺。

**Tech Stack:** React 18、TypeScript、Vite、Vitest、Motion for React、Lucide React、現有 CSS。

---

## 檔案地圖

- Modify: `app/src/App.tsx` — 加入桌面 shell class。
- Modify: `app/src/components/Navbar.tsx` — 保留導覽行為，補桌面品牌與 links wrapper。
- Modify: `app/src/views/DashboardView.tsx` — 組合工具列、左右工作區與週摘要。
- Modify: `app/src/views/dashboard/TechDashboardHeader.tsx` — 一般桌面頁首與連線狀態。
- Modify: `app/src/views/dashboard/HydrationHero.tsx` — DOM-only 今日進度卡與水杯狀態。
- Modify: `app/src/views/dashboard/QuickDrinkGrid.tsx` — 右欄快速記錄卡，保留所有既有狀態。
- Modify: `app/src/views/dashboard/TodayRecordsCard.tsx` — 桌面表格式紀錄列。
- Modify: `app/src/views/dashboard/HydrationReminder.tsx` — 顯示真實剩餘容量。
- Create: `app/src/views/dashboard/DashboardWeekSummary.tsx` — 週摘要與今日小結。
- Modify: `app/src/views/dashboard/dashboardViewModel.ts` — 純函式格式化與邊界值。
- Modify: `app/tests/dashboardViewModel.test.ts` — 新增純函式測試。
- Modify: `app/src/App.css` — 桌面 shell、頂部導覽、左右欄、表格與低 AI 感視覺。

### Task 1: 鎖定日期與週摘要純函式

**Files:**
- Modify: `app/src/views/dashboard/dashboardViewModel.ts`
- Modify: `app/tests/dashboardViewModel.test.ts`

- [ ] **Step 1: 寫 failing tests**

加入 `getDayLabel`、`getWeekPercent` 的測試：

```ts
it('formats a dashboard date without timezone drift', () => {
  expect(getDayLabel('2026-08-31')).toBe('8 月 31 日');
  expect(getDayLabel('bad-date')).toBe('日期未定');
});

it('clamps weekly summary percentages', () => {
  expect(getWeekPercent(0, 2000)).toBe(0);
  expect(getWeekPercent(1000, 2000)).toBe(50);
  expect(getWeekPercent(2400, 2000)).toBe(100);
  expect(getWeekPercent(1000, 0)).toBe(0);
});
```

- [ ] **Step 2: 確認先失敗**

Run:

```bash
npm run test --workspace app -- dashboardViewModel.test.ts
```

Expected: FAIL，指出兩個 helper 尚未 export。

- [ ] **Step 3: 實作 helper**

在 `dashboardViewModel.ts` 加入：

```ts
export const getDayLabel = (value: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return '日期未定';
  return `${Number(match[2])} 月 ${Number(match[3])} 日`;
};

export const getWeekPercent = (totalMl: number, goalMl: number): number => {
  if (!Number.isFinite(totalMl) || !Number.isFinite(goalMl) || goalMl <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((totalMl / goalMl) * 100)));
};
```

- [ ] **Step 4: 驗證並 commit**

Run `npm run test --workspace app -- dashboardViewModel.test.ts`，Expected: 全部 PASS。

```bash
git add app/src/views/dashboard/dashboardViewModel.ts app/tests/dashboardViewModel.test.ts
git commit -m "test: 補上桌面摘要格式化行為"
```

### Task 2: 重組首頁與導覽結構

**Files:**
- Modify: `app/src/App.tsx`
- Modify: `app/src/components/Navbar.tsx`
- Modify: `app/src/views/DashboardView.tsx`

- [ ] **Step 1: 建立桌面 shell 與 Navbar wrapper**

在 `App.tsx` 將登入後容器改為 `<div className="app-container app-shell">`。Navbar 保留既有 `items` 與 `renderItem`，return 結構改成品牌按鈕、`.desktop-nav-links` wrapper、既有導覽按鈕與 compact `新增紀錄` 按鈕；`onAdd`、`onSelectTab`、pending badge 行為不變。

- [ ] **Step 2: 組合 Dashboard workspace**

在 `DashboardView` 取出 `weeklyStats`，移除 `getSceneProgress` 與 `sceneProgress`。加入 `formatDashboardDate` 與 `handleScrollToQuickDrink`，並使用以下結構：

```tsx
<div className="dashboard-toolbar">日期與「今天的飲水」<button>新增紀錄</button></div>
<div className="dashboard-workspace">
  <HydrationHero totalMl={totalMl} goalMl={goalMl} percent={percent} ble={bleDisplay} onOpenBle={() => onNavigate('ble')} />
  <div className="dashboard-workspace__side">
    <QuickDrinkGrid amounts={QUICK_AMOUNTS} busyAmount={busyAmount} successAmount={successAmount} onDrink={handleQuickLog} />
    <HydrationReminder remainingMl={Math.max(0, goalMl - totalMl)} />
  </div>
</div>
<div className="dashboard-lower-grid">
  <TodayRecordsCard records={recentRecords} onViewAll={() => onNavigate('history')} onDelete={handleDeleteRecord} deletingRecordId={deletingRecordId} />
  <DashboardWeekSummary weeklyStats={weeklyStats} drinkCount={dailyStats?.drinkCount ?? 0} totalMl={totalMl} />
</div>
```

- [ ] **Step 3: 執行 build，確認 props 差異清楚**

Run `npm run build --workspace app`。Expected: 若暫時失敗，只應是 Task 3 的元件介面尚未同步，不修改 API 或 Context 型別。

### Task 3: 重寫 Dashboard 元件

**Files:**
- Modify: `app/src/views/dashboard/TechDashboardHeader.tsx`
- Modify: `app/src/views/dashboard/HydrationHero.tsx`
- Modify: `app/src/views/dashboard/QuickDrinkGrid.tsx`
- Modify: `app/src/views/dashboard/TodayRecordsCard.tsx`
- Modify: `app/src/views/dashboard/HydrationReminder.tsx`
- Create: `app/src/views/dashboard/DashboardWeekSummary.tsx`

- [ ] **Step 1: 改頁首**

保留 `greeting`、`displayName`、`connected`、`onNotify` props；使用 `desktop-dashboard-header` class，中文顯示問候、今日工作面與「水杯已連線／水杯未連線」，保留 Lucide `Radio`、`Bell` 與通知 callback。

- [ ] **Step 2: 移除 HydrationHero 場景依賴**

props 縮成 `totalMl`、`goalMl`、`percent`、`ble`、`onOpenBle`；移除 `ringPercent`、`sceneProgress`、`HydrationScene` import 與 orbit／scan／axis DOM。進度條寬度 clamp 到 0–100%，保留 DOM 數字、目標、剩餘量與 BLE button。

- [ ] **Step 3: 簡化 QuickDrinkGrid**

保留四個 amount 與 `busyAmount`、`successAmount`、`onDrink`；移除序號與裝飾性 energy bar，使用 `Plus`／`Check` 和 `${amount} ml` 文字。外層 id 保留 `quick-drink`，class 改為 `desktop-quick-card`。

- [ ] **Step 4: 改 TodayRecordsCard 表格列**

保留排序、查看全部、刪除確認與 loading；欄位固定為時間、容量、來源、操作，來源顯示「補水事件」或「飲水紀錄」，刪除按鈕保留 `aria-label`。

- [ ] **Step 5: 改 HydrationReminder 與新增週摘要**

`HydrationReminder` 介面為 `{ remainingMl: number }`，只顯示「還差 {remainingMl} ml」或「今天已達標」。`DashboardWeekSummary` 介面為：

```ts
interface DashboardWeekSummaryProps {
  weeklyStats: WeeklyStats | null;
  drinkCount: number;
  totalMl: number;
}
```

weeklyStats 為 null 顯示穩定載入狀態；有資料時最多列出 7 天，以 `getWeekPercent` 控制柱高並同時呈現日期、容量與百分比；drinkCount 為 0 時平均容量顯示 `0 ml`。

- [ ] **Step 6: build 與 commit**

Run `npm run build --workspace app`，Expected: TypeScript strict 與 Vite build PASS，沒有未使用 import。

```bash
git add app/src/App.tsx app/src/components/Navbar.tsx app/src/views/DashboardView.tsx app/src/views/dashboard
git commit -m "feat: 實作桌面飲水工作台首頁"
```

### Task 4: 套用桌面低 AI 感視覺

**Files:**
- Modify: `app/src/App.css`

- [ ] **Step 1: 建立 desktop shell 與頂部導覽**

在既有 CSS 最後加入 `@media (min-width: 769px)`：`.app-shell` 寬度 100%、背景 `#f7f9f6`、無手機圓角；`.app-shell .navbar.bottom-nav` 改為 sticky top 64px、白色背景、底線、無漂浮陰影；`.desktop-nav-brand` 左對齊，`.desktop-nav-links` 水平排列，新增按鈕為 44px 高深綠文字按鈕。小於 769px 隱藏 brand、links 使用 `display: contents`。

- [ ] **Step 2: 建立首頁容器與工作區**

桌面 main content 使用 `max-width: 1280px; padding: 34px 40px 64px`。覆寫 dashboard 舊深色 background 與 `::before` 網格。`dashboard-workspace` 與 `dashboard-lower-grid` 在 900px 以上使用 `minmax(0, 1.5fr) minmax(320px, .88fr)` 兩欄，900px 以下單欄。

- [ ] **Step 3: 套用元件表面與互動狀態**

各 desktop card 使用白底、`1px solid #d8e0d9`、4–8px radius、低幅度 shadow；主色為 `#202b28`，進度為 `#b7d568`，主要按鈕為 `#26372f`。按鈕至少 44px 高，hover 只調整邊框，focus 顯示 outline；移除漸層、霓虹、玻璃擬態與大型圓角。沿用既有 reduced-motion 規則。

- [ ] **Step 4: 瀏覽器檢查**

Run `npm run dev --workspace app -- --host 127.0.0.1`，以 Chrome 檢查 1440×900 與 1280×720：頂部導覽、左進度／紀錄、右快速記錄／提醒、底部週摘要均不溢出，且舊 `.tech-*` 規則沒有覆蓋新樣式。

```bash
git add app/src/App.css
git commit -m "style: 套用桌面飲水工作台視覺"
```

### Task 5: 回歸測試與完成驗證

**Files:**
- No new files.

- [ ] **Step 1: 執行全部 App tests**

Run `npm run test --workspace app`。Expected: view-model、API client、BLE protocol、sync engine、SVG scene 測試全部 PASS。

- [ ] **Step 2: 執行 production build**

Run `npm run build --workspace app`。Expected: TypeScript strict check 與 Vite bundle PASS。

- [ ] **Step 3: 驗證主要流程**

逐一確認：導覽切換與返回總覽、四個快速容量的 busy／success／Toast、離線暫存、水杯狀態導覽、查看全部、刪除確認與週摘要 null 狀態。

- [ ] **Step 4: 檢查變更邊界**

```bash
git status --short
git diff --check
```

Expected: 只有本計畫列出的前端檔案與既有使用者變更；`git diff --check` 無 whitespace error，不重置其他變更。
