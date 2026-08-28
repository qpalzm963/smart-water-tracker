# Three.js Hydration Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing light mobile dashboard with a high-tech hydration home screen whose Three.js glass visualizes live progress while all logging, BLE, offline, and navigation behavior remains intact.

**Architecture:** Keep Context access and API actions in `DashboardView`, pass normalized display data into DOM-only dashboard components, and isolate React Three Fiber behind a lazy-loaded `HydrationScene` boundary. Use Motion for DOM transitions and R3F frame updates for the glass, water level, and one-shot ripple; fall back to the existing SVG glass when WebGL or motion is unavailable.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, Three.js, React Three Fiber 8, Motion for React, Lucide React, CSS.

---

## File Map

- Modify `app/package.json` and `package-lock.json`: add Three.js, R3F, Motion, and Three types.
- Modify `app/src/views/dashboard/dashboardViewModel.ts`: clamp and normalize progress for the scene.
- Modify `app/tests/dashboardViewModel.test.ts`: cover scene progress edge cases.
- Create `app/src/views/dashboard/three/HydrationScene.tsx`: lazy loading, WebGL/reduced-motion detection, error boundary, and SVG fallback.
- Create `app/src/views/dashboard/three/HydrationCanvas.tsx`: Canvas, camera, lighting, tech rings, and scene composition.
- Create `app/src/views/dashboard/three/TechWaterGlass.tsx`: glass geometry, animated water, drag rotation, and success ripple.
- Create `app/src/views/dashboard/TechDashboardHeader.tsx`: tech-system greeting and connection summary.
- Modify `app/src/views/dashboard/HydrationHero.tsx`: replace the light progress ring with HUD plus `HydrationScene`.
- Modify `app/src/views/dashboard/QuickDrinkGrid.tsx`: use Motion for press, busy, and success feedback.
- Modify `app/src/views/dashboard/TodayRecordsCard.tsx`: tech data-log presentation and Motion row entry.
- Modify `app/src/views/DashboardView.tsx`: orchestrate `successPulseId`, new header, and tech sections.
- Modify `app/src/components/Navbar.tsx`: add tech-active motion marker without changing tab behavior.
- Modify `app/src/App.css`: implement the dark high-tech visual system, responsive sizing, WebGL shell, focus states, and reduced-motion behavior.

### Task 1: Install Compatible Animation and 3D Dependencies

**Files:**
- Modify: `app/package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install React 18-compatible packages**

Run:

```bash
npm install --workspace app three@^0.180.0 @types/three@^0.180.0 @react-three/fiber@^8.18.0 motion@^12
```

Expected: npm updates `app/package.json` and the root lockfile without peer-dependency errors. Fiber stays on major version 8 because the app uses React 18.

- [ ] **Step 2: Verify the dependency tree**

Run:

```bash
npm ls --workspace app three @react-three/fiber motion
```

Expected: all four packages resolve once and `npm ls` exits with code 0.

- [ ] **Step 3: Commit dependencies**

```bash
git add app/package.json package-lock.json
git commit -m "build: 加入 Three.js 與動畫套件"
```

### Task 2: Add Deterministic Scene Progress Mapping

**Files:**
- Modify: `app/src/views/dashboard/dashboardViewModel.ts`
- Modify: `app/tests/dashboardViewModel.test.ts`

- [ ] **Step 1: Write failing normalization tests**

Add the import and test:

```ts
import { getSceneProgress } from '../src/views/dashboard/dashboardViewModel';

