/**
 * Anki 数据库行类型定义
 *
 * 包含:
 * - ColRow (col 表)
 * - CardRow  (cards 表 — 已在 card.ts 部分定义, 这里补完)
 * - NoteRow  (notes 表)
 * - RevlogRow (revlog 表)
 * - JSON 结构: Deck / Notetype / DeckConfig
 */

// ─── col 表 ───

export interface ColRow {
  id: number;
  crt: number;
  mod: number;
  scm: number;
  ver: number;
  dty: number;
  usn: number;
  ls: number;
  conf: string;
  models: string;
  decks: string;
  dconf: string;
  tags: string;
}

// ─── cards 表 ───

export interface CardRow {
  id: number;
  nid: number;
  did: number;
  ord: number;
  mod: number;
  usn: number;
  type: number;
  queue: number;
  due: number;
  ivl: number;
  factor: number;
  reps: number;
  lapses: number;
  left: number;
  odue: number;
  odid: number;
  flags: number;
  data: string;
}

// ─── notes 表 ───

export interface NoteRow {
  id: number;
  guid: string;
  mid: number;
  mod: number;
  usn: number;
  tags: string;
  flds: string;
  sfld: number;
  csum: number;
  flags: number;
  data: string;
}

// ─── revlog 表 ───

export interface RevlogRow {
  id: number;
  cid: number;
  usn: number;
  ease: number;
  ivl: number;
  lastIvl: number;
  factor: number;
  time: number;
  type: number;
}

// ─── JSON 结构: Deck (来自 col.decks) ───

export interface DeckJson {
  id: number;
  name: string;
  desc: string;
  extendRev: number;
  extendNew: number;
  collapse: boolean;
  browserCollapse: boolean;
  conf: number;
  dyn: number;
  /** 新版调度延迟 (V2 scheduler) */
  newToday?: [number, number];
  revToday?: [number, number];
  lrnToday?: [number, number];
  timeToday?: [number, number];
}

/** decks JSON 格式: { [id: string]: DeckJson } */
export type DecksJson = Record<string, DeckJson>;

export interface DeckSummary {
  id: number;
  name: string;
  cardCount: number;
  newCount: number;
  learnCount: number;
  reviewCount: number;
  /** 从根到当前牌组的路径 */
  namePath: string;
}

// ─── JSON 结构: Notetype (来自 col.models) ───

export interface NotetypeField {
  name: string;
  ord: number;
  font: string;
  size: number;
  rtl: boolean;
  sticky: boolean;
  plainText: boolean;
  collapsed: boolean;
  excludeFromSearch: boolean;
}

export interface NotetypeTemplate {
  name: string;
  ord: number;
  qfmt: string;
  afmt: string;
  bqfmt: string;
  bafmt: string;
  did: number | null;
  bfont: string;
  bsize: number;
}

export interface NotetypeJson {
  id: number;
  name: string;
  type: number;
  usn: number;
  mtime_secs: number;
  flds: NotetypeField[];
  tmpls: NotetypeTemplate[];
  css: string;
  latexPre: string;
  latexPost: string;
  latexsvg: boolean;
  req: Array<[number, string, number[]]>;
  tags: string[];
  vers: unknown[];
}

/** models JSON 格式: { [id: string]: NotetypeJson } */
export type NotetypesJson = Record<string, NotetypeJson>;

// ─── JSON 结构: DeckConfig (来自 col.dconf) ───

export interface DeckConfigJson {
  id: number;
  name: string;
  mtime_secs: number;
  usn: number;
  maxTaken: number;
  autoplay: boolean;
  timer: number;
  replayq: boolean;
  /** FSRS 参数 (可为空数组) */
  fsrsParams?: number[];
  fsrsWeights?: number[];
  fsrsReschedule?: boolean;
  fsrsDesiredRetention?: number;
  fsrsHistoricalRetention?: number;
  fsrsMaximumInterval?: number;
  fsrsSm2Retention?: number;
  newMix: number;
  newPerDay: number;
  newPerDayMinimum: number;
  newBury: boolean;
  newSteps: number[];
  newGraduatingInterval: number;
  newEasyInterval: number;
  newInsertionOrder: number;
  revMix: number;
  revPerDay: number;
  revHardFactor: number;
  revEasyBonus: number;
  revIvlFct: number;
  revMaxIvl: number;
  revBury: boolean;
  lapseSteps: number[];
  lapseMult: number;
  lapseMinInt: number;
  lapseLeechFails: number;
  lapseLeechAction: number;
}

/** dconf JSON 格式: { [id: string]: DeckConfigJson } */
export type DeckConfigsJson = Record<string, DeckConfigJson>;

// ─── 字段分隔符 ───

export const FIELD_SEPARATOR = '\x1f';

/**
 * 解析 notes.flds 为字段值数组
 */
export function parseNoteFields(flds: string): string[] {
  return flds.split(FIELD_SEPARATOR);
}

/**
 * 将字段名数组 + notes.flds 映射为 Record<string, string>
 */
export function fieldsToRecord(flds: string, fieldNames: string[]): Record<string, string> {
  const values = flds.split(FIELD_SEPARATOR);
  const result: Record<string, string> = {};
  for (let i = 0; i < fieldNames.length; i++) {
    result[fieldNames[i]!] = values[i] ?? '';
  }
  return result;
}

/**
 * 安全的 JSON 解析 (返回默认值)
 */
export function parseJsonSafe<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}
