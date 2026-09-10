import React, { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { ActiveTab } from '../components/Navbar';
import { useAuth } from '../contexts/AuthContext';
import { useBle } from '../contexts/BleContext';
import { useWater } from '../contexts/WaterContext';
import { offlineQueue } from '../services/sync/offlineQueue';
import {
  buildDrinkPayload,
  getBleDisplay,
  getGreeting,
  getProgress,
  getRecentRecords,
  QUICK_AMOUNTS,
} from './dashboard/dashboardViewModel';
import { DashboardWeekSummary } from './dashboard/DashboardWeekSummary';
import { HydrationHero } from './dashboard/HydrationHero';
import { HydrationReminder } from './dashboard/HydrationReminder';
import { QuickDrinkGrid } from './dashboard/QuickDrinkGrid';
import { TechDashboardHeader } from './dashboard/TechDashboardHeader';
import { TodayRecordsCard } from './dashboard/TodayRecordsCard';
import { BossBattleCard } from './dashboard/game/BossBattleCard';
import { useDailyGame } from '../game/useDailyGame';
import { DrinkRecord } from '../types';

interface DashboardViewProps {
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  onNavigate: (tab: ActiveTab) => void;
}

export const getDrinkSuccessMessage = (
  amountMl: number,
  energyGained: number,
  waterMl: number,
  dailyGoalMl: number,
): string => {
  if (energyGained > 0) return `+${amountMl} ml，獲得 ${energyGained} 水能量`;
  if (dailyGoalMl > 0 && waterMl >= dailyGoalMl) {
    return `已記錄 ${amountMl} ml，今日目標已達成，不再累積水能量`;
  }
  return `已記錄 ${amountMl} ml，目前未新增水能量`;
};

const formatDashboardDate = (now: Date): string =>
  new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(now);

export const DashboardView: React.FC<DashboardViewProps> = ({
  showToast,
  onNavigate,
}) => {
  const { user } = useAuth();
  const {
    dailyStats,
    weeklyStats,
    logWaterRecord,
    records,
    isLoading,
    deleteWaterRecord,
  } = useWater();
  const { status: bleStatus, summary: bleSummary } = useBle();
  const game = useDailyGame();
  const [busyAmount, setBusyAmount] = useState<number | null>(null);
  const [successAmount, setSuccessAmount] = useState<number | null>(null);
  const [deletingRecordId, setDeletingRecordId] = useState<string | null>(null);
  const successTimerRef = useRef<number | null>(null);

  const totalMl = dailyStats?.totalMl ?? 0;
  const goalMl = dailyStats?.goalMl ?? user?.dailyGoalMl ?? 2000;
  const { percent } = getProgress(totalMl, goalMl);
  const bleDisplay = getBleDisplay(bleStatus, bleSummary?.currentWeight);
  const recentRecords = getRecentRecords(records);
  const displayName = user?.displayName || user?.username || user?.email?.split('@')[0] || '朋友';

  const handleScrollToQuickDrink = () => {
    document
      .getElementById('quick-drink')
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  useEffect(
    () => () => {
      if (successTimerRef.current !== null) {
        window.clearTimeout(successTimerRef.current);
      }
    },
    [],
  );

  const handleQuickLog = async (amount: number) => {
    const pendingBefore = offlineQueue.getCount();
    const energyPreview = game.previewEnergy(amount);
    const waterMlAfterLog = totalMl + amount;
    setBusyAmount(amount);
    try {
      await logWaterRecord(buildDrinkPayload(amount));
      setSuccessAmount(amount);
      const queuedOffline = offlineQueue.getCount() > pendingBefore;
      showToast(
        queuedOffline
          ? `已暫存 ${amount} ml，連線後會自動同步`
          : getDrinkSuccessMessage(amount, energyPreview, waterMlAfterLog, goalMl),
        queuedOffline ? 'info' : 'success',
      );
      if (successTimerRef.current !== null) {
        window.clearTimeout(successTimerRef.current);
      }
      successTimerRef.current = window.setTimeout(() => setSuccessAmount(null), 1200);
    } catch (error) {
      const message = error instanceof Error ? error.message : '記錄失敗，請稍後再試';
      showToast(message, 'error');
    } finally {
      setBusyAmount(null);
    }
  };

  const handleAttack = () => {
    const feedback = game.attack();
    if (!feedback) return;
    if (feedback.defeated) {
      showToast('擊敗今日 Boss！記得領取獎勵', 'success');
    }
  };

  const handleClaimReward = () => {
    const reward = game.claim();
    if (reward) {
      showToast(`已領取 ${reward.points} 點數與 ${reward.chests} 個寶箱`, 'success');
    }
  };

  const handleDeleteRecord = async (record: DrinkRecord) => {
    const occurredAtLabel = new Date(record.occurredAt).toLocaleString();
    if (!window.confirm(`確定要永久刪除 ${occurredAtLabel} 的喝水紀錄嗎？刪除後無法復原。`)) {
      return;
    }

    setDeletingRecordId(record.id);
    try {
      await deleteWaterRecord(record.id);
      showToast('喝水紀錄已永久刪除', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '刪除喝水紀錄失敗';
      showToast(message, 'error');
    } finally {
      setDeletingRecordId(null);
    }
  };

  return (
    <div
      className={`dashboard-home ${isLoading && !dailyStats ? 'dashboard-home--loading' : ''}`}
    >
      <TechDashboardHeader
        greeting={getGreeting()}
        displayName={displayName}
        connected={bleStatus === 'connected'}
        onNotify={() => showToast('目前沒有新通知', 'info')}
      />

      <div className="dashboard-toolbar">
        <div>
          <span className="dashboard-toolbar__date">{formatDashboardDate(new Date())}</span>
          <h2>今天的飲水</h2>
        </div>
        <button type="button" className="dashboard-toolbar__add" onClick={handleScrollToQuickDrink}>
          <Plus size={16} aria-hidden="true" />
          新增紀錄
        </button>
      </div>

      <div className="dashboard-workspace">
        <div className="dashboard-workspace__main">
          {game.state && (
            <BossBattleCard
              state={game.state}
              attackCheck={game.attackCheck}
              attacksAvailable={game.attacksAvailable}
              waterMlForNextAttack={game.waterMlForNextAttack}
              lastAttack={game.lastAttack}
              lastEnergyGain={game.lastEnergyGain}
              lastReward={game.lastReward}
              onAttack={handleAttack}
              onClaimReward={handleClaimReward}
              onLogWater={handleScrollToQuickDrink}
            />
          )}
          <HydrationHero
            totalMl={totalMl}
            goalMl={goalMl}
            percent={percent}
            ble={bleDisplay}
            onOpenBle={() => onNavigate('devices')}
          />
        </div>
        <div className="dashboard-workspace__side">
          <QuickDrinkGrid
            amounts={QUICK_AMOUNTS}
            busyAmount={busyAmount}
            successAmount={successAmount}
            onDrink={handleQuickLog}
          />
          <HydrationReminder remainingMl={Math.max(0, goalMl - totalMl)} />
        </div>
      </div>

      <div className="dashboard-lower-grid">
        <TodayRecordsCard
          records={recentRecords}
          onViewAll={() => onNavigate('history')}
          onDelete={handleDeleteRecord}
          deletingRecordId={deletingRecordId}
        />
        <DashboardWeekSummary
          weeklyStats={weeklyStats}
          drinkCount={dailyStats?.drinkCount ?? 0}
          totalMl={totalMl}
        />
      </div>
    </div>
  );
};
