import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useWater } from '../contexts/WaterContext';
import { GAME_CONFIG } from './gameConfig';
import {
  attackBoss,
  AttackCheck,
  canAttack,
  claimReward,
  createDailyGameState,
  DailyGameState,
  getAttacksAvailable,
  getWaterMlForNextAttack,
  previewEnergyGain,
  RewardGrant,
  rolloverIfNeeded,
  syncHydration,
} from './gameRules';
import { gameStateStore } from './gameStateStore';

export interface AttackFeedback {
  id: number;
  damage: number;
  defeated: boolean;
}

export interface EnergyFeedback {
  id: number;
  energy: number;
}

export interface DailyGame {
  state: DailyGameState | null;
  attackCheck: AttackCheck;
  attacksAvailable: number;
  waterMlForNextAttack: number | null;
  lastAttack: AttackFeedback | null;
  lastEnergyGain: EnergyFeedback | null;
  lastReward: RewardGrant | null;
  attack: () => AttackFeedback | null;
  claim: () => RewardGrant | null;
  previewEnergy: (amountMl: number) => number;
}

const FEEDBACK_TTL_MS = 1600;

/** Taipei calendar date, matching the backend's daily stats bucket. */
export const getTaipeiToday = (now = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

const resolveTodayState = (
  userId: string,
  today: string,
  waterMl: number,
  dailyGoalMl: number,
  previous: DailyGameState | null,
): { state: DailyGameState; energyGained: number } => {
  const base =
    previous ?? gameStateStore.load(userId) ?? createDailyGameState(today, dailyGoalMl);
  const rolled = rolloverIfNeeded(base, today, dailyGoalMl);
  const synced = syncHydration(rolled, { waterMl, dailyGoalMl });
  return { state: synced.state, energyGained: synced.energyGained };
};

/**
 * Bridges the authoritative hydration state (WaterContext) to the daily boss
 * battle. The hook never writes hydration data; it only derives energy from
 * the daily total and persists the derived game state per user.
 */
export const useDailyGame = (): DailyGame => {
  const { user } = useAuth();
  const { dailyStats } = useWater();

  const userId = user?.id ?? '';
  const today = dailyStats?.date ?? getTaipeiToday();
  const waterMl = dailyStats?.totalMl ?? 0;
  const dailyGoalMl = dailyStats?.goalMl ?? user?.dailyGoalMl ?? GAME_CONFIG.defaultDailyGoalMl;

  // Initialise synchronously so the first paint (and SSR) already shows the boss.
  const [state, setState] = useState<DailyGameState | null>(
    () => resolveTodayState(userId, today, waterMl, dailyGoalMl, null).state,
  );
  const [lastAttack, setLastAttack] = useState<AttackFeedback | null>(null);
  const [lastEnergyGain, setLastEnergyGain] = useState<EnergyFeedback | null>(null);
  const [lastReward, setLastReward] = useState<RewardGrant | null>(null);
  const feedbackId = useRef(0);
  const energyTimer = useRef<number | null>(null);
  const stateUserRef = useRef<string>(userId);

  // Keep the game in step with hydration; reload when the user changes.
  useEffect(() => {
    // A user switch (including logout → anonymous) discards the in-memory
    // state; the store only persists for a real user id, so anonymous state is
    // purely derived from the current hydration snapshot.
    const previous = stateUserRef.current === userId ? state : null;
    if (previous === null) {
      setLastAttack(null);
      setLastEnergyGain(null);
      setLastReward(null);
    }

    const { state: next, energyGained } = resolveTodayState(
      userId,
      today,
      waterMl,
      dailyGoalMl,
      previous,
    );
    stateUserRef.current = userId;

    if (next !== state) {
      setState(next);
      gameStateStore.save(userId, next);
    }
    if (energyGained > 0 && previous !== null) {
      setLastEnergyGain({ id: ++feedbackId.current, energy: energyGained });
    }
    // `state` is intentionally omitted: this effect reacts to hydration only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, today, waterMl, dailyGoalMl]);

  useEffect(() => {
    if (!lastEnergyGain) return;
    if (energyTimer.current !== null) window.clearTimeout(energyTimer.current);
    energyTimer.current = window.setTimeout(() => setLastEnergyGain(null), FEEDBACK_TTL_MS);
    return () => {
      if (energyTimer.current !== null) window.clearTimeout(energyTimer.current);
    };
  }, [lastEnergyGain]);

  const commit = useCallback(
    (next: DailyGameState) => {
      setState(next);
      if (userId) gameStateStore.save(userId, next);
    },
    [userId],
  );

  const attack = useCallback((): AttackFeedback | null => {
    if (!state || !canAttack(state).ok) return null;
    const result = attackBoss(state);
    commit(result.state);
    const feedback: AttackFeedback = {
      id: ++feedbackId.current,
      damage: result.damageDealt,
      defeated: result.defeated,
    };
    setLastAttack(feedback);
    return feedback;
  }, [state, commit]);

  const claim = useCallback((): RewardGrant | null => {
    if (!state) return null;
    const result = claimReward(state);
    if (!result.reward) return null;
    commit(result.state);
    setLastReward(result.reward);
    return result.reward;
  }, [state, commit]);

  const previewEnergy = useCallback(
    (amountMl: number) => (state ? previewEnergyGain(state, amountMl) : 0),
    [state],
  );

  const derived = useMemo(() => {
    if (!state) {
      return {
        attackCheck: { ok: false, reason: 'not-enough-energy' } as AttackCheck,
        attacksAvailable: 0,
        waterMlForNextAttack: Math.ceil(GAME_CONFIG.attackEnergyCost / GAME_CONFIG.energyPerMl),
      };
    }
    return {
      attackCheck: canAttack(state),
      attacksAvailable: getAttacksAvailable(state),
      waterMlForNextAttack: getWaterMlForNextAttack(state),
    };
  }, [state]);

  return {
    state,
    ...derived,
    lastAttack,
    lastEnergyGain,
    lastReward: state?.rewardClaimed ? lastReward : null,
    attack,
    claim,
    previewEnergy,
  };
};
