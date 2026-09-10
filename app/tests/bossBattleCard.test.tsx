import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../src/game/gameConfig';
import {
  attackBoss,
  canAttack,
  claimReward,
  createDailyGameState,
  DailyGameState,
  getAttacksAvailable,
  getWaterMlForNextAttack,
  syncHydration,
} from '../src/game/gameRules';
import { BossBattleCard, getAttackHint } from '../src/views/dashboard/game/BossBattleCard';
import { getDrinkSuccessMessage } from '../src/views/DashboardView';

const render = (state: DailyGameState, lastReward: { points: number; chests: number } | null = null) =>
  renderToStaticMarkup(
    <BossBattleCard
      state={state}
      attackCheck={canAttack(state)}
      attacksAvailable={getAttacksAvailable(state)}
      waterMlForNextAttack={getWaterMlForNextAttack(state)}
      lastAttack={null}
      lastEnergyGain={null}
      lastReward={lastReward}
      onAttack={() => {}}
      onClaimReward={() => {}}
      onLogWater={() => {}}
    />,
  );

const withWater = (ml: number) =>
  syncHydration(createDailyGameState('2026-09-10', 2000), { waterMl: ml, dailyGoalMl: 2000 }).state;

const defeated = () => {
  let state = withWater(2000);
  while (canAttack(state).ok) state = attackBoss(state).state;
  return state;
};

describe('BossBattleCard', () => {
  it('shows boss, HP, hydration progress and energy', () => {
    const html = render(withWater(600));
    expect(html).toContain('深海巨鯨');
    expect(html).toContain('Lv.1');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('今日喝水');
    expect(html).toContain('600 / 2,000 ml');
    expect(html).toContain('目前水能量');
    expect(html).toContain('>240<');
    expect(html).toContain('alt="深海巨鯨（待機）"');
    expect(html).toContain('alt="玩家攻擊姿勢"');
    // Vite inlines small SVG assets as data URIs; assert on the stage hooks instead of file names.
    expect(html).toMatch(/class="boss-stage[^"]*"[^>]*style="background-image:url\(/);
    expect(html).toContain('class="boss-stage__boss"');
  });

  it('disables the attack button and explains how much water unlocks it', () => {
    const html = render(withWater(150)); // 60 energy
    expect(html).toMatch(/<button[^>]*class="boss-card__attack"[^>]*disabled/);
    expect(html).toContain('再喝 100 ml 就能攻擊一次');
    expect(html).not.toContain('擊敗獎勵');
  });

  it('enables the attack button when energy suffices', () => {
    const html = render(withWater(500)); // 200 energy → 2 attacks
    expect(html).not.toMatch(/<button[^>]*class="boss-card__attack"[^>]*disabled/);
    expect(html).toContain('可攻擊 2 次');
  });

  it('renders the reward panel once the boss is defeated and locks it after claiming', () => {
    const state = defeated();
    const html = render(state);
    expect(html).toContain('擊敗獎勵');
    expect(html).toContain('領取獎勵');
    expect(html).toContain('class="boss-reward__art"');
    expect(html).toContain('今天的 Boss 已被擊敗');

    const claimed = claimReward(state);
    const claimedHtml = render(claimed.state, claimed.reward);
    expect(claimedHtml).toMatch(/<button[^>]*class="boss-reward__claim"[^>]*disabled/);
    expect(claimedHtml).toContain('已領取');
    expect(claimedHtml).toContain(`${GAME_CONFIG.defeatRewardPoints} 點`);
  });

  it('explains the energy cap once the goal is exceeded', () => {
    let state = withWater(2400);
    while (canAttack(state).ok && state.waterEnergy >= GAME_CONFIG.attackEnergyCost && !state.bossDefeated) {
      state = attackBoss(state).state;
      if (state.bossHp <= GAME_CONFIG.attackDamage) break;
    }
    // Simulate: over goal, energy drained below one attack, boss alive.
    const drained = { ...state, waterEnergy: 40, bossHp: state.bossMaxHp, bossDefeated: false };
    expect(getAttackHint(drained, canAttack(drained), 0, getWaterMlForNextAttack(drained))).toContain(
      '今日目標已達成',
    );
  });

  it('explains when deleted records cannot produce more energy', () => {
    const credited = withWater(2000);
    const deleted = {
      ...credited,
      waterMl: 200,
      waterEnergy: 0,
      bossHp: credited.bossMaxHp,
      bossDefeated: false,
    };
    expect(getAttackHint(deleted, canAttack(deleted), 0, getWaterMlForNextAttack(deleted))).toContain(
      '目前已無可累積的水能量',
    );
  });
});

describe('getDrinkSuccessMessage', () => {
  it('reports the energy gained or the cap', () => {
    expect(getDrinkSuccessMessage(300, 120, 300, 2000)).toBe('+300 ml，獲得 120 水能量');
    expect(getDrinkSuccessMessage(300, 0, 2000, 2000)).toBe(
      '已記錄 300 ml，今日目標已達成，不再累積水能量',
    );
  });

  it('does not call a high-water-mark no-op a completed goal', () => {
    expect(getDrinkSuccessMessage(300, 0, 800, 2000)).toBe('已記錄 300 ml，目前未新增水能量');
  });
});
