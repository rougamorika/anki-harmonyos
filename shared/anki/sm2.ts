/**
 * Anki SM-2 调度算法 — 纯函数实现
 *
 * 对应 Rust:
 *   rslib/src/scheduler/states/review.rs     (SM-2 间隔公式)
 *   rslib/src/scheduler/states/learning.rs   (学习步骤)
 *   rslib/src/scheduler/states/relearning.rs (重新学习)
 *   rslib/src/scheduler/states/new.rs        (新卡片)
 *   rslib/src/scheduler/answering/mod.rs     (答题流程)
 */

import type {
  CardRow,
  CardState,
  DeckConfig,
  LearnState,
  NewState,
  NormalState,
  RelearnState,
  ReviewRating,
  ReviewState,
  SchedTiming,
  SchedulingStates,
  StateContext,
} from './card.ts';
import {
  CardType,
  CardQueue,
  DEFAULT_DECK_CONFIG,
  EASE_FACTOR_AGAIN_DELTA,
  EASE_FACTOR_EASY_DELTA,
  EASE_FACTOR_HARD_DELTA,
  INITIAL_EASE_FACTOR,
  MINIMUM_EASE_FACTOR,
  buildStateContext,
} from './card.ts';

// ═══════════════════════════════════════════
// 状态推导
// ═══════════════════════════════════════════

/**
 * 从卡片数据库行推导当前状态。
 *
 * 对应 Rust `CardStateUpdater::current_card_state()`
 */
export function computeCurrentState(card: CardRow, timing: SchedTiming): CardState {
  switch (card.type) {
    case CardType.New:
      return newState(card.due);

    case CardType.Learn: {
      const remaining = card.left % 1000;
      return learnState(card, timing, remaining);
    }

    case CardType.Review: {
      const elapsed = Math.max(0, timing.daysElapsed - card.due);
      return reviewState(card, elapsed);
    }

    case CardType.Relearn: {
      const review = reviewForRelearn(card);
      const remaining = card.left % 1000;
      const learning = learnState(card, timing, remaining);
      return relearnState(learning, review);
    }

    default:
      return newState(0);
  }
}

function newState(position: number): NewState {
  return { kind: 'new', position };
}

function learnState(card: CardRow, timing: SchedTiming, remainingSteps: number): LearnState {
  const elapsed = Math.max(0, timing.now - card.due);
  return {
    kind: 'learn',
    remainingSteps,
    scheduledSecs: 0,
    elapsedSecs: elapsed,
  };
}

function reviewState(card: CardRow, elapsedDays: number): ReviewState {
  return {
    kind: 'review',
    scheduledDays: card.ivl,
    elapsedDays,
    easeFactor: card.factor > 0 ? card.factor / 1000 : INITIAL_EASE_FACTOR,
    lapses: card.lapses,
    leeched: false,
  };
}

function reviewForRelearn(card: CardRow): ReviewState {
  return {
    kind: 'review',
    scheduledDays: card.ivl,
    elapsedDays: 0,
    easeFactor: card.factor > 0 ? card.factor / 1000 : INITIAL_EASE_FACTOR,
    lapses: card.lapses,
    leeched: false,
  };
}

function relearnState(learning: LearnState, review: ReviewState): RelearnState {
  return { kind: 'relearn', learning, review };
}

// ═══════════════════════════════════════════
// 下一状态计算
// ═══════════════════════════════════════════

/**
 * 计算 4 个按钮的下一状态。
 *
 * 对应 Rust `CardState::next_states()`
 */
export function computeNextStates(
  current: CardState,
  ctx: StateContext,
): SchedulingStates {
  switch (current.kind) {
    case 'new':
      return computeNewNextStates(current, ctx);
    case 'learn':
      return computeLearningNextStates(current, ctx);
    case 'review':
      return computeReviewNextStates(current, ctx);
    case 'relearn':
      return computeRelearningNextStates(current, ctx);
  }
}

// ─── New ───

function computeNewNextStates(
  _current: NewState,
  ctx: StateContext,
): SchedulingStates {
  // New 状态的行为等同于学习第一张卡片按下 Again
  const initial: LearnState = {
    kind: 'learn',
    remainingSteps: remainingAfterFailed(ctx.steps),
    scheduledSecs: 0,
    elapsedSecs: 0,
  };
  const next = computeLearningNextStates(initial, ctx);
  return { ...next, current: _current };
}

