import React, { useEffect, useState } from 'react';
import { Droplets, Flame, Gift, Swords, Trophy } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import deepSeaUrl from '../../../assets/game/backgrounds/deep_sea.svg';
import whaleIdleUrl from '../../../assets/game/boss/whale_idle.svg';
import whaleHitUrl from '../../../assets/game/boss/whale_hit.svg';
import waterBlastUrl from '../../../assets/game/effects/water_blast.svg';
import waterEnergyUrl from '../../../assets/game/icons/water_energy.svg';
import waterDropUrl from '../../../assets/game/mascot/water_drop.svg';
import playerAttackUrl from '../../../assets/game/player/player_attack.svg';
import chestUrl from '../../../assets/game/rewards/chest.svg';
import coinUrl from '../../../assets/game/rewards/coin.svg';
import { GAME_CONFIG } from '../../../game/gameConfig';
import { AttackCheck, DailyGameState, RewardGrant } from '../../../game/gameRules';
import { AttackFeedback, EnergyFeedback } from '../../../game/useDailyGame';

export interface BossBattleCardProps {
  state: DailyGameState;
  attackCheck: AttackCheck;
  attacksAvailable: number;
  waterMlForNextAttack: number | null;
  lastAttack: AttackFeedback | null;
  lastEnergyGain: EnergyFeedback | null;
  lastReward: RewardGrant | null;
  onAttack: () => void;
  onClaimReward: () => void;
  onLogWater: () => void;
}

const BOSS_HIT_MS = 260;
const numberFormatter = new Intl.NumberFormat('zh-TW');

export const getAttackHint = (
  state: DailyGameState,
  attackCheck: AttackCheck,
  attacksAvailable: number,
  waterMlForNextAttack: number | null,
): string => {
  if (attackCheck.reason === 'boss-defeated') return '今天的 Boss 已被擊敗，明天再戰！';
  if (attackCheck.reason === 'not-enough-energy') {
    if (state.waterMl >= state.dailyGoalMl && state.dailyGoalMl > 0) {
      return '今日目標已達成，能量不再累積；剩餘能量不足以再攻擊。';
    }
    if (waterMlForNextAttack === null) {
      return '目前已無可累積的水能量；刪除紀錄不會重新轉換已獲得的能量。';
    }
    return `再喝 ${numberFormatter.format(waterMlForNextAttack)} ml 就能攻擊一次`;
  }
  return `可攻擊 ${attacksAvailable} 次，每次消耗 ${GAME_CONFIG.attackEnergyCost} 能量、造成 ${GAME_CONFIG.attackDamage} 傷害`;
};

