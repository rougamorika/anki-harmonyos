/**
 * 牌组配置 / 筛选牌组 / 集合操作 — 单元测试
 *
 * 运行: npx tsx harmony/tests/collection.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_DECK_CONFIG, SCHEMA_VERSION } from '../shared/anki/collection';
import { simpleChecksum } from '../shared/anki/ops';
import { parseQuery, buildSearchSql, toSql, toRegex } from '../shared/anki/search';

// ═══════════════════════════════════════════
// DeckConfig
// ═══════════════════════════════════════════

test('DEFAULT_DECK_CONFIG: 有效默认值', () => {
  assert.equal(DEFAULT_DECK_CONFIG.newPerDay, 20);
  assert.equal(DEFAULT_DECK_CONFIG.revPerDay, 200);
  assert.deepEqual(DEFAULT_DECK_CONFIG.newSteps, [1, 10]);
  assert.deepEqual(DEFAULT_DECK_CONFIG.lapseSteps, [10]);
  assert.equal(DEFAULT_DECK_CONFIG.revHardFactor, 1.2);
  assert.equal(DEFAULT_DECK_CONFIG.revEasyBonus, 1.3);
  assert.equal(DEFAULT_DECK_CONFIG.revMaxIvl, 36500);
  assert.equal(DEFAULT_DECK_CONFIG.lapseLeechFails, 8);
});

test('DEFAULT_DECK_CONFIG: FSRS 默认关闭', () => {
  assert.ok(!DEFAULT_DECK_CONFIG.fsrsParams || DEFAULT_DECK_CONFIG.fsrsParams.length === 0);
});

test('DEFAULT_DECK_CONFIG: 可序列化', () => {
  const json = JSON.stringify(DEFAULT_DECK_CONFIG);
  const parsed = JSON.parse(json);
  assert.equal(parsed.name, 'Default');
  assert.deepEqual(parsed.newSteps, [1, 10]);
});

// ═══════════════════════════════════════════
// 筛选牌组 — 搜索查询
// ═══════════════════════════════════════════

test('filtered: 复杂搜索 → SQL', () => {
  const nodes = parseQuery('deck:Default is:due -tag:leech');
  const result = buildSearchSql(nodes);
  assert.ok(result.whereClause.length > 0);
  assert.ok(result.whereClause.includes('not'));
  assert.ok(result.params.length > 0);
});

test('filtered: 空搜索 → 匹配全部', () => {
  const nodes = parseQuery('');
  const result = buildSearchSql(nodes);
  assert.ok(result.whereClause.includes('true'));
  assert.equal(result.params.length, 0);
});

test('filtered: prop 多操作符', () => {
  assertSearchOk('prop:ivl>=10');
  assertSearchOk('prop:ease<=2.5');
  assertSearchOk('prop:lapses>5');
  assertSearchOk('prop:reps=0');
});

function assertSearchOk(query: string): void {
  const nodes = parseQuery(query);
  const result = buildSearchSql(nodes);
  assert.ok(result.whereClause.length > 0, `查询 '${query}' 应生成 SQL`);
}

// ═══════════════════════════════════════════
// 集合操作
// ═══════════════════════════════════════════

test('collection: checksum 确定性', () => {
  const c1 = simpleChecksum('hello world');
  const c2 = simpleChecksum('hello world');
  assert.equal(c1, c2);
});

test('collection: checksum 不同输入不同值', () => {
  const c1 = simpleChecksum('a');
  const c2 = simpleChecksum('b');
  assert.notEqual(c1, c2);
});

test('collection: toSql 通配符', () => {
  assert.equal(toSql('foo*'), 'foo%');
  assert.equal(toSql('test_'), 'test_');
  assert.equal(toSql('50%'), '50\\%');
});

test('collection: toRegex 通配符', () => {
  assert.equal(toRegex('a*b'), 'a.*b');
  assert.equal(toRegex('a_b'), 'a.b');
  assert.equal(toRegex('a.b'), 'a\\.b');
});

// ═══════════════════════════════════════════
// 牌组重命名逻辑
// ═══════════════════════════════════════════

test('deck: 前缀重命名逻辑', () => {
  const oldPrefix = 'Old';
  const newPrefix = 'New';
  const names = ['Old', 'Old::Child', 'Old::Child::Grand', 'Other'];

  const renamed = names.map((name) => {
    if (name === oldPrefix) return newPrefix;
    if (name.startsWith(oldPrefix + '::')) {
      return newPrefix + '::' + name.substring((oldPrefix + '::').length);
    }
    return name;
  });

  assert.deepEqual(renamed, ['New', 'New::Child', 'New::Child::Grand', 'Other']);
});

// ═══════════════════════════════════════════
// SCHEMA_VERSION
// ═══════════════════════════════════════════

test('SCHEMA_VERSION: 匹配 Anki 11', () => {
  assert.equal(SCHEMA_VERSION, 11);
});
