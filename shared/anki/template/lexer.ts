/**
 * Anki 模板引擎 — 词法分析器 (Lexer)
 *
 * 将模板文本分解为 Token 流。
 * 支持标准 {{...}} 语法和替代 <%...%> 语法。
 * HTML 注释中的标签 <!--{{...}}--> 被归类为 Comment。
 *
 * 对应 Rust: rslib/src/template.rs
 *   - tokens() (line 136-151)
 *   - classify_handle() (line 154-168)
 *   - next_token() (line 76-109)
 */

import {
  type Token,
  COMMENT_START,
  COMMENT_END,
} from './types.ts';

// ─── 标签定界符 ───

interface Delimiters {
  start: string;
  end: string;
}

const STANDARD: Delimiters = { start: '{{', end: '}}' };
const ALT_LEGACY: Delimiters = { start: '<%', end: '%>' };

// ─── 主入口 ───

/**
 * 将模板文本分解为 Token 流。
 * 自动检测替代语法 {{=<% %>=}}。
 */
export function tokenize(template: string): Token[] {
  const delimiters = detectDelimiters(template);
  const tokens: Token[] = [];
  let remaining = template;
  let mode = 'normal';

  while (remaining.length > 0) {
    // 查找下一个 token 起始位置
    const next = findNextTokenStart(remaining, delimiters);
    if (!next) {
      // 没有更多标签，剩余全部为文本
      tokens.push({ kind: 'text', content: remaining });
      break;
    }

    // 标签之前的文本
    if (next.offset > 0) {
      tokens.push({ kind: 'text', content: remaining.substring(0, next.offset) });
    }

    // 消费标签
    if (next.type === 'comment') {
      tokens.push({ kind: 'comment', content: next.innerContent });
    } else {
      parseHandlebarToken(next.innerContent.trim(), tokens);
    }

    remaining = remaining.substring(next.offset + next.length);
  }

  return tokens;
}

// ─── 分隔符检测 ───

function detectDelimiters(template: string): Delimiters {
  const trimmed = template.trimStart();
  if (trimmed.startsWith('{{=<% %>=}}')) {
    return ALT_LEGACY;
  }
  return STANDARD;
}

// ─── 查找下一个 token ───

interface TokenStart {
  offset: number;
  length: number;
  type: 'handlebar' | 'comment';
  innerContent: string;
}

function findNextTokenStart(input: string, delimiters: Delimiters): TokenStart | undefined {
  let best: TokenStart | undefined;

  // 搜索 handlebar {{...}}
  const hbStart = input.indexOf(delimiters.start);
  if (hbStart >= 0) {
    const hbEnd = input.indexOf(delimiters.end, hbStart + delimiters.start.length);
    if (hbEnd >= 0) {
      const inner = input.substring(hbStart + delimiters.start.length, hbEnd);
      best = {
        offset: hbStart,
        length: hbEnd + delimiters.end.length - hbStart,
        type: 'handlebar',
        innerContent: inner,
      };
    }
  }

  // 搜索 HTML 注释 <!-- ... -->
  const cmStart = input.indexOf(COMMENT_START);
  if (cmStart >= 0) {
    // 注释必须包含模板标签 {{...}}
    const cmInner = input.indexOf(delimiters.start, cmStart + COMMENT_START.length);
    if (cmInner >= 0) {
      const cmEnd = input.indexOf(COMMENT_END, cmInner);
      if (cmEnd >= 0) {
        const innerContent = input.substring(cmStart + COMMENT_START.length, cmEnd);

        // 比较 handlebar 和 comment 的位置，取最近的
        if (!best || cmStart < best.offset) {
          best = {
            offset: cmStart,
            length: cmEnd + COMMENT_END.length - cmStart,
            type: 'comment',
            innerContent,
          };
        }
      }
    }
  }

  return best;
}

// ─── Handlebar 标签分类 ───

/**
 * 根据标签内容分类。
 * 对应 Rust classify_handle() (line 154-168)
 */
function parseHandlebarToken(content: string, tokens: Token[]): void {
  // 空标签 → 忽略
  if (content.length === 0) return;

  const first = content[0]!;

  if (first === '#') {
    // {{#condition}}
    tokens.push({ kind: 'open_conditional', field: content.substring(1).trim() });
  } else if (first === '/') {
    // {{/condition}}
    tokens.push({ kind: 'close_conditional', field: content.substring(1).trim() });
  } else if (first === '^') {
    // {{^condition}}
    tokens.push({ kind: 'open_negated', field: content.substring(1).trim() });
  } else if (first === '!') {
    // {{!comment}} — 非 HTML 注释形式的模板注释
    // 忽略，不生成 token
  } else {
    // {{field:filter1:filter2}}
    tokens.push({ kind: 'replacement', content });
  }
}