// ─── Learning ───

function computeLearningNextStates(
  current: LearnState,
  ctx: StateContext,
): SchedulingStates {
  const steps = ctx.steps;

  const again: LearnState = {
    kind: 'learn',
    remainingSteps: remainingAfterFailed(steps),
    scheduledSecs: againDelaySecs(steps),
    elapsedSecs: 0,
  };

  const good = advanceLearning(current, steps, false, ctx);

  const easy: CardState = (() => {
    // Easy 直接毕业为 Review
    const ivl = ctx.graduatingIntervalEasy;
    return reviewStateNew(ivl, ctx.initialEaseFactor + EASE_FACTOR_EASY_DELTA, 0);
  })();

  return {
    current,
    again,
    hard: again, // Learning 中 Hard 等同于 Again
    good: good.nextStep > 0
      ? { kind: 'learn', remainingSteps: good.nextStep, scheduledSecs: good.scheduledSecs, elapsedSecs: 0 }
      : reviewStateNew(good.graduatingIvl, ctx.initialEaseFactor, 0),
    easy,
  };
}

function advanceLearning(
  current: LearnState,
  steps: number[],
  _isRelearn: boolean,
  ctx: StateContext,
): { nextStep: number; scheduledSecs: number; graduatingIvl: number } {
  const remaining = current.remainingSteps;

  if (remaining <= 1) {
    // 最后一步 — 毕业
    return {
      nextStep: 0,
      scheduledSecs: 0,
      graduatingIvl: ctx.graduatingIntervalGood,
    };
  }

  // 还有更多步骤
  const stepIdx = steps.length - remaining;
  const nextDelay = (steps[stepIdx] ?? 1) * 60; // 分钟 → 秒

  return {
    nextStep: remaining - 1,
    scheduledSecs: nextDelay,
    graduatingIvl: 0,
  };
}

// ─── Review ───

function computeReviewNextStates(
  current: ReviewState,
  ctx: StateContext,
): SchedulingStates {
  const [hardIvl, goodIvl, easyIvl] = passingReviewIntervals(current, ctx);

  return {
    current,
    again: computeReviewAgain(current, ctx),
    hard: reviewAnswer(hardIvl, current.easeFactor + EASE_FACTOR_HARD_DELTA, current.lapses),
    good: reviewAnswer(goodIvl, current.easeFactor, current.lapses),
    easy: reviewAnswer(easyIvl, current.easeFactor + EASE_FACTOR_EASY_DELTA, current.lapses),
  };
}

function reviewAnswer(scheduledDays: number, easeFactor: number, lapses: number): ReviewState {
  return {
    kind: 'review',
    scheduledDays,
    elapsedDays: 0,
    easeFactor: Math.max(easeFactor, MINIMUM_EASE_FACTOR),
    lapses,
    leeched: false,
  };
}

function computeReviewAgain(
  current: ReviewState,
  ctx: StateContext,
): CardState {
  const lapses = current.lapses + 1;
  const leeched = isLeeched(lapses, ctx.leechThreshold);
  const [failingIvl] = failingReviewInterval(current, ctx);

  const againReview: ReviewState = {
    kind: 'review',
    scheduledDays: Math.max(1, Math.round(failingIvl)),
    elapsedDays: 0,
    easeFactor: Math.max(current.easeFactor + EASE_FACTOR_AGAIN_DELTA, MINIMUM_EASE_FACTOR),
    lapses,
    leeched,
  };

  const relearnSteps = ctx.relearnSteps;
  const againDelay = relearnSteps.length > 0 ? (relearnSteps[0] ?? 10) * 60 : 0;

  if (againDelay > 0 && failingIvl >= 0.5) {
    // 有重新学习步骤且间隔足够长
    return {
      kind: 'relearn',
      learning: {
        kind: 'learn',
        remainingSteps: remainingAfterFailed(relearnSteps),
        scheduledSecs: againDelay,
        elapsedSecs: 0,
      },
      review: againReview,
    };
  }

  // 短期 — 直接进入 review (无 learning 步骤)
  return againReview;
}

/**
 * SM-2 通过间隔计算 (hard/good/easy)。
 *
 * 对应 Rust `ReviewState::passing_review_intervals()`
 */
