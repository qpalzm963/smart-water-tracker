import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../src/game/gameConfig';
import {
  attackBoss,
  canAttack,
  claimReward,
  createDailyGameState,
  DailyGameState,
  getBossMaxHp,
  getEnergyForWater,
  getWaterMlForNextAttack,
  previewEnergyGain,
  rolloverIfNeeded,
  syncHydration,
} from '../src/game/gameRules';

const GOAL = 2000;
const day = (date = '2026-09-10', goalMl = GOAL) => createDailyGameState(date, goalMl);

const drink = (state: DailyGameState, totalMl: number) =>
  syncHydration(state, { waterMl: totalMl, dailyGoalMl: state.dailyGoalMl }).state;

const assertInvariants = (state: DailyGameState) => {
  expect(state.waterEnergy).toBeGreaterThanOrEqual(0);
  expect(state.bossHp).toBeGreaterThanOrEqual(0);
  expect(state.bossHp).toBeLessThanOrEqual(state.bossMaxHp);
  expect(state.bossDefeated).toBe(state.bossHp === 0);
};

describe('gameRules: water → energy', () => {
  it('converts every 250 ml into 100 water energy (proportional)', () => {
    expect(getEnergyForWater(250, GOAL)).toBe(100);
    expect(getEnergyForWater(300, GOAL)).toBe(120);
    expect(getEnergyForWater(0, GOAL)).toBe(0);
    expect(getEnergyForWater(-50, GOAL)).toBe(0);
  });

  it('caps energy at the daily goal (effectiveWater = min(today, goal))', () => {
    expect(getEnergyForWater(2000, GOAL)).toBe(800);
    expect(getEnergyForWater(3500, GOAL)).toBe(800);
    expect(getEnergyForWater(500, 0)).toBe(0);
  });

  it('grants energy only for the newly credited increment', () => {
    let state = day();
    const first = syncHydration(state, { waterMl: 300, dailyGoalMl: GOAL });
    expect(first.energyGained).toBe(120);
    expect(first.state.waterEnergy).toBe(120);
    expect(first.state.waterMl).toBe(300);

    const second = syncHydration(first.state, { waterMl: 800, dailyGoalMl: GOAL });
    expect(second.energyGained).toBe(200);
    expect(second.state.waterEnergy).toBe(320);
    state = second.state;
    assertInvariants(state);
  });

  it('does not re-credit the same hydration total twice', () => {
    const once = syncHydration(day(), { waterMl: 500, dailyGoalMl: GOAL });
    const twice = syncHydration(once.state, { waterMl: 500, dailyGoalMl: GOAL });
    expect(twice.energyGained).toBe(0);
    expect(twice.state.waterEnergy).toBe(200);
    expect(twice.state).toBe(once.state);
  });

  it('stops producing battle energy once the daily goal is exceeded', () => {
    const atGoal = syncHydration(day(), { waterMl: 2000, dailyGoalMl: GOAL });
    expect(atGoal.energyGained).toBe(800);
    const over = syncHydration(atGoal.state, { waterMl: 2750, dailyGoalMl: GOAL });
    expect(over.energyGained).toBe(0);
    expect(over.state.waterEnergy).toBe(800);
    expect(over.state.waterMl).toBe(2750);
  });

  it('keeps already-spent energy safe when the hydration total drops (record deleted)', () => {
    let state = drink(day(), 1000); // 400 energy
    state = attackBoss(state).state; // spend 100
    state = attackBoss(state).state; // spend 100
    const lowered = syncHydration(state, { waterMl: 200, dailyGoalMl: GOAL });
    expect(lowered.energyGained).toBe(0);
    expect(lowered.state.waterEnergy).toBe(200);
    expect(lowered.state.waterMl).toBe(200);
    assertInvariants(lowered.state);
  });

  it('previews the energy a quick-drink amount would add, respecting the cap', () => {
    expect(previewEnergyGain(day(), 300)).toBe(120);
    const nearGoal = drink(day(), 1900);
    expect(previewEnergyGain(nearGoal, 500)).toBe(40);
    const over = drink(day(), 2400);
    expect(previewEnergyGain(over, 500)).toBe(0);
  });

  it('tells how much more water unlocks the next attack', () => {
    expect(getWaterMlForNextAttack(day())).toBe(250);
    expect(getWaterMlForNextAttack(drink(day(), 150))).toBe(100);
    expect(getWaterMlForNextAttack(drink(day(), 250))).toBe(0);
  });

  it('includes the high-water mark after hydration records are deleted', () => {
    let state = drink(day(), 1000);
    for (let i = 0; i < 4; i += 1) state = attackBoss(state).state;

    const deleted = syncHydration(state, { waterMl: 200, dailyGoalMl: GOAL }).state;
    expect(deleted.energyEarned).toBe(400);
    expect(deleted.waterEnergy).toBe(0);
    expect(getWaterMlForNextAttack(deleted)).toBe(1050);
  });

  it('reports when the high-water mark has exhausted the daily energy cap', () => {
    const credited = drink(day(), GOAL);
    const deleted = {
      ...credited,
      waterMl: 200,
      waterEnergy: 0,
      bossHp: credited.bossMaxHp,
      bossDefeated: false,
    };
    expect(getWaterMlForNextAttack(deleted)).toBeNull();
  });
});

