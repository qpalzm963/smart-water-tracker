import React from 'react';
import {
  ChartNoAxesColumnIncreasing,
  Cloud,
  CloudUpload,
  Cpu,
  History,
  House,
  LogOut,
  LucideIcon,
  Settings,
  User,
} from 'lucide-react';
import { ActiveTab } from './Navbar';
import { useAuth } from '../contexts/AuthContext';
import { useWater } from '../contexts/WaterContext';

interface DesktopSidebarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  onTriggerSync: () => void;
}

interface SidebarItem {
  id: ActiveTab;
  label: string;
  subLabel?: string;
  icon: LucideIcon;
}

export const DesktopSidebar: React.FC<DesktopSidebarProps> = ({
  activeTab,
  onSelectTab,
  onTriggerSync,
}) => {
  const { user, logout } = useAuth();
  const { syncStatus } = useWater();

  const navItems: SidebarItem[] = [
    { id: 'dashboard', label: '總覽儀表板', subLabel: '今日飲水與進度', icon: House },
    { id: 'stats', label: '統計與分析', subLabel: '週/月趨勢與連續達標', icon: ChartNoAxesColumnIncreasing },
    { id: 'history', label: '飲水歷程', subLabel: '完整紀錄與資料管理', icon: History },
    { id: 'devices', label: '裝置中心', subLabel: '藍牙控制與雲端綁定', icon: Cpu },
    { id: 'settings', label: '系統設定', subLabel: '目標偏好與同步設定', icon: Settings },
  ];

  const displayName = user?.displayName || user?.username || user?.email?.split('@')[0] || '使用者';
  const displayUsername = user?.username || user?.email || '';

  return (
    <aside className="desktop-sidebar" aria-label="側邊主要導覽">
      {/* Brand Header */}
      <div className="desktop-sidebar__brand" onClick={() => onSelectTab('dashboard')}>
        <div className="brand-logo-icon">🥤</div>
        <div className="brand-text">
          <span className="brand-title">Smart Water</span>
          <span className="brand-subtitle">智慧喝水追蹤器</span>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="desktop-sidebar__nav">
        <span className="nav-group-title">功能選單</span>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            activeTab === item.id ||
            (item.id === 'dashboard' && activeTab === 'dashboard') ||
            (item.id === 'devices' && (activeTab === 'devices' || activeTab === 'ble'));

          return (
            <button
              key={item.id}
              type="button"
              className={`desktop-sidebar__item ${isActive ? 'active' : ''}`}
              onClick={() => onSelectTab(item.id)}
              aria-current={isActive ? 'page' : undefined}
            >
              <div className="item-icon-wrap">
                <Icon size={20} />
              </div>
              <div className="item-text-wrap">
                <span className="item-label">{item.label}</span>
                {item.subLabel && <span className="item-sublabel">{item.subLabel}</span>}
              </div>
              {item.id === 'dashboard' && syncStatus.pendingCount > 0 && (
                <span className="item-badge">{syncStatus.pendingCount}</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Offline Sync Status Card */}
      <div className="desktop-sidebar__sync-card">
        {syncStatus.pendingCount > 0 ? (
          <div className="sync-card-content sync-card--pending">
            <div className="sync-card-header">
              <CloudUpload size={18} className="sync-icon animate-bounce" />
              <span className="sync-title">{syncStatus.pendingCount} 筆待同步</span>
            </div>
            <p className="sync-desc">偵測到離線喝水事件，已安全暫存在本地端。</p>
            <button
              type="button"
              className="sync-btn"
              onClick={onTriggerSync}
              disabled={syncStatus.isSyncing}
            >
              {syncStatus.isSyncing ? '同步中...' : '立即同步至雲端'}
            </button>
          </div>
        ) : (
          <div className="sync-card-content sync-card--synced">
            <Cloud size={18} className="sync-icon-success" />
            <span className="sync-title-success">資料已與雲端同步</span>
          </div>
        )}
      </div>

      {/* User Profile & Logout */}
      <div className="desktop-sidebar__user">
        <div className="user-avatar">
          <User size={18} />
        </div>
        <div className="user-info">
          <span className="user-name" title={displayName}>
            {displayName}
          </span>
          <span className="user-email" title={displayUsername}>
            帳號：{displayUsername}
          </span>
        </div>
        <button
          type="button"
          className="logout-btn"
          onClick={() => {
            if (window.confirm('確定要登出系統嗎？')) {
              logout();
            }
          }}
          title="登出帳號"
          aria-label="登出帳號"
        >
          <LogOut size={18} />
        </button>
      </div>
    </aside>
  );
};
