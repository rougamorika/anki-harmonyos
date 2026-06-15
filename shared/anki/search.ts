/**
 * Anki 搜索引擎 — 查询解析 + SQL 生成
 *
 * 对应 Rust: rslib/src/search/{parser,sqlwriter,builder}.rs
 *
 * 支持搜索语法:
 *   文本: hello, "hello world"
 *   字段: Front:hello, Front:re:regex
 *   牌组: deck:Default, deck:filtered, deck:*
 *   标签: tag:hard, tag:none, tag:re:.*
 *   状态: is:due, is:new, is:learn, is:review, is:suspended
 *   属性: prop:ivl>5, prop:ease>=2.5, prop:reps<10
 *   布尔: and, or, - (NOT), () (分组)
 *   通配: *, _
 */

// ═══════════════════════════════════════════
// 类型
// ═══════════════════════════════════════════

export type SearchNode =
  | { kind: 'unqualified'; text: string }
  | { kind: 'single_field'; field: string; text: string; mode: 'normal' | 'regex' }
  | { kind: 'tag'; tag: string; mode: 'normal' | 'regex' }
  | { kind: 'deck'; name: string }
  | { kind: 'deck_id'; ids: number[] }
  | { kind: 'notetype'; name: string }
  | { kind: 'notetype_id'; id: number }
  | { kind: 'state'; state: StateKind }
  | { kind: 'flag'; flag: number }
  | { kind: 'card_template'; value: string }
  | { kind: 'property'; propKind: PropertyKind; operator: string }
  | { kind: 'card_ids'; ids: number[] }
  | { kind: 'note_ids'; ids: number[] }
  | { kind: 'added_in_days'; days: number }
  | { kind: 'rated'; days: number; ease: number }
  | { kind: 'regex'; pattern: string }
  | { kind: 'no_combining'; text: string }
  | { kind: 'word_boundary'; text: string }
  | { kind: 'all' };

export type StateKind =
  | 'new' | 'learn' | 'review' | 'due'
  | 'suspended' | 'buried' | 'user_buried' | 'sched_buried';

export type PropertyKind =
  | { kind: 'interval'; value: number }
  | { kind: 'due'; value: number }
  | { kind: 'reps'; value: number }
  | { kind: 'lapses'; value: number }
  | { kind: 'ease'; value: number }
  | { kind: 'position'; value: number }
  | { kind: 'stability'; value: number }
  | { kind: 'difficulty'; value: number }
  | { kind: 'retrievability'; value: number };

export type Node =
  | { kind: 'search'; node: SearchNode }
  | { kind: 'and' }
  | { kind: 'or' }
  | { kind: 'not'; child: Node }
  | { kind: 'group'; children: Node[] };

// ═══════════════════════════════════════════
// 解析结果
// ═══════════════════════════════════════════

export interface SearchResult {
  /** 解析后的 AST (解析为顶层 group) */
  ast: Node;
  /** 生成的 SQL WHERE 子句 (不含 SELECT/FROM) */
  whereClause: string;
  /** 参数绑定值 */
  params: Array<string | number>;
}

export interface SearchOptions {
  /** 返回类型: 'cards' 或 'notes' */
  itemType?: 'cards' | 'notes';
  /** 是否规范化文本 (NFC) */
  normalizeText?: boolean;
}

// ═══════════════════════════════════════════
// Parser
// ═══════════════════════════════════════════

const BOOLS = new Set(['and', 'or']);

export function parseQuery(input: string): Node[] {
  const trimmed = input.trim();
  if (trimmed.length === 0) return [leaf('all')];

  return parseGroup(trimmed);
}

function parseGroup(input: string): Node[] {
  const nodes: Node[] = [];
  let remaining = input;
  let expectBool = false;

  while (remaining.length > 0) {
    const token = nextToken(remaining);
    if (!token) break;

    const word = token.value.toLowerCase();

    if (expectBool && BOOLS.has(word) && !token.quoted) {
      nodes.push({ kind: word as 'and' | 'or' });
      expectBool = false;
    } else if (!expectBool) {
      nodes.push(parseTerm(token.value, token.quoted));
      expectBool = true;
    } else {
      // 隐式 AND
      nodes.push({ kind: 'and' });
      nodes.push(parseTerm(token.value, token.quoted));
      expectBool = true;
    }

    remaining = token.remainder;
  }

  return nodes;
}

interface Token {
  value: string;
  quoted: boolean;
  remainder: string;
}

