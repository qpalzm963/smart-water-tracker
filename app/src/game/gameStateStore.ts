import { GAME_CONFIG, GAME_STATE_SCHEMA_VERSION } from './gameConfig';
import { createDailyGameState, DailyGameState } from './gameRules';

const STORAGE_PREFIX = 'water_game_state:';

type StorageResolver = () => Storage | null;

const defaultStorageResolver: StorageResolver = () => {
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
      return globalThis.localStorage;
    }
  } catch {
    // localStorage can be unavailable in private or restricted environments.
  }
  return null;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isStateShape = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;

  if (typeof candidate.date !== 'string' || typeof candidate.bossId !== 'string') return false;
  if (typeof candidate.bossDefeated !== 'boolean' || typeof candidate.rewardClaimed !== 'boolean') {
    return false;
  }

  const numericKeys: Array<keyof DailyGameState> = [
    'waterMl',
    'dailyGoalMl',
    'waterEnergy',
    'energyEarned',
    'bossHp',
    'bossMaxHp',
    'points',
    'chests',
    'streakDays',
  ];
  if (!numericKeys.every((key) => isFiniteNumber(candidate[key]) && (candidate[key] as number) >= 0)) {
    return false;
  }

  const bossHp = candidate.bossHp as number;
  const bossMaxHp = candidate.bossMaxHp as number;
  if (bossHp > bossMaxHp) return false;
  if (candidate.bossDefeated !== (bossHp === 0)) return false;

  return true;
};

const isValidState = (value: unknown): value is DailyGameState => {
  if (!isStateShape(value)) return false;
  return (
    value.schemaVersion === GAME_STATE_SCHEMA_VERSION &&
    value.configVersion === GAME_CONFIG.configVersion &&
    value.bossId === GAME_CONFIG.bossId
  );
};

const canMigrateState = (value: unknown): value is Record<string, unknown> => {
  if (!isStateShape(value)) return false;

  // Missing/zero schema versions are the pre-versioned format introduced by
  // the first MVP. Future schema versions are intentionally not guessed at.
  const schemaVersion = value.schemaVersion;
  return schemaVersion === undefined || schemaVersion === 0 || schemaVersion === GAME_STATE_SCHEMA_VERSION;
};

const migrateState = (value: Record<string, unknown>): DailyGameState => {
  const migrated = createDailyGameState(value.date as string, value.dailyGoalMl as number, {
    points: value.points as number,
    chests: value.chests as number,
    streakDays: value.streakDays as number,
  });

  // Balance-dependent fields are rebuilt from the current config, but daily
  // completion is authoritative for reward idempotency and must survive a
  // config migration. The hook will resync hydration energy after this load.
  if (value.bossDefeated !== true) return migrated;

  return {
    ...migrated,
    bossHp: 0,
    bossDefeated: true,
    rewardClaimed: value.rewardClaimed === true,
  };
};

/**
 * Persists the daily battle per user so a tab switch or reload keeps today's
 * boss progress. Hydration data is never stored here; only derived game state.
 */
export class GameStateStore {
  constructor(private readonly resolveStorage: StorageResolver = defaultStorageResolver) {}

  private key(userId: string): string {
    return `${STORAGE_PREFIX}${userId}`;
  }

  public load(userId: string): DailyGameState | null {
    if (!userId) return null;
    const storage = this.resolveStorage();
    if (!storage) return null;

    try {
      const raw = storage.getItem(this.key(userId));
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (isValidState(parsed)) return parsed;
      if (!canMigrateState(parsed)) return null;

      const migrated = migrateState(parsed);
      try {
        storage.setItem(this.key(userId), JSON.stringify(migrated));
      } catch {
        // A storage write failure must not interrupt loading the game.
      }
      return migrated;
    } catch {
      return null;
    }
  }

  public save(userId: string, state: DailyGameState): void {
    if (!userId) return;
    const storage = this.resolveStorage();
    if (!storage) return;

    try {
      storage.setItem(this.key(userId), JSON.stringify(state));
    } catch {
      // Quota or privacy errors must never break the hydration flow.
    }
  }

  public clear(userId: string): void {
    if (!userId) return;
    const storage = this.resolveStorage();
    if (!storage) return;
    try {
      storage.removeItem(this.key(userId));
    } catch {
      // ignore
    }
  }
}

export const gameStateStore = new GameStateStore();
