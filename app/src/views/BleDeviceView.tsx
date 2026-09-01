import React, { useState } from 'react';
import {
  AlertTriangle,
  Bluetooth,
  Clock3,
  Download,
  Droplets,
  FlaskConical,
  GlassWater,
  KeyRound,
  LoaderCircle,
  Radio,
  RefreshCcw,
  Scale,
  Search,
  Unplug,
  Wifi,
} from 'lucide-react';
import { useBle } from '../contexts/BleContext';

interface BleDeviceViewProps {
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  embedded?: boolean;
}

export const BleDeviceView: React.FC<BleDeviceViewProps> = ({ showToast, embedded = false }) => {
  const {
    status,
    deviceName,
    summary,
    liveEvents,
    isMockMode,
    isSupported,
    setMockMode,
    connect,
    disconnect,
    tare,
    resetDaily,
    syncTime,
    rotateClaim,
    configureWifi,
    clearWifi,
    syncHistory,
    simulateDrink,
    simulateRefill,
  } = useBle();

  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPass, setWifiPass] = useState('');
  const [apiUrl, setApiUrl] = useState('http://192.168.1.100:3000');
  const [devToken, setDevToken] = useState('');
  const [showWifiModal, setShowWifiModal] = useState(false);
  const [simAmount, setSimAmount] = useState(250);

  const handleConnect = async () => {
    try {
      await connect();
      showToast('藍牙連線成功！', 'success');
    } catch (err: any) {
      showToast(err.message || '藍牙連線失敗', 'error');
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect();
      showToast('已中斷藍牙連線', 'info');
    } catch (err: any) {
      showToast(err.message || '中斷連線失敗', 'error');
    }
  };

  const handleTare = async () => {
    try {
      const res = await tare();
      if (res.success) {
        showToast(`去皮完成！當前重量: ${res.currentWeight?.toFixed(1) ?? 0}g`, 'success');
      } else {
        showToast('去皮失敗', 'error');
      }
    } catch (err: any) {
      showToast(err.message || '執行去皮失敗', 'error');
    }
  };

  const handleResetDaily = async () => {
    if (!window.confirm('確定要將裝置上的今日累積喝水量歸零重設嗎？')) return;
    try {
      const res = await resetDaily();
      if (res.success) {
        showToast('裝置今日飲水量已歸零！', 'success');
      }
    } catch (err: any) {
      showToast(err.message || '重設失敗', 'error');
    }
  };

  const handleSyncTime = async () => {
    try {
      const res = await syncTime();
      if (res.success) {
        showToast('硬體時鐘校時成功！', 'success');
      }
    } catch (err: any) {
      showToast(err.message || '校時失敗', 'error');
    }
  };

  const handleRotateClaim = async () => {
    if (!window.confirm('確定要輪替硬體認領金鑰嗎？這將產生新的硬體密鑰供轉讓或重新認領使用。')) return;
    try {
      const res = await rotateClaim();
      if (res.success) {
        showToast(`新認領金鑰: ${res.claimSecret}`, 'success');
      } else {
        showToast(res.error || '金鑰輪替失敗', 'error');
      }
    } catch (err: any) {
      showToast(err.message || '金鑰輪替失敗', 'error');
    }
  };

  const handleSyncHistory = async () => {
    try {
      showToast('開始從硬體拉取未同步歷史事件...', 'info');
      await syncHistory();
      showToast('歷史紀錄重送與同步完成！', 'success');
    } catch (err: any) {
      showToast(err.message || '歷史同步失敗', 'error');
    }
  };

  const handleConfigureWifiSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await configureWifi(wifiSsid, wifiPass, apiUrl, devToken);
      if (res.success) {
        showToast(`已發送 WiFi 設定至 ESP32 (SSID: ${wifiSsid})`, 'success');
        setShowWifiModal(false);
      } else {
        showToast('WiFi 設定寫入失敗', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'WiFi 設定失敗', 'error');
    }
  };

  const handleClearWifi = async () => {
    if (!window.confirm('確定要清除 ESP32 的 WiFi 儲存設定嗎？')) return;
    try {
      const res = await clearWifi();
      if (res.success) {
        showToast('已清除 ESP32 的 WiFi 設定', 'success');
      }
    } catch (err: any) {
      showToast(err.message || '清除失敗', 'error');
    }
  };

  return (
    <div className={`view-container ble-view ${embedded ? 'device-center-section' : ''}`}>
      <div className="section-header">
        <div>
          <h2 className="title-with-icon">
            <Bluetooth aria-hidden="true" />
            藍牙智慧水杯控制面板
          </h2>
          <p className="subtitle">
            支援 Web Bluetooth API 直連 ESP32-C3 稱重模組，可即時去皮、校時、轉讓金鑰與配網。
          </p>
        </div>

        <div className="mode-toggle-box">
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={isMockMode}
              onChange={(e) => setMockMode(e.target.checked)}
            />
            <span className="title-with-icon">
              <FlaskConical aria-hidden="true" />
              模擬硬體模式 (Simulated Hardware)
            </span>
          </label>
        </div>
      </div>

      {!isSupported && !isMockMode && (
        <div className="alert alert-warning title-with-icon">
          <AlertTriangle aria-hidden="true" />
          <span>
            您的瀏覽器不支援 Web Bluetooth API，建議使用 Chrome 或 Edge 瀏覽器，或勾選右上角「模擬硬體模式」進行功能測試。
          </span>
        </div>
      )}

      {/* Connection & Status Card */}
      <div className="grid grid-2">
        <div className="card">
          <div className="card-header">
            <h3>連線狀態</h3>
            <span className={`badge ${status === 'connected' ? 'badge-success' : 'badge-muted'}`}>
              {status === 'connected' ? `已連線: ${deviceName || 'ESP32'}` : '未連線'}
            </span>
          </div>

          <div className="connection-control-box">
            {status !== 'connected' ? (
              <button
                className="btn btn-primary btn-block"
                disabled={status === 'scanning' || status === 'connecting'}
                onClick={handleConnect}
              >
                {status === 'scanning' || status === 'connecting' ? (
                  <LoaderCircle className="icon-spin" aria-hidden="true" />
                ) : (
                  <Search aria-hidden="true" />
                )}
                {status === 'scanning'
                  ? '搜尋 ESP32 裝置中...'
                  : status === 'connecting'
                    ? '建立 GATT 連線中...'
                    : '掃描並連線智慧水杯 (WaterTracker)'}
              </button>
            ) : (
              <button className="btn btn-danger btn-block" onClick={handleDisconnect}>
                <Unplug aria-hidden="true" />
                中斷藍牙連線
              </button>
            )}
          </div>

          {/* Device Summary Info */}
          {summary && (
            <div className="summary-details-grid">
              <div className="detail-row">
                <span className="label">裝置 ID:</span>
                <span className="val font-mono">{summary.deviceId}</span>
              </div>
              <div className="detail-row">
                <span className="label">目前讀數重量:</span>
                <span className="val font-bold">{summary.currentWeight.toFixed(1)} g</span>
              </div>
              <div className="detail-row">
                <span className="label">秤盤穩定度:</span>
                <span
                  className={`val status-inline ${
                    summary.isStable ? 'status-inline--success' : 'status-inline--warning'
                  }`}
                >
                  <span className="status-inline__dot" aria-hidden="true" />
                  {summary.isStable ? '穩定' : '晃動中'}
                </span>
              </div>
              <div className="detail-row">
                <span className="label">今日累計飲水:</span>
                <span className="val">{summary.todayTotalMl} / {summary.dailyGoalMl} ml</span>
              </div>
              <div className="detail-row">
                <span className="label">硬體時鐘狀態:</span>
                <span
                  className={`val status-inline ${
                    summary.timeSynced ? 'status-inline--success' : 'status-inline--danger'
                  }`}
                >
                  <span className="status-inline__dot" aria-hidden="true" />
                  {summary.timeSynced ? '已校時' : '未校時'}
                </span>
              </div>
              <div className="detail-row">
                <span className="label">硬體認領金鑰:</span>
                <span className="val font-mono">{summary.claimSecret || '(無)'}</span>
              </div>
              <div className="detail-row">
                <span className="label">WiFi 狀態:</span>
                <span
                  className={`val status-inline ${
                    summary.wifiConnected
                      ? 'status-inline--success'
                      : summary.wifiConfigured
                        ? 'status-inline--warning'
                        : 'status-inline--muted'
                  }`}
                >
                  <span className="status-inline__dot" aria-hidden="true" />
                  {summary.wifiConnected
                    ? `已連線 (${summary.ssid || 'WiFi'}, IP: ${summary.ip})`
                    : summary.wifiConfigured
                      ? '已配網未連線'
                      : '未設定'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Hardware Control Commands Card */}
        <div className="card">
          <div className="card-header">
            <h3>硬體指令控制</h3>
          </div>

          <div className="command-grid">
            <button
              className="btn btn-secondary"
              disabled={status !== 'connected'}
              onClick={handleTare}
            >
              <Scale aria-hidden="true" />
              去皮歸零 (Tare)
            </button>

            <button
              className="btn btn-secondary"
              disabled={status !== 'connected'}
              onClick={handleSyncTime}
            >
              <Clock3 aria-hidden="true" />
              立即校時 (Set Time)
            </button>

            <button
              className="btn btn-secondary"
              disabled={status !== 'connected'}
              onClick={handleResetDaily}
            >
              <RefreshCcw aria-hidden="true" />
              重設今日喝水 (Reset)
            </button>

            <button
              className="btn btn-secondary"
              disabled={status !== 'connected'}
              onClick={handleRotateClaim}
            >
              <KeyRound aria-hidden="true" />
              輪替金鑰 (Rotate Claim)
            </button>

            <button
              className="btn btn-secondary"
              disabled={status !== 'connected'}
              onClick={handleSyncHistory}
            >
              <Download aria-hidden="true" />
              歷史事件重送 (History Sync)
            </button>

            <button
              className="btn btn-secondary"
              disabled={status !== 'connected'}
              onClick={() => setShowWifiModal(!showWifiModal)}
            >
              <Wifi aria-hidden="true" />
              WiFi 輔助配網...
            </button>
          </div>

          {/* Simulated Event Trigger */}
          {isMockMode && (
            <div className="mock-controls-section">
              <h4 className="title-with-icon">
                <FlaskConical aria-hidden="true" />
                模擬硬體事件發送
              </h4>
              <div className="form-row">
                <input
                  type="number"
                  min="10"
                  max="1000"
                  value={simAmount}
                  onChange={(e) => setSimAmount(Number(e.target.value))}
                  className="input-field"
                  placeholder="水量 ml"
                />
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => simulateDrink(simAmount)}
                >
                  <GlassWater aria-hidden="true" />
                  模擬喝水
                </button>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => simulateRefill(simAmount)}
                >
                  <Droplets aria-hidden="true" />
                  模擬加水
                </button>
              </div>
            </div>
          )}

          {/* WiFi Config Form Modal / Inline Box */}
          {showWifiModal && (
            <form onSubmit={handleConfigureWifiSubmit} className="wifi-config-form">
              <h4 className="title-with-icon">
                <Wifi aria-hidden="true" />
                透過 BLE 配置 ESP32 WiFi 與雲端
              </h4>
              <div className="form-group">
                <label>WiFi SSID (2.4GHz)</label>
                <input
                  type="text"
                  required
                  value={wifiSsid}
                  onChange={(e) => setWifiSsid(e.target.value)}
                  className="input-field"
                  placeholder="Home_WiFi"
                />
              </div>
              <div className="form-group">
                <label>WiFi 密碼</label>
                <input
                  type="password"
                  value={wifiPass}
                  onChange={(e) => setWifiPass(e.target.value)}
                  className="input-field"
                  placeholder="密碼"
                />
              </div>
              <div className="form-group">
                <label>後端 API 網址</label>
                <input
                  type="text"
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  className="input-field"
                />
              </div>
              <div className="form-group">
                <label>裝置憑證 (Device Token)</label>
                <input
                  type="text"
                  value={devToken}
                  onChange={(e) => setDevToken(e.target.value)}
                  className="input-field"
                  placeholder="dvt_..."
                />
              </div>
              <div className="form-row">
                <button type="submit" className="btn btn-primary">
                  發送配網設定
                </button>
                <button type="button" className="btn btn-danger" onClick={handleClearWifi}>
                  清除 WiFi
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowWifiModal(false)}
                >
                  關閉
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Live Event Stream Table */}
      <div className="card" style={{ marginTop: '1.5rem' }}>
        <div className="card-header">
          <h3 className="title-with-icon">
            <Radio aria-hidden="true" />
            即時藍牙事件串流 (Live Events)
          </h3>
          <span className="text-muted" style={{ fontSize: '0.85rem' }}>
            已自動寫入離線佇列並同步至雲端後端
          </span>
        </div>

        {liveEvents.length === 0 ? (
          <p className="text-muted" style={{ padding: '1rem', textAlign: 'center' }}>
            尚未收到任何藍牙事件通知
          </p>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>事件識別碼 (Event ID)</th>
                  <th>時間 (Occurred At)</th>
                  <th>類型</th>
                  <th>水量變化</th>
                  <th>杯內剩餘</th>
                  <th>今日累計</th>
                </tr>
              </thead>
              <tbody>
                {liveEvents.map((ev) => (
                  <tr key={ev.eventId}>
                    <td className="font-mono">{ev.eventId}</td>
                    <td>
                      {ev.occurredAt > 0
                        ? new Date(ev.occurredAt * 1000).toLocaleTimeString()
                        : '(未校時時間)'}
                    </td>
                    <td>
                      <span
                        className={`badge badge-with-icon ${
                          ev.type === 'drink' ? 'badge-primary' : 'badge-success'
                        }`}
                      >
                        {ev.type === 'drink' ? (
                          <GlassWater aria-hidden="true" />
                        ) : (
                          <Droplets aria-hidden="true" />
                        )}
                        {ev.type === 'drink' ? '喝水' : '補水'}
                      </span>
                    </td>
                    <td className="font-semibold">+{ev.amountMl} ml</td>
                    <td>{ev.remainingMl} ml</td>
                    <td>{ev.todayTotalMl} ml</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
