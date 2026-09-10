/**
 * Hydration game MVP tuning values (Issue #3).
 *
 * These are initial UI/MVP numbers, not permanent balance. Everything the
 * game rules need to compute energy, damage and rewards lives here so a
 * balance pass only touches this file.
 */
export interface GameConfig {
  /** Version of the balance values used to derive a daily battle state. */
  configVersion: number;
  /** Water energy granted per millilitre of *effective* water (每 250 ml → +100). */
  energyPerMl: number;
  /** Energy spent by one attack. */
  attackEnergyCost: number;
  /** Deterministic damage dealt by one attack. */
  attackDamage: number;
  /**
   * Fraction of the "attacks available at the daily goal" the boss can absorb.
   * 0.9 means the boss falls around 90% of the daily goal, so hitting the goal
   * always guarantees a defeat while leaving no incentive to over-drink.
   */
  bossHpGoalRatio: number;
  /** Points granted once per day when the boss is defeated. */
  defeatRewardPoints: number;
  /** Chests granted once per day when the boss is defeated. */
  defeatRewardChests: number;
  /** Fallback goal when hydration data has not loaded yet. */
  defaultDailyGoalMl: number;
  /** Boss identity for the MVP; presentation maps this to the whale assets. */
  bossId: string;
  bossName: string;
  bossLevel: number;
}

/** Version of the persisted game-state shape in localStorage. */
export const GAME_STATE_SCHEMA_VERSION = 1;

export const GAME_CONFIG: GameConfig = {
  configVersion: 1,
  energyPerMl: 100 / 250,
  attackEnergyCost: 100,
  attackDamage: 120,
  bossHpGoalRatio: 0.9,
  defeatRewardPoints: 300,
  defeatRewardChests: 1,
  defaultDailyGoalMl: 2000,
  bossId: 'deep-sea-whale',
  bossName: '深海巨鯨',
  bossLevel: 1,
};

/** Quick-drink amounts shared by the hydration flow and the game feedback. */
export const QUICK_DRINK_AMOUNTS_ML = [100, 200, 300, 500, 750, 1000] as const;
