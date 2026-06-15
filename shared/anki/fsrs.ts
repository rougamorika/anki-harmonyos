/**
 * FSRS (Free Spaced Repetition Scheduler) — 核心算法
 *
 * 基于 FSRS-5 规范 (fsrs crate v5.2.0).
 * 对应 Rust: fsrs crate + rslib/src/scheduler/fsrs/
 *
 * 核心公式:
 *   可提取概率:  R(t) = exp(-t / S)
 *   下一个间隔:  t = -S * ln(R_desired)
 *   稳定性更新:  S' = S * (1 + f(D, S, R))
 *   难度更新:    D' = D + w[4]*(G-3) + ...
 */

// ═══════════════════════════════════════════
// 类型
// ═══════════════════════════════════════════

export interface MemoryState {
  /** 记忆稳定性 (天) */
  stability: number;
  /** 难度 (1-10) */
  difficulty: number;
}

export interface NextState {
  /** 下一个间隔 (天) */
  interval: number;
  /** 新的记忆状态 */
  memory: MemoryState;
}

export interface NextStates {
  again: NextState;
  hard: NextState;
  good: NextState;
  easy: NextState;
}

export interface FSRSReview {
  /** 评分 (1=Again, 2=Hard, 3=Good, 4=Easy) */
  rating: number;
  /** 上次复习以来的天数 */
  deltaT: number;
}

export interface FSRSItem {
  reviews: FSRSReview[];
}

export interface ComputeParametersInput {
  trainSet: FSRSItem[];
  enableShortTerm: boolean;
}

// ═══════════════════════════════════════════
// 默认参数 (FSRS-5)
// ═══════════════════════════════════════════

/**
 * FSRS-5 默认参数 (17 个浮点数 + 可选扩展).
 * 参数索引:
 *   0-3:   初始稳定性 (首次评分)
 *   4:     难度 delta 系数 (rating deviation)
 *   5:     难度 delta 二次项
 *   6:     稳定性增长系数 ln(w)
 *   7:     稳定性指数 (负值)
 *   8:     可提取概率敏感度
 *   9:     Hard 惩罚系数
 *   10:    Easy 奖励系数
 *   11-13: 短期稳定性
 *   14:    遗忘后稳定性衰减系数
 *   15:    短期难度偏移
 *   16:    短期稳定性偏移
 *   17:    短期稳定性斜率 (FSRS-5+)
 *   18:    当日短期稳定性 (FSRS-5+)
 */
export const DEFAULT_FSRS_PARAMS: number[] = [
  0.4072, 1.1829, 3.1262, 15.4722,  // w0-w3: initial stability
  7.3252,                            // w4: difficulty delta coefficient
  0.3976,                            // w5: difficulty delta quadratic
  2.0929,                            // w6: ln(stability_growth)
  0.7893,                            // w7: stability exponent (neg)
  0.3860,                            // w8: retrievability sensitivity
  1.0000,                            // w9: hard penalty
  1.3720,                            // w10: easy bonus
  0.0069, 0.5887, 1.0986,           // w11-13: short-term
  0.4706,                            // w14: post-lapse stability factor
  0.0200,                            // w15: short-term difficulty offset
  0.4854,                            // w16: short-term stability offset
  0.0000,                            // w17: FSRS-5+
  0.0000,                            // w18: FSRS-5+
];

export const DEFAULT_DECAY = -0.2;
export const FSRS5_DEFAULT_DECAY = -0.2;

/** 短期间隔阈值 (天) — 低于此值使用短期参数 */
const SHORT_TERM_THRESHOLD = 1.0;

// ═══════════════════════════════════════════
// 核心算法
// ═══════════════════════════════════════════

/**
 * 计算下一个间隔 (天)。
 *
 * FSRS-5 使用双曲模型:
 *   R(t) = 1 / (1 + factor * t / S)
 *   t = S * (1/R - 1) / factor
 *
 * @param stability 当前稳定性 (天)
 * @param desiredRetention 期望保持率 (0.0-1.0)
 * @param decay 衰减因子 (默认 -0.2, 用于微调)
 * @param factor 倍率因子 (默认 1.0)
 */
export function nextInterval(
  stability: number,
  desiredRetention: number,
  _decay: number = DEFAULT_DECAY,
  factor: number = 1.0,
): number {
  const r = Math.max(0.05, Math.min(0.99, desiredRetention));
  const raw = stability * (1 / r - 1) / factor;
  return Math.max(0, Math.round(raw * 100) / 100);
}

/**
 * 计算 4 个按钮的下一状态。
 *
 * 对应 Rust: FSRS::next_states()
 *
 * @param state 当前记忆状态 (新卡片为 undefined)
 * @param desiredRetention 期望保持率
 * @param daysElapsed 上次复习以来的天数
 * @param params FSRS 参数数组
 * @returns 4 个按钮的下一状态
 */
