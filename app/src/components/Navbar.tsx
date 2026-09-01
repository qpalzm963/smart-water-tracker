import React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  ChartNoAxesColumnIncreasing,
  Cpu,
  House,
  LucideIcon,
  Plus,
  UserRound,
} from 'lucide-react';
import { useWater } from '../contexts/WaterContext';

export type ActiveTab =
  | 'dashboard'
  | 'ble'
  | 'history'
  | 'stats'
  | 'devices'
  | 'settings';

interface NavbarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  onAdd: () => void;
}

interface NavItem {
  label: string;
  tab: ActiveTab;
  icon: LucideIcon;
}

const items: NavItem[] = [
  { label: '首頁', tab: 'dashboard', icon: House },
  { label: '統計', tab: 'stats', icon: ChartNoAxesColumnIncreasing },
  { label: '裝置中心', tab: 'devices', icon: Cpu },
  { label: '我的', tab: 'settings', icon: UserRound },
];

const isItemActive = (activeTab: ActiveTab, tab: ActiveTab): boolean => {
  if (tab === 'dashboard') return activeTab === 'dashboard' || activeTab === 'history';
  if (tab === 'devices') return activeTab === 'devices' || activeTab === 'ble';
  return activeTab === tab;
};

export const Navbar: React.FC<NavbarProps> = ({ activeTab, onSelectTab, onAdd }) => {
  const { syncStatus } = useWater();
  const reduceMotion = useReducedMotion();
  const leftItems = items.slice(0, 2);
  const rightItems = items.slice(2);

  const renderItem = ({ label, tab, icon: Icon }: NavItem) => {
    const active = isItemActive(activeTab, tab);
    return (
      <button
        key={tab}
        type="button"
        className={`bottom-nav__item ${active ? 'bottom-nav__item--active' : ''}`}
        onClick={() => onSelectTab(tab)}
        aria-current={active ? 'page' : undefined}
      >
        {active && (
          <motion.span
            className="bottom-nav__active-line"
            layoutId="bottom-nav-active"
            transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }}
            aria-hidden="true"
          />
        )}
        <Icon size={23} strokeWidth={active ? 2.5 : 2} aria-hidden="true" />
        <span>{label}</span>
      </button>
    );
  };

  return (
    <nav className="navbar bottom-nav" aria-label="主要導覽">
      <button
        type="button"
        className="desktop-nav-brand"
        onClick={() => onSelectTab('dashboard')}
        aria-label="回到飲水總覽"
      >
        WATER / TRACKER
      </button>
      <div className="desktop-nav-links">
        {leftItems.map(renderItem)}
        <button
          type="button"
          className="bottom-nav__add"
          onClick={onAdd}
          aria-label="快速記錄喝水"
        >
          <Plus size={34} strokeWidth={2} aria-hidden="true" />
          <span className="bottom-nav__add-label">新增紀錄</span>
          {syncStatus.pendingCount > 0 && (
            <span className="bottom-nav__sync-badge" aria-label={`${syncStatus.pendingCount} 筆待同步`}>
              {syncStatus.pendingCount > 9 ? '9+' : syncStatus.pendingCount}
            </span>
          )}
        </button>
        {rightItems.map(renderItem)}
      </div>
    </nav>
  );
};