it('normalizes the scene progress into the 0..1 range', () => {
  expect(getSceneProgress(-20)).toBe(0);
  expect(getSceneProgress(60)).toBe(0.6);
  expect(getSceneProgress(120)).toBe(1);
  expect(getSceneProgress(Number.NaN)).toBe(0);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm run test --workspace app -- dashboardViewModel.test.ts
```

Expected: FAIL because `getSceneProgress` is not exported.

- [ ] **Step 3: Implement the normalization helper**

Add to `dashboardViewModel.ts`:

```ts
export const getSceneProgress = (percent: number): number => {
  if (!Number.isFinite(percent)) return 0;
  return Math.min(1, Math.max(0, percent / 100));
};
```

- [ ] **Step 4: Run the test and verify it passes**

Run:

```bash
npm run test --workspace app -- dashboardViewModel.test.ts
```

Expected: PASS with the existing five tests plus the normalization test.

- [ ] **Step 5: Commit the view-model change**

```bash
git add app/src/views/dashboard/dashboardViewModel.ts app/tests/dashboardViewModel.test.ts
git commit -m "test: 新增 3D 水位映射測試"
```

### Task 3: Build the Lazy Three.js Scene and Static Fallback

**Files:**
- Create: `app/src/views/dashboard/three/HydrationScene.tsx`
- Create: `app/src/views/dashboard/three/HydrationCanvas.tsx`
- Create: `app/src/views/dashboard/three/TechWaterGlass.tsx`

- [ ] **Step 1: Create the scene boundary**

Implement `HydrationScene.tsx` with a reusable fallback and a class error boundary:

```tsx
import React, { Component, lazy, Suspense, useEffect, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { WaterGlassIllustration } from '../WaterGlassIllustration';

const HydrationCanvas = lazy(() => import('./HydrationCanvas'));

const canUseWebGl = (): boolean => {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
};

class SceneErrorBoundary extends Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export interface HydrationSceneProps {
  progress: number;
  successPulseId: number;
}

export const HydrationScene: React.FC<HydrationSceneProps> = ({
  progress,
  successPulseId,
}) => {
  const reduceMotion = useReducedMotion();
  const [webGlAvailable, setWebGlAvailable] = useState(false);
  const [pageVisible, setPageVisible] = useState(!document.hidden);

  useEffect(() => setWebGlAvailable(canUseWebGl()), []);
  useEffect(() => {
    const handleVisibility = () => setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  const fallback = (
    <div className="tech-scene__fallback">
      <WaterGlassIllustration progress={progress * 100} />
    </div>
  );

  if (reduceMotion || !webGlAvailable) return fallback;

  return (
    <SceneErrorBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <HydrationCanvas
          progress={progress}
          successPulseId={successPulseId}
          active={pageVisible}
        />
      </Suspense>
    </SceneErrorBoundary>
  );
};
```

- [ ] **Step 2: Create the Canvas and fixed-cost environment**

Implement `HydrationCanvas.tsx`:

```tsx
import React, { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { TechWaterGlass } from './TechWaterGlass';

interface HydrationCanvasProps {
  progress: number;
  successPulseId: number;
  active: boolean;
}

const SceneFloat: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const groupRef = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (!groupRef.current) return;
    const time = state.clock.getElapsedTime();
    groupRef.current.position.y = Math.sin(time * 1.35) * 0.045;
    groupRef.current.rotation.x = Math.sin(time * 0.85) * 0.012;
  });
  return <group ref={groupRef}>{children}</group>;
};

const HydrationCanvas: React.FC<HydrationCanvasProps> = ({ progress, successPulseId, active }) => (
  <Canvas
    className="tech-scene__canvas"
    camera={{ position: [0, 0.1, 5.4], fov: 34 }}
    dpr={[1, 1.5]}
    frameloop={active ? 'always' : 'never'}
    gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
  >
    <ambientLight intensity={1.2} />
    <directionalLight position={[3, 4, 4]} intensity={2.2} color="#c9f8ff" />
    <pointLight position={[-2, 0, 2]} intensity={12} distance={7} color="#238bff" />
    <pointLight position={[2, -1, 1]} intensity={7} distance={5} color="#54e6ff" />
    <SceneFloat>
      <TechWaterGlass progress={progress} successPulseId={successPulseId} />
    </SceneFloat>
  </Canvas>
);

export default HydrationCanvas;
```

- [ ] **Step 3: Create the glass, animated liquid, and ripple**

Implement `TechWaterGlass.tsx` with three refs: the root group, liquid mesh, and ripple mesh. Clamp `progress`, calculate `targetHeight = 0.28 + progress * 1.72` and `targetY = -1.05 + targetHeight / 2`, then use `THREE.MathUtils.damp` in `useFrame` to update liquid scale and position. Detect a changed non-zero `successPulseId`, reset ripple scale and opacity, and animate it outward for one second. Limit pointer-driven rotation to `x=-0.12..0.12` and `y=-0.32..0.32`, then damp back to `[-0.05, -0.16]` after pointer release.

The visible meshes must be:

```tsx
<group ref={groupRef} rotation={[-0.05, -0.16, 0]}>
  <mesh>
    <cylinderGeometry args={[1.04, 0.86, 2.45, 64, 1, true]} />
    <meshPhysicalMaterial
      color="#bcefff"
      transparent
      opacity={0.24}
      roughness={0.08}
      metalness={0.05}
      transmission={0.72}
      thickness={0.34}
      side={THREE.DoubleSide}
    />
  </mesh>
  <mesh position={[0, -1.22, 0]} rotation={[Math.PI / 2, 0, 0]}>
    <circleGeometry args={[0.86, 64]} />
    <meshPhysicalMaterial color="#8cdfff" transparent opacity={0.32} />
  </mesh>
  <mesh ref={liquidRef} position={[0, targetY, 0]} scale={[1, targetHeight, 1]}>
    <cylinderGeometry args={[0.92, 0.79, 1, 64]} />
    <meshPhysicalMaterial color="#198cff" transparent opacity={0.72} roughness={0.12} />
  </mesh>
  <mesh ref={rippleRef} rotation={[Math.PI / 2, 0, 0]}>
    <torusGeometry args={[0.35, 0.022, 12, 64]} />
    <meshBasicMaterial color="#88f2ff" transparent opacity={0} />
  </mesh>
</group>
```

Add an outer invisible pointer target around the group so dragging does not depend on hitting transparent glass geometry.

- [ ] **Step 4: Verify type safety and bundle creation**

Run:

```bash
npm run build --workspace app
```

Expected: TypeScript passes and Vite creates a separate lazy Three.js chunk.

- [ ] **Step 5: Commit the isolated scene**

```bash
git add app/src/views/dashboard/three
git commit -m "feat: 建立 Three.js 飲水場景"
```

### Task 4: Build the High-Tech DOM Interface

**Files:**
- Create: `app/src/views/dashboard/TechDashboardHeader.tsx`
- Modify: `app/src/views/dashboard/HydrationHero.tsx`
- Modify: `app/src/views/dashboard/QuickDrinkGrid.tsx`
- Modify: `app/src/views/dashboard/TodayRecordsCard.tsx`
- Modify: `app/src/components/Navbar.tsx`

- [ ] **Step 1: Create the system header**

Implement `TechDashboardHeader` with Motion and Lucide icons:

```tsx
import React from 'react';
import { Bell, Radio } from 'lucide-react';
import { motion } from 'motion/react';

interface TechDashboardHeaderProps {
  greeting: string;
  displayName: string;
  connected: boolean;
  onNotify: () => void;
}

export const TechDashboardHeader: React.FC<TechDashboardHeaderProps> = ({
  greeting,
  displayName,
  connected,
  onNotify,
}) => (
  <motion.header
    className="tech-dashboard-header"
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
  >
    <div>
      <span className="tech-eyebrow">HYDRATION SYSTEM</span>
      <h1>{greeting}，{displayName}</h1>
      <p>今日補水狀態</p>
    </div>
    <button type="button" className="tech-status-button" onClick={onNotify} aria-label="查看系統通知">
      <Radio size={14} aria-hidden="true" />
      <span>{connected ? 'ONLINE' : 'STANDBY'}</span>
      <Bell size={18} aria-hidden="true" />
    </button>
  </motion.header>
);
```

- [ ] **Step 2: Replace the ring hero with HUD and 3D scene**

Update `HydrationHero` to accept `sceneProgress` and `successPulseId`, render `HydrationScene` in the right half, retain the semantic BLE button below it, and wrap the hero in a Motion entry animation. HUD text remains in DOM:

```tsx
<div className="tech-hud">
  <span className="tech-hud__label">DAILY INTAKE</span>
  <div className="tech-hud__amount">
    <strong>{numberFormatter.format(totalMl)}</strong><span>ML</span>
  </div>
  <span className="tech-hud__percent">{percent.toFixed(0)}%</span>
  <span className="tech-hud__goal">目標 / {numberFormatter.format(goalMl)} ML</span>
</div>
<HydrationScene progress={sceneProgress} successPulseId={successPulseId} />
```

- [ ] **Step 3: Add Motion states to quick logging**

Replace each plain button with `motion.button`, keeping native disabled and accessible labels. Use `whileTap={{ scale: 0.94 }}` and conditionally render a Motion check mark. Do not animate layout-affecting height or width.

- [ ] **Step 4: Add staggered data-log entry**

Wrap the records list in a Motion parent with `staggerChildren: 0.06`; render each row as `motion.div` with opacity and `y` entry. Keep `<time dateTime>` and the refill label unchanged.

- [ ] **Step 5: Add a non-layout active marker to navigation**

Within each active nav item render:

```tsx
{active && (
  <motion.span
    className="bottom-nav__active-line"
    layoutId="bottom-nav-active"
    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
    aria-hidden="true"
  />
)}
```

Import `motion` from `motion/react`. The marker is absolutely positioned so it cannot resize the navigation item.

- [ ] **Step 6: Run build before composition**

Run:

```bash
npm run build --workspace app
```

Expected: all new prop interfaces and Motion components type-check.

- [ ] **Step 7: Commit DOM components**

```bash
git add app/src/views/dashboard app/src/components/Navbar.tsx
git commit -m "feat: 建立高科技飲水介面元件"
```

### Task 5: Compose One-Shot Animation State in DashboardView

**Files:**
- Modify: `app/src/views/DashboardView.tsx`

- [ ] **Step 1: Add scene progress and success pulse state**

Import `getSceneProgress` and `TechDashboardHeader`, add:

```tsx
const [successPulseId, setSuccessPulseId] = useState(0);
const sceneProgress = getSceneProgress(ringPercent);
```

After `logWaterRecord` resolves and the local success state is set, call:

```tsx
setSuccessPulseId((current) => current + 1);
```

Do not increment it in `catch`.

- [ ] **Step 2: Replace the existing greeting and pass scene props**

Render:

```tsx
<TechDashboardHeader
  greeting={getGreeting()}
  displayName={displayName}
  connected={bleStatus === 'connected'}
  onNotify={() => showToast('目前沒有新通知', 'info')}
/>
```

Pass `sceneProgress` and `successPulseId` to `HydrationHero` along with the existing totals, BLE state, and navigation callback.

- [ ] **Step 3: Remove the lifestyle reminder from homepage composition**

Delete the `HydrationReminder` import and `<HydrationReminder />` call from `DashboardView`. Leave the component file available for other consumers; it is not part of the high-tech home screen.

- [ ] **Step 4: Verify existing dashboard tests and build**

Run:

```bash
npm run test --workspace app -- dashboardViewModel.test.ts
npm run build --workspace app
```

Expected: view-model tests pass and the production build completes.

- [ ] **Step 5: Commit page orchestration**

```bash
git add app/src/views/DashboardView.tsx
git commit -m "feat: 串接 Three.js 首頁狀態"
```

### Task 6: Apply the High-Tech Visual System

**Files:**
- Modify: `app/src/App.css`

- [ ] **Step 1: Add dashboard-scoped tokens**

At the mobile dashboard section define:

```css
.dashboard-home {
  --tech-bg: #06111f;
  --tech-panel: rgba(10, 31, 51, 0.78);
  --tech-panel-strong: #0c243b;
  --tech-line: rgba(82, 205, 244, 0.2);
  --tech-cyan: #57e4f7;
  --tech-blue: #3f86ff;
  --tech-text: #eaf8ff;
  --tech-muted: #7293aa;
  color: var(--tech-text);
}
```

Set the authenticated mobile app shell background to a deep radial gradient only while the dashboard is active by styling `.app-container:has(.dashboard-home)`. Keep other views on the existing light background.

- [ ] **Step 2: Style the fixed 3D hero shell**

Create styles for `.tech-hydration-hero`, `.tech-hydration-hero__main`, `.tech-hud`, `.tech-scene`, `.tech-scene__canvas`, `.tech-scene__fallback`, HUD corner brackets, orbit rings, and scan line. The scene container must have `height: 290px`, `touch-action: pan-y`, and `contain: layout paint`.

- [ ] **Step 3: Restyle operational sections**

Scope dark surfaces to `.dashboard-home` for quick buttons, records, BLE row, links, and bottom navigation. Provide distinct connected, connecting, disconnected, loading, success, disabled, hover, active, and `:focus-visible` states. Keep minimum touch targets at 44px.

- [ ] **Step 4: Add responsive and reduced-motion rules**

At widths below 375px reduce the hero columns and HUD number size without hiding values. In the existing reduced-motion media query, disable scan-line, orbit, Float fallback CSS, row stagger visibility changes, and smooth scroll while keeping final states visible.

- [ ] **Step 5: Run CSS and production verification**

Run:

```bash
npm run build --workspace app
npm run test --workspace app
```

Expected: build and all app tests pass.

- [ ] **Step 6: Commit styling**

```bash
git add app/src/App.css
git commit -m "style: 完成高科技飲水首頁視覺"
```

### Task 7: Browser QA and Final Refinement

**Files:**
- Modify: `app/src/App.css`
- Modify: `app/src/views/dashboard/three/HydrationScene.tsx`
- Modify: `app/src/views/dashboard/three/HydrationCanvas.tsx`
- Modify: `app/src/views/dashboard/three/TechWaterGlass.tsx`
- Modify: `app/src/views/dashboard/HydrationHero.tsx`
- Modify: `app/src/views/dashboard/QuickDrinkGrid.tsx`
- Modify: `app/src/views/dashboard/TodayRecordsCard.tsx`

- [ ] **Step 1: Open the running app at mobile size**

Use the existing Vite server at `http://127.0.0.1:5188/`, authenticate with the project's available local flow, and inspect at 390×844 and 375×812.

Expected: no horizontal overflow, clipped text, canvas collapse, bottom-navigation overlap, or unreadable status.

- [ ] **Step 2: Exercise the primary flow**

Click each quick amount, confirm disabled state while saving, verify success Toast, HUD update, single ripple, and record row refresh. Open BLE and return to the dashboard; verify the Canvas mounts and unmounts cleanly.

- [ ] **Step 3: Exercise fallback and reduced motion**

Enable reduced motion in browser emulation and reload. Confirm the SVG glass replaces WebGL, no scan/float loop remains, and all buttons and data stay available.

- [ ] **Step 4: Fix defects found during visual QA**

Only edit the files listed in this task. Re-run the exact failing interaction after each fix and keep changes scoped to the approved homepage.

- [ ] **Step 5: Run the final verification suite**

Run:

```bash
npm run test --workspace app
npm run build --workspace app
git diff --check
```

Expected: all Vitest tests pass, Vite production build succeeds, and Git reports no whitespace errors.

- [ ] **Step 6: Commit final refinements**

```bash
git add app/src app/tests app/package.json package-lock.json
git commit -m "fix: 完成 Three.js 首頁互動驗證"
```