function nextToken(input: string): Token | undefined {
  let s = input.trimStart();
  let value = '';
  let quoted = false;

  if (s.startsWith('(')) {
    // 分组
    let depth = 1;
    let i = 1;
    let inQuote = false;
    while (i < s.length && depth > 0) {
      const ch = s[i]!;
      if (ch === '\\') { i += 2; continue; }
      if (ch === '"') { inQuote = !inQuote; i++; continue; }
      if (!inQuote) {
        if (ch === '(') depth++;
        if (ch === ')') depth--;
      }
      i++;
    }
    value = s.substring(0, i);
    return { value, quoted: false, remainder: s.substring(i) };
  }

  if (s.startsWith('"')) {
    quoted = true;
    let i = 1;
    while (i < s.length && s[i] !== '"') {
      if (s[i] === '\\') i++;
      i++;
    }
    value = s.substring(1, i);
    return { value, quoted, remainder: s.substring(i + 1) };
  }

  if (s.startsWith('-')) {
    // 否定
    const rest = s.substring(1).trimStart();
    if (rest.startsWith('(')) {
      const token = nextToken(rest);
      if (token) {
        return { value: '-' + token.value, quoted: false, remainder: token.remainder };
      }
    }
    // 否定单个词
    let i = 1;
    while (i < s.length && s[i] !== ' ' && s[i] !== '\t') i++;
    value = s.substring(0, i);
    return { value, quoted: false, remainder: s.substring(i) };
  }

  // 普通词
  let i = 0;
  while (i < s.length && s[i] !== ' ' && s[i] !== '\t' && s[i] !== '(' && s[i] !== ')') i++;
  value = s.substring(0, i);
  return { value, quoted: false, remainder: s.substring(i) };
}

function parseTerm(word: string, _quoted: boolean): Node {
  // 否定
  if (word.startsWith('-(')) {
    const inner = parseGroup(word.substring(2, word.length - 1));
    return { kind: 'not', child: { kind: 'group', children: inner } };
  }
  if (word.startsWith('-')) {
    return { kind: 'not', child: parseTerm(word.substring(1), false) };
  }

  // 分组
  if (word.startsWith('(')) {
    const inner = parseGroup(word.substring(1, word.length - 1));
    return { kind: 'group', children: inner };
  }

  // 搜索条件
  const colon = findFirstUnescapedColon(word);
  if (colon < 0) {
    return leaf('unqualified', { text: unescape(word) });
  }

  const key = word.substring(0, colon).trim().toLowerCase();
  const val = unescape(word.substring(colon + 1).trim());
  return parseSearchNode(key, val);
}

function findFirstUnescapedColon(s: string): number {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] === ':') return i;
  }
  return -1;
}

function parseSearchNode(key: string, val: string): Node {
  switch (key) {
    case 'deck': return leaf('deck', { name: val });
    case 'tag': return parseTag(val);
    case 'note': case 'notetype': return leaf('notetype', { name: val });
    case 'card': case 'template': return leaf('card_template', { value: val });
    case 'flag': return leaf('flag', { flag: Number(val) || 0 });
    case 'is': return parseState(val);
    case 'prop': return parseProp(val);
    case 'added': return leaf('added_in_days', { days: Number(val) || 0 });
    case 'rated': return parseRated(val);
    case 're': return leaf('regex', { pattern: val });
    case 'nc': return leaf('no_combining', { text: val });
    case 'w': return leaf('word_boundary', { text: val });
    case 'did': return leaf('deck_id', { ids: parseIdList(val) });
    case 'mid': return leaf('notetype_id', { id: Number(val) || 0 });
    case 'nid': case 'note_id': return leaf('note_ids', { ids: parseIdList(val) });
    case 'cid': case 'card_id': return leaf('card_ids', { ids: parseIdList(val) });
    default: return leaf('single_field', { field: key, text: val, mode: 'normal' });
  }
}

function parseTag(val: string): Node {
  if (val === 'none') return leaf('tag', { tag: '', mode: 'normal' });
  if (val.startsWith('re:')) return leaf('tag', { tag: val.substring(3), mode: 'regex' });
  return leaf('tag', { tag: val, mode: 'normal' });
}

function parseState(val: string): Node {
  const map: Record<string, StateKind> = {
    'new': 'new', 'learn': 'learn', 'learning': 'learn',
    'review': 'review', 'due': 'due',
    'suspended': 'suspended', 'suspend': 'suspended',
    'buried': 'buried', 'bury': 'buried',
    'user_buried': 'user_buried', 'sched_buried': 'sched_buried',
  };
  return leaf('state', { state: map[val.toLowerCase()] ?? 'new' });
}

function parseRated(val: string): Node {
  const parts = val.split(':');
  return leaf('rated', {
    days: Number(parts[0]) || 0,
    ease: Number(parts[1]) || 1,
  });
}