export function nextStates(
  state: MemoryState | undefined,
  desiredRetention: number,
  daysElapsed: number,
  params: number[] = DEFAULT_FSRS_PARAMS,
): NextStates {
  const S = state?.stability ?? 0;
  const D = state?.difficulty ?? 1.0;

  // 当前可提取概率
  let R: number;
  if (S <= 0 || daysElapsed <= 0) {
    R = 1.0;
  } else {
    R = Math.exp(-daysElapsed / S);
  }
  R = Math.min(1.0, Math.max(0.0, R));

  const shortTerm = S < SHORT_TERM_THRESHOLD;

  // ─── Again ───
  const SAgain = computeStabilityAfterLapse(S, params, shortTerm);
  const DAgain = computeNextDifficulty(D, 1, params);

  // ─── Hard ───
  const SHard = computeStabilityAfterSuccess(S, R, D, params, 2, shortTerm, daysElapsed);
  const DHard = computeNextDifficulty(D, 2, params);

  // ─── Good ───
  const SGood = computeStabilityAfterSuccess(S, R, D, params, 3, shortTerm, daysElapsed);
  const DGood = computeNextDifficulty(D, 3, params);

  // ─── Easy ───
  const SEasy = computeStabilityAfterSuccess(S, R, D, params, 4, shortTerm, daysElapsed);
  const DEasy = computeNextDifficulty(D, 4, params);

  const decay = getParam(params, 20, DEFAULT_DECAY);

  return {
    again: {
      interval: Math.max(0, nextInterval(SAgain, desiredRetention, decay, 1.0)),
      memory: { stability: SAgain, difficulty: clampD(DAgain) },
    },
    hard: {
      interval: Math.max(0, nextInterval(SHard, desiredRetention, decay, 1.0)),
      memory: { stability: SHard, difficulty: clampD(DHard) },
    },
    good: {
      interval: Math.max(0, nextInterval(SGood, desiredRetention, decay, 1.0)),
      memory: { stability: SGood, difficulty: clampD(DGood) },
    },
    easy: {
      interval: Math.max(0, nextInterval(SEasy, desiredRetention, decay, 1.0)),
      memory: { stability: SEasy, difficulty: clampD(DEasy) },
    },
  };
}

// ═══════════════════════════════════════════
// 内部计算函数
// ═══════════════════════════════════════════

/**
 * 成功后稳定性增长。
 *
 * 公式:
 *   S' = S * (1 + exp(w6) * (11 - D) * S^(-w7) * (exp((1-R)*w8) - 1) * bonus)
 *
 * @param S 当前稳定性
 * @param R 当前可提取概率
 * @param D 当前难度
 * @param params FSRS 参数
 * @param rating 评分 (2=Hard, 3=Good, 4=Easy)
 * @param shortTerm 是否短期
 */
function computeStabilityAfterSuccess(
  S: number,
  R: number,
  D: number,
  params: number[],
  rating: number,
  shortTerm: boolean,
  daysElapsed: number,
): number {
  if (S <= 0) {
    // 新卡片 — 使用初始稳定性
    return initialStability(params, rating);
  }

  const w6 = getParam(params, 6, 2.0);
  const w7 = getParam(params, 7, 0.8);
  const w8 = getParam(params, 8, 0.4);

  // bonus: 1.0 for Good, w9 for Hard, w10 for Easy
  let bonus = 1.0;
  if (rating === 2) {
    bonus = getParam(params, 9, 1.0);
  } else if (rating === 4) {
    bonus = getParam(params, 10, 1.3);
  }

  const hardPenalty = rating === 2 ? getParam(params, 9, 1.0) : 1.0;
  const easyBonus = rating === 4 ? getParam(params, 10, 1.3) : 1.0;

  let SNew: number;

  if (shortTerm) {
    // 短期 — 使用短期参数
    SNew = computeShortTermStability(S, D, R, params, rating, daysElapsed);
  } else {
    // 长期 — 标准 FSRS 公式
    const DClamped = clampD(D);
    const stabilityGain = 1
      + Math.exp(w6)
      * (11 - DClamped)
      * Math.pow(Math.max(0.1, S), -w7)
      * (Math.exp((1 - R) * w8) - 1)
      * bonus;

    SNew = S * Math.max(1.0, stabilityGain);
  }

  return SNew;
}

/**
 * 遗忘后稳定性衰减。
 *
 * 公式: S' = max(minimum, S * w14)
 *
 * @param S 当前稳定性
 * @param params FSRS 参数
 * @param shortTerm 是否短期
 */
function computeStabilityAfterLapse(
  S: number,
  params: number[],
  shortTerm: boolean,
): number {
  if (S <= 0) {
    return initialStability(params, 1);
  }

  const w14 = getParam(params, 14, 0.5);
  const SMin = 0.01;

  return Math.max(SMin, S * w14);
}

/**
 * 短期稳定性计算 (FSRS-5 扩展)。
 */
