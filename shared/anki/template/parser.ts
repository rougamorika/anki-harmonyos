/**
 * Anki 模板引擎 — 语法分析器 (Parser)
 *
 * 递归下降解析 Token 流为 ParsedNode 树。
 * 处理嵌套条件、过滤器解析、HTML 注释。
 *
 * 对应 Rust: rslib/src/template.rs
 *   - parse_inner() (line 202-252)
 *   - ParsedNode 枚举 (line 178-189)
 */

import type { ParsedNode, Token } from './types.ts';
import { TemplateError, TemplateErrorCode } from './types.ts';

/**
 * 解析 Token 流为 ParsedNode 树。
 *
 * @param tokens Token 流 (来自 lexer)
 * @returns ParsedNode 树
 * @throws TemplateError 如果条件不匹配
 */
export function parse(tokens: Token[]): ParsedNode[] {
  const [nodes, _consumed] = parseInner(tokens, undefined);
  return nodes;
}

/**
 * 递归下降解析。
 *
 * @param tokens 剩余 Token 流
 * @param openTag 当前正在解析的条件标签名 (undefined = 顶层)
 * @returns [nodes, consumedCount]
 * @throws TemplateError
 */
function parseInner(
  tokens: Token[],
  openTag: string | undefined,
): [ParsedNode[], number] {
  const nodes: ParsedNode[] = [];
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i]!;

    switch (token.kind) {
      case 'text':
        nodes.push({ kind: 'text', text: token.content });
        i++;
        break;

      case 'comment':
        // HTML 注释模板标签 → 原样保留内容
        nodes.push({ kind: 'comment', text: token.content });
        i++;
        break;

      case 'replacement': {
        const { key, filters } = parseFilterString(token.content);
        nodes.push({ kind: 'replacement', key, filters });
        i++;
        break;
      }

      case 'open_conditional': {
        i++;
        const [children, consumed] = parseInner(tokens.slice(i), token.field);
        nodes.push({ kind: 'conditional', key: token.field, children });
        i += consumed;
        break;
      }

      case 'open_negated': {
        i++;
        const [children, consumed] = parseInner(tokens.slice(i), token.field);
        nodes.push({ kind: 'negated_conditional', key: token.field, children });
        i += consumed;
        break;
      }

      case 'close_conditional': {
        if (openTag === undefined) {
          throw new TemplateError(
            `Closing tag {{/${token.field}}} without matching opening tag. ` +
              `Use {{#${token.field}}} or {{^${token.field}}} to open.`,
            TemplateErrorCode.ConditionalNotOpen,
            token.field,
          );
        }
        if (token.field !== openTag) {
          throw new TemplateError(
            `Mismatched closing tag: expected {{/${openTag}}}, found {{/${token.field}}}.`,
            TemplateErrorCode.MismatchedConditional,
            `expected /${openTag}, got /${token.field}`,
          );
        }
        // 匹配成功 — 返回当前节点和消费的 token 数
        return [nodes, i + 1];
      }
    }
  }

  // 遍历完成 — 如果有未闭合标签则报错
  if (openTag !== undefined) {
    throw new TemplateError(
      `Conditional tag {{#${openTag}}} was never closed with {{/${openTag}}}.`,
      TemplateErrorCode.ConditionalNotClosed,
      openTag,
    );
  }

  return [nodes, -1]; // -1 表示顶层，消费数无关紧要
}

/**
 * 解析过滤器字符串。
 * 格式: "field" 或 "field:filter1:filter2"
 * 从右向左解析，最右段为字段名，其余为过滤器。
 * 返回的 filters 按应用顺序排列 (从左到右)。
 *
 * 对应 Rust: template.rs lines 213-218
 */
export function parseFilterString(content: string): { key: string; filters: string[] } {
  const parts = content.split(':');
  // 从右向左取: 最后一段是 key，其余是 filters (逆序)
  const reversed = parts.reverse();
  const key = reversed[0] ?? '';
  const filters = reversed.slice(1).reverse();
  return { key, filters };
}