function parseProp(val: string): Node {
  const m = val.match(/^(\w+)\s*(<=|>=|!=|[<>=])\s*(.+)$/);
  if (!m) return leaf('all');

  const name = m[1]!;
  const op = m[2]!;
  const valNum = Number(m[3]);

  const prop: PropertyKind = (() => {
    switch (name) {
      case 'ivl': case 'interval': return { kind: 'interval', value: valNum };
      case 'due': return { kind: 'due', value: valNum };
      case 'reps': return { kind: 'reps', value: valNum };
      case 'lapses': return { kind: 'lapses', value: valNum };
      case 'ease': return { kind: 'ease', value: valNum };
      case 'pos': case 'position': return { kind: 'position', value: valNum };
      case 's': case 'stability': return { kind: 'stability', value: valNum };
      case 'd': case 'difficulty': return { kind: 'difficulty', value: valNum };
      case 'r': case 'retrievability': return { kind: 'retrievability', value: valNum };
      default: return { kind: 'interval', value: valNum };
    }
  })();

  return leaf('property', { propKind: prop, operator: op });
}

function parseIdList(val: string): number[] {
  return val.split(/[, ]+/).map(Number).filter((n) => !isNaN(n));
}

function leaf<T extends SearchNode>(kind: T['kind'], props?: Partial<Omit<T, 'kind'>>): Node {
  return { kind: 'search', node: { kind, ...props } as unknown as SearchNode };
}

// ═══════════════════════════════════════════
// SQL Writer
// ═══════════════════════════════════════════

export function buildSearchSql(nodes: Node[], paramStart: number = 0): SearchResult {
  const writer = new SqlWriter(paramStart);
  const group: Node = { kind: 'group', children: nodes };
  writeNode(group, writer);
  return { ast: group, whereClause: writer.sql, params: writer.params };
}

class SqlWriter {
  sql = '';
  params: Array<string | number> = [];
  private counter: number;

  constructor(start: number) { this.counter = start; }

  param(val: string | number): string {
    this.params.push(val);
    return `?${this.counter++}`;
  }

  write(s: string): void { this.sql += s; }
}

function writeNode(node: Node, w: SqlWriter): void {
  switch (node.kind) {
    case 'search':
      writeSearchNode(node.node, w);
      break;
    case 'and':
      w.write(' and ');
      break;
    case 'or':
      w.write(' or ');
      break;
    case 'not':
      w.write('not ');
      writeNode(node.child, w);
      break;
    case 'group':
      if (node.children.length === 0) { w.write(' true '); break; }
      if (node.children.length === 1) { writeNode(node.children[0]!, w); break; }
      w.write('(');
      writeNode(node.children[0]!, w);
      for (let i = 1; i < node.children.length; i++) {
        writeNode(node.children[i]!, w);
      }
      w.write(')');
      break;
  }
}

function writeSearchNode(sn: SearchNode, w: SqlWriter): void {
  switch (sn.kind) {
    case 'all':
      w.write(' true ');
      break;

    case 'unqualified':
      w.write('(n.sfld like ' + w.param('%' + toSql(sn.text) + '%'));
      w.write(' escape \'\\\' or n.flds like ' + w.param('%' + toSql(sn.text) + '%'));
      w.write(' escape \'\\\') ');
      break;

    case 'single_field':
      w.write('n.flds like \'\' || ' + w.param(toSql(sn.text)));
      w.write(' || \'\x1f%\' escape \'\\\' ');
      break;

    case 'tag':
      if (!sn.tag) { w.write('n.tags = \'\' '); break; }
      if (sn.mode === 'regex') {
        w.write('n.tags regexp ' + w.param(sn.tag) + ' ');
      } else {
        w.write('n.tags like ' + w.param('% ' + toSql(sn.tag) + ' %'));
        w.write(' escape \'\\\' ');
      }
      break;

    case 'deck':
      if (sn.name === '*') { w.write(' true '); break; }
      if (sn.name === 'filtered') { w.write('c.odid != 0 '); break; }
      w.write('c.did in (select id from anki_decks where name like ');
      w.write(w.param(sn.name + '%'));
      w.write(' escape \'\\\') ');
      break;

    case 'deck_id': {
      const ids = sn.ids.map(String).join(',');
      w.write('c.did in (' + ids + ') ');
      break;
    }

    case 'notetype':
      w.write('n.mid in (select id from anki_notetypes where name = ');
      w.write(w.param(sn.name) + ') ');
      break;

    case 'notetype_id':
      w.write('n.mid = ' + sn.id + ' ');
      break;

    case 'state':
      writeStateSql(sn.state, w);
      break;

    case 'flag':
      w.write('(c.flags & 7) = ' + sn.flag + ' ');
      break;

    case 'card_template':
      w.write('c.ord = ' + (Number(sn.value) || 0) + ' ');
      break;

    case 'property':
      writePropSql(sn.propKind, sn.operator, w);
      break;

    case 'card_ids': {
      if (sn.ids.length === 0) { w.write(' false '); break; }
      w.write('c.id in (' + sn.ids.join(',') + ') ');
      break;
    }

    case 'note_ids': {
      if (sn.ids.length === 0) { w.write(' false '); break; }
      w.write('c.nid in (' + sn.ids.join(',') + ') ');
      break;
    }

    case 'added_in_days':
      w.write('c.id > ' + w.param(sn.days * 86400 * 1000) + ' ');
      break;

    case 'rated':
      w.write('c.id in (select cid from revlog where id >= ');
      w.write(w.param(sn.days * 86400 * 1000));
      w.write(' and ease = ' + sn.ease + ') ');
      break;

    case 'regex':
      w.write('n.flds regexp ' + w.param('(?i)' + sn.pattern) + ' ');
      break;

    case 'no_combining':
      w.write('(n.sfld like ' + w.param('%' + toSql(sn.text) + '%'));
      w.write(' escape \'\\\') ');
      break;

    case 'word_boundary':
      w.write('n.flds regexp ' + w.param('(?i)\\b' + sn.text + '\\b') + ' ');
      break;
  }
}

