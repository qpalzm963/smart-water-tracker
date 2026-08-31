import React from 'react';
import { Clock3 } from 'lucide-react';

interface HydrationReminderProps {
  remainingMl: number;
}

export const HydrationReminder: React.FC<HydrationReminderProps> = ({ remainingMl }) => (
  <aside className="desktop-reminder">
    <div className="desktop-reminder__heading">
      <div>
        <span className="desktop-card-overline">下一次提醒</span>
        <h2>{remainingMl > 0 ? `還差 ${remainingMl} ml` : '今天已達標'}</h2>
      </div>
      <Clock3 size={18} aria-hidden="true" />
    </div>
    <p>
      {remainingMl > 0
        ? '分幾次慢慢補足，不需要一次喝完。'
        : '維持現在的節奏，記得照常補水。'}
    </p>
  </aside>
);
