import React, { useState } from 'react';
import { WaterDropMark } from '../components/WaterDropMark';
import { useAuth } from '../contexts/AuthContext';

interface AuthViewProps {
  onSuccess?: () => void;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export const AuthView: React.FC<AuthViewProps> = ({ showToast }) => {
  const { login, register, isLoading } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (mode === 'login') {
        await login(username, password);
        showToast('登入成功！', 'success');
      } else {
        await register(username, password, displayName || undefined);
        showToast('註冊並登入成功！', 'success');
      }
    } catch (err: any) {
      showToast(err.message || '操作失敗', 'error');
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <WaterDropMark className="auth-brand-mark" title="智慧喝水追蹤器" />
          <h2>智慧喝水追蹤器</h2>
          <p className="auth-subtitle">追蹤您的每日健康飲水量與智慧水杯連線</p>
        </div>

        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab ${mode === 'login' ? 'active' : ''}`}
            onClick={() => setMode('login')}
          >
            登入帳號
          </button>
          <button
            type="button"
            className={`auth-tab ${mode === 'register' ? 'active' : ''}`}
            onClick={() => setMode('register')}
          >
            註冊新帳號
          </button>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {mode === 'register' && (
            <div className="form-group">
              <label>顯示名稱 (選填)</label>
              <input
                type="text"
                placeholder="例如: 小水滴"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="input-field"
              />
            </div>
          )}

          <div className="form-group">
            <label htmlFor="auth-username">帳號</label>
            <input
              id="auth-username"
              type="text"
              placeholder="例如：vince_water"
              required
              minLength={3}
              maxLength={32}
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="input-field"
            />
          </div>

          <div className="form-group">
            <label>密碼</label>
            <input
              type="password"
              placeholder="••••••••"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field"
            />
          </div>

          <button type="submit" disabled={isLoading} className="btn btn-primary btn-block">
            {isLoading ? '處理中...' : mode === 'login' ? '立即登入' : '建立帳號'}
          </button>
        </form>
      </div>
    </div>
  );
};
