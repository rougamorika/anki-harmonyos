/**
 * Anki 模板引擎 — 完整单元测试
 *
 * 对应 Rust: rslib/src/template.rs 测试 (line 911-1377)
 *
 * 运行: npx tsx harmony/tests/template.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { tokenize } from '../shared/anki/template/lexer';
import { parse, parseFilterString } from '../shared/anki/template/parser';
import { render, fieldIsEmpty, computeNonemptyFields } from '../shared/anki/template/renderer';
import { renderCard } from '../shared/anki/template/mod';
import { TemplateError, TemplateErrorCode } from '../shared/anki/template/types';

// ═══════════════════════════════════════════
// LEXER 测试
// ═══════════════════════════════════════════

test('lexer: 纯文本', () => {
  const tokens = tokenize('Hello World');
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0]!.kind, 'text');
  assert.equal((tokens[0] as { content: string }).content, 'Hello World');
});

test('lexer: 字段替换', () => {
  const tokens = tokenize('Hello {{Name}}');
  assert.equal(tokens.length, 2);
  assert.equal(tokens[0]!.kind, 'text');
  assert.equal(tokens[1]!.kind, 'replacement');
});

test('lexer: 带过滤器的字段', () => {
  const tokens = tokenize('{{Field:text}}');
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0]!.kind, 'replacement');
  assert.equal((tokens[0] as { content: string }).content, 'Field:text');
});

test('lexer: 多个过滤器', () => {
  const tokens = tokenize('{{one:two:Field}}');
  assert.equal(tokens[0]!.kind, 'replacement');
  assert.equal((tokens[0] as { content: string }).content, 'one:two:Field');
});

test('lexer: 条件判断 {{#}}', () => {
  const tokens = tokenize('{{#Cond}}text{{/Cond}}');
  assert.equal(tokens.length, 3);
  assert.equal(tokens[0]!.kind, 'open_conditional');
  assert.equal(tokens[1]!.kind, 'text');
  assert.equal(tokens[2]!.kind, 'close_conditional');
});

test('lexer: 否定条件 {{^}}', () => {
  const tokens = tokenize('{{^Empty}}nothing{{/Empty}}');
  assert.equal(tokens.length, 3);
  assert.equal(tokens[0]!.kind, 'open_negated');
  assert.equal(tokens[2]!.kind, 'close_conditional');
});

test('lexer: 标签内空格处理', () => {
  const tokens = tokenize('{{ tag }}');
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0]!.kind, 'replacement');
  assert.equal((tokens[0] as { content: string }).content, 'tag');
});

test('lexer: 注释 {{!comment}} 被忽略', () => {
  const tokens = tokenize('Before{{! ignore this }}After');
  assert.equal(tokens.length, 2);
  assert.equal(tokens[0]!.kind, 'text');
  assert.equal(tokens[1]!.kind, 'text');
});

test('lexer: 独立的 }} 被保留为文本', () => {
  const tokens = tokenize('text }} more');
  // }} 不在 {{...}} 中 → 全部作为文本
  const allText = tokens.every((t) => t.kind === 'text');
  assert.ok(allText);
});

test('lexer: HTML 注释隐藏', () => {
  const tokens = tokenize('foo <!--{{bar}}--> baz');
  assert.equal(tokens.length, 3);
  // 中间应该是 comment
  assert.equal(tokens[1]!.kind, 'comment');
});

test('lexer: 空模板', () => {
  const tokens = tokenize('');
  assert.deepEqual(tokens, []);
});

test('lexer: FrontSide 关键字', () => {
  const tokens = tokenize('{{FrontSide}}');
  assert.equal(tokens[0]!.kind, 'replacement');
  assert.equal((tokens[0] as { content: string }).content, 'FrontSide');
});

// ═══════════════════════════════════════════
// PARSER 测试
// ═══════════════════════════════════════════

test('parser: 纯文本', () => {
  const tokens = tokenize('Hello');
  const nodes = parse(tokens);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0]!.kind, 'text');
});

test('parser: 文本 + 字段替换', () => {
  const tokens = tokenize('foo {{bar}} baz');
  const nodes = parse(tokens);
  assert.equal(nodes.length, 3);
});

test('parser: 过滤器解析', () => {
  const { key, filters } = parseFilterString('one:two:Field');
  assert.equal(key, 'Field');
  assert.deepEqual(filters, ['one', 'two']);
});

test('parser: 无过滤器', () => {
  const { key, filters } = parseFilterString('Field');
  assert.equal(key, 'Field');
  assert.deepEqual(filters, []);
});

test('parser: 简单条件判断', () => {
  const tokens = tokenize('{{#baz}} quux {{/baz}}');
  const nodes = parse(tokens);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0]!.kind, 'conditional');
  const cond = nodes[0]! as { key: string; children: { kind: string; text: string }[] };
  assert.equal(cond.key, 'baz');
  assert.equal(cond.children.length, 1);
  assert.equal(cond.children[0]!.text, ' quux ');
});

test('parser: 嵌套条件', () => {
  const tokens = tokenize('{{#A}}{{#B}}inner{{/B}}{{/A}}');
  const nodes = parse(tokens);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0]!.kind, 'conditional');
  const outer = nodes[0]! as { key: string; children: { kind: string; key: string }[] };
  assert.equal(outer.key, 'A');
  assert.equal(outer.children.length, 1);
  assert.equal(outer.children[0]!.key, 'B');
});

test('parser: 否定条件', () => {
  const tokens = tokenize('{{^baz}}{{/baz}}');
  const nodes = parse(tokens);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0]!.kind, 'negated_conditional');
});

test('parser: 未闭合条件 → 抛出异常', () => {
  const tokens = tokenize('{{#mis}}');
  assert.throws(() => parse(tokens), TemplateError);
});

test('parser: 未开放条件 → 抛出异常', () => {
  const tokens = tokenize('{{/matched}}');
  assert.throws(() => parse(tokens), TemplateError);
});

test('parser: 不匹配条件 → 抛出异常', () => {
  const tokens = tokenize('{{#foo}}{{/bar}}');
  assert.throws(() => parse(tokens), TemplateError);
});

// ═══════════════════════════════════════════
// RENDERER 测试
// ═══════════════════════════════════════════

function makeCtx(fields: Record<string, string>, cardOrdinal: number = 0, frontSide?: string) {
  return {
    fields,
    nonemptyFields: computeNonemptyFields(fields),
    cardOrdinal,
    frontSide,
  };
}

test('renderer: 简单字段替换', () => {
  const tokens = tokenize('{{B}}A{{F}}');
  const nodes = parse(tokens);
  const ctx = makeCtx({ F: 'f', B: 'b' });
  const result = render(nodes, ctx);
  assert.equal(result, 'bAf');
});

test('renderer: 空字段', () => {
  const tokens = tokenize('{{E}}');
  const nodes = parse(tokens);
  const ctx = makeCtx({ E: '' });
  const result = render(nodes, ctx);
  assert.equal(result, '');
});

test('renderer: FrontSide 替换', () => {
  const tokens = tokenize('Question: {{FrontSide}}');
  const nodes = parse(tokens);
  const ctx = makeCtx({}, 0, 'Q content');
  const result = render(nodes, ctx);
  assert.equal(result, 'Question: Q content');
});

test('renderer: FrontSide 未设置 → 空串', () => {
  const tokens = tokenize('{{FrontSide}}');
  const nodes = parse(tokens);
  const ctx = makeCtx({});
  const result = render(nodes, ctx);
  assert.equal(result, '');
});

test('renderer: 条件 — 字段非空时渲染', () => {
  const tokens = tokenize('{{#F}}YES{{/F}}');
  const nodes = parse(tokens);
  const ctx = makeCtx({ F: 'hello' });
  const result = render(nodes, ctx);
  assert.equal(result, 'YES');
});

test('renderer: 条件 — 字段为空跳过', () => {
  const tokens = tokenize('{{#E}}YES{{/E}}');
  const nodes = parse(tokens);
  const ctx = makeCtx({ E: '' });
  const result = render(nodes, ctx);
  assert.equal(result, '');
});

test('renderer: 否定条件 — 字段为空渲染', () => {
  const tokens = tokenize('{{^E}}EMPTY{{/E}}');
  const nodes = parse(tokens);
  const ctx = makeCtx({ E: '' });
  const result = render(nodes, ctx);
  assert.equal(result, 'EMPTY');
});

test('renderer: 否定条件 — 字段非空跳过', () => {
  const tokens = tokenize('{{^F}}EMPTY{{/F}}');
  const nodes = parse(tokens);
  const ctx = makeCtx({ F: 'data' });
  const result = render(nodes, ctx);
  assert.equal(result, '');
});

test('renderer: 嵌套条件', () => {
  const tokens = tokenize('{{^E}}1{{#F}}2{{F}}{{/F}}{{/E}}');
  const nodes = parse(tokens);
  const ctx = makeCtx({ E: '', F: 'f' });
  const result = render(nodes, ctx);
  assert.equal(result, '12f');
});

test('renderer: 缺失字段 → 抛出异常', () => {
  const tokens = tokenize('{{X}}');
  const nodes = parse(tokens);
  const ctx = makeCtx({});
  assert.throws(() => render(nodes, ctx), TemplateError);
});

test('renderer: 缺失条件字段 → 抛出异常', () => {
  const tokens = tokenize('{{#Missing}}{{/Missing}}');
  const nodes = parse(tokens);
  const ctx = makeCtx({});
  assert.throws(() => render(nodes, ctx), TemplateError);
});

test('renderer: comment 节点输出原注释', () => {
  const tokens = tokenize('Hello<!--{{Foo}}-->World');
  const nodes = parse(tokens);
  const ctx = makeCtx({ Foo: 'bar' });
  const result = render(nodes, ctx);
  assert.ok(result.includes('<!--{{Foo}}-->'));
});

// ═══════════════════════════════════════════
// fieldIsEmpty 测试
// ═══════════════════════════════════════════

test('fieldIsEmpty: 空字符串', () => {
  assert.ok(fieldIsEmpty(''));
  assert.ok(fieldIsEmpty('  '));
});

test('fieldIsEmpty: 空标签', () => {
  assert.ok(fieldIsEmpty('<br>'));
  assert.ok(fieldIsEmpty('<BR>'));
  assert.ok(fieldIsEmpty('<div />'));
  assert.ok(fieldIsEmpty('<div></div>'));
  assert.ok(fieldIsEmpty(' <div> <br> </div>\n'));
});

test('fieldIsEmpty: 非空', () => {
  assert.ok(!fieldIsEmpty('x'));
  assert.ok(!fieldIsEmpty(' <div>x</div>\n'));
});

// ═══════════════════════════════════════════
// renderCard 端到端测试
// ═══════════════════════════════════════════

test('renderCard: 基本卡片', () => {
  const output = renderCard({
    questionTemplate: '{{Front}}',
    answerTemplate: '{{FrontSide}}<hr id=answer>{{Back}}',
    fields: { Front: 'Who?', Back: 'Me' },
    cardOrdinal: 0,
    css: '.card { color: red; }',
  });

  assert.ok(!output.isEmpty);
  assert.ok(output.questionHtml.includes('Who?'));
  assert.ok(output.answerHtml.includes('Me'));
  assert.ok(output.answerHtml.includes('Who?')); // FrontSide
  assert.ok(output.answerHtml.includes('<hr id=answer>'));
  assert.ok(output.css.includes('.card'));
});

test('renderCard: 空卡片检测', () => {
  const output = renderCard({
    questionTemplate: 'test{{E}}',
    answerTemplate: '',
    fields: { E: '' },
    cardOrdinal: 0,
    css: '',
  });

  assert.ok(output.isEmpty);
});

test('renderCard: FrontSide 在正面为空', () => {
  const output = renderCard({
    questionTemplate: '{{FrontSide}}{{N}}',
    answerTemplate: '{{Back}}',
    fields: { FrontSide: 'ignored', N: 'N', Back: 'B' },
    cardOrdinal: 0,
    css: '',
  });

  assert.ok(!output.isEmpty);
  // 正面: FrontSide 为空 + N
  assert.equal(output.questionHtml, 'N');
});

test('renderCard: 条件在卡片中使用', () => {
  const output = renderCard({
    questionTemplate: '{{#Hint}}<div class=hint>{{Hint}}</div>{{/Hint}}{{Word}}',
    answerTemplate: '{{FrontSide}}<hr>{{Meaning}}',
    fields: { Word: 'hello', Meaning: '你好', Hint: 'Greeting' },
    cardOrdinal: 0,
    css: '',
  });

  assert.ok(output.questionHtml.includes('hello'));
  assert.ok(output.questionHtml.includes('Greeting'));
  assert.ok(output.answerHtml.includes('你好'));
});

test('renderCard: 模板错误处理', () => {
  // 引用不存在的字段
  const output = renderCard({
    questionTemplate: '{{MissingField}}',
    answerTemplate: 'OK',
    fields: { Front: 'test' },
    cardOrdinal: 0,
    css: '',
  });

  assert.ok(output.questionHtml.includes('template-error'));
  assert.ok(!output.isEmpty); // 显示了错误信息，不算空
});

test('renderCard: 媒体路径重写', () => {
  const output = renderCard({
    questionTemplate: '<img src="cat.jpg">{{Front}}',
    answerTemplate: '{{Back}}',
    fields: { Front: 'Q', Back: 'A' },
    cardOrdinal: 0,
    css: '',
    mediaBaseUrl: 'file://media/',
  });

  assert.ok(output.questionHtml.includes('file://media/cat.jpg'));
});