describe('gameRules: boss & attacks', () => {
  it.each([
    [500, 2, 240],
    [1000, 4, 480],
    [2000, 8, 960],
    [3000, 12, 1320],
  ])('uses a whole number of attacks near the daily goal (%i ml)', (goalMl, attacksAtGoal, expectedHp) => {
    const maxHp = getBossMaxHp(goalMl);
    expect(maxHp).toBe(expectedHp);
    expect(maxHp).toBe(Math.ceil(attacksAtGoal * GAME_CONFIG.bossHpGoalRatio) * GAME_CONFIG.attackDamage);
    expect(maxHp % GAME_CONFIG.attackDamage).toBe(0);
    expect(maxHp).toBeLessThanOrEqual(attacksAtGoal * GAME_CONFIG.attackDamage);
  });

  it('keeps a defensive one-attack fallback for an invalid zero goal', () => {
    expect(getBossMaxHp(0)).toBe(GAME_CONFIG.attackDamage);
  });

  it('rebalances same-day goal changes without taking away damage', () => {
    let state = drink(day('2026-09-10', 3000), 3000);
    state = attackBoss(state).state;
    const loweredGoal = syncHydration(state, {
      waterMl: 3000,
      dailyGoalMl: 500,
    });

    expect(loweredGoal.state.dailyGoalMl).toBe(500);
    expect(loweredGoal.state.bossMaxHp).toBe(getBossMaxHp(500));
    expect(loweredGoal.state.bossHp).toBe(120);
    expect(loweredGoal.state.bossDefeated).toBe(false);
    expect(loweredGoal.state.streakDays).toBe(0);

    state = attackBoss(state).state;
    const defeatedByLowerGoal = syncHydration(state, {
      waterMl: 3000,
      dailyGoalMl: 500,
    });
    expect(defeatedByLowerGoal.state.bossHp).toBe(0);
    expect(defeatedByLowerGoal.state.bossDefeated).toBe(true);
    expect(defeatedByLowerGoal.state.streakDays).toBe(1);

    const increasedGoal = syncHydration(loweredGoal.state, {
      waterMl: 3000,
      dailyGoalMl: 3000,
    });
    expect(increasedGoal.state.bossMaxHp).toBe(getBossMaxHp(3000));
    expect(increasedGoal.state.bossHp).toBe(getBossMaxHp(3000) - GAME_CONFIG.attackDamage);
    expect(increasedGoal.state.bossDefeated).toBe(false);
  });

  it('does not resurrect a completed battle when the goal changes again', () => {
    let state = drink(day('2026-09-10', 500), 500);
    while (canAttack(state).ok) state = attackBoss(state).state;

    const changed = syncHydration(state, {
      waterMl: 500,
      dailyGoalMl: 3000,
    });
    expect(changed.state.bossDefeated).toBe(true);
    expect(changed.state.bossHp).toBe(0);
    expect(changed.state.bossMaxHp).toBe(getBossMaxHp(3000));
  });

  it('blocks attacks without enough energy', () => {
    const state = drink(day(), 200); // 80 energy
    expect(canAttack(state)).toEqual({ ok: false, reason: 'not-enough-energy' });
    const result = attackBoss(state);
    expect(result.damageDealt).toBe(0);
    expect(result.state).toBe(state);
  });

  it('spends energy and damages the boss on attack', () => {
    const state = drink(day(), 500); // 200 energy
    const result = attackBoss(state);
    expect(result.damageDealt).toBe(GAME_CONFIG.attackDamage);
    expect(result.state.waterEnergy).toBe(200 - GAME_CONFIG.attackEnergyCost);
    expect(result.state.bossHp).toBe(state.bossMaxHp - GAME_CONFIG.attackDamage);
    expect(result.defeated).toBe(false);
    assertInvariants(result.state);
  });

  it('never drives boss HP below zero and marks defeat', () => {
    let state = drink(day(), GOAL);
    let defeated = false;
    for (let i = 0; i < 20 && canAttack(state).ok; i += 1) {
      const result = attackBoss(state);
      state = result.state;
      assertInvariants(state);
      defeated = defeated || result.defeated;
    }
    expect(defeated).toBe(true);
    expect(state.bossHp).toBe(0);
    expect(state.bossDefeated).toBe(true);
    expect(canAttack(state)).toEqual({ ok: false, reason: 'boss-defeated' });
    expect(attackBoss(state).state).toBe(state);
  });

  it('counts the defeat towards the streak once', () => {
    let state = drink(day(), GOAL);
    expect(state.streakDays).toBe(0);
    while (canAttack(state).ok) state = attackBoss(state).state;
    expect(state.streakDays).toBe(1);
  });
});