function writeStateSql(state: StateKind, w: SqlWriter): void {
  switch (state) {
    case 'new': w.write('c.type = 0 '); break;
    case 'learn': w.write('c.type = 1 '); break;
    case 'review': w.write('c.type in (2, 3) '); break;
    case 'due':
      w.write('(c.queue = 0 or (c.queue in (1, 3) and c.due <= ');
      w.write(w.param(Math.floor(Date.now() / 1000)));
      w.write(') or (c.queue = 2 and c.due <= ');
      w.write(w.param(Math.floor(Date.now() / 86400)));
      w.write(')) ');
      break;
    case 'suspended': w.write('c.queue = -1 '); break;
    case 'buried': case 'user_buried': w.write('c.queue = -3 '); break;
    case 'sched_buried': w.write('c.queue = -2 '); break;
  }
}

function writePropSql(prop: PropertyKind, op: string, w: SqlWriter): void {
  let col: string;
  let val: number;

  switch (prop.kind) {
    case 'interval': col = 'c.ivl'; val = prop.value; break;
    case 'due': col = 'c.due'; val = prop.value; break;
    case 'reps': col = 'c.reps'; val = prop.value; break;
    case 'lapses': col = 'c.lapses'; val = prop.value; break;
    case 'ease': col = 'c.factor'; val = prop.value * 1000; break;
    case 'position': col = 'c.due'; val = prop.value; break;
    default: w.write(' true '); return;
  }

  w.write(`${col} ${op} ${val} `);
}

// ═══════════════════════════════════════════
// 通配符转换
// ═══════════════════════════════════════════

/**
 * Anki 通配符 → SQL LIKE 通配符。
 * * → %, _ → _, % → \%, \* → *, \\ → \\
 */
export function toSql(text: string): string {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '\\' && i + 1 < text.length) {
      const next = text[i + 1]!;
      if (next === '*' || next === '_' || next === '%') {
        result += next;
        i++;
        continue;
      }
      if (next === '\\') {
        result += '\\\\';
        i++;
        continue;
      }
      result += '\\\\';
      continue;
    }
    if (ch === '*') { result += '%'; continue; }
    if (ch === '%') { result += '\\%'; continue; }
    if (ch === '_') { result += '_'; continue; }
    result += ch;
  }
  return result;
}

/**
 * Anki 通配符 → 正则表达式。
 * * → .*, _ → ., 其余 escape。
 */
export function toRegex(text: string): string {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '\\' && i + 1 < text.length) {
      const next = text[i + 1]!;
      if (next === '*' || next === '_') { result += escapeReChar(next); i++; continue; }
      result += '\\\\';
      continue;
    }
    if (ch === '*') { result += '.*'; continue; }
    if (ch === '_') { result += '.'; continue; }
    result += escapeReChar(ch);
  }
  return result;
}

function escapeReChar(ch: string): string {
  return '\\^$.|?*+()[]{}'.includes(ch) ? '\\' + ch : ch;
}

/**
 * 判断文本是否包含 Anki 通配符 (* 或 _)。
 */
export function isGlob(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue; }
    if (text[i] === '*' || text[i] === '_') return true;
  }
  return false;
}

/**
 * 反转义 — 移除所有反斜杠转义。
 */
export function unescape(text: string): string {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\' && i + 1 < text.length) {
      const next = text[i + 1]!;
      if (':\\-"*_()'.includes(next)) { result += next; i++; continue; }
    }
    result += text[i];
  }
  return result;
}
