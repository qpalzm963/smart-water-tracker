import {
  GAME_CONFIG,
  GAME_STATE_SCHEMA_VERSION,
  GameConfig,
} from './gameConfig';

/**
 * Daily battle state. Hydration totals (`waterMl`, `dailyGoalMl`) are mirrored
 * from the existing water domain, which stays the single source of truth; the
 * game only derives energy from them and never writes hydration data.
 */
export interface DailyGameState {
  schemaVersion: number;
  configVersion: number;
  /** YYYY-MM-DD (Taipei date reported by the hydration stats). */
  date: string;
  waterMl: number;
  dailyGoalMl: number;
  /** Spendable energy. Invariant: >= 0. */
  waterEnergy: number;
  /**
   * High-water mark of energy already credited from effective water. Prevents
   * the same hydration total from being converted twice and keeps spent energy
   * intact when a record is deleted.
   */
  energyEarned: number;
  bossId: string;
  /** Invariant: 0 <= bossHp <= bossMaxHp. */
  bossHp: number;
  bossMaxHp: number;
  bossDefeated: boolean;
  rewardClaimed: boolean;
  /** Lifetime points, carried across days. */
  points: number;
  /** Lifetime chests, carried across days. */
  chests: number;
  /** Consecutive days with a defeated boss (including today once defeated). */
  streakDays: number;
}

export interface HydrationSnapshot {
  waterMl: number;
  dailyGoalMl: number;
}

export type AttackBlockReason = 'not-enough-energy' | 'boss-defeated';

export interface AttackCheck {
  ok: boolean;
  reason?: AttackBlockReason;
}

export interface AttackResult {
  state: DailyGameState;
  damageDealt: number;
  defeated: boolean;
}

export interface RewardGrant {
  points: number;
  chests: number;
}

export interface ClaimResult {
  state: DailyGameState;
  reward: RewardGrant | null;
}