describe('gameRules: rewards', () => {
  const defeatedState = () => {
    let state = drink(day(), GOAL);
    while (canAttack(state).ok) state = attackBoss(state).state;
    return state;
  };

  it('refuses rewards while the boss is alive', () => {
    const state = drink(day(), 500);
    const result = claimReward(state);
    expect(result.reward).toBeNull();
    expect(result.state).toBe(state);
  });

  it('grants points and a chest exactly once per day', () => {
    const first = claimReward(defeatedState());
    expect(first.reward).toEqual({
      points: GAME_CONFIG.defeatRewardPoints,
      chests: GAME_CONFIG.defeatRewardChests,
    });
    expect(first.state.points).toBe(GAME_CONFIG.defeatRewardPoints);
    expect(first.state.chests).toBe(GAME_CONFIG.defeatRewardChests);
    expect(first.state.rewardClaimed).toBe(true);

    const second = claimReward(first.state);
    expect(second.reward).toBeNull();
    expect(second.state.points).toBe(GAME_CONFIG.defeatRewardPoints);
    expect(second.state.chests).toBe(GAME_CONFIG.defeatRewardChests);
  });
});

describe('gameRules: daily rollover', () => {
  const finishDay = (date: string) => {
    let state = drink(day(date), GOAL);
    while (canAttack(state).ok) state = attackBoss(state).state;
    return claimReward(state).state;
  };

  it('returns the same state while the date is unchanged', () => {
    const state = drink(day('2026-09-10'), 500);
    expect(rolloverIfNeeded(state, '2026-09-10', GOAL)).toBe(state);
  });

  it('resets the battle but carries points, chests and streak into the next day', () => {
    const yesterday = finishDay('2026-09-10');
    const today = rolloverIfNeeded(yesterday, '2026-09-11', GOAL);
    expect(today.date).toBe('2026-09-11');
    expect(today.waterMl).toBe(0);
    expect(today.waterEnergy).toBe(0);
    expect(today.bossHp).toBe(today.bossMaxHp);
    expect(today.bossDefeated).toBe(false);
    expect(today.rewardClaimed).toBe(false);
    expect(today.points).toBe(yesterday.points);
    expect(today.chests).toBe(yesterday.chests);
    expect(today.streakDays).toBe(1);
  });

  it('breaks the streak when a day was skipped or the boss survived', () => {
    const skipped = rolloverIfNeeded(finishDay('2026-09-10'), '2026-09-12', GOAL);
    expect(skipped.streakDays).toBe(0);

    const survived = drink(day('2026-09-10'), 300);
    expect(rolloverIfNeeded(survived, '2026-09-11', GOAL).streakDays).toBe(0);
  });

  it('adopts the new goal for the new day boss', () => {
    const next = rolloverIfNeeded(day('2026-09-10', 2000), '2026-09-11', 3000);
    expect(next.dailyGoalMl).toBe(3000);
    expect(next.bossMaxHp).toBe(getBossMaxHp(3000));
  });
});
