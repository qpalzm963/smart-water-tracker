import React, { useEffect, useState } from 'react';
import {
  ArrowLeftRight,
  CircleCheck,
  Clipboard,
  Cpu,
  LockKeyhole,
  Plus,
  RefreshCw,
  RotateCw,
  Trash2,
  X,
} from 'lucide-react';
import { useDevices } from '../contexts/DeviceContext';
import { useBle } from '../contexts/BleContext';

interface DevicesViewProps {
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  embedded?: boolean;
}

export const DevicesView: React.FC<DevicesViewProps> = ({ showToast, embedded = false }) => {
  const {
    devices,
    isLoading,
    newlyBoundToken,
    setNewlyBoundToken,
    bindDevice,
    unbindDevice,
    rotateToken,
    refreshDevices,
  } = useDevices();
  const { summary } = useBle();

  const [mode, setMode] = useState<'bind' | 'transfer'>('bind');
  const [deviceId, setDeviceId] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [claimCode, setClaimCode] = useState('');
  const [newClaimCode, setNewClaimCode] = useState('');
  const [showBindForm, setShowBindForm] = useState(true);
  const activeDeviceId = summary?.deviceId || '';
  const activeDeviceIsBound = Boolean(
    activeDeviceId && devices.some((device) => device.id === activeDeviceId),
  );

  useEffect(() => {
    if (activeDeviceIsBound) {
      setShowBindForm(false);
      return;
    }

    // When the connected cup is not bound yet, use the ID reported by BLE so
    // users do not accidentally bind a shortened or unrelated ID.
    if (activeDeviceId && !deviceId.trim()) {
      setDeviceId(activeDeviceId);
    }
  }, [activeDeviceId, activeDeviceIsBound, deviceId]);

  const handleBindSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (mode === 'bind') {
        await bindDevice({
          id: deviceId.trim(),
          name: deviceName.trim() || undefined,
          claimCode: claimCode.trim() || undefined,
        });
        showToast(`已成功綁定裝置 ${deviceId}！`, 'success');
      } else {
        await bindDevice({
          id: deviceId.trim(),
          name: deviceName.trim() || undefined,
          claimCode: claimCode.trim(),
          newClaimCode: newClaimCode.trim(),
        });
        showToast(`已成功轉讓並綁定裝置 ${deviceId}！`, 'success');
      }

      setDeviceId('');
      setDeviceName('');
      setClaimCode('');
      setNewClaimCode('');
    } catch (err: any) {
      showToast(err.message || '綁定或轉讓失敗', 'error');
    }
  };

  const handleUnbind = async (id: string) => {
    if (!window.confirm(`確定要解除綁定裝置 ${id} 嗎？此操作將註銷該裝置目前的 Device Token。`)) return;
    try {
      await unbindDevice(id);
      showToast(`已解除綁定裝置 ${id}`, 'info');
    } catch (err: any) {
      showToast(err.message || '解除綁定失敗', 'error');
    }
  };

  const handleRotateToken = async (id: string) => {
    if (!window.confirm(`確定要為裝置 ${id} 重新生成 Device Token 嗎？舊 Token 將立即失效。`)) return;
    try {
      const newToken = await rotateToken(id);
      showToast(`已生成新 Token: ${newToken}`, 'success');
    } catch (err: any) {
      showToast(err.message || '輪替 Token 失敗', 'error');
    }
  };

  const copyToken = (text: string) => {
    navigator.clipboard.writeText(text);
    showToast('已複製 Token 至剪貼簿！', 'success');
  };

  return (
    <div className={`view-container devices-view ${embedded ? 'device-center-section' : ''}`}>
      <div className="section-header">
        <div>
          <h2 className="title-with-icon">
            <Cpu aria-hidden="true" />
            智慧水杯裝置管理
          </h2>
          <p className="subtitle">管理您帳號下綁定的 ESP32-C3 裝置憑證與轉讓金鑰。</p>
        </div>

        <div className="header-actions">
          <button className="btn btn-secondary" onClick={() => refreshDevices()} disabled={isLoading}>
            <RefreshCw className={isLoading ? 'icon-spin' : undefined} aria-hidden="true" />
            重新整理
          </button>
        </div>
      </div>

      {/* Newly Issued Token Display Banner */}
      {newlyBoundToken && (
        <div className="token-banner">
          <div className="token-banner-header">
            <h4 className="title-with-icon">
              <CircleCheck aria-hidden="true" />
              裝置憑證已簽發 (Device Token)
            </h4>
            <button
              className="btn-close"
              onClick={() => setNewlyBoundToken(null)}
              aria-label="關閉裝置憑證提示"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <p className="token-hint">
            請將此 Token 寫入 ESP32 韌體配置或透過 BLE 配網指令發送至硬體：
          </p>
          <div className="token-code-row">
            <code className="token-code">{newlyBoundToken}</code>
            <button className="btn btn-primary btn-sm" onClick={() => copyToken(newlyBoundToken)}>
              <Clipboard aria-hidden="true" />
              複製 Token
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-2">
        {/* Bound Devices List */}
        <div className="card">
          <div className="card-header">
            <h3>已綁定裝置列表 ({devices.length})</h3>
          </div>

          {devices.length === 0 ? (
            <div className="empty-state-box">
              <p>您尚未綁定任何智慧水杯裝置</p>
            </div>
          ) : (
            <div className="devices-list">
              {devices.map((d) => (
                <div key={d.id} className="device-item-card">
                  <div className="device-item-header">
                    <div className="device-name-row">
                      <span className={`status-dot ${d.isOnline ? 'dot-online' : 'dot-offline'}`} />
                      <span className="device-title">{d.name || d.id}</span>
                    </div>
                    <span
                      className={`badge status-inline ${
                        d.isOnline ? 'badge-success status-inline--success' : 'badge-muted status-inline--muted'
                      }`}
                    >
                      <span className="status-inline__dot" aria-hidden="true" />
                      {d.isOnline ? '線上' : '離線'}
                    </span>
                  </div>

                  <div className="device-item-body">
                    <div className="detail-row">
                      <span className="label">硬體 ID:</span>
                      <span className="val font-mono">{d.id}</span>
                    </div>
                    <div className="detail-row">
                      <span className="label">最後活躍時間:</span>
                      <span className="val">
                        {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : '從未連線'}
                      </span>
                    </div>
                    <div className="detail-row">
                      <span className="label">硬體配對密鑰:</span>
                      <span className="val title-with-icon">
                        {d.hasClaimCode && <LockKeyhole aria-hidden="true" />}
                        {d.hasClaimCode ? '已設定' : '無'}
                      </span>
                    </div>
                  </div>

                  <div className="device-item-actions">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleRotateToken(d.id)}
                      title="重置此裝置的 Token"
                    >
                      <RotateCw aria-hidden="true" />
                      輪替 Token
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => handleUnbind(d.id)}
                    >
                      <Trash2 aria-hidden="true" />
                      解除綁定
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bind / Transfer Device Form Card */}
        <div className="card device-binding-card">
          <div className="card-header">
            <h3 className="title-with-icon">
              {mode === 'bind' ? <Plus aria-hidden="true" /> : <ArrowLeftRight aria-hidden="true" />}
              {activeDeviceIsBound
                ? '目前裝置已綁定'
                : devices.length > 0
                  ? mode === 'bind' ? '綁定另一個水杯' : '轉讓裝置擁有權'
                  : mode === 'bind' ? '綁定新水杯' : '轉讓裝置擁有權'}
            </h3>
            {devices.length > 0 && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setShowBindForm((visible) => !visible)}
                aria-expanded={showBindForm}
              >
                {showBindForm ? '收起' : '新增水杯'}
              </button>
            )}
          </div>

          {!showBindForm ? (
            <div className="empty-state-box">
              {activeDeviceIsBound ? (
                <>
                  <p>目前連線的水杯已經綁定，不需要再次綁定。</p>
                  <p className="form-hint">
                    若要管理這個水杯，請使用左側清單；右上角「新增水杯」只用來加入其他裝置。
                  </p>
                </>
              ) : (
                <p>已有綁定裝置。若要加入另一個水杯，請按右上角「新增水杯」。</p>
              )}
            </div>
          ) : (
            <>
              {activeDeviceId && (
                <div className="form-hint" style={{ marginBottom: '1rem' }}>
                  目前 BLE 裝置 ID：<code>{activeDeviceId}</code>
                  {activeDeviceIsBound ? '（已綁定）' : '（尚未綁定，已自動帶入）'}
                </div>
              )}

              <div className="auth-tabs" style={{ marginBottom: '1rem' }}>
            <button
              className={`auth-tab ${mode === 'bind' ? 'active' : ''}`}
              onClick={() => setMode('bind')}
            >
              首次/一般綁定
            </button>
            <button
              className={`auth-tab ${mode === 'transfer' ? 'active' : ''}`}
              onClick={() => setMode('transfer')}
            >
              安全轉讓 (雙階段)
            </button>
              </div>

              <form onSubmit={handleBindSubmit} className="bind-device-form">
            <div className="form-group">
              <label>裝置 ID (ESP32 MAC，例如: water_a1b2c3d4)</label>
              <input
                type="text"
                required
                placeholder="water_xxxx"
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
                className="input-field"
              />
            </div>

            <div className="form-group">
              <label>自訂水杯名稱 (選填)</label>
              <input
                type="text"
                placeholder="例如: 辦公桌水杯"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                className="input-field"
              />
            </div>

            {mode === 'bind' ? (
              <div className="form-group">
                <label>硬體配對金鑰 (Claim Code，選填)</label>
                <input
                  type="text"
                  placeholder="由 BLE 讀取的 16 位金鑰"
                  value={claimCode}
                  onChange={(e) => setClaimCode(e.target.value)}
                  className="input-field"
                />
                <p className="form-hint">若硬體尚未被任何人認領，可留空或填入硬體初始金鑰。</p>
              </div>
            ) : (
              <>
                <div className="form-group">
                  <label>目前硬體配對金鑰 (Old Claim Code)</label>
                  <input
                    type="text"
                    required
                    placeholder="轉讓前由 BLE 讀取的目前金鑰"
                    value={claimCode}
                    onChange={(e) => setClaimCode(e.target.value)}
                    className="input-field"
                  />
                </div>

                <div className="form-group">
                  <label>新硬體配對金鑰 (New Claim Code)</label>
                  <input
                    type="text"
                    required
                    placeholder="在 BLE 執行 rotate_claim 後取得的新金鑰"
                    value={newClaimCode}
                    onChange={(e) => setNewClaimCode(e.target.value)}
                    className="input-field"
                  />
                  <p className="form-hint">
                    雙階段轉讓安全協議：必須持有實體水杯，先在 BLE 執行金鑰輪替，再同時提交新舊金鑰完成轉讓。
                  </p>
                </div>
              </>
            )}

            <button type="submit" className="btn btn-primary btn-block">
              {mode === 'bind' ? '確認綁定裝置' : '驗證金鑰並轉讓擁有權'}
            </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
