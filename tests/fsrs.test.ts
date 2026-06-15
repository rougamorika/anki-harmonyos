/**
 * FSRS 算法 — 单元测试
 *
 * 运行: npx tsx harmony/tests/fsrs.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  type MemoryState,
  type FSRSItem,
  type FSRSReview,
  DEFAULT_FSRS_PARAMS,
  nextInterval,
  nextStates,
  memoryState,
  memoryStateFromSm2,
  retrievability,
  validateParams,
} from '../shared/anki/fsrs';

// ─── 辅助 ───

function assertClose(actual: number, expected: number, epsilon: number = 0.1, msg?: string): void {
  const diff = Math.abs(actual - expected);
  assert.ok(
    diff < epsilon,
    `${msg ?? ''} expected ${expected} ± ${epsilon}, got ${actual} (diff ${diff.toFixed(4)})`,
  );
}

function r(rating: number, deltaT: number): FSRSReview {
  return { rating, deltaT };
}

// ═══════════════════════════════════════════
// nextInterval
// ═══════════════════════════════════════════

test('nextInterval: 稳定性=10, 90%保持率', () => {
  const ivl = nextInterval(10, 0.9);
  assert.ok(ivl > 0, '间隔应大于 0');
  assert.ok(ivl < 30, `间隔 ${ivl} 应在合理范围内`);
});

test('nextInterval: 稳定性=1, 90%保持率', () => {
  const ivl = nextInterval(1, 0.9);
  assert.ok(ivl > 0 && ivl < 5, `短稳定性间隔: ${ivl}`);
});

test('nextInterval: 边界 retention 值', () => {
  const ivl99 = nextInterval(10, 0.99);
  const ivl70 = nextInterval(10, 0.70);
  assert.ok(ivl99 < ivl70, '高保持率 → 更短间隔');
});

// ═══════════════════════════════════════════
// nextStates
// ═══════════════════════════════════════════

test('nextStates: 新卡片 (无状态)', () => {
  const states = nextStates(undefined, 0.9, 0, DEFAULT_FSRS_PARAMS);

  // 新卡片应产生有效状态
  assert.ok(states.again.interval >= 0, 'Again 间隔');
  assert.ok(states.good.interval > 0, 'Good 间隔应 > 0');
  assert.ok(states.easy.interval > states.good.interval, 'Easy 间隔 > Good 间隔');
});

test('nextStates: 有状态的卡片', () => {
  const state: MemoryState = { stability: 10, difficulty: 5 };
  const states = nextStates(state, 0.9, 1, DEFAULT_FSRS_PARAMS); // 1天后复习

  assert.ok(states.again.interval >= 0);
  assert.ok(states.hard.interval > 0);
  assert.ok(states.easy.interval > states.good.interval);

  // 验证递减排序
  assert.ok(states.easy.interval >= states.good.interval);
  assert.ok(states.good.interval >= states.hard.interval);
});

test('nextStates: 长间隔后的复习', () => {
  const state: MemoryState = { stability: 30, difficulty: 4 };
  const states = nextStates(state, 0.9, 35, DEFAULT_FSRS_PARAMS);

  // 过期很久的卡片 — 间隔仍应为正
  assert.ok(states.again.interval >= 0);
  assert.ok(states.good.interval > 0);
});

test('nextStates: 低稳定性 + 高难度', () => {
  const state: MemoryState = { stability: 1, difficulty: 9 };
  const states = nextStates(state, 0.9, 1, DEFAULT_FSRS_PARAMS);

  assert.ok(states.again.interval >= 0);
  assert.ok(states.good.interval > 0);
  // 高难度 → 增长更慢
  assert.ok(states.good.interval < 10, `高难度间隔应较小: ${states.good.interval}`);
});

test('nextStates: 记忆状态更新', () => {
  const state: MemoryState = { stability: 10, difficulty: 5 };
  const states = nextStates(state, 0.9, 1, DEFAULT_FSRS_PARAMS); // 1天后复习

  // Again → 稳定性降低
  assert.ok(states.again.memory.stability < state.stability,
    `Again 稳定性 ${states.again.memory.stability} 应 < ${state.stability}`);

  // Good → 稳定性增加 (需经过1天，R<1)
  assert.ok(states.good.memory.stability > state.stability,
    `Good 稳定性 ${states.good.memory.stability} 应 > ${state.stability}`);
});

// ═══════════════════════════════════════════
// memoryState
// ═══════════════════════════════════════════

test('memoryState: 单次复习', () => {
  const item: FSRSItem = {
    reviews: [r(3, 1)], // Good, 1天后
  };
  const result = memoryState(item, undefined, DEFAULT_FSRS_PARAMS);
  assert.ok(result.stability > 0, '稳定性应 > 0');
  assert.ok(result.difficulty >= 1 && result.difficulty <= 10);
});

test('memoryState: 多次复习累积', () => {
  const item: FSRSItem = {
    reviews: [
      r(3, 1),   // Good
      r(3, 3),   // Good
      r(4, 7),   // Easy
    ],
  };
  const result = memoryState(item, undefined, DEFAULT_FSRS_PARAMS);
  assert.ok(result.stability > 5, `稳定性 ${result.stability} 应足够大`);
});

test('memoryState: 包含遗忘', () => {
  const item: FSRSItem = {
    reviews: [
      r(3, 1),   // Good
      r(1, 3),   // Again (遗忘)
      r(3, 1),   // Good (重学后)
    ],
  };
  const result = memoryState(item, undefined, DEFAULT_FSRS_PARAMS);

  // 遗忘后稳定性应较小
  assert.ok(result.stability > 0);
  assert.ok(result.difficulty >= 1);
});

// ═══════════════════════════════════════════
// memoryStateFromSm2
// ═══════════════════════════════════════════

test('memoryStateFromSm2: 默认 ease=2.5', () => {
  const ms = memoryStateFromSm2(2.5, 100, 0.9);
  assert.ok(ms.stability > 0);
  assert.ok(ms.difficulty >= 1 && ms.difficulty <= 10);
});

test('memoryStateFromSm2: 低 ease → 高难度', () => {
  const msLow = memoryStateFromSm2(1.3, 100, 0.9);
  const msHigh = memoryStateFromSm2(3.5, 100, 0.9);
  assert.ok(msLow.difficulty > msHigh.difficulty,
    `低 ease ${msLow.difficulty} > 高 ease ${msHigh.difficulty}`);
});

test('memoryStateFromSm2: 间隔为零', () => {
  const ms = memoryStateFromSm2(2.5, 0, 0.9);
  assert.equal(ms.stability, 1.0); // 回退到 1
});

// ═══════════════════════════════════════════
// retrievability
// ═══════════════════════════════════════════

test('retrievability: 刚复习完 → ~100%', () => {
  const r = retrievability(10, 0);
  assert.ok(r > 0.99);
});

test('retrievability: 间隔 = 稳定性 → ~37%', () => {
  const r = retrievability(10, 10);
  assertClose(r, 1 / Math.E, 0.02, 't=S → e^-1');
});

test('retrievability: 零稳定性 → 0', () => {
  assert.equal(retrievability(0, 5), 0);
});

// ═══════════════════════════════════════════
// validateParams
// ═══════════════════════════════════════════

test('validateParams: 默认参数有效', () => {
  assert.ok(validateParams(DEFAULT_FSRS_PARAMS));
});

test('validateParams: 参数太短无效', () => {
  assert.ok(!validateParams([1, 2, 3]));
});

test('validateParams: 空数组无效', () => {
  assert.ok(!validateParams([]));
});

test('validateParams: NaN 无效', () => {
  const bad = [...DEFAULT_FSRS_PARAMS];
  bad[5] = NaN;
  assert.ok(!validateParams(bad));
});

// ═══════════════════════════════════════════
// 确定性验证
// ═══════════════════════════════════════════

test('确定性: 相同输入 → 相同输出', () => {
  const state: MemoryState = { stability: 15, difficulty: 4.5 };
  const r1 = nextStates(state, 0.9, 2, DEFAULT_FSRS_PARAMS);
  const r2 = nextStates(state, 0.9, 2, DEFAULT_FSRS_PARAMS);

  assert.equal(r1.good.interval, r2.good.interval);
  assert.equal(r1.good.memory.stability, r2.good.memory.stability);
  assert.equal(r1.good.memory.difficulty, r2.good.memory.difficulty);
});

test('确定性: memoryState 确定性', () => {
  const item: FSRSItem = {
    reviews: [r(3, 1), r(3, 3), r(2, 5), r(4, 10)],
  };
  const ms1 = memoryState(item, undefined);
  const ms2 = memoryState(item, undefined);
  assert.equal(ms1.stability, ms2.stability);
  assert.equal(ms1.difficulty, ms2.difficulty);
});

// ═══════════════════════════════════════════
// 积分场景
// ═══════════════════════════════════════════

test('集成: SM-2 → FSRS 桥接', () => {
  // 模拟已有 SM-2 数据的卡片
  const sm2State = memoryStateFromSm2(2.5, 30, 0.9);
  const states = nextStates(sm2State, 0.9, 30);

  // 所有按钮应有有效输出
  assert.ok(states.again.memory.stability > 0);
  assert.ok(states.good.interval > 0);
});

test('集成: 新卡片完整流程', () => {
  // 新卡片首次复习 → Hard
  const s1 = nextStates(undefined, 0.9, 0);
  const afterFirst = s1.hard;

  // 第二次复习 → Good
  const s2 = nextStates(afterFirst.memory, 0.9, afterFirst.interval);
  const afterSecond = s2.good;

  // 第三次 → Easy
  const s3 = nextStates(afterSecond.memory, 0.9, afterSecond.interval);
  const afterThird = s3.easy;

  // 稳定性应该逐步增长
  assert.ok(afterThird.memory.stability > afterSecond.memory.stability,
    '稳定性应逐级增长');
});
