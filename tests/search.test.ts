/**
 * Anki 搜索引擎 — 单元测试
 *
 * 运行: npx tsx harmony/tests/search.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseQuery,
  buildSearchSql,
  toSql,
  toRegex,
  isGlob,
  unescape,
} from '../shared/anki/search';

// ═══════════════════════════════════════════
// Parser
// ═══════════════════════════════════════════

test('parser: 空字符串 → all', () => {
  const nodes = parseQuery('');
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0]!.kind, 'search');
  assert.equal((nodes[0] as { node: { kind: string } }).node.kind, 'all');
});

test('parser: 纯文本', () => {
  const nodes = parseQuery('hello');
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0]!.kind, 'search');
  const sn = (nodes[0] as { node: { kind: string; text: string } }).node;
  assert.equal(sn.kind, 'unqualified');
  assert.equal(sn.text, 'hello');
});

test('parser: deck: 搜索', () => {
  const nodes = parseQuery('deck:Default');
  assert.equal(nodes.length, 1);
  const sn = (nodes[0] as { node: { kind: string; name: string } }).node;
  assert.equal(sn.kind, 'deck');
  assert.equal(sn.name, 'Default');
});

test('parser: tag: 搜索', () => {
  const nodes = parseQuery('tag:hard');
  const sn = (nodes[0] as { node: { kind: string; tag: string; mode: string } }).node;
  assert.equal(sn.kind, 'tag');
  assert.equal(sn.tag, 'hard');
  assert.equal(sn.mode, 'normal');
});

test('parser: tag:re: 正则', () => {
  const nodes = parseQuery('tag:re:.*japanese.*');
  const sn = (nodes[0] as { node: { kind: string; tag: string; mode: string } }).node;
  assert.equal(sn.mode, 'regex');
  assert.equal(sn.tag, '.*japanese.*');
});

test('parser: is: 状态', () => {
  assertState('is:new', 'new');
  assertState('is:review', 'review');
  assertState('is:due', 'due');
  assertState('is:suspended', 'suspended');
});

function assertState(query: string, expected: string): void {
  const nodes = parseQuery(query);
  const sn = (nodes[0] as { node: { kind: string; state: string } }).node;
  assert.equal(sn.kind, 'state');
  assert.equal(sn.state, expected);
}

test('parser: prop: 属性', () => {
  const nodes = parseQuery('prop:ivl>=5');
  const sn = (nodes[0] as { node: { kind: string; propKind: { kind: string; value: number }; operator: string } }).node;
  assert.equal(sn.kind, 'property');
  assert.equal(sn.operator, '>=');
  assert.equal(sn.propKind.kind, 'interval');
  assert.equal(sn.propKind.value, 5);
});

test('parser: 否定', () => {
  const nodes = parseQuery('-is:suspended');
  assert.equal(nodes[0]!.kind, 'not');
});

test('parser: 分组', () => {
  const nodes = parseQuery('(tag:a or tag:b)');
  assert.equal(nodes[0]!.kind, 'group');
});

test('parser: AND 连接', () => {
  const nodes = parseQuery('deck:Default tag:hard');
  // deck, AND, tag  → 3 nodes
  assert.equal(nodes.length, 3);
  assert.equal(nodes[0]!.kind, 'search');
  assert.equal(nodes[1]!.kind, 'and');
  assert.equal(nodes[2]!.kind, 'search');
});

test('parser: OR 连接', () => {
  const nodes = parseQuery('tag:a or tag:b');
  assert.equal(nodes.length, 3);
  assert.equal(nodes[1]!.kind, 'or');
});

test('parser: 字段搜索', () => {
  const nodes = parseQuery('Front:hello');
  const sn = (nodes[0] as { node: { kind: string; field: string; text: string } }).node;
  assert.equal(sn.kind, 'single_field');
  assert.equal(sn.field, 'front'); // 小写化
  assert.equal(sn.text, 'hello');
});

// ═══════════════════════════════════════════
// SQL Generation
// ═══════════════════════════════════════════

test('sql: 空查询 → true', () => {
  const result = buildSearchSql(parseQuery(''));
  assert.ok(result.whereClause.includes('true'));
});

test('sql: is:new → c.type = 0', () => {
  const result = buildSearchSql(parseQuery('is:new'));
  assert.ok(result.whereClause.includes('c.type = 0'));
});

test('sql: is:suspended → c.queue = -1', () => {
  const result = buildSearchSql(parseQuery('is:suspended'));
  assert.ok(result.whereClause.includes('c.queue = -1'));
});

test('sql: deck:Name → LIKE 子查询', () => {
  const result = buildSearchSql(parseQuery('deck:Default'));
  assert.ok(result.whereClause.includes('like'));
  assert.ok(result.whereClause.includes('anki_decks'));
});

test('sql: tag: → n.tags LIKE', () => {
  const result = buildSearchSql(parseQuery('tag:hard'));
  assert.ok(result.whereClause.includes('n.tags'));
});

test('sql: 参数化查询不内插值', () => {
  const result = buildSearchSql(parseQuery('Front:hello'));
  assert.ok(result.params.includes('hello'));
  assert.ok(!result.whereClause.includes("'hello'"), '值不应直接内插');
});

test('sql: 否定生成 not', () => {
  const result = buildSearchSql(parseQuery('-is:due'));
  assert.ok(result.whereClause.includes('not'));
});

test('sql: AND 生成 and', () => {
  const result = buildSearchSql(parseQuery('deck:A is:new'));
  assert.ok(result.whereClause.includes(' and '));
});

// ═══════════════════════════════════════════
// 通配符转换
// ═══════════════════════════════════════════

test('toSql: * → %', () => {
  assert.equal(toSql('foo*bar'), 'foo%bar');
});

test('toSql: _ → _ (不变)', () => {
  assert.equal(toSql('foo_bar'), 'foo_bar');
});

test('toSql: % → \\%', () => {
  assert.equal(toSql('50%'), '50\\%');
});

test('toSql: \\* → *', () => {
  assert.equal(toSql('foo\\*bar'), 'foo*bar');
});

test('toSql: \\\\ → \\\\', () => {
  assert.equal(toSql('foo\\\\bar'), 'foo\\\\bar');
});

test('toRegex: * → .*', () => {
  assert.equal(toRegex('a*b'), 'a.*b');
});

test('toRegex: _ → .', () => {
  assert.equal(toRegex('a_b'), 'a.b');
});

test('toRegex: 特殊字符 escape', () => {
  assert.equal(toRegex('a.b'), 'a\\.b');
});

test('isGlob: 含 * 返回 true', () => {
  assert.ok(isGlob('test*'));
  assert.ok(isGlob('test_'));
});

test('isGlob: 不含通配符返回 false', () => {
  assert.ok(!isGlob('test'));
  assert.ok(!isGlob('test\\*')); // esc
});

// ═══════════════════════════════════════════
// unescape
// ═══════════════════════════════════════════

test('unescape: \\: → :', () => {
  assert.equal(unescape('a\\:b'), 'a:b');
});

test('unescape: \\" → "', () => {
  assert.equal(unescape('a\\"b'), 'a"b');
});

test('unescape: 未知转义保留反斜杠', () => {
  // \  后跟不可转义字符 → 保留反斜杠
  assert.equal(unescape('hello\\ world'), 'hello\\ world');
});

// ═══════════════════════════════════════════
// 复杂查询
// ═══════════════════════════════════════════

test('集成: 复杂组合查询', () => {
  const nodes = parseQuery('deck:Default (tag:hard or tag:easy) -is:suspended prop:ivl>=5');
  assert.ok(nodes.length >= 3);
  const result = buildSearchSql(nodes);
  assert.ok(result.whereClause.includes(' and '));
  assert.ok(result.whereClause.includes(' or '));
  assert.ok(result.whereClause.includes('not'));
  assert.ok(result.params.length > 0);
});

test('集成: 多个 tag 搜索', () => {
  const nodes = parseQuery('tag:verb tag:noun -tag:ignore');
  assert.equal(nodes.length, 5); // tag, AND, tag, AND, NOT(tag)
});
