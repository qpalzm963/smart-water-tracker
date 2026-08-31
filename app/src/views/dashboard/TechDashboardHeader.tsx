import React from 'react';
import { Bell, Radio } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';

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
}) => {
  const reduceMotion = useReducedMotion();

  return (
    <motion.header
      className="desktop-dashboard-header"
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="desktop-dashboard-header__copy">
        <span className="desktop-eyebrow">WATER / TRACKER</span>
        <h1>
          {greeting}，{displayName}
        </h1>
        <p>今天的飲水工作面</p>
      </div>

      <button
        type="button"
        className={`desktop-status-button ${connected ? 'desktop-status-button--online' : ''}`}
        onClick={onNotify}
        aria-label={`查看通知，目前${connected ? '水杯已連線' : '水杯未連線'}`}
      >
        <Radio size={14} aria-hidden="true" />
        <span>{connected ? '水杯已連線' : '水杯未連線'}</span>
        <Bell size={18} aria-hidden="true" />
      </button>
    </motion.header>
  );
};
