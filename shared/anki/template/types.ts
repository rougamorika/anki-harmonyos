/**
 * Anki 模板引擎 — 公共类型定义
 *
 * 对应 Rust: rslib/src/template.rs
 *   - Token 枚举 (line 115-122)
 *   - ParsedNode 枚举 (line 178-189)
 *   - RenderedNode 枚举 (line 367-377)
 *   - RenderContext (line 379-390)
 */

// ─── Token (词法分析输出) ───

export interface TokenText {
  kind: 'text';
  content: string;
}

export interface TokenComment {
  kind: 'comment';
  content: string;
}

export interface TokenReplacement {
  kind: 'replacement';
  /** 原始标签内容: "Field:filter1:filter2" */
  content: string;
}

export interface TokenOpenConditional {
  kind: 'open_conditional';
  field: string;
}

export interface TokenOpenNegated {
  kind: 'open_negated';
  field: string;
}

export interface TokenCloseConditional {
  kind: 'close_conditional';
  field: string;
}

export type Token =
  | TokenText
  | TokenComment
  | TokenReplacement
  | TokenOpenConditional
  | TokenOpenNegated
  | TokenCloseConditional;

// ─── ParsedNode (语法分析输出) ───

export interface ParsedText {
  kind: 'text';
  text: string;
}

export interface ParsedComment {
  kind: 'comment';
  text: string;
}

export interface ParsedReplacement {
  kind: 'replacement';
  /** 字段名 (最右段) */
  key: string;
  /** 过滤器列表 (从左到右) */
  filters: string[];
}

export interface ParsedConditional {
  kind: 'conditional';
  key: string;
  children: ParsedNode[];
}

export interface ParsedNegatedConditional {
  kind: 'negated_conditional';
  key: string;
  children: ParsedNode[];
}

export type ParsedNode =
  | ParsedText
  | ParsedComment
  | ParsedReplacement
  | ParsedConditional
  | ParsedNegatedConditional;

// ─── 渲染上下文 ───

export interface RenderContext {
  fields: Record<string, string>;
  nonemptyFields: Set<string>;
  cardOrdinal: number;
  frontSide?: string;
}

// ─── 渲染输出 ───

export interface CardRenderOutput {
  questionHtml: string;
  answerHtml: string;
  css: string;
  /** 模板是否渲染为空 (空卡片) */
  isEmpty: boolean;
}

// ─── 错误类型 ───

export class TemplateError extends Error {
  constructor(
    message: string,
    public readonly code: TemplateErrorCode,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = 'TemplateError';
  }
}

export enum TemplateErrorCode {
  /** {{/field}} 缺少对应的 {{#field}} */
  ConditionalNotOpen = 'CONDITIONAL_NOT_OPEN',
  /** {{#field}} 缺少对应的 {{/field}} */
  ConditionalNotClosed = 'CONDITIONAL_NOT_CLOSED',
  /** {{/a}} 对 {{#b}} */
  MismatchedConditional = 'MISMATCHED_CONDITIONAL',
  /** 模板中引用了不存在的字段 */
  FieldNotFound = 'FIELD_NOT_FOUND',
  /** 条件引用了不存在的字段 */
  NoSuchConditional = 'NO_SUCH_CONDITIONAL',
}

// ─── 常量 ───

export const COMMENT_START = '<!--';
export const COMMENT_END = '-->';
export const ALT_HANDLEBAR_DIRECTIVE = '{{=<% %>=}}';
