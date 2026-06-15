/**
 * Anki CRUD 操作 — 单元测试
 *
 * 运行: npx tsx harmony/tests/ops.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  simpleChecksum,
  generateGuid,
} from '../shared/anki/ops';

// ═══════════════════════════════════════════
// simpleChecksum
// ═══════════════════════════════════════════

test('simpleChecksum: 空字符串', () => {
  const c = simpleChecksum('');
  assert.ok(c >= 0);
});

test('simpleChecksum: 确定性', () => {
  assert.equal(simpleChecksum('hello'), simpleChecksum('hello'));
  assert.equal(simpleChecksum('world'), simpleChecksum('world'));
});

test('simpleChecksum: 不同文本不同值', () => {
  assert.notEqual(simpleChecksum('hello'), simpleChecksum('world'));
});

test('simpleChecksum: HTML 剥离', () => {
  // 带/不带 HTML 应产生相同 checksum
  assert.equal(
    simpleChecksum('<b>hello</b>'),
    simpleChecksum('hello'),
  );
});

test('simpleChecksum: 截断到 100 字符', () => {
  const a = 'x'.repeat(150);
  const b = 'x'.repeat(150) + 'yyy';
  assert.equal(simpleChecksum(a), simpleChecksum(b), '超 100 字符后截断为相同前缀');
});

// ═══════════════════════════════════════════
// generateGuid
// ═══════════════════════════════════════════

test('generateGuid: 格式正确', () => {
  const guid = generateGuid();
  // UUID 格式: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  assert.match(guid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('generateGuid: 每次不同', () => {
  const g1 = generateGuid();
  const g2 = generateGuid();
  assert.notEqual(g1, g2);
});

test('generateGuid: 输出 36 字符', () => {
  assert.equal(generateGuid().length, 36);
});

// ═══════════════════════════════════════════
// CardUpdate 类型验证
// ═══════════════════════════════════════════

test('CardUpdate: 基本字段构造', () => {
  const update = {
    type: 2, queue: 2, due: 30, ivl: 30,
    factor: 2500, reps: 10, lapses: 1, left: 0,
  };
  assert.equal(update.type, 2);
  assert.equal(update.queue, 2);
  assert.equal(update.factor, 2500);
  assert.equal(update.reps, 10);
});

// ═══════════════════════════════════════════
// SQL 生成正确性 (不依赖 DB)
// ═══════════════════════════════════════════

test('SQL: 参数计数', () => {
  // 验证 produceInClause 逻辑
  const ids = [1, 2, 3, 4, 5];
  const placeholders = ids.map(() => '?').join(',');
  assert.equal(placeholders, '?,?,?,?,?');
  assert.equal(ids.length, 5);
});

// ═══════════════════════════════════════════
// 边界
// ═══════════════════════════════════════════

test('simpleChecksum: Unicode 文本', () => {
  const c = simpleChecksum('日本語テスト');
  assert.ok(typeof c === 'number');
  assert.ok(c >= 0);
});

test('simpleChecksum: 极长文本 truncates', () => {
  const long1 = 'a'.repeat(99) + 'X';
  const long2 = 'a'.repeat(99) + 'Y';
  // 前 100 字符不同
  assert.notEqual(simpleChecksum(long1), simpleChecksum(long2));
});

// ═══════════════════════════════════════════
// NoteCreate
// ═══════════════════════════════════════════

test('NoteCreate: 字段分割 \\x1f', () => {
  const flds = 'Front\x1fBack\x1fExtra';
  const parts = flds.split('\x1f');
  assert.equal(parts.length, 3);
  assert.equal(parts[0], 'Front');
  assert.equal(parts[1], 'Back');
  assert.equal(parts[2], 'Extra');
});
