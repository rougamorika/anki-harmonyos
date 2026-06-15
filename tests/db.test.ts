/**
 * Anki 数据库层 & 过滤器 & 统计 — 单元测试
 *
 * 运行: npx tsx harmony/tests/db.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ─── 直接导入 shared 纯函数 (不依赖 DB 连接) ───

import { buildDeckTree, flattenDeckTree } from '../shared/anki/db/decks';
import { parseNoteFields, fieldsToRecord } from '../shared/anki/db/types';
import { applyFilter, applyFilters, stripHtml, processFurigana, fieldIsEmpty, stripComments } from '../shared/anki/filters';
import {
  computeCardStats,
  computeRatingDistribution,
  ratingPercentages,
  buildReviewCurve,
  buildRetentionCurve,
  forecastDueCards,
} from '../shared/anki/stats';

// ═══════════════════════════════════════════
// 牌组树
// ═══════════════════════════════════════════

test('buildDeckTree: 平面牌组 → 树', () => {
  const decks = {
    '1': { id: 1, name: 'Root', desc: '', extendRev: 0, extendNew: 0, collapse: false, browserCollapse: false, conf: 1, dyn: 0 },
    '2': { id: 2, name: 'Root::Child', desc: '', extendRev: 0, extendNew: 0, collapse: false, browserCollapse: false, conf: 1, dyn: 0 },
    '3': { id: 3, name: 'Root::Child::Grandchild', desc: '', extendRev: 0, extendNew: 0, collapse: false, browserCollapse: false, conf: 1, dyn: 0 },
  };

  const tree = buildDeckTree(decks);
  assert.equal(tree.length, 1);
  assert.equal(tree[0]!.deck.name, 'Root');
  assert.equal(tree[0]!.children.length, 1);
  assert.equal(tree[0]!.children[0]!.deck.name, 'Root::Child');
  assert.equal(tree[0]!.children[0]!.children.length, 1);
  assert.equal(tree[0]!.children[0]!.children[0]!.deck.name, 'Root::Child::Grandchild');
});

test('flattenDeckTree: 树 → 扁平带路径', () => {
  const tree = [{
    deck: { id: 1, name: 'A', desc: '', extendRev: 0, extendNew: 0, collapse: false, browserCollapse: false, conf: 1, dyn: 0 },
    children: [{
      deck: { id: 2, name: 'A::B', desc: '', extendRev: 0, extendNew: 0, collapse: false, browserCollapse: false, conf: 1, dyn: 0 },
      children: [],
    }],
  }];

  const flat = flattenDeckTree(tree);
  assert.equal(flat.length, 2);
  assert.equal(flat[0]!.name, 'A');
  assert.equal(flat[0]!.namePath, 'A');
  assert.equal(flat[1]!.name, 'A::B');
  assert.equal(flat[1]!.namePath, 'A::A::B');
});

// ═══════════════════════════════════════════
// 笔记字段解析
// ═══════════════════════════════════════════

test('parseNoteFields: 按 \\x1f 分割', () => {
  const flds = 'Hello\x1fWorld\x1fFoo';
  const values = parseNoteFields(flds);
  assert.deepEqual(values, ['Hello', 'World', 'Foo']);
});

test('parseNoteFields: 单字段', () => {
  assert.deepEqual(parseNoteFields('OnlyOne'), ['OnlyOne']);
});

test('fieldsToRecord: 字段值 → 名称映射', () => {
  const rec = fieldsToRecord('Front\x1fBack', ['Front', 'Back']);
  assert.deepEqual(rec, { Front: 'Front', Back: 'Back' });
});

test('fieldsToRecord: 缺字段用空字符串', () => {
  const rec = fieldsToRecord('A', ['A', 'B', 'C']);
  assert.equal(rec['A'], 'A');
  assert.equal(rec['B'], '');
  assert.equal(rec['C'], '');
});

// ═══════════════════════════════════════════
// 模板过滤器
// ═══════════════════════════════════════════

test('filter text: 去除 HTML', () => {
  assert.equal(applyFilter('<b>Hello</b> World<br>', 'text', 'Front'), 'Hello World');
  assert.equal(applyFilter('<div>a</div><p>b</p>', 'text', 'F'), 'a b');
});

test('filter text: HTML 实体解码', () => {
  const result = applyFilter('Hello &amp; Goodbye &lt;3', 'text', 'F');
  assert.equal(result, 'Hello & Goodbye <3');
});

test('filter hint: 生成提示链接', () => {
  const result = applyFilter('Answer text', 'hint', 'Back');
  assert.ok(result.includes('Show Hint'));
  assert.ok(result.includes('hint_Back'));
  assert.ok(result.includes('Answer text'));
});

test('filter hint: 空文本返回空', () => {
  assert.equal(applyFilter('  ', 'hint', 'X'), '');
});

test('filter furigana: 注音标记转换', () => {
  const result = applyFilter('漢字[かんじ] 読[よ]む', 'furigana', 'F');
  assert.ok(result.includes('<ruby>'));
  assert.ok(result.includes('<rt>かんじ</rt>'));
  assert.ok(result.includes('<rt>よ</rt>'));
});

test('filter kanji: 只保留汉字', () => {
  const result = applyFilter('漢字kanji混合', 'kanji', 'F');
  assert.equal(result, '漢字混合');
});

test('filter kana: 只保留假名', () => {
  const result = applyFilter('漢字かなカナabc', 'kana', 'F');
  assert.equal(result, 'かなカナ');
});

test('filter type: 生成输入框', () => {
  const result = applyFilter('ignored', 'type', 'MyField');
  assert.ok(result.includes('<input'));
  assert.ok(result.includes('id="typeans"'));
  assert.ok(result.includes('data-field="MyField"'));
});

test('applyFilters: 链式应用', () => {
  const result = applyFilters('<b>Hello</b>', ['text'], 'F');
  assert.equal(result, 'Hello');
});

test('stripHtml', () => {
  assert.equal(stripHtml(''), '');
  assert.equal(stripHtml('plain'), 'plain');
  assert.equal(stripHtml('<p>text</p>'), 'text');
  assert.equal(stripHtml('a<br>b'), 'a b');
});

test('processFurigana: 无标记文本原样返回', () => {
  assert.equal(processFurigana('No mark'), 'No mark');
});

test('fieldIsEmpty', () => {
  assert.ok(fieldIsEmpty(''));
  assert.ok(fieldIsEmpty('  '));
  assert.ok(fieldIsEmpty('<br>'));
  assert.ok(fieldIsEmpty('<div></div>'));
  assert.ok(!fieldIsEmpty('hello'));
  assert.ok(!fieldIsEmpty('<div>x</div>'));
});

test('stripComments: {{!...}} 剥离', () => {
  assert.equal(stripComments('Hello{{! comment }}World'), 'HelloWorld');
  assert.equal(stripComments('{{! multi\nline }}text'), 'text');
});

// ═══════════════════════════════════════════
// 统计计算
// ═══════════════════════════════════════════

test('computeCardStats: 按 queue 分类', () => {
  const cards = [
    { queue: 0 }, { queue: 0 }, { queue: 0 },
    { queue: 1 }, { queue: 3 },
    { queue: 2 }, { queue: 2 }, { queue: 2 }, { queue: 2 },
    { queue: -1 },
  ];
  const stats = computeCardStats(cards);
  assert.equal(stats.newCards, 3);
  assert.equal(stats.learningCards, 2);
  assert.equal(stats.reviewCards, 4);
  assert.equal(stats.suspendedCards, 1);
});

test('computeRatingDistribution', () => {
  const entries = [
    { ease: 1 }, { ease: 1 },
    { ease: 2 },
    { ease: 3 }, { ease: 3 }, { ease: 3 },
    { ease: 4 },
  ];
  const dist = computeRatingDistribution(entries);
  assert.equal(dist.again, 2);
  assert.equal(dist.hard, 1);
  assert.equal(dist.good, 3);
  assert.equal(dist.easy, 1);
});

test('ratingPercentages', () => {
  const pct = ratingPercentages({ again: 2, hard: 2, good: 4, easy: 2 });
  assert.equal(pct.again, 20);
  assert.equal(pct.hard, 20);
  assert.equal(pct.good, 40);
  assert.equal(pct.easy, 20);
});

test('ratingPercentages: 空分布返回零', () => {
  const pct = ratingPercentages({ again: 0, hard: 0, good: 0, easy: 0 });
  assert.deepEqual(pct, { again: 0, hard: 0, good: 0, easy: 0 });
});

test('buildReviewCurve: 填充空白天数', () => {
  const now = Math.floor(Date.now() / 1000 / 86400);
  const points = buildReviewCurve([
    { day: now - 2, count: 10, avgTime: 5000 },
    { day: now - 1, count: 20, avgTime: 4000 },
    { day: now, count: 15, avgTime: 6000 },
  ], 3);

  assert.equal(points.length, 3);
  assert.equal(points[0]!.count, 10);
  assert.equal(points[1]!.count, 20);
  assert.equal(points[2]!.count, 15);
  // 累计值
  assert.equal(points[0]!.cumulative, 10);
  assert.equal(points[1]!.cumulative, 30);
  assert.equal(points[2]!.cumulative, 45);
});

test('buildReviewCurve: 空白日填充零', () => {
  const now = Math.floor(Date.now() / 1000 / 86400);
  const points = buildReviewCurve([
    { day: now, count: 5, avgTime: 1000 },
  ], 3);

  assert.equal(points.length, 3);
  assert.equal(points[0]!.count, 0); // 2 天前的空白
  assert.equal(points[1]!.count, 0); // 1 天前的空白
  assert.equal(points[2]!.count, 5);
});

test('buildRetentionCurve: 按间隔分桶', () => {
  const entries = [
    { ease: 3, lastIvl: 1 },  // passed
    { ease: 1, lastIvl: 1 },  // failed
    { ease: 4, lastIvl: 7 },  // passed
    { ease: 3, lastIvl: 7 },  // passed
    { ease: 2, lastIvl: 7 },  // failed
  ];
  const curve = buildRetentionCurve(entries);
  assert.equal(curve.length, 2);

  // 间隔 = 1: 1/2 = 50%
  const b1 = curve.find(p => p.interval === 1);
  assert.ok(b1);
  assert.equal(b1.count, 2);
  assert.ok(Math.abs(b1.retention - 0.5) < 0.01);

  // 间隔 = 7: 2/3 ≈ 66.7%
  const b7 = curve.find(p => p.interval === 7);
  assert.ok(b7);
  assert.equal(b7.count, 3);
  assert.ok(Math.abs(b7.retention - 0.667) < 0.01);
});

test('forecastDueCards: 预测到期', () => {
  const today = Math.floor(Date.now() / 1000 / 86400);
  const cards = [
    { due: today - 5, ivl: 10 },  // 5 天后到期 (ivl=10, 已过 5天 → 5天后)
    { due: today, ivl: 3 },        // 3 天后到期
    { due: today - 20, ivl: 30 },  // 10 天后到期
  ];

  const forecast = forecastDueCards(cards, 30);

  // 找到有计数的天数
  const day5 = forecast.find(p => p.dueCount > 0 && p.day === today + 5);
  assert.ok(day5, '5 天后应有 1 张卡片到期');

  const day3 = forecast.find(p => p.dueCount > 0 && p.day === today + 3);
  assert.ok(day3, '3 天后应有 1 张卡片到期');
});

test('forecastDueCards: 无到期卡片', () => {
  const forecast = forecastDueCards([], 7);
  assert.ok(forecast.every(p => p.dueCount === 0));
});
