import React, { useState } from 'react';
import {
  Archive,
  Cloud,
  LoaderCircle,
  LogOut,
  RefreshCw,
  Settings,
  Target,
  Trash2,
  User as UserIcon,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useWater } from '../contexts/WaterContext';
import { offlineQueue } from '../services/sync/offlineQueue';
import { apiClient } from '../services/api/apiClient';

interface SettingsViewProps {
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ showToast }) => {
  const { user, updateDailyGoal, logout } = useAuth();
  const { syncStatus, triggerSync, refreshAll } = useWater();

  const [goalInput, setGoalInput] = useState(user?.dailyGoalMl ?? 2000);
  const [apiBaseUrl, setApiBaseUrl] = useState(apiClient.getBaseUrl());
  const [queuedItems, setQueuedItems] = useState(offlineQueue.getAll());

  const handleUpdateGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (goalInput <= 0) return;
    try {
      await updateDailyGoal(goalInput);
      await refreshAll();
      showToast('每日目標更新成功！', 'success');
    } catch (err: any) {
      showToast(err.message || '更新目標失敗', 'error');
    }
  };

  const handleUpdateApiUrl = (e: React.FormEvent) => {
    e.preventDefault();
    apiClient.setBaseUrl(apiBaseUrl);
    showToast(`後端 API 網址已更新為: ${apiBaseUrl}`, 'success');
  };

  const handleTriggerSync = async () => {
    try {
      showToast('正在將離線事件同步至雲端...', 'info');
      await triggerSync();
      setQueuedItems(offlineQueue.getAll());
      showToast('離線同步完成！', 'success');
    } catch (err: any) {
      showToast(err.message || '同步失敗', 'error');
    }
  };

  const handleClearQueue = () => {
    if (!window.confirm('確定要清空本地所有未同步的離線喝水事件嗎？')) return;
    offlineQueue.clear();
    setQueuedItems([]);
    showToast('離線佇列已清空', 'info');
  };

  return (
    <div className="view-container settings-view">
      <div className="section-header">
        <div>
          <h2 className="title-with-icon">
            <Settings aria-hidden="true" />
            偏好與離線同步設定
          </h2>
          <p className="subtitle">管理您的每日飲水目標、後端服務設定與離線快取佇列。</p>
        </div>
      </div>

      <div className="grid grid-2">
        {/* Profile & Goals Card */}
        <div className="card">
          <div className="card-header">
            <h3 className="title-with-icon">
              <Target aria-hidden="true" />
              每日目標設定
            </h3>
          </div>

          <form onSubmit={handleUpdateGoal} className="settings-form">
            <div className="form-group">
              <label>每日喝水目標 (ml)</label>
              <input
                type="number"
                min="500"
                max="10000"
                step="50"
                value={goalInput}
                onChange={(e) => setGoalInput(Number(e.target.value))}
                className="input-field"
              />
              <p className="form-hint">衛福部建議成人每日飲水量約為 2000 ~ 2500 ml。</p>
            </div>

            <button type="submit" className="btn btn-primary">
              儲存目標
            </button>
          </form>

          <hr style={{ margin: '1.5rem 0', borderColor: 'var(--color-border)' }} />

          <div className="card-header">
            <h3 className="title-with-icon">
              <Cloud aria-hidden="true" />
              後端 API 端點設定
            </h3>
          </div>

          <form onSubmit={handleUpdateApiUrl} className="settings-form">
            <div className="form-group">
              <label>API Base URL</label>
              <input
                type="text"
                value={apiBaseUrl}
                onChange={(e) => setApiBaseUrl(e.target.value)}
                className="input-field"
              />
              <p className="form-hint">預設為 <code>/api/v1</code>（透過 Vite 代理至後端）。</p>
            </div>

            <button type="submit" className="btn btn-secondary">
              更新 API 端點
            </button>
          </form>

          <hr style={{ margin: '1.5rem 0', borderColor: 'var(--color-border)' }} />

          <div className="card-header">
            <h3 className="title-with-icon">
              <UserIcon aria-hidden="true" />
              帳號資訊
            </h3>
          </div>

          <div className="detail-row">
            <span className="label">帳號:</span>
            <span className="val font-mono">{user?.username || user?.email || '已登入'}</span>
          </div>
          {user?.displayName && (
            <div className="detail-row">
              <span className="label">暱稱:</span>
              <span className="val">{user.displayName}</span>
            </div>
          )}

          <div style={{ marginTop: '1.25rem' }}>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => {
                if (window.confirm('確定要登出當前帳號嗎？')) {
                  logout();
                  showToast('已成功登出', 'info');
                }
              }}
            >
              <LogOut aria-hidden="true" />
              登出帳號
            </button>
          </div>
        </div>

        {/* Offline Queue Inspector Card */}
        <div className="card">
          <div className="card-header">
            <h3 className="title-with-icon">
              <Archive aria-hidden="true" />
              離線事件同步佇列 (Offline Sync Queue)
            </h3>
            <span className={`badge ${syncStatus.pendingCount > 0 ? 'badge-warning' : 'badge-success'}`}>
              {syncStatus.pendingCount} 筆待同步
            </span>
          </div>

          <p className="form-hint" style={{ marginBottom: '1rem' }}>
            當您透過 BLE 接收喝水事件但網路中斷時，事件會安全暫存於本地 LocalStorage，並在網路恢復時自動重傳至後端。
          </p>

          <div className="queue-status-box">
            <div className="detail-row">
              <span className="label">同步引擎狀態:</span>
              <span
                className={`val status-inline ${
                  syncStatus.isSyncing ? 'status-inline--warning' : 'status-inline--success'
                }`}
              >
                {syncStatus.isSyncing ? (
                  <LoaderCircle className="icon-spin" aria-hidden="true" />
                ) : (
                  <span className="status-inline__dot" aria-hidden="true" />
                )}
                {syncStatus.isSyncing ? '同步中...' : '待命 (Idle)'}
              </span>
            </div>
            <div className="detail-row">
              <span className="label">上次同步時間:</span>
              <span className="val">
                {syncStatus.lastSyncAt ? new Date(syncStatus.lastSyncAt).toLocaleTimeString() : '尚未同步'}
              </span>
            </div>
            {syncStatus.lastError && (
              <div className="detail-row text-danger">
                <span className="label">上次同步錯誤:</span>
                <span className="val">{syncStatus.lastError}</span>
              </div>
            )}
          </div>

          <div className="form-row" style={{ marginTop: '1rem' }}>
            <button
              className="btn btn-primary"
              disabled={syncStatus.isSyncing || queuedItems.length === 0}
              onClick={handleTriggerSync}
            >
              <RefreshCw className={syncStatus.isSyncing ? 'icon-spin' : undefined} aria-hidden="true" />
              立即手動同步
            </button>
            <button
              className="btn btn-danger"
              disabled={queuedItems.length === 0}
              onClick={handleClearQueue}
            >
              <Trash2 aria-hidden="true" />
              清空佇列
            </button>
          </div>

          {/* Queued Records List */}
          <div style={{ marginTop: '1.25rem' }}>
            <h4>佇列中事件清單 ({queuedItems.length})</h4>
            {queuedItems.length === 0 ? (
              <p className="text-muted" style={{ padding: '0.5rem 0', fontSize: '0.85rem' }}>
                目前離線佇列為空，所有事件皆已同步至雲端。
              </p>
            ) : (
              <div className="table-responsive" style={{ maxHeight: '220px', overflowY: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Event ID</th>
                      <th>類型</th>
                      <th>水量</th>
                      <th>重試次數</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queuedItems.map((item) => (
                      <tr key={item.clientQueueId}>
                        <td className="font-mono text-muted">{item.payload.eventId || '手動事件'}</td>
                        <td>{item.payload.eventType}</td>
                        <td>+{item.payload.amountMl} ml</td>
                        <td>{item.retryCount} 次</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