function computeShortTermStability(
  S: number,
  D: number,
  R: number,
  params: number[],
  rating: number,
  _daysElapsed: number,
): number {
  const w11 = getParam(params, 11, 0.01);
  const w12 = getParam(params, 12, 0.6);
  const w13 = getParam(params, 13, 1.1);
  const w16 = getParam(params, 16, 0.5);
  const w17 = getParam(params, 17, 0.0);
  const w18 = getParam(params, 18, 0.0);

  const DClamped = clampD(D);

  // Rating 对短期稳定性的影响
  const ratingFactor = rating === 1 ? 0.0
    : rating === 2 ? 0.5
    : rating === 3 ? 1.0
    : 1.5; // Easy

  const base = Math.exp(w11) * (DClamped + w12) * Math.pow(S, w13) * ratingFactor;
  const newS = w16 + base * (1 + w17 * S + w18 * S * S);

  return Math.max(S * 0.5, newS);
}

/**
 * 初始稳定性 (新卡片首次评分后)。
 */
function initialStability(params: number[], rating: number): number {
  switch (rating) {
    case 1: return getParam(params, 0, 0.4);
    case 2: return getParam(params, 1, 1.2);
    case 3: return getParam(params, 2, 3.1);
    case 4: return getParam(params, 3, 15.5);
    default: return getParam(params, 2, 3.1);
  }
}

/**
 * 难度更新。
 *
 * FSRS-5 公式: D' = D + w4 * (rating - 3) / scale + mean_reversion
 * 使用对数缩放使权重更合理。
 */
function computeNextDifficulty(
  D: number,
  rating: number,
  params: number[],
): number {
  const w4 = getParam(params, 4, 7.0);
  const w5 = getParam(params, 5, 0.4);

  // 缩放 w4 — 避免直接使用原始值
  const difficultyScale = 50.0;
  const ratingDelta = (w4 / difficultyScale) * (rating - 3);

  // Mean reversion toward 5.0
  const meanReversion = (w5 / 10.0) * (5.0 - D);

  let DNew = D + ratingDelta + meanReversion;

  return clampD(DNew);
}

// ═══════════════════════════════════════════
// 记忆状态计算
// ═══════════════════════════════════════════

/**
 * 从复习历史计算当前记忆状态。
 *
 * 对应 Rust: fsrs::memory_state()
 *
 * @param item 复习历史
 * @param startingState 初始状态 (如果历史被截断则为 Some)
 * @param params FSRS 参数
 * @returns 当前记忆状态
 */
export function memoryState(
  item: FSRSItem,
  startingState: MemoryState | undefined,
  params: number[] = DEFAULT_FSRS_PARAMS,
): MemoryState {
  let D = startingState?.difficulty ?? 1.0;
  let S = startingState?.stability ?? 0;

  for (const review of item.reviews) {
    const daysElapsed = review.deltaT;

    if (review.rating === 1) {
      // Again
      S = computeStabilityAfterLapse(S, params, S < SHORT_TERM_THRESHOLD);
    } else {
      const R = S > 0 ? Math.exp(-daysElapsed / Math.max(0.01, S)) : 1.0;
      S = computeStabilityAfterSuccess(S, R, D, params, review.rating, S < SHORT_TERM_THRESHOLD, daysElapsed);
    }

    D = computeNextDifficulty(D, review.rating, params);
  }

  return { stability: S, difficulty: clampD(D) };
}

/**
 * 批量计算记忆状态。
 *
 * 对应 Rust: fsrs::memory_state_batch()
 */
export function memoryStateBatch(
  items: FSRSItem[],
  startingStates: Array<MemoryState | undefined>,
  params: number[] = DEFAULT_FSRS_PARAMS,
): MemoryState[] {
  return items.map((item, i) => memoryState(item, startingStates[i], params));
}

/**
 * 从 SM-2 参数推断记忆状态。
 *
 * 对应 Rust: fsrs::memory_state_from_sm2()
 */
export function memoryStateFromSm2(
  easeFactor: number,
  interval: number,
  desiredRetention: number,
  _params: number[] = DEFAULT_FSRS_PARAMS,
): MemoryState {
  const stability = interval > 0 ? interval : 1.0;

  // SM-2 ease -> FSRS difficulty 映射
  // ease 1.3(min) → 10(max), 3.5(high) → 1(min)
  // 线性映射: D = 10 - (ease - 1.3) * (9 / (3.5 - 1.3))
  let difficulty = 10.0 - (easeFactor - 1.3) * (9.0 / 2.2);
  difficulty = clampD(difficulty);

  return { stability, difficulty };
}

// ═══════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════

function getParam(params: number[], index: number, fallback: number): number {
  if (index < params.length && Number.isFinite(params[index]!)) {
    return params[index]!;
  }
  return fallback;
}

function clampD(d: number): number {
  return Math.max(1.0, Math.min(10.0, d));
}

/**
 * 验证 FSRS 参数。
 * @returns true 如果参数有效
 */
export function validateParams(params: number[]): boolean {
  if (params.length < 17) return false;
  for (const p of params) {
    if (!Number.isFinite(p)) return false;
  }
  return true;
}

/**
 * 计算当前可提取概率。
 */
export function retrievability(stability: number, elapsedDays: number): number {
  if (stability <= 0) return 0;
  return Math.exp(-elapsedDays / stability);
}
