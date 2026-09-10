import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GAME_CONFIG, GAME_STATE_SCHEMA_VERSION } from '../src/game/gameConfig';
import { attackBoss, canAttack, claimReward, createDailyGameState } from '../src/game/gameRules';
import { GameStateStore } from '../src/game/gameStateStore';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.has(key) ? this.data.get(key)! : null; }
  key(index: number) { return Array.from(this.data.keys())[index] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { this.data.set(key, value); }
}

describe('GameStateStore', () => {
  let storage: MemoryStorage;
  let store: GameStateStore;

  beforeEach(() => {
    storage = new MemoryStorage();
    store = new GameStateStore(() => storage);
  });

  afterEach(() => storage.clear());

  it('round-trips a daily state per user', () => {
    const state = { ...createDailyGameState('2026-09-10', 2000), points: 300, waterEnergy: 120 };
    store.save('user-a', state);
    expect(store.load('user-a')).toEqual(state);
    expect(store.load('user-b')).toBeNull();
  });

  it('migrates pre-versioned state by rebuilding daily battle fields', () => {
    const current = createDailyGameState('2026-09-10', 2000);
    const legacy = {
      ...current,
      schemaVersion: undefined,
      configVersion: undefined,
      points: 300,
      chests: 2,
      streakDays: 4,
      waterEnergy: 700,
      bossHp: current.bossMaxHp - 120,
      bossDefeated: false,
    };
    storage.setItem('water_game_state:user-a', JSON.stringify(legacy));

    const migrated = store.load('user-a');
    expect(migrated?.schemaVersion).toBe(GAME_STATE_SCHEMA_VERSION);
    expect(migrated?.configVersion).toBe(GAME_CONFIG.configVersion);
    expect(migrated?.waterEnergy).toBe(0);
    expect(migrated?.bossHp).toBe(migrated?.bossMaxHp);
    expect(migrated?.bossDefeated).toBe(false);
    expect(migrated?.points).toBe(300);
    expect(migrated?.chests).toBe(2);
    expect(migrated?.streakDays).toBe(4);
  });

  it('rebuilds daily battle fields when the balance config version changes', () => {
    const current = createDailyGameState('2026-09-10', 2000);
    storage.setItem(
      'water_game_state:user-a',
      JSON.stringify({
        ...current,
        configVersion: GAME_CONFIG.configVersion + 1,
        points: 600,
        chests: 3,
        waterEnergy: 250,
      }),
    );

    const migrated = store.load('user-a');
    expect(migrated?.configVersion).toBe(GAME_CONFIG.configVersion);
    expect(migrated?.waterEnergy).toBe(0);
    expect(migrated?.bossHp).toBe(migrated?.bossMaxHp);
    expect(migrated?.points).toBe(600);
    expect(migrated?.chests).toBe(3);
  });

  it('preserves completed and claimed state across a config migration', () => {
    let defeated = createDailyGameState('2026-09-10', 2000);
    defeated = {
      ...defeated,
      waterMl: 2000,
      waterEnergy: 800,
      energyEarned: 800,
    };
    while (canAttack(defeated).ok) defeated = attackBoss(defeated).state;
    const claimed = claimReward(defeated).state;
    storage.setItem(
      'water_game_state:user-a',
      JSON.stringify({ ...claimed, configVersion: GAME_CONFIG.configVersion + 1 }),
    );

    const migrated = store.load('user-a');
    expect(migrated?.bossDefeated).toBe(true);
    expect(migrated?.rewardClaimed).toBe(true);
    expect(migrated?.streakDays).toBe(claimed.streakDays);
    expect(claimReward(migrated!).reward).toBeNull();
    expect(claimReward(migrated!).state.points).toBe(claimed.points);
  });

  it('keeps an unclaimed completed reward claimable exactly once after migration', () => {
    let defeated = createDailyGameState('2026-09-10', 2000);
    defeated = {
      ...defeated,
      waterMl: 2000,
      waterEnergy: 800,
      energyEarned: 800,
    };
    while (canAttack(defeated).ok) defeated = attackBoss(defeated).state;
    storage.setItem(
      'water_game_state:user-a',
      JSON.stringify({ ...defeated, configVersion: GAME_CONFIG.configVersion + 1 }),
    );

    const migrated = store.load('user-a');
    expect(migrated?.bossDefeated).toBe(true);
    expect(migrated?.rewardClaimed).toBe(false);
    const firstClaim = claimReward(migrated!);
    expect(firstClaim.reward).toEqual({
      points: GAME_CONFIG.defeatRewardPoints,
      chests: GAME_CONFIG.defeatRewardChests,
    });
    expect(firstClaim.state.streakDays).toBe(migrated?.streakDays);
    expect(claimReward(firstClaim.state).reward).toBeNull();
  });

  it('does not guess how to load a future schema version', () => {
    const current = createDailyGameState('2026-09-10', 2000);
    storage.setItem(
      'water_game_state:user-a',
      JSON.stringify({ ...current, schemaVersion: GAME_STATE_SCHEMA_VERSION + 1 }),
    );
    expect(store.load('user-a')).toBeNull();
  });

  it('ignores corrupt or foreign payloads instead of throwing', () => {
    storage.setItem('water_game_state:user-a', '{not json');
    expect(store.load('user-a')).toBeNull();
    storage.setItem('water_game_state:user-a', JSON.stringify({ hello: 'world' }));
    expect(store.load('user-a')).toBeNull();
    storage.setItem('water_game_state:user-a', JSON.stringify([1, 2, 3]));
    expect(store.load('user-a')).toBeNull();
  });

  it('rejects payloads that violate the game invariants', () => {
    const base = createDailyGameState('2026-09-10', 2000);
    storage.setItem('water_game_state:user-a', JSON.stringify({ ...base, waterEnergy: -5 }));
    expect(store.load('user-a')).toBeNull();
    storage.setItem('water_game_state:user-a', JSON.stringify({ ...base, bossHp: base.bossMaxHp + 1 }));
    expect(store.load('user-a')).toBeNull();
  });

  it('is a no-op without a user or a storage backend', () => {
    const noStorage = new GameStateStore(() => null);
    const state = createDailyGameState('2026-09-10', 2000);
    expect(() => noStorage.save('user-a', state)).not.toThrow();
    expect(noStorage.load('user-a')).toBeNull();
    store.save('', state);
    expect(storage.length).toBe(0);
  });
});
