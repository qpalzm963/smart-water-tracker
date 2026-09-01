import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Navbar, ActiveTab } from '../src/components/Navbar';
import { AuthProvider } from '../src/contexts/AuthContext';
import { BleProvider } from '../src/contexts/BleContext';
import { WaterProvider } from '../src/contexts/WaterContext';
import { DeviceProvider } from '../src/contexts/DeviceContext';
import { DashboardView } from '../src/views/DashboardView';
import { BleDeviceView } from '../src/views/BleDeviceView';
import { DevicesView } from '../src/views/DevicesView';
import { DeviceCenterView } from '../src/views/DeviceCenterView';
import { HistoryView } from '../src/views/HistoryView';
import { StatsView } from '../src/views/StatsView';
import { SettingsView } from '../src/views/SettingsView';
import { AuthView } from '../src/views/AuthView';

describe('Navigation and View Routing Coverage', () => {
  const dummyToast = () => {};
  const dummyNavigate = (_tab: ActiveTab) => {};

  const wrapProviders = (children: React.ReactNode) => (
    <AuthProvider>
      <BleProvider>
        <WaterProvider>
          <DeviceProvider>
            {children}
          </DeviceProvider>
        </WaterProvider>
      </BleProvider>
    </AuthProvider>
  );

  it('renders Navbar and marks active tab properly for primary and sub routes', () => {
    // 1. Dashboard active (also marks dashboard for history)
    const navDashboard = renderToStaticMarkup(
      wrapProviders(<Navbar activeTab="dashboard" onSelectTab={dummyNavigate} onAdd={() => {}} />)
    );
    expect(navDashboard).toContain('WATER / TRACKER');
    expect(navDashboard).toContain('首頁');
    expect(navDashboard).toContain('統計');
    expect(navDashboard).toContain('裝置');
    expect(navDashboard).toContain('我的');
    expect(navDashboard).toContain('bottom-nav__item--active');

    // 2. Sub-route history marks dashboard nav as active
    const navHistory = renderToStaticMarkup(
      wrapProviders(<Navbar activeTab="history" onSelectTab={dummyNavigate} onAdd={() => {}} />)
    );
    expect(navHistory).toContain('bottom-nav__item--active');

    // 3. Sub-route ble marks devices nav as active
    const navBle = renderToStaticMarkup(
      wrapProviders(<Navbar activeTab="ble" onSelectTab={dummyNavigate} onAdd={() => {}} />)
    );
    expect(navBle).toContain('bottom-nav__item--active');
  });

  it('renders AuthView with login and register forms', () => {
    const html = renderToStaticMarkup(
      wrapProviders(<AuthView showToast={dummyToast} />)
    );
    expect(html).toContain('智慧喝水追蹤器');
    expect(html).toContain('登入帳號');
    expect(html).toContain('註冊新帳號');
    expect(html).toContain('帳號');
  });

  it('renders DashboardView with today stats, hero, and action buttons', () => {
    const html = renderToStaticMarkup(
      wrapProviders(<DashboardView showToast={dummyToast} onNavigate={dummyNavigate} />)
    );
    expect(html).toContain('今天的飲水');
    expect(html).toContain('今日總量');
    expect(html).toContain('新增紀錄');
    expect(html).toContain('今日紀錄');
    expect(html).toContain('喝水節奏');
  });

  it('renders BleDeviceView with hardware controls, telemetry and live events table', () => {
    const html = renderToStaticMarkup(
      wrapProviders(<BleDeviceView showToast={dummyToast} />)
    );
    expect(html).toContain('藍牙智慧水杯控制面板');
    expect(html).toContain('連線狀態');
    expect(html).toContain('硬體指令控制');
    expect(html).toContain('即時藍牙事件串流');
  });

  it('renders DevicesView with device binding form and claim code transfer', () => {
    const html = renderToStaticMarkup(
      wrapProviders(<DevicesView showToast={dummyToast} />)
    );
    expect(html).toContain('智慧水杯裝置管理');
    expect(html).toContain('已綁定裝置列表');
    expect(html).toContain('綁定新水杯');
  });

  it('renders one device center with both hardware and cloud management sections', () => {
    const html = renderToStaticMarkup(
      wrapProviders(<DeviceCenterView showToast={dummyToast} />)
    );
    expect(html).toContain('裝置中心');
    expect(html).toContain('藍牙即時控制');
    expect(html).toContain('雲端綁定管理');
    expect(html).toContain('device-bluetooth-control');
    expect(html).toContain('device-cloud-management');
  });

  it('renders HistoryView with date & type filters and records table', () => {
    const html = renderToStaticMarkup(
      wrapProviders(<HistoryView showToast={dummyToast} />)
    );
    expect(html).toContain('喝水歷程紀錄');
    expect(html).toContain('開始日期');
    expect(html).toContain('結束日期');
    expect(html).toContain('事件類型');
  });

  it('renders StatsView with weekly and monthly tabs', () => {
    const html = renderToStaticMarkup(
      wrapProviders(<StatsView showToast={dummyToast} />)
    );
    expect(html).toContain('飲水統計與連續達標分析');
    expect(html).toContain('過去 7 日週統計');
    expect(html).toContain('過去 30 日月統計');
  });

  it('renders SettingsView with goals, backend URL, account info and offline queue', () => {
    const html = renderToStaticMarkup(
      wrapProviders(<SettingsView showToast={dummyToast} />)
    );
    expect(html).toContain('偏好與離線同步設定');
    expect(html).toContain('每日目標設定');
    expect(html).toContain('後端 API 端點設定');
    expect(html).toContain('帳號資訊');
    expect(html).toContain('登出帳號');
    expect(html).toContain('離線事件同步佇列');
  });
});
