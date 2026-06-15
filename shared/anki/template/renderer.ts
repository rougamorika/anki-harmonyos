/**
 * Anki 模板引擎 — 渲染器 (Renderer)
 *
 * 将 ParsedNode 树渲染为 HTML 字符串。
 * 处理字段替换、条件判断、FrontSide 引用、Cloze/Type 特殊字段。
 *
 * 对应 Rust: rslib/src/template.rs
 *   - render_into() (line 407-511)
 *   - RenderContext (line 379-390)
 *   - render_card() (line 597-668)
 */

import type { ParsedNode, RenderContext } from './types.ts';
import { TemplateError, TemplateErrorCode } from './types.ts';
import { applyFilters } from '../filters.ts';
import { tokenize } from './lexer.ts';
import { parse } from './parser.ts';

/**
 * 渲染 ParsedNode 树为 HTML 字符串。
 */
export function render(nodes: ParsedNode[], ctx: RenderContext): string {
  const parts: string[] = [];
  renderInto(parts, nodes, ctx);
  return parts.join('');
}

function renderInto(
  output: string[],
  nodes: ParsedNode[],
  ctx: RenderContext,
): void {
  for (const node of nodes) {
    switch (node.kind) {
      case 'text':
        output.push(node.text);
        break;

      case 'comment':
        // HTML 注释中的模板标签 — 保留注释标记
        output.push('<!--');
        output.push(node.text);
        output.push('-->');
        break;

      case 'replacement':
        renderReplacement(node, ctx, output);
        break;

      case 'conditional':
        renderConditional(node.key, node.children, ctx, output, false);
        break;

      case 'negated_conditional':
        renderConditional(node.key, node.children, ctx, output, true);
        break;
    }
  }
}

// ─── 字段替换 ───

function renderReplacement(
  node: { key: string; filters: string[] },
  ctx: RenderContext,
  output: string[],
): void {
  const { key, filters } = node;

  // FrontSide 特殊处理
  if (key === 'FrontSide') {
    output.push(ctx.frontSide ?? '');
    return;
  }

  // 空字段只带过滤器 — 允许空输入 filter
  if (key === '' && filters.length > 0) {
    // 将空字符串传入过滤器链
    let result = '';
    for (const f of filters) {
      result = applyFilters(result, [f], key);
    }
    output.push(result);
    return;
  }

  // 字段检查
  if (key === '' || !(key in ctx.fields)) {
    throw new TemplateError(
      `Field '${key}' not found in note type.`,
      TemplateErrorCode.FieldNotFound,
      key,
    );
  }

  let text = ctx.fields[key] ?? '';

  // 应用过滤器
  if (filters.length > 0) {
    for (const f of filters) {
      text = applyFilters(text, [f], key);
    }
  }

  output.push(text);
}

// ─── 条件判断 ───

/**
 * 条件渲染。
 *
 * @param key 条件字段名
 * @param children 子节点
 * @param ctx 渲染上下文
 * @param negated 是否为否定条件 ({{^field}})
 */
function renderConditional(
  key: string,
  children: ParsedNode[],
  ctx: RenderContext,
  output: string[],
  negated: boolean,
): void {
  // 检查字段是否存在
  if (!(key in ctx.fields)) {
    // cloze 条件: {{#cN}} 或 {{^cN}} (N 是数字)
    if (isClozeConditional(key)) {
      // cloze 条件总视为字段存在
      if (!negated) {
        renderInto(output, children, ctx);
      }
      return;
    }
    const prefix = negated ? '^' : '#';
    throw new TemplateError(
      `Conditional field '${prefix}${key}' not found.`,
      TemplateErrorCode.NoSuchConditional,
      `${prefix}${key}`,
    );
  }

  const nonempty = ctx.nonemptyFields.has(key);

  if (negated) {
    // {{^field}} — 字段为空时渲染
    if (!nonempty) {
      renderInto(output, children, ctx);
    }
  } else {
    // {{#field}} — 字段非空时渲染
    if (nonempty) {
      renderInto(output, children, ctx);
    }
  }
}

// ─── Cloze 条件检测 ───

/**
 * 检查是否为 cloze 条件 ({{#c1}} / {{^c2}} 等)。
 * 对应 Rust is_cloze_conditional()
 */
function isClozeConditional(key: string): boolean {
  return key.length > 1 && key[0] === 'c' && /^\d+$/.test(key.substring(1));
}

// ─── 空白检查 ───

/**
 * 检查渲染后的模板是否为空。
 * 空 = 只有 whitespace + 空 BR/DIV + 注释。
 *
 * 对应 Rust template_is_empty() + field_is_empty().
 */
export function isRenderedEmpty(html: string): boolean {
  return fieldIsEmpty(html);
}

/**
 * 检查单个字段是否为空。
 * 对应 Rust field_is_empty() (line 543-557)
 */
export function fieldIsEmpty(text: string): boolean {
  if (text.length === 0) return true;

  // 去除空标签和空白
  const cleaned = text
    .replace(/<\/?(?:br|div)\s*\/?>/gi, '')
    .replace(/&nbsp;/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();

  return cleaned.length === 0;
}

/**
 * 计算非空字段集合。
 * 对应 Rust nonempty_fields()
 */
export function computeNonemptyFields(fields: Record<string, string>): Set<string> {
  const set = new Set<string>();
  for (const [name, value] of Object.entries(fields)) {
    if (!fieldIsEmpty(value)) {
      set.add(name);
    }
  }
  return set;
}

// ─── 便捷包装 ───

/**
 * 一步渲染: 解析 + 渲染。
 */
export function parseAndRender(
  template: string,
  ctx: RenderContext,
): string {
  const tokens = tokenize(template);
  const nodes = parse(tokens);
  return render(nodes, ctx);
}
