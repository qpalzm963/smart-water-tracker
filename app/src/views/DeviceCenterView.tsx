import React, { useEffect, useRef } from 'react';
import {
  Bluetooth,
  Check,
  ChevronDown,
  Cloud,
  Cpu,
  Link2,
  RadioTower,
} from 'lucide-react';
import { useBle } from '../contexts/BleContext';
import { useDevices } from '../contexts/DeviceContext';
import { BleDeviceView } from './BleDeviceView';
import { DevicesView } from './DevicesView';

interface DeviceCenterViewProps {
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

const scrollToSection = (id: string) => {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

export const DeviceCenterView: React.FC<DeviceCenterViewProps> = ({ showToast }) => {
  const { status, deviceName, summary, syncHistory } = useBle();
  const { devices } = useDevices();
  const connected = status === 'connected';
  const bound = summary ? devices.some((device) => device.id === summary.deviceId) : devices.length > 0;
  const activeDeviceBound = Boolean(
    summary?.deviceId && devices.some((device) => device.id === summary.deviceId),
  );
  const previousBoundRef = useRef(activeDeviceBound);
  const connectionLabel = connected
    ? deviceName || '智慧水杯'
    : status === 'scanning'
      ? '搜尋裝置中'
      : status === 'connecting'
        ? '建立連線中'
        : '尚未連線';

  useEffect(() => {
    const wasBound = previousBoundRef.current;
    previousBoundRef.current = activeDeviceBound;

    // If the cup was already connected when the account binding completed,
    // retry the history sync immediately instead of requiring another click.
    if (!connected || !summary?.deviceId || !activeDeviceBound || wasBound) return;

    syncHistory()
      .then(() => showToast('裝置已綁定，歷史事件已同步並完成 ACK。', 'success'))
      .catch((error: any) => {
        showToast(`裝置已綁定，但歷史同步未完成：${error?.message || '請稍後重試'}`, 'error');
      });
  }, [activeDeviceBound, connected, showToast, summary?.deviceId, syncHistory]);

  return (
    <div className="view-container device-center-view">
      <header className="device-center-hero">
        <div className="device-center-hero__copy">
          <span className="device-center-eyebrow">HARDWARE / CLOUD CONTROL</span>
          <h2>
            <Cpu aria-hidden="true" />
            裝置中心
          </h2>
          <p>
            一個地方管理水杯的即時連線、歷史同步與雲端綁定。先連上實體水杯，再完成帳號綁定，後續資料就會自動同步。
          </p>
        </div>

        <div className="device-center-hero__status" aria-label="目前裝置狀態">
          <div className={`device-center-status-chip ${connected ? 'is-connected' : ''}`}>
            <span className="device-center-status-dot" aria-hidden="true" />
            <span>
              <small>藍牙連線</small>
              <strong>{connectionLabel}</strong>
            </span>
          </div>
          <div className={`device-center-status-chip ${bound ? 'is-connected' : ''}`}>
            <span className="device-center-status-icon" aria-hidden="true">
              {bound ? <Check size={14} /> : <Cloud size={15} />}
            </span>
            <span>
              <small>雲端狀態</small>
              <strong>{bound ? '已完成綁定' : '尚未綁定'}</strong>
            </span>
          </div>
        </div>
      </header>

      <div className="device-center-flow" aria-label="裝置設定流程">
        <button type="button" className="device-center-flow__step is-active" onClick={() => scrollToSection('device-bluetooth-control')}>
          <span className="device-center-flow__number">01</span>
          <span>
            <strong>藍牙控制</strong>
            <small>連線、讀重、同步歷史</small>
          </span>
          <Bluetooth size={18} aria-hidden="true" />
        </button>
        <ChevronDown className="device-center-flow__arrow" size={18} aria-hidden="true" />
        <button type="button" className={`device-center-flow__step ${bound ? 'is-complete' : ''}`} onClick={() => scrollToSection('device-cloud-management')}>
          <span className="device-center-flow__number">02</span>
          <span>
            <strong>雲端管理</strong>
            <small>{bound ? '帳號已綁定，可持續同步' : '將水杯綁定到你的帳號'}</small>
          </span>
          <Link2 size={18} aria-hidden="true" />
        </button>
      </div>

      {connected && summary && !bound && (
        <div className="device-center-callout" role="status">
          <div className="device-center-callout__icon">
            <RadioTower size={18} aria-hidden="true" />
          </div>
          <div>
            <strong>水杯已連線，下一步完成雲端綁定</strong>
            <p>目前裝置 ID：<code>{summary.deviceId}</code>。完成綁定後，若水杯仍保持連線，系統會自動同步待處理事件。</p>
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => scrollToSection('device-cloud-management')}>
            前往綁定
          </button>
        </div>
      )}

      <section id="device-bluetooth-control" className="device-center-panel" aria-labelledby="device-bluetooth-title">
        <div className="device-center-panel__heading">
          <div className="device-center-panel__index">01</div>
          <div>
            <span className="device-center-panel__eyebrow">DIRECT CONNECTION</span>
            <h3 id="device-bluetooth-title">藍牙即時控制</h3>
            <p>直連 ESP32 水杯，查看重量、執行硬體操作，並安全重送歷史事件。</p>
          </div>
        </div>
        <BleDeviceView showToast={showToast} embedded />
      </section>

      <section id="device-cloud-management" className="device-center-panel" aria-labelledby="device-cloud-title">
        <div className="device-center-panel__heading">
          <div className="device-center-panel__index">02</div>
          <div>
            <span className="device-center-panel__eyebrow">ACCOUNT OWNERSHIP</span>
            <h3 id="device-cloud-title">雲端綁定管理</h3>
            <p>管理已綁定水杯、Device Token，以及安全轉讓裝置擁有權。</p>
          </div>
        </div>
        <DevicesView showToast={showToast} embedded />
      </section>
    </div>
  );
};
