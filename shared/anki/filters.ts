/**
 * Anki 模板过滤器
 *
 * 对模板引擎输出应用的字段转换。
 * 对应 Rust: rslib/src/template_filters.rs
 */

// ─── 过滤器注册表 ───

export type FilterFn = (text: string, fieldName: string, args: string[]) => string;

const FILTERS = new Map<string, FilterFn>();

export function registerFilter(name: string, fn: FilterFn): void {
  FILTERS.set(name.toLowerCase(), fn);
}

export function applyFilter(text: string, filterName: string, fieldName: string, args: string[] = []): string {
  const fn = FILTERS.get(filterName.toLowerCase());
  return fn ? fn(text, fieldName, args) : text;
}

export function applyFilters(text: string, filterNames: string[], fieldName: string): string {
  let result = text;
  for (const name of filterNames) {
    result = applyFilter(result, name, fieldName);
  }
  return result;
}

// ─── 内置过滤器 ───

/** {{text:Field}} — 去除 HTML 标签，只保留纯文本 */
registerFilter('text', (text) => stripHtml(text));

/** {{hint:Field}} — 生成提示链接 (点击显示答案) */
registerFilter('hint', (text, fieldName) => {
  if (!text.trim()) return '';
  return `<a class="hint" href="#" onclick="this.style.display='none';document.getElementById('hint_${fieldName}').style.display='block';return false;">Show Hint</a><div id="hint_${fieldName}" class="hint" style="display:none">${text}</div>`;
});

/** {{furigana:Field}} — 处理日文注音标记 */
registerFilter('furigana', (text) => processFurigana(text));

/** {{kanji:Field}} — 只保留汉字 */
registerFilter('kanji', (text) => {
  const stripped = stripHtml(text);
  return stripped.replace(/[^\u4e00-\u9fff\u3400-\u4dbf]/g, '');
});

/** {{kana:Field}} — 只保留假名 */
registerFilter('kana', (text) => {
  const stripped = stripHtml(text);
  return stripped.replace(/[^\u3040-\u309f\u30a0-\u30ff]/g, '');
});

/** {{type:Field}} — 打字输入框 */
registerFilter('type', (text, fieldName) => {
  return `<input id="typeans" type="text" data-field="${fieldName}" value="" style="width:100%" />`;
});

/** {{cloze:Field}} — 完形填空 (渲染时由模板引擎处理) */
registerFilter('cloze', (text) => {
  // cloze 过滤器由模板引擎的 {{cloze:Field}} 语法调用
  // 这里返回原文本，实际的 cloze 替换在模板渲染中完成
  return text;
});

// ─── 过滤器实现函数 ───

/** 去除 HTML 标签 */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?(?:div|p|h[1-6]|li|tr)\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** 处理日文注音标记 (furigana) */
export function processFurigana(text: string): string {
  // 格式: 漢字[かんじ] → <ruby>漢字<rt>かんじ</rt></ruby>
  // 格式: 漢字[かんじ] 或 単語[たんご]
  return text.replace(
    / ?([^\[\]\s]+?)\[([^\[\]]+?)\]/g,
    (_match, kanji: string, reading: string) => {
      return `<ruby>${kanji}<rt>${reading}</rt></ruby>`;
    },
  );
}

/** 检查文本是否是空白的 (只有 whitespace 或空 BR/DIV) */
export function fieldIsEmpty(text: string): boolean {
  const cleaned = text
    .replace(/<\/?(?:br|div)\s*\/?>/gi, '')
    .replace(/&nbsp;/gi, '')
    .trim();
  return cleaned.length === 0;
}

/** 去除 {{! ... }} 注释 */
export function stripComments(template: string): string {
  return template.replace(/{{!.*?}}/gs, '');
}