function passingReviewIntervals(
  state: ReviewState,
  ctx: StateContext,
): [number, number, number] {
  const current = Math.max(state.scheduledDays, 1);
  const daysLate = Math.max(0, state.elapsedDays - state.scheduledDays);

  // Hard
  const hardMin = ctx.hardMultiplier > 1.0 ? state.scheduledDays + 1 : 0;
  const hardIvl = constrainInterval(
    current * ctx.hardMultiplier * ctx.intervalMultiplier,
    hardMin,
    ctx.maximumReviewInterval,
    ctx.fuzzFactor,
  );

  // Good
  const goodMin = ctx.hardMultiplier > 1.0 ? hardIvl + 1 : state.scheduledDays + 1;
  const goodBase = (current + daysLate / 2) * state.easeFactor * ctx.intervalMultiplier;
  const goodIvl = constrainInterval(goodBase, goodMin, ctx.maximumReviewInterval, ctx.fuzzFactor);

  // Easy
  const easyBase = (current + daysLate) * state.easeFactor * ctx.easyMultiplier * ctx.intervalMultiplier;
  const easyIvl = constrainInterval(easyBase, goodIvl + 1, ctx.maximumReviewInterval, ctx.fuzzFactor);

  return [hardIvl, goodIvl, easyIvl];
}

function constrainInterval(
  interval: number,
  minimum: number,
  maximum: number,
  fuzzFactor: number | undefined,
): number {
  const min = Math.max(1, Math.min(minimum, Math.max(1, maximum)));
  const max = Math.max(1, maximum);

  if (fuzzFactor !== undefined) {
    // fuzz: interval * (0.95 + fuzzFactor * 0.1)
    const fuzzed = Math.round(interval * (0.95 + fuzzFactor * 0.1));
    return Math.max(min, Math.min(fuzzed, max));
  }

  return Math.max(min, Math.min(Math.round(interval), max));
}

function failingReviewInterval(
  state: ReviewState,
  ctx: StateContext,
): [number, undefined] {
  const base = Math.max(state.scheduledDays, 1) * ctx.lapseMultiplier;
  const ivl = constrainInterval(
    base,
    ctx.minimumLapseInterval,
    ctx.maximumReviewInterval,
    ctx.fuzzFactor,
  );
  return [ivl, undefined];
}

// ─── Relearning ───

function computeRelearningNextStates(
  current: RelearnState,
  ctx: StateContext,
): SchedulingStates {
  const steps = ctx.relearnSteps;

  // Again — 重置重新学习步骤
  const againLearning: LearnState = {
    kind: 'learn',
    remainingSteps: remainingAfterFailed(steps),
    scheduledSecs: againDelaySecs(steps),
    elapsedSecs: 0,
  };

  // Good — 推进重新学习步骤
  const good = advanceLearning(current.learning, steps, true, ctx);

  return {
    current,
    again: { kind: 'relearn', learning: againLearning, review: current.review },
    hard: { kind: 'relearn', learning: againLearning, review: current.review },
    good: good.nextStep > 0
      ? {
          kind: 'relearn',
          learning: { kind: 'learn', remainingSteps: good.nextStep, scheduledSecs: good.scheduledSecs, elapsedSecs: 0 },
          review: current.review,
        }
      : current.review, // 毕业 → Review
    easy: current.review, // Easy → 直接 Review (等价于 Good 毕业)
  };
}

// ═══════════════════════════════════════════
// 应用评分
// ═══════════════════════════════════════════

export interface CardUpdate {
  type: CardType;
  queue: CardQueue;
  due: number;
  ivl: number;
  factor: number;
  reps: number;
  lapses: number;
  left: number;
}

/**
 * 应用评分并返回更新后的卡片字段。
 *
 * @param card 原始卡片行
 * @param states 调度状态集
 * @param rating 用户评分
 * @param timing 当前计时
 * @param config 牌组配置
 * @returns 卡片更新值 + 是否 leech
 */
