/**
 * Anki SM-2 调度算法 — 单元测试
 *
 * 对照 Rust 测试: rslib/src/scheduler/answering/mod.rs:state_application()
 *
 * 运行: npx tsx harmony/tests/sm2.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  type CardState,
  type CardRow,
  type SchedTiming,
  type SchedulingStates,
  type StateContext,
  CardType,
  CardQueue,
  DEFAULT_DECK_CONFIG,
  buildStateContext,
  INITIAL_EASE_FACTOR,
  MINIMUM_EASE_FACTOR,
} from '../shared/anki/card.ts';

import {
  computeCurrentState,
  computeNextStates,
  applyRating,
  isLeeched,
  fuzzSeed,
  fuzzFactor,
} from '../shared/anki/sm2.ts';

// ─── 测试工具 ───

function newCard(overrides: Partial<CardRow> = {}): CardRow {
  return {
    id: 1001,
    nid: 2001,
    did: 1,
    ord: 0,
    type: CardType.New,
    queue: CardQueue.New,
    due: 0,
    ivl: 0,
    factor: 0,
    reps: 0,
    lapses: 0,
    left: 0,
    odue: 0,
    odid: 0,
    flags: 0,
    data: '',
    ...overrides,
  };
}

function timing(daysElapsed: number = 0, now: number = 1000000): SchedTiming {
  return {
    daysElapsed,
    nextDayAt: now + 86400,
    now,
  };
}

function ctx(overrides: Partial<StateContext> = {}): StateContext {
  return { ...buildStateContext(DEFAULT_DECK_CONFIG), ...overrides };
}

function ctxNoFuzz(): StateContext {
  const c = buildStateContext(DEFAULT_DECK_CONFIG);
  c.fuzzFactor = undefined; // 禁用 fuzz
  return c;
}

function findState(states: SchedulingStates, rating: string): CardState {
  switch (rating) {
    case 'again': return states.again;
    case 'hard': return states.hard;
    case 'good': return states.good;
    case 'easy': return states.easy;
    default: throw new Error('unknown rating');
  }
}

// ═══════════════════════════════════════════
// 状态推导
// ═══════════════════════════════════════════

test('computeCurrentState: 新卡片', () => {
  const card = newCard({ due: 5 });
  const state = computeCurrentState(card, timing());
  assert.equal(state.kind, 'new');
  assert.equal((state as { position: number }).position, 5);
});

test('computeCurrentState: 学习中的卡片', () => {
  const card = newCard({
    type: CardType.Learn,
    queue: CardQueue.Learn,
    due: 1000000 - 60, // 60 秒前到期
    left: 2, // 剩余 2 步
  });
  const state = computeCurrentState(card, timing());
  assert.equal(state.kind, 'learn');
  const ls = state as { kind: 'learn'; remainingSteps: number; elapsedSecs: number };
  assert.equal(ls.remainingSteps, 2);
  assert.ok(ls.elapsedSecs >= 60, `已过 ${ls.elapsedSecs} 秒`);
});

test('computeCurrentState: 复习卡片 (按时)', () => {
  const card = newCard({
    type: CardType.Review,
    queue: CardQueue.Review,
    due: 0, // 今天到期
    ivl: 10,
    factor: 2500,
    lapses: 2,
  });
  const state = computeCurrentState(card, timing(0));
  assert.equal(state.kind, 'review');
  const rs = state as { kind: 'review'; scheduledDays: number; elapsedDays: number };
  assert.equal(rs.scheduledDays, 10);
  assert.equal(rs.elapsedDays, 0);
  assert.equal(rs.lapses, 2);
});

test('computeCurrentState: 复习卡片 (迟到 5 天)', () => {
  const card = newCard({
    type: CardType.Review,
    queue: CardQueue.Review,
    due: 0,
    ivl: 10,
    factor: 2500,
    lapses: 0,
  });
  const state = computeCurrentState(card, timing(5));
  assert.equal(state.kind, 'review');
  const rs = state as { kind: 'review'; elapsedDays: number };
  assert.equal(rs.elapsedDays, 5);
});

test('computeCurrentState: 重新学习中的卡片', () => {
  const card = newCard({
    type: CardType.Relearn,
    queue: CardQueue.Learn,
    due: 999940,
    ivl: 1,
    factor: 2450,
    lapses: 1,
    left: 1,
  });
  const state = computeCurrentState(card, timing(0, 1000000));
  assert.equal(state.kind, 'relearn');
});

// ═══════════════════════════════════════════
// New → Learning (对应 Rust 测试: state_application new->learning)
// ═══════════════════════════════════════════

test('SM-2: New → Again → Learning (step 重置)', () => {
  const card = newCard();
  const current = computeCurrentState(card, timing());
  assert.equal(current.kind, 'new');

  const states = computeNextStates(current, ctxNoFuzz());

  // Again → Learning，有 2 个剩余步骤 (learnSteps=[1,10])
  assert.equal(states.again.kind, 'learn');
  const again = states.again as { kind: 'learn'; remainingSteps: number };
  assert.equal(again.remainingSteps, 2, '应重置为 2 步 (对应 [1, 10] 共 2 步)');

  // Good → Learning (第 1 步完成，剩余 1 步)
  assert.equal(states.good.kind, 'learn');
  const good = states.good as { kind: 'learn'; remainingSteps: number };
  assert.equal(good.remainingSteps, 1);

  // Easy → Review (跳过学习，直接毕业)
  assert.equal(states.easy.kind, 'review');
  const easy = states.easy as { kind: 'review'; scheduledDays: number };
  assert.equal(easy.scheduledDays, DEFAULT_DECK_CONFIG.graduatingIntervalEasy);
});

// ═══════════════════════════════════════════
// Learning → Review (毕业)
// ═══════════════════════════════════════════

test('SM-2: Learning (最后一步) → Good → Review (毕业)', () => {
  const card = newCard({
    type: CardType.Learn,
    queue: CardQueue.Learn,
    due: 999940,
    left: 1, // 仅剩 1 步
    factor: 0,
  });
  const current = computeCurrentState(card, timing(0, 1000000));
  assert.equal(current.kind, 'learn');
  const ls = current as { kind: 'learn'; remainingSteps: number };
  assert.equal(ls.remainingSteps, 1);

  const states = computeNextStates(current, ctxNoFuzz());
  // Good → Review (毕业!)
  assert.equal(states.good.kind, 'review');
  const good = states.good as { kind: 'review'; scheduledDays: number; easeFactor: number };
  assert.equal(good.scheduledDays, DEFAULT_DECK_CONFIG.graduatingIntervalGood);
  assert.equal(good.easeFactor, INITIAL_EASE_FACTOR);
});

// ═══════════════════════════════════════════
// Review → Review (SM-2 间隔)
// ═══════════════════════════════════════════

test('SM-2: Review → Good (标准间隔)', () => {
  const card = newCard({
    type: CardType.Review,
    queue: CardQueue.Review,
    due: 0,
    ivl: 1,
    factor: 2500,
    reps: 5,
    lapses: 0,
  });
  const current = computeCurrentState(card, timing());
  assert.equal(current.kind, 'review');

  const states = computeNextStates(current, ctxNoFuzz());

  // Good: ivl = current * ease * interval_multiplier
  //      = 1 * 2.5 * 1.0 = 2.5 ≈ 3 (round)
  assert.equal(states.good.kind, 'review');
  const good = states.good as { kind: 'review'; scheduledDays: number };
  assert.ok(good.scheduledDays >= 2, `期望 ≥ 2，实际 ${good.scheduledDays}`);
});

test('SM-2: Review → Easy (加速间隔)', () => {
  const card = newCard({
    type: CardType.Review,
    queue: CardQueue.Review,
    due: 0,
    ivl: 1,
    factor: 2500,
    reps: 5,
    lapses: 0,
  });
  const current = computeCurrentState(card, timing());
  const states = computeNextStates(current, ctxNoFuzz());

  // Easy: ivl = current * ease * easy_multiplier * interval_multiplier
  //          = 1 * 2.5 * 1.3 * 1.0 = 3.25 ≈ 3
  assert.equal(states.easy.kind, 'review');
  const easy = states.easy as { kind: 'review'; scheduledDays: number; easeFactor: number };
  assert.ok(easy.scheduledDays >= 3, `期望 ≥ 3，实际 ${easy.scheduledDays}`);
  assert.ok(easy.easeFactor > 2.5, `简易度应增加`);
});

test('SM-2: Review → Hard (最低间隔增长)', () => {
  const card = newCard({
    type: CardType.Review,
    queue: CardQueue.Review,
    due: 0,
    ivl: 5,
    factor: 2500,
    reps: 5,
    lapses: 0,
  });
  const current = computeCurrentState(card, timing());
  const states = computeNextStates(current, ctxNoFuzz());

  // Hard: ivl = current * hardMultiplier * interval_multiplier
  //           = 5 * 1.2 * 1.0 = 6.0
  const hard = states.hard as { kind: 'review'; scheduledDays: number };
  assert.ok(hard.scheduledDays >= 5, `Hard 间隔 ${hard.scheduledDays} 应 ≥ 当前间隔 5`);
});

test('SM-2: Review → Again → Relearning (遗忘)', () => {
  const card = newCard({
    type: CardType.Review,
    queue: CardQueue.Review,
    due: 0,
    ivl: 10,
    factor: 2500,
    reps: 10,
    lapses: 0,
  });
  const current = computeCurrentState(card, timing());
  const states = computeNextStates(current, ctxNoFuzz());

  // Again: 因为 lapse_multiplier=0 导致 failing_interval 可能为 0
  // 使用 min_lapse_interval=1
  assert.ok(
    states.again.kind === 'relearn' || states.again.kind === 'review',
    `Again 状态: ${states.again.kind}`,
  );

  if (states.again.kind === 'relearn') {
    const again = states.again as { kind: 'relearn'; review: { lapses: number; easeFactor: number } };
    assert.equal(again.review.lapses, 1, 'lapses 应增加到 1');
    assert.ok(again.review.easeFactor < 2.5, `ease 应降低: ${again.review.easeFactor}`);
  }
});

// ═══════════════════════════════════════════
// Relearning
// ═══════════════════════════════════════════

test('SM-2: Relearning → Good (完成重新学习)', () => {
  const card = newCard({
    type: CardType.Relearn,
    queue: CardQueue.Learn,
    due: 999940,
    ivl: 1,
    factor: 2450,
    lapses: 1,
    left: 1, // 仅剩 1 个 relearn step
  });
  const current = computeCurrentState(card, timing(0, 1000000));
  assert.equal(current.kind, 'relearn');

  const states = computeNextStates(current, ctxNoFuzz());
  assert.equal(states.good.kind, 'review', '完成重新学习应回到 Review');
});

// ═══════════════════════════════════════════
// Leech 检测
// ═══════════════════════════════════════════

test('Leech: 标准阈值检测', () => {
  assert.equal(isLeeched(0, 8), false);
  assert.equal(isLeeched(7, 8), false);
  assert.equal(isLeeched(8, 8), true,  '第 8 次遗忘应触发 leech');
  assert.equal(isLeeched(9, 8), false);
  assert.equal(isLeeched(12, 8), true, '第 12 次 (8 + 4) 应触发');
  assert.equal(isLeeched(16, 8), true, '第 16 次 (8 + 8) 应触发');
});

test('Leech: 零阈值禁用', () => {
  assert.equal(isLeeched(100, 0), false);
  assert.equal(isLeeched(0, 0), false);
});

test('Leech: 奇数阈值 (如 5)', () => {
  assert.equal(isLeeched(4, 5), false);
  assert.equal(isLeeched(5, 5), true);
  // half = ceil(5/2) = 3; 5 + 3 = 8
  assert.equal(isLeeched(8, 5), true);
  assert.equal(isLeeched(9, 5), false);
  assert.equal(isLeeched(11, 5), true);
});

// ═══════════════════════════════════════════
// Fuzz
// ═══════════════════════════════════════════

test('Fuzz: 确定性种子生成', () => {
  const s1 = fuzzSeed(1001, 3);
  const s2 = fuzzSeed(1001, 3);
  assert.equal(s1, s2, '相同输入应得相同种子');
  const s3 = fuzzSeed(1001, 4);
  assert.notEqual(s1, s3, '不同 reps 得不同种子');
});

test('Fuzz: Factor 范围检查', () => {
  for (let i = 0; i < 100; i++) {
    const f = fuzzFactor(fuzzSeed(i, 5));
    if (f !== undefined) {
      assert.ok(f >= 0 && f < 1, `fuzz ${f} 应在 [0, 1)`);
    }
  }
});

// ═══════════════════════════════════════════
// applyRating — 端到端
// ═══════════════════════════════════════════

test('applyRating: New → Again', () => {
  const card = newCard();
  const current = computeCurrentState(card, timing());
  const states = computeNextStates(current, ctxNoFuzz());

  const result = applyRating(card, states, 'again', timing());
  assert.equal(result.update.type, CardType.Learn);
  assert.equal(result.update.queue, CardQueue.Learn);
  assert.equal(result.leeched, false);
});

test('applyRating: Review → Easy (保持 Review)', () => {
  const card = newCard({
    type: CardType.Review,
    queue: CardQueue.Review,
    due: 0,
    ivl: 1,
    factor: 2500,
    reps: 10,
    lapses: 0,
  });
  const current = computeCurrentState(card, timing());
  const states = computeNextStates(current, ctxNoFuzz());

  const result = applyRating(card, states, 'easy', timing());
  assert.equal(result.update.type, CardType.Review);
  assert.equal(result.update.queue, CardQueue.Review);
  assert.ok(result.update.ivl >= 3);
  assert.ok(result.update.factor > 2500);
});

test('applyRating: Leech 暂停卡片', () => {
  // 模拟第 8 次 lapses → leeched
  const card = newCard({
    type: CardType.Review,
    queue: CardQueue.Review,
    due: 0,
    ivl: 10,
    factor: 1300, // 已经最低 ease
    reps: 50,
    lapses: 7, // 下次 Again 触达 8
  });
  const current = computeCurrentState(card, timing());
  const states = computeNextStates(current, ctxNoFuzz());

  const result = applyRating(card, states, 'again', timing());
  assert.equal(result.leeched, true, '应检测到 leech');

  // leechSuspend=true (默认) → queue = Suspended
  assert.equal(result.update.queue, CardQueue.Suspended);
});

// ═══════════════════════════════════════════
// 完整场景 (对应 Rust smoke test)
// ═══════════════════════════════════════════

test('SM-2: 完整状态流转 — New→Learn→Review→Relearn→Review', () => {
  // Step 1: New → Again (进入 Learning)
  let card = newCard();
  let t = timing();
  let current = computeCurrentState(card, t);
  let states = computeNextStates(current, ctxNoFuzz());
  let result = applyRating(card, states, 'again', t);
  assert.equal(result.update.type, CardType.Learn);
  assert.equal(result.update.queue, CardQueue.Learn);

  // Step 2: Learning → Good (推进到只剩 1 步)
  card = { ...card, ...result.update, type: CardType.Learn, queue: CardQueue.Learn, due: t.now };
  current = computeCurrentState(card, t);
  states = computeNextStates(current, ctxNoFuzz());
  result = applyRating(card, states, 'good', t);
  assert.equal(result.update.type, CardType.Learn);
  // 断言 remaining steps = 1
  const goodState = states.good as { kind: 'learn'; remainingSteps: number };
  assert.equal(goodState.remainingSteps, 1);

  // Step 3: Learning 最后一步 → Good (毕业 → Review)
  card = { ...card, ...result.update, type: CardType.Learn, queue: CardQueue.Learn, due: t.now, left: result.update.left };
  current = computeCurrentState(card, t);
  states = computeNextStates(current, ctxNoFuzz());
  result = applyRating(card, states, 'good', t);
  assert.equal(result.update.type, CardType.Review);
  assert.equal(result.update.queue, CardQueue.Review);

  // Step 4: Review → Again (遗忘 → Relearning)
  card = { ...card, ...result.update, type: CardType.Review, queue: CardQueue.Review };
  current = computeCurrentState(card, t);
  states = computeNextStates(current, ctxNoFuzz());
  result = applyRating(card, states, 'again', t);
  assert.ok(
    result.update.type === CardType.Relearn || result.update.type === CardType.Review,
    `Again 后类型: ${result.update.type}`,
  );
  assert.equal(result.update.reps, 4); // 第 4 次复习

  // Step 5: Relearning → Good (毕业 → Review)
  if (result.update.type === CardType.Relearn) {
    card = { ...card, ...result.update, type: CardType.Relearn, queue: CardQueue.Learn, due: t.now };
    current = computeCurrentState(card, t);
    states = computeNextStates(current, ctxNoFuzz());

    // 如果 only 1 remaining relearn step
    const rl = current as { kind: 'relearn'; learning: { remainingSteps: number } };
    if (rl.kind === 'relearn' && rl.learning.remainingSteps <= 1) {
      result = applyRating(card, states, 'good', t);
      assert.equal(result.update.type, CardType.Review, '重学完成后应回到 Review');
    }
  }
});
