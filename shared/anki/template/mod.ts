/**
 * Anki 模板引擎 — 主入口
 *
 * 提供 renderCard() 一站式渲染接口。
 *
 * 对应 Rust: rslib/src/template.rs
 *   - render_card() (line 597-668)
 *   - RenderCardRequest (line 579-588)
 *   - RenderCardResponse (line 590-594)
 */

import type { RenderContext, CardRenderOutput } from './types.ts';
import { TemplateError, TemplateErrorCode } from './types.ts';
import { tokenize } from './lexer.ts';
import { parse } from './parser.ts';
import { render, computeNonemptyFields, fieldIsEmpty } from './renderer.ts';

// ─── 重新导出 ───

export type {
  Token,
  TokenText,
  TokenComment,
  TokenReplacement,
  TokenOpenConditional,
  TokenOpenNegated,
  TokenCloseConditional,
  ParsedNode,
  ParsedText,
  ParsedComment,
  ParsedReplacement,
  ParsedConditional,
  ParsedNegatedConditional,
  RenderContext,
  CardRenderOutput,
} from './types.ts';

export { TemplateError, TemplateErrorCode } from './types.ts';
export { tokenize } from './lexer.ts';
export { parse, parseFilterString } from './parser.ts';
export { render, fieldIsEmpty, computeNonemptyFields, parseAndRender } from './renderer.ts';

// ─── 主入口: renderCard ───

export interface RenderCardInput {
  /** 正面模板 (qfmt) */
  questionTemplate: string;
  /** 背面模板 (afmt) */
  answerTemplate: string;
  /** 字段值映射 (fieldName → value) */
  fields: Record<string, string>;
  /** 卡片模板序号 (0-based) */
  cardOrdinal: number;
  /** CSS 样式 */
  css: string;
  /** 是否为完形填空模板 */
  isCloze?: boolean;
  /** 媒体文件根 URL */
  mediaBaseUrl?: string;
}

/**
 * 完整渲染一张卡片的正面和背面。
 *
 * 流程:
 * 1. 计算 nonempty fields
 * 2. 词法分析 + 语法分析 question 模板
 * 3. 渲染 question
 * 4. 空白检查
 * 5. 渲染 answer (注入 question 作为 FrontSide)
 * 6. 返回 HTML
 *
 * 对应 Rust render_card()
 */
export function renderCard(input: RenderCardInput): CardRenderOutput {
  const {
    questionTemplate,
    answerTemplate,
    fields,
    cardOrdinal,
    css,
    isCloze = false,
    mediaBaseUrl,
  } = input;

  const nonemptyFields = computeNonemptyFields(fields);

  // 1. 渲染正面
  const qCtx: RenderContext = {
    fields,
    nonemptyFields,
    cardOrdinal,
    frontSide: undefined, // 正面无 FrontSide
  };

  let questionHtml: string;
  try {
    const qTokens = tokenize(questionTemplate);
    const qNodes = parse(qTokens);
    questionHtml = render(qNodes, qCtx);
  } catch (e) {
    if (e instanceof TemplateError) {
      questionHtml = `<div class="template-error"><p>${escapeHtml(e.message)}</p></div>`;
    } else {
      throw e;
    }
  }

  // 2. 空白检查
  const isEmpty = checkIsEmpty(questionHtml, isCloze, nonemptyFields, cardOrdinal);

  if (isEmpty) {
    const emptyMsg = `<div class="template-empty">Card is blank</div>`;
    questionHtml += emptyMsg;
    return {
      questionHtml: wrapWithCss(css, questionHtml),
      answerHtml: wrapWithCss(css, emptyMsg),
      css,
      isEmpty: true,
    };
  }

  // 3. 渲染背面
  const aCtx: RenderContext = {
    fields,
    nonemptyFields,
    cardOrdinal,
    frontSide: questionHtml,
  };

  let answerHtml: string;
  try {
    const aTokens = tokenize(answerTemplate);
    const aNodes = parse(aTokens);
    answerHtml = render(aNodes, aCtx);
  } catch (e) {
    if (e instanceof TemplateError) {
      answerHtml = `<div class="template-error"><p>${escapeHtml(e.message)}</p></div>`;
    } else {
      throw e;
    }
  }

  // 4. 注入 CSS + 媒体路径重写
  questionHtml = wrapWithCss(css, questionHtml);
  answerHtml = wrapWithCss(css, answerHtml);

  if (mediaBaseUrl) {
    questionHtml = rewriteMediaReferences(questionHtml, mediaBaseUrl);
    answerHtml = rewriteMediaReferences(answerHtml, mediaBaseUrl);
  }

  return { questionHtml, answerHtml, css, isEmpty: false };
}

// ─── 空白检查 ───

/**
 * 检查模板是否为空。
 * 对应 Rust ParsedTemplate::renders_with_fields() + template_is_empty()
 *
 * 规则: 如果模板中没有任何非空字段的 {{替换}}，
 *       则卡片被视为空白 — 即使模板包含纯文本。
 */
function checkIsEmpty(
  _questionHtml: string,
  isCloze: boolean,
  nonemptyFields: Set<string>,
  cardOrdinal: number,
): boolean {
  if (isCloze) {
    return nonemptyFields.size === 0;
  }
  if (nonemptyFields.size > 0) return false;
  // 没有任何非空字段 → 卡片为空
  return true;
}

// ─── CSS 包装 ───

function wrapWithCss(css: string, html: string): string {
  if (!css) return html;
  return `<style>${css}</style>${html}`;
}

// ─── HTML 转义 ───

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─── 媒体路径重写 ───

function joinBaseUrl(baseUrl: string, filename: string): string {
  const sep = baseUrl.endsWith('/') ? '' : '/';
  return `${baseUrl}${sep}${encodeURI(filename)}`;
}

function rewriteMediaReferences(html: string, mediaBaseUrl: string): string {
  let output = html.replace(
    /(<(?:img|audio|video|source)\b[^>]*\s(?:src|poster)=)(["'])(?![a-z][a-z0-9+.-]*:|\/\/)([^"']+)\2/gi,
    (_match, prefix: string, quote: string, filename: string) =>
      `${prefix}${quote}${joinBaseUrl(mediaBaseUrl, filename)}${quote}`,
  );

  output = output.replace(
    /\[sound:([^\]]+)\]/gi,
    (_match, filename: string) =>
      `<audio controls src="${joinBaseUrl(mediaBaseUrl, filename)}"></audio>`,
  );

  return output;
}