export function applyRating(
  card: CardRow,
  states: SchedulingStates,
  rating: ReviewRating,
  timing: SchedTiming,
  config: DeckConfig = DEFAULT_DECK_CONFIG,
): { update: CardUpdate; leeched: boolean } {
  const next = pickState(states, rating);
  const update = stateToUpdate(next, timing, card.reps + 1);

  const leeched = (next.kind === 'review' && next.leeched)
    || (next.kind === 'relearn' && next.review.leeched);

  if (leeched && config.leechSuspend) {
    update.queue = CardQueue.Suspended;
  }

  return { update, leeched };
}

function pickState(states: SchedulingStates, rating: ReviewRating): CardState {
  switch (rating) {
    case 'again': return states.again;
    case 'hard': return states.hard;
    case 'good': return states.good;
    case 'easy': return states.easy;
  }
}

function stateToUpdate(state: CardState, timing: SchedTiming, newReps: number): CardUpdate {
  switch (state.kind) {
    case 'new':
      return {
        type: CardType.New,
        queue: CardQueue.New,
        due: state.position,
        ivl: 0,
        factor: 0,
        reps: newReps,
        lapses: 0,
        left: 0,
      };

    case 'learn': {
      const stepSecs = state.scheduledSecs;
      if (stepSecs >= 86400) {
        // 跨天学习
        return {
          type: CardType.Learn,
          queue: CardQueue.DayLearn,
          due: timing.daysElapsed + Math.ceil(stepSecs / 86400),
          ivl: 0,
          factor: 0,
          reps: newReps,
          lapses: 0,
          left: state.remainingSteps,
        };
      }
      return {
        type: CardType.Learn,
        queue: CardQueue.Learn,
        due: timing.now + stepSecs,
        ivl: 0,
        factor: 0,
        reps: newReps,
        lapses: 0,
        left: state.remainingSteps,
      };
    }

    case 'review':
      return {
        type: CardType.Review,
        queue: CardQueue.Review,
        due: timing.daysElapsed + state.scheduledDays,
        ivl: state.scheduledDays,
        factor: Math.round(state.easeFactor * 1000),
        reps: newReps,
        lapses: state.lapses,
        left: 0,
      };

    case 'relearn': {
      const learning = state.learning;
      const review = state.review;
      const stepSecs = learning.scheduledSecs;

      if (stepSecs >= 86400) {
        return {
          type: CardType.Relearn,
          queue: CardQueue.DayLearn,
          due: timing.daysElapsed + Math.ceil(stepSecs / 86400),
          ivl: review.scheduledDays,
          factor: Math.round(review.easeFactor * 1000),
          reps: newReps,
          lapses: review.lapses,
          left: learning.remainingSteps,
        };
      }
      return {
        type: CardType.Relearn,
        queue: CardQueue.Learn,
        due: timing.now + stepSecs,
        ivl: review.scheduledDays,
        factor: Math.round(review.easeFactor * 1000),
        reps: newReps,
        lapses: review.lapses,
        left: learning.remainingSteps,
      };
    }
  }
}

// ═══════════════════════════════════════════
// 辅助函数
// ═══════════════════════════════════════════

function remainingAfterFailed(steps: number[]): number {
  return steps.length;
}

function againDelaySecs(steps: number[]): number {
  return (steps[0] ?? 1) * 60;
}

function reviewStateNew(ivl: number, ease: number, lapses: number): ReviewState {
  return {
    kind: 'review',
    scheduledDays: ivl,
    elapsedDays: 0,
    easeFactor: Math.max(ease, MINIMUM_EASE_FACTOR),
    lapses,
    leeched: false,
  };
}

/** Leech 检测 — 对应 Rust `leech_threshold_met()` */
export function isLeeched(lapses: number, threshold: number): boolean {
  if (threshold <= 0) return false;
  const half = Math.max(1, Math.ceil(threshold / 2));
  return lapses >= threshold && (lapses - threshold) % half === 0;
}

/** 简单的 fuzz 种子生成 — 对应 Rust `get_fuzz_seed()` */
export function fuzzSeed(cardId: number, reps: number): number | undefined {
  return (cardId + reps) >>> 0;
}

/**
 * 从 fuzz 种子生成 fuzz factor (0.0-1.0)。
 * 简化版 — 真实实现使用完整的 RNG。
 */
export function fuzzFactor(seed: number | undefined): number | undefined {
  if (seed === undefined) return undefined;
  // Mulberry32 PRNG — 确定性伪随机
  let s = seed | 0;
  s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return r;
}