export const BossBattleCard: React.FC<BossBattleCardProps> = ({
  state,
  attackCheck,
  attacksAvailable,
  waterMlForNextAttack,
  lastAttack,
  lastEnergyGain,
  lastReward,
  onAttack,
  onClaimReward,
  onLogWater,
}) => {
  const reduceMotion = useReducedMotion();
  const [bossHit, setBossHit] = useState(false);

  useEffect(() => {
    if (!lastAttack) return;
    setBossHit(true);
    const timer = window.setTimeout(() => setBossHit(false), BOSS_HIT_MS);
    return () => window.clearTimeout(timer);
  }, [lastAttack?.id]);

  const hpPercent = state.bossMaxHp > 0 ? Math.round((state.bossHp / state.bossMaxHp) * 100) : 0;
  const waterPercent =
    state.dailyGoalMl > 0
      ? Math.min(100, Math.round((state.waterMl / state.dailyGoalMl) * 100))
      : 0;
  const hint = getAttackHint(state, attackCheck, attacksAvailable, waterMlForNextAttack);
  const bossStateLabel = state.bossDefeated ? '已擊敗' : bossHit ? '受擊' : '待機';

  return (
    <motion.section
      className={`boss-card ${state.bossDefeated ? 'boss-card--defeated' : ''}`}
      aria-label="今日 Boss 戰鬥"
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <header className="boss-card__heading">
        <div>
          <span className="desktop-card-overline">今日 BOSS</span>
          <h2>
            {GAME_CONFIG.bossName}
            <small>Lv.{GAME_CONFIG.bossLevel}</small>
          </h2>
        </div>
        <ul className="boss-card__stats" aria-label="遊戲進度">
          <li title="連續擊敗 Boss 天數">
            <Flame size={14} aria-hidden="true" />
            <span>連續 {state.streakDays} 天</span>
          </li>
          <li title="累積點數">
            <img src={coinUrl} alt="" width={16} height={16} />
            <span>{numberFormatter.format(state.points)} 點</span>
          </li>
          <li title="累積寶箱">
            <Gift size={14} aria-hidden="true" />
            <span>{state.chests} 寶箱</span>
          </li>
        </ul>
      </header>

      <div
        className={`boss-stage ${bossHit ? 'boss-stage--hit' : ''}`}
        style={{ backgroundImage: `url(${deepSeaUrl})` }}
        data-boss-state={bossStateLabel}
      >
        <div className="boss-stage__hp" aria-label={`Boss HP ${state.bossHp} / ${state.bossMaxHp}`}>
          <div className="boss-stage__hp-row">
            <span>HP</span>
            <strong>
              {numberFormatter.format(state.bossHp)} / {numberFormatter.format(state.bossMaxHp)}
            </strong>
          </div>
          <div
            className="boss-hp-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={state.bossMaxHp}
            aria-valuenow={state.bossHp}
          >
            <motion.span
              className="boss-hp-bar__fill"
              initial={false}
              animate={{ width: `${hpPercent}%` }}
              transition={reduceMotion ? { duration: 0 } : { duration: 0.45, ease: 'easeOut' }}
            />
          </div>
        </div>

        <img
          className="boss-stage__player"
          src={playerAttackUrl}
          alt="玩家攻擊姿勢"
          width={150}
          height={150}
        />

        <AnimatePresence>
          {lastAttack && bossHit && (
            <motion.img
              key={`blast-${lastAttack.id}`}
              className="boss-stage__blast"
              src={waterBlastUrl}
              alt=""
              aria-hidden="true"
              initial={reduceMotion ? { opacity: 1 } : { opacity: 0, x: -60, scaleX: 0.6 }}
              animate={{ opacity: 1, x: 0, scaleX: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.2 }}
            />
          )}
        </AnimatePresence>

        <motion.img
          className="boss-stage__boss"
          src={bossHit ? whaleHitUrl : whaleIdleUrl}
          alt={`${GAME_CONFIG.bossName}（${bossStateLabel}）`}
          width={260}
          height={260}
          animate={
            reduceMotion || state.bossDefeated
              ? { x: 0, opacity: state.bossDefeated ? 0.45 : 1 }
              : bossHit
                ? { x: [0, -10, 8, -4, 0], opacity: 1 }
                : { x: 0, opacity: 1 }
          }
          transition={{ duration: 0.28 }}
        />

        <AnimatePresence>
          {lastAttack && bossHit && (
            <motion.strong
              key={`damage-${lastAttack.id}`}
              className="boss-stage__damage"
              initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 10, scale: 0.8 }}
              animate={{ opacity: 1, y: reduceMotion ? 0 : -18, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.25 }}
            >
              -{lastAttack.damage}
            </motion.strong>
          )}
        </AnimatePresence>

        {state.bossDefeated && (
          <div className="boss-stage__victory" role="status">
            <Trophy size={18} aria-hidden="true" />
            <span>擊敗 {GAME_CONFIG.bossName}！</span>
          </div>
        )}
      </div>

      <p className="boss-card__live" aria-live="polite">
        {lastAttack && bossHit
          ? `攻擊命中，Boss 損失 ${lastAttack.damage} HP`
          : lastEnergyGain
            ? `獲得 ${lastEnergyGain.energy} 水能量`
            : ''}
      </p>

      <div className="boss-card__meters">
        <div className="boss-meter">
          <div className="boss-meter__row">
            <span>
              <Droplets size={14} aria-hidden="true" />
              今日喝水
            </span>
            <strong>
              {numberFormatter.format(state.waterMl)} / {numberFormatter.format(state.dailyGoalMl)} ml
            </strong>
          </div>
          <div
            className="boss-meter__bar boss-meter__bar--water"
            role="progressbar"
            aria-label="今日喝水進度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={waterPercent}
          >
            <span style={{ width: `${waterPercent}%` }} />
          </div>
          <small>
            {state.waterMl >= state.dailyGoalMl && state.dailyGoalMl > 0
              ? '今天已達標，超出的水量不再增加能量'
              : `達標還差 ${numberFormatter.format(Math.max(0, state.dailyGoalMl - state.waterMl))} ml`}
          </small>
        </div>

        <div className="boss-energy">
          <img src={waterEnergyUrl} alt="" width={32} height={32} />
          <div>
            <span>目前水能量</span>
            <strong>{numberFormatter.format(state.waterEnergy)}</strong>
          </div>
          <AnimatePresence>
            {lastEnergyGain && (
              <motion.span
                key={`energy-${lastEnergyGain.id}`}
                className="boss-energy__gain"
                initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <img src={waterDropUrl} alt="" width={18} height={18} />
                +{lastEnergyGain.energy}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="boss-card__actions">
        <button type="button" className="boss-card__cta" onClick={onLogWater}>
          <Droplets size={18} aria-hidden="true" />
          記錄喝水
        </button>
        <button
          type="button"
          className="boss-card__attack"
          onClick={onAttack}
          disabled={!attackCheck.ok}
          aria-describedby="boss-attack-hint"
        >
          <Swords size={18} aria-hidden="true" />
          攻擊 Boss
          <small>消耗 {GAME_CONFIG.attackEnergyCost} 能量</small>
        </button>
      </div>
      <p id="boss-attack-hint" className="boss-card__hint">
        {hint}
      </p>

      {state.bossDefeated && (
        <div className="boss-reward" role="region" aria-label="擊敗獎勵">
          <div className="boss-reward__art" aria-hidden="true">
            <img src={chestUrl} alt="" width={96} height={79} />
            <img src={coinUrl} alt="" width={40} height={40} />
          </div>
          <div className="boss-reward__copy">
            <span className="desktop-card-overline">擊敗獎勵</span>
            <strong>
              +{GAME_CONFIG.defeatRewardPoints} 點數、+{GAME_CONFIG.defeatRewardChests} 寶箱
            </strong>
            <small>
              {state.rewardClaimed
                ? `今日獎勵已領取${lastReward ? `（+${lastReward.points} 點）` : ''}，連續擊敗 ${state.streakDays} 天`
                : '同一天的 Boss 獎勵只能領取一次'}
            </small>
          </div>
          <button
            type="button"
            className="boss-reward__claim"
            onClick={onClaimReward}
            disabled={state.rewardClaimed}
          >
            {state.rewardClaimed ? '已領取' : '領取獎勵'}
          </button>
        </div>
      )}
    </motion.section>
  );
};
