import React from 'react';
import { WeeklyStats } from '../../types';
import { getDayLabel, getWeekPercent } from './dashboardViewModel';

interface DashboardWeekSummaryProps {
  weeklyStats: WeeklyStats | null;
  drinkCount: number;
  totalMl: number;
}

const numberFormatter = new Intl.NumberFormat('zh-TW');

const formatShortDate = (value: string): string => value.slice(5).replace('-', '/');

export const DashboardWeekSummary: React.FC<DashboardWeekSummaryProps> = ({
  weeklyStats,
  drinkCount,
  totalMl,
}) => {
  const averageMl = drinkCount > 0 ? Math.round(totalMl / drinkCount) : 0;
  const days = weeklyStats?.days.slice(-7) ?? [];

  return (
    <section className="dashboard-card desktop-week-summary" aria-label="本週飲水摘要">
      <div className="desktop-card-heading">
        <div>
          <span className="desktop-card-overline">本週完成率</span>
          <h2>喝水節奏</h2>
        </div>
        <span className="desktop-card-meta">
          {weeklyStats ? `${weeklyStats.daysMetGoal} / 7 天達標` : '讀取中'}
        </span>
      </div>

      {weeklyStats === null ? (
        <div className="desktop-week-summary__empty">本週資料載入中</div>
      ) : (
        <>
          <div className="desktop-week-bars" role="list" aria-label="七日飲水量">
            {days.map((day) => {
              const percent = getWeekPercent(day.totalMl, weeklyStats.goalMl);
              return (
                <div
                  key={day.date}
                  className="desktop-week-day"
                  role="listitem"
                  aria-label={`${getDayLabel(day.date)} ${numberFormatter.format(day.totalMl)} ml，${percent}%`}
                >
                  <div className="desktop-week-bar-track">
                    <span className="desktop-week-bar" style={{ height: `${Math.max(5, percent)}%` }} />
                  </div>
                  <span className="desktop-week-day__label">{formatShortDate(day.date)}</span>
                  <span className="desktop-week-day__percent">{percent}%</span>
                </div>
              );
            })}
          </div>
          <div className="desktop-week-summary__metrics">
            <div>
              <span>今天喝水</span>
              <strong>{drinkCount} 次</strong>
            </div>
            <div>
              <span>平均每次</span>
              <strong>{numberFormatter.format(averageMl)} ml</strong>
            </div>
          </div>
        </>
      )}
    </section>
  );
};
