import React from 'react';
import { Bluetooth, ChevronRight, RadioTower, Scale } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { BleDisplay } from './dashboardViewModel';

interface HydrationHeroProps {
  totalMl: number;
  goalMl: number;
  percent: number;
  ble: BleDisplay;
  onOpenBle: () => void;
}

const numberFormatter = new Intl.NumberFormat('zh-TW');

export const HydrationHero: React.FC<HydrationHeroProps> = ({
  totalMl,
  goalMl,
  percent,
  ble,
  onOpenBle,
}) => {
  const reduceMotion = useReducedMotion();
  const progress = Math.min(100, Math.max(0, percent));
  const progressStyle = { '--desktop-progress': `${progress}%` } as React.CSSProperties;
  const remainingMl = Math.max(0, goalMl - totalMl);

  return (
    <motion.section
      className={`desktop-hydration-hero ${percent >= 100 ? 'desktop-hydration-hero--complete' : ''}`}
      aria-label="今日飲水進度"
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="desktop-hydration-hero__heading">
        <span>今日總量</span>
        <span>目標　<strong>{numberFormatter.format(goalMl)} ml</strong></span>
      </div>
      <div className="desktop-hydration-hero__amount">
        <strong>{numberFormatter.format(totalMl)}</strong>
        <span>ml</span>
      </div>
      <div className="desktop-hydration-hero__progress-row">
        <div className="desktop-progress" style={progressStyle} aria-hidden="true"><span /></div>
        <strong>{percent}%</strong>
      </div>
      <div className="desktop-hydration-hero__meta">
        <span>已完成今天目標</span>
        <span>{remainingMl > 0 ? `還差 ${numberFormatter.format(remainingMl)} ml` : '今天已達標'}</span>
      </div>

      <button
        type="button"
        className={`desktop-smart-cup desktop-smart-cup--${ble.tone}`}
        onClick={onOpenBle}
        aria-label={`${ble.label}${ble.value ? `，${ble.value}` : ''}`}
      >
        <span className="desktop-smart-cup__icon" aria-hidden="true">
          {ble.tone === 'connected' ? <RadioTower size={18} /> : <Bluetooth size={18} />}
        </span>
        <span className="desktop-smart-cup__copy">
          <strong>{ble.label}</strong>
          <small>{ble.value || '前往裝置頁查看狀態'}</small>
        </span>
        {ble.value && <Scale size={15} aria-hidden="true" />}
        <ChevronRight className="desktop-smart-cup__chevron" size={18} aria-hidden="true" />
      </button>
    </motion.section>
  );
};
