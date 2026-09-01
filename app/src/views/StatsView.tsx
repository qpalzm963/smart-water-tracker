import React, { useState } from 'react';
import {
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  CircleCheck,
  Flame,
  RefreshCw,
} from 'lucide-react';
import { useWater } from '../contexts/WaterContext';

interface StatsViewProps {
  showToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export const StatsView: React.FC<StatsViewProps> = () => {
  const { weeklyStats, monthlyStats, refreshAll, isLoading } = useWater();
  const [tab, setTab] = useState<'weekly' | 'monthly'>('weekly');

  return (
    <div className="view-container stats-view">
      <div className="section-header">
        <div>
          <h2 className="title-with-icon">
            <ChartNoAxesColumnIncreasing aria-hidden="true" />
            飲水統計與連續達標分析
          </h2>
          <p className="subtitle">檢視過去 7 日與 30 日的飲水趨勢及連續喝水紀錄。</p>
        </div>

        <div className="header-actions">
          <button className="btn btn-secondary" onClick={() => refreshAll()} disabled={isLoading}>
            <RefreshCw className={isLoading ? 'icon-spin' : undefined} aria-hidden="true" />
            重新計算
          </button>
        </div>
      </div>

      <div className="auth-tabs stats-tabs">
        <button
          className={`auth-tab ${tab === 'weekly' ? 'active' : ''}`}
          onClick={() => setTab('weekly')}
        >
          <CalendarDays aria-hidden="true" />
          過去 7 日週統計
        </button>
        <button
          className={`auth-tab ${tab === 'monthly' ? 'active' : ''}`}
          onClick={() => setTab('monthly')}
        >
          <CalendarDays aria-hidden="true" />
          過去 30 日月統計
        </button>
      </div>

      {tab === 'weekly' && weeklyStats && (
        <div>
          {/* Weekly Summary Cards */}
          <div className="grid grid-3">
            <div className="card stat-metric-card">
              <span className="metric-label">週總飲水量</span>
              <span className="metric-val">{weeklyStats.totalMl} ml</span>
              <span className="metric-sub">期間: {weeklyStats.startDate} ~ {weeklyStats.endDate}</span>
            </div>

            <div className="card stat-metric-card">
              <span className="metric-label">每日平均飲水</span>
              <span className="metric-val">{weeklyStats.dailyAverageMl} ml</span>
              <span className="metric-sub">目標: {weeklyStats.goalMl} ml / 日</span>
            </div>

            <div className="card stat-metric-card">
              <span className="metric-label">達標天數</span>
              <span className="metric-val font-success">{weeklyStats.daysMetGoal} / 7 天</span>
              <span className="metric-sub">
                達成率: {Math.round((weeklyStats.daysMetGoal / 7) * 100)}%
              </span>
            </div>
          </div>

          {/* 7 Days Visual Breakdown */}
          <div className="card" style={{ marginTop: '1.5rem' }}>
            <div className="card-header">
              <h3>7 日每日飲水明細</h3>
            </div>
            <div className="days-bars-container">
              {weeklyStats.days.map((day) => {
                const pct = Math.min(100, Math.round((day.totalMl / weeklyStats.goalMl) * 100));
                const isMet = day.totalMl >= weeklyStats.goalMl;
                return (
                  <div key={day.date} className="day-bar-item">
                    <div className="day-bar-header">
                      <span className="day-date">{day.date}</span>
                      <span className={`day-amount ${isMet ? 'font-success' : ''}`}>
                        {day.totalMl} ml {isMet ? '・達標' : ''}
                      </span>
                    </div>
                    <div className="bar-track">
                      <div
                        className={`bar-fill ${isMet ? 'bar-success' : 'bar-primary'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="day-bar-footer">
                      <span>喝水: {day.drinkCount === undefined ? '—' : `${day.drinkCount} 次`}</span>
                      <span>補水: {day.refillCount === undefined ? '—' : `${day.refillCount} 次`}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {tab === 'monthly' && monthlyStats && (
        <div>
          {/* Monthly Summary Cards */}
          <div className="grid grid-3">
            <div className="card stat-metric-card">
              <span className="metric-label title-with-icon">
                <Flame aria-hidden="true" />
                當前連續達標 (Streak)
              </span>
              <span className="metric-val font-primary">{monthlyStats.currentStreak} 天</span>
              <span className="metric-sub">最高紀錄: {monthlyStats.maxStreak} 天</span>
            </div>

            <div className="card stat-metric-card">
              <span className="metric-label">月總飲水量</span>
              <span className="metric-val">{monthlyStats.totalMl} ml</span>
              <span className="metric-sub">日均: {monthlyStats.dailyAverageMl} ml</span>
            </div>

            <div className="card stat-metric-card">
              <span className="metric-label">30 日達標天數</span>
              <span className="metric-val font-success">{monthlyStats.daysMetGoal} / 30 天</span>
              <span className="metric-sub">
                達成率: {Math.round((monthlyStats.daysMetGoal / 30) * 100)}%
              </span>
            </div>
          </div>

          {/* 30 Days Breakdown List */}
          <div className="card" style={{ marginTop: '1.5rem' }}>
            <div className="card-header">
              <h3>30 日飲水歷程</h3>
            </div>
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>飲水量</th>
                    <th>目標達成</th>
                    <th>喝水次數</th>
                    <th>補水次數</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyStats.days.map((day) => {
                    const isMet = day.totalMl >= monthlyStats.goalMl;
                    return (
                      <tr key={day.date}>
                        <td>{day.date}</td>
                        <td className="font-bold">{day.totalMl} ml</td>
                        <td>
                          <span
                            className={`badge badge-with-icon ${
                              isMet ? 'badge-success' : 'badge-muted'
                            }`}
                          >
                            {isMet && <CircleCheck aria-hidden="true" />}
                            {isMet
                              ? '達標'
                              : `${Math.round((day.totalMl / monthlyStats.goalMl) * 100)}%`}
                          </span>
                        </td>
                        <td>{day.drinkCount === undefined ? '—' : `${day.drinkCount} 次`}</td>
                        <td>{day.refillCount === undefined ? '—' : `${day.refillCount} 次`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