export interface SyncResult {
  state: DailyGameState;
  energyGained: number;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const clampNonNegative = (value: number): number =>
  Number.isFinite(value) && value > 0 ? value : 0;

export const getEffectiveWaterMl = (waterMl: number, dailyGoalMl: number): number =>
  Math.min(clampNonNegative(waterMl), clampNonNegative(dailyGoalMl));

/** Energy earned by a hydration total, capped at the daily goal. */
export const getEnergyForWater = (
  waterMl: number,
  dailyGoalMl: number,
  config: GameConfig = GAME_CONFIG,
): number => Math.floor(getEffectiveWaterMl(waterMl, dailyGoalMl) * config.energyPerMl);

/** Boss HP scaled from the goal so the boss falls near (but not past) the goal. */
export const getBossMaxHp = (dailyGoalMl: number, config: GameConfig = GAME_CONFIG): number => {
  const attacksAtGoal = Math.floor(
    getEnergyForWater(dailyGoalMl, dailyGoalMl, config) / config.attackEnergyCost,
  );
  const attacksToDefeat = Math.max(1, Math.ceil(attacksAtGoal * config.bossHpGoalRatio));
  return attacksToDefeat * config.attackDamage;
};

export interface CarryOver {
  points?: number;
  chests?: number;
  streakDays?: number;
}

export const createDailyGameState = (
  date: string,
  dailyGoalMl: number,
  carry: CarryOver = {},
  config: GameConfig = GAME_CONFIG,
): DailyGameState => {
  const bossMaxHp = getBossMaxHp(dailyGoalMl, config);
  return {
    schemaVersion: GAME_STATE_SCHEMA_VERSION,
    configVersion: config.configVersion,
    date,
    waterMl: 0,
    dailyGoalMl: clampNonNegative(dailyGoalMl),
    waterEnergy: 0,
    energyEarned: 0,
    bossId: config.bossId,
    bossHp: bossMaxHp,
    bossMaxHp,
    bossDefeated: false,
    rewardClaimed: false,
    points: clampNonNegative(carry.points ?? 0),
    chests: clampNonNegative(carry.chests ?? 0),
    streakDays: clampNonNegative(carry.streakDays ?? 0),
  };
};

interface BossState {
  bossHp: number;
  bossMaxHp: number;
  bossDefeated: boolean;
  streakDays: number;
}

/**
 * Rebase the daily boss when the user changes their goal without taking away
 * damage already dealt. A completed battle remains completed, so changing the
 * goal cannot resurrect a defeated boss or make its reward available twice.
 */
const rebaseBossForGoal = (
  state: DailyGameState,
  dailyGoalMl: number,
  config: GameConfig,
): BossState => {
  const bossMaxHp = getBossMaxHp(dailyGoalMl, config);
  if (state.bossDefeated) {
    return {
      bossHp: 0,
      bossMaxHp,
      bossDefeated: true,
      streakDays: state.streakDays,
    };
  }

  const damageTaken = Math.max(0, state.bossMaxHp - state.bossHp);
  const bossHp = Math.max(0, bossMaxHp - damageTaken);
  const bossDefeated = bossHp === 0;

  return {
    bossHp,
    bossMaxHp,
    bossDefeated,
    streakDays: bossDefeated ? state.streakDays + 1 : state.streakDays,
  };
};

/**
 * Mirror the authoritative hydration total into the game and credit only the
 * increment that has not yet been converted. Returns the same object when
 * nothing changed so React state updates can be skipped.
 */
export const syncHydration = (
  state: DailyGameState,
  hydration: HydrationSnapshot,
  config: GameConfig = GAME_CONFIG,
): SyncResult => {
  const waterMl = clampNonNegative(hydration.waterMl);
  const dailyGoalMl = clampNonNegative(hydration.dailyGoalMl);
  const goalChanged = dailyGoalMl !== state.dailyGoalMl;
  const earnedNow = getEnergyForWater(waterMl, dailyGoalMl, config);
  const energyGained = Math.max(0, earnedNow - state.energyEarned);
  const boss = goalChanged
    ? rebaseBossForGoal(state, dailyGoalMl, config)
    : {
        bossHp: state.bossHp,
        bossMaxHp: state.bossMaxHp,
        bossDefeated: state.bossDefeated,
        streakDays: state.streakDays,
      };

  if (
    energyGained === 0 &&
    waterMl === state.waterMl &&
    !goalChanged
  ) {
    return { state, energyGained: 0 };
  }

  return {
    state: {
      ...state,
      waterMl,
      dailyGoalMl,
      bossHp: boss.bossHp,
      bossMaxHp: boss.bossMaxHp,
      bossDefeated: boss.bossDefeated,
      streakDays: boss.streakDays,
      energyEarned: state.energyEarned + energyGained,
      waterEnergy: state.waterEnergy + energyGained,
    },
    energyGained,
  };
};

/** Energy a new drink of `amountMl` would add, given the current cap. */
export const previewEnergyGain = (
  state: DailyGameState,
  amountMl: number,
  config: GameConfig = GAME_CONFIG,
): number => {
  const earnedAfter = getEnergyForWater(state.waterMl + clampNonNegative(amountMl), state.dailyGoalMl, config);
  return Math.max(0, earnedAfter - state.energyEarned);
};

/** Millilitres still needed before one more attack becomes affordable (0 if affordable). */
export const getWaterMlForNextAttack = (
  state: DailyGameState,
  config: GameConfig = GAME_CONFIG,
): number | null => {
  const missingEnergy = config.attackEnergyCost - state.waterEnergy;
  if (missingEnergy <= 0 || config.energyPerMl <= 0) return 0;

  const maxEnergy = getEnergyForWater(state.dailyGoalMl, state.dailyGoalMl, config);
  const targetEnergy = state.energyEarned + missingEnergy;
  if (state.dailyGoalMl <= 0 || targetEnergy > maxEnergy) return null;

  const targetWaterMl = Math.ceil(targetEnergy / config.energyPerMl);
  if (targetWaterMl > state.dailyGoalMl) return null;

  return Math.max(0, targetWaterMl - clampNonNegative(state.waterMl));
};

export const getAttacksAvailable = (
  state: DailyGameState,
  config: GameConfig = GAME_CONFIG,
): number => Math.floor(state.waterEnergy / config.attackEnergyCost);

export const canAttack = (state: DailyGameState, config: GameConfig = GAME_CONFIG): AttackCheck => {
  if (state.bossDefeated) return { ok: false, reason: 'boss-defeated' };
  if (state.waterEnergy < config.attackEnergyCost) {
    return { ok: false, reason: 'not-enough-energy' };
  }
  return { ok: true };
};

export const attackBoss = (state: DailyGameState, config: GameConfig = GAME_CONFIG): AttackResult => {
  if (!canAttack(state, config).ok) {
    return { state, damageDealt: 0, defeated: false };
  }

  const damageDealt = Math.min(config.attackDamage, state.bossHp);
  const bossHp = state.bossHp - damageDealt;
  const defeated = bossHp === 0;

  return {
    state: {
      ...state,
      waterEnergy: state.waterEnergy - config.attackEnergyCost,
      bossHp,
      bossDefeated: defeated,
      streakDays: defeated ? state.streakDays + 1 : state.streakDays,
    },
    damageDealt,
    defeated,
  };
};

export const claimReward = (state: DailyGameState, config: GameConfig = GAME_CONFIG): ClaimResult => {
  if (!state.bossDefeated || state.rewardClaimed) {
    return { state, reward: null };
  }

  const reward: RewardGrant = {
    points: config.defeatRewardPoints,
    chests: config.defeatRewardChests,
  };

  return {
    state: {
      ...state,
      rewardClaimed: true,
      points: state.points + reward.points,
      chests: state.chests + reward.chests,
    },
    reward,
  };
};

const parseDateUtcMs = (date: string): number | null => {
  if (!DATE_PATTERN.test(date)) return null;
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
};

export const isNextDay = (previous: string, next: string): boolean => {
  const prevMs = parseDateUtcMs(previous);
  const nextMs = parseDateUtcMs(next);
  if (prevMs === null || nextMs === null) return false;
  return nextMs - prevMs === DAY_MS;
};

/**
 * Roll the battle into a new day. Lifetime points/chests carry over; the
 * streak survives only if yesterday's boss was defeated.
 */
export const rolloverIfNeeded = (
  state: DailyGameState,
  today: string,
  dailyGoalMl: number,
  config: GameConfig = GAME_CONFIG,
): DailyGameState => {
  if (state.date === today) return state;

  const streakDays = isNextDay(state.date, today) && state.bossDefeated ? state.streakDays : 0;

  return createDailyGameState(
    today,
    dailyGoalMl,
    { points: state.points, chests: state.chests, streakDays },
    config,
  );
};
