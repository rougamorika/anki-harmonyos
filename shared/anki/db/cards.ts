/**
 * Anki 卡片(CARDS)数据库查询层
 *
 * 功能:
 * - 按到期顺序获取待复习卡片
 * - 按牌组筛选
 * - 按状态筛选 (New/Learning/Review/Relearning)
 * - 搜索 (按笔记字段)
 * - 分页查询
 * - 获取卡片详情 (含笔记 + 模板信息)
 */

import type { DbConnection, DbResultSet } from './connection.ts';
import { querySingle, queryAll, queryScalar } from './connection.ts';
import type {
  CardRow,
  NoteRow,
  DeckJson,
  NotetypeJson,
  NotetypesJson,
} from './types.ts';
import { parseJsonSafe, parseNoteFields } from './types.ts';
import { getDecksJson, getModelsJson } from './decks.ts';

// ─── 查询选项 ───

export interface CardQueryOptions {
  /** 牌组 ID (0 = 全部) */
  deckId?: number;
  /** 是否包含子牌组 */
  includeChildDecks?: boolean;
  /** 只返回到期卡片 (queue >= 0 且 due <= today) */
  dueOnly?: boolean;
  /** 按 queue 筛选: 0=new, 1/3=learn, 2=review, -1=suspended, null=全部 */
  queueFilter?: number | null;
  /** 搜索关键词 (搜索 notes.flds) */
  search?: string;
  /** 排序: 'due' | 'interval' | 'ease' | 'lapses' | 'added' */
  sortBy?: 'due' | 'interval' | 'ease' | 'lapses' | 'added';
  /** 升序 */
  ascending?: boolean;
  /** 分页: 偏移 */
  offset?: number;
  /** 分页: 条数 */
  limit?: number;
  /** 当前天数 (Review 的 due 对比基准) */
  today?: number;
}

const DEFAULT_OPTIONS: Required<CardQueryOptions> = {
  deckId: 0,
  includeChildDecks: false,
  dueOnly: false,
  queueFilter: null,
  search: '',
  sortBy: 'due',
  ascending: true,
  offset: 0,
  limit: 50,
  today: 0,
};

// ─── 卡片读取 ───

function cardFromRow(rs: DbResultSet): CardRow {
  return {
    id: rs.getLong(0),
    nid: rs.getLong(1),
    did: rs.getLong(2),
    ord: rs.getLong(3),
    mod: rs.getLong(4),
    usn: rs.getLong(5),
    type: rs.getLong(6),
    queue: rs.getLong(7),
    due: rs.getLong(8),
    ivl: rs.getLong(9),
    factor: rs.getLong(10),
    reps: rs.getLong(11),
    lapses: rs.getLong(12),
    left: rs.getLong(13),
    odue: rs.getLong(14),
    odid: rs.getLong(15),
    flags: rs.getLong(16),
    data: rs.getString(17),
  };
}

function noteFromRow(rs: DbResultSet): NoteRow {
  return {
    id: rs.getLong(0),
    guid: rs.getString(1),
    mid: rs.getLong(2),
    mod: rs.getLong(3),
    usn: rs.getLong(4),
    tags: rs.getString(5),
    flds: rs.getString(6),
    sfld: rs.getLong(7),
    csum: rs.getLong(8),
    flags: rs.getLong(9),
    data: rs.getString(10),
  };
}

// ─── 查询构建 ───

interface SqlClause {
  condition: string;
  params: Array<string | number | null>;
}

function buildCardQuery(options: CardQueryOptions, deckIds?: number[]): { sql: string; params: Array<string | number | null> } {
  const clauses: SqlClause[] = [];
  const params: Array<string | number | null> = [];

  // 牌组筛选
  if (deckIds && deckIds.length > 0) {
    const placeholders = deckIds.map(() => '?').join(',');
    clauses.push({ condition: `c.did IN (${placeholders})`, params: deckIds });
  } else if (options.deckId && options.deckId > 0) {
    clauses.push({ condition: 'c.did = ?', params: [options.deckId] });
  }

  // queue 筛选
  if (options.queueFilter !== null && options.queueFilter !== undefined) {
    if (options.queueFilter === -1) {
      clauses.push({ condition: 'c.queue = -1', params: [] });
    } else if (options.queueFilter === 1) {
      // Learning + DayLearn
      clauses.push({ condition: 'c.queue IN (1, 3)', params: [] });
    } else {
      clauses.push({ condition: 'c.queue = ?', params: [options.queueFilter] });
    }
  } else {
    // 默认排除暂停/埋藏
    clauses.push({ condition: 'c.queue >= 0', params: [] });
  }

  // 到期筛选
  if (options.dueOnly) {
    const today = options.today ?? 0;
    clauses.push({
      condition: `(
        (c.queue = 0) OR
        (c.queue IN (1, 3) AND c.due <= ?) OR
        (c.queue = 2 AND c.due <= ?)
      )`,
      params: [Math.floor(Date.now() / 1000) + 3600, today],
    });
  }

  // 搜索
  if (options.search) {
    clauses.push({ condition: 'n.flds LIKE ? COLLATE NOCASE', params: [`%${options.search}%`] });
  }

  for (const clause of clauses) {
    params.push(...clause.params);
  }

  return { sql: buildSql(clauses, options), params };
}

function buildSql(clauses: SqlClause[], options: CardQueryOptions): string {
  const where = clauses.length > 0
    ? `WHERE ${clauses.map((c) => c.condition).join(' AND ')}`
    : '';

  let orderBy: string;
  switch (options.sortBy) {
    case 'interval': orderBy = 'c.ivl'; break;
    case 'ease':     orderBy = 'c.factor'; break;
    case 'lapses':   orderBy = 'c.lapses'; break;
    case 'added':    orderBy = 'c.id'; break;
    default:         orderBy = 'c.due'; break;
  }
  const dir = options.ascending ?? true ? 'ASC' : 'DESC';

  return `
    SELECT ${COLUMNS}
    FROM cards c
    JOIN notes n ON n.id = c.nid
    ${where}
    ORDER BY ${orderBy} ${dir}
    LIMIT ? OFFSET ?
  `;
}

const COLUMNS = 'c.id, c.nid, c.did, c.ord, c.mod, c.usn, c.type, c.queue, c.due, c.ivl, c.factor, c.reps, c.lapses, c.left, c.odue, c.odid, c.flags, c.data';

// ─── 公开 API ───

/** 查询卡片列表 */
export async function queryCards(
  conn: DbConnection,
  options: CardQueryOptions = {},
): Promise<CardRow[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // 如果要求包含子牌组，先获取子牌组 ID
  let deckIds: number[] | undefined;
  if (opts.includeChildDecks && opts.deckId && opts.deckId > 0) {
    deckIds = await getDeckAndChildIds(conn, opts.deckId);
  }

  const { sql, params } = buildCardQuery(opts, deckIds);
  return queryAll(conn, sql, [...params, opts.limit, opts.offset], cardFromRow);
}

/** 获取下一个到期卡片 (用于复习) */
export async function getNextDueCard(
  conn: DbConnection,
  deckId?: number,
  today?: number,
): Promise<CardRow | undefined> {
  return querySingle(
    conn,
    buildNextDueSql(deckId),
    buildNextDueParams(deckId, today),
    cardFromRow,
  );
}

function buildNextDueSql(deckId?: number): string {
  const deckClause = deckId ? 'AND c.did = ?' : '';
  return `
    SELECT ${COLUMNS}
    FROM cards c
    WHERE c.queue >= 0
      ${deckClause}
      AND (
        c.queue = 0
        OR (c.queue IN (1, 3) AND c.due <= ?)
        OR (c.queue = 2 AND c.due <= ?)
      )
    ORDER BY
      CASE c.queue WHEN 0 THEN 0 WHEN 1 THEN 1 WHEN 3 THEN 1 ELSE 2 END,
      c.due ASC
    LIMIT 1
  `;
}

function buildNextDueParams(deckId?: number, _today?: number): Array<string | number | null> {
  const now = Math.floor(Date.now() / 1000) + 3600;
  const today = _today ?? 0;
  const params: Array<string | number | null> = [];
  if (deckId) params.push(deckId);
  params.push(now, today);
  return params;
}

/** 获取卡片总数 (带筛选条件) */
export async function countCards(
  conn: DbConnection,
  options: CardQueryOptions = {},
): Promise<number> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let deckIds: number[] | undefined;
  if (opts.includeChildDecks && opts.deckId && opts.deckId > 0) {
    deckIds = await getDeckAndChildIds(conn, opts.deckId);
  }

  const { sql, params } = buildCountQuery(opts, deckIds);
  return (await queryScalar(conn, sql, params)) ?? 0;
}

function buildCountQuery(options: CardQueryOptions, deckIds?: number[]): { sql: string; params: Array<string | number | null> } {
  const clauses: SqlClause[] = [];
  const params: Array<string | number | null> = [];

  if (deckIds && deckIds.length > 0) {
    const ph = deckIds.map(() => '?').join(',');
    clauses.push({ condition: `c.did IN (${ph})`, params: deckIds });
  } else if (options.deckId && options.deckId > 0) {
    clauses.push({ condition: 'c.did = ?', params: [options.deckId] });
  }

  if (options.queueFilter !== null && options.queueFilter !== undefined) {
    clauses.push({ condition: 'c.queue = ?', params: [options.queueFilter] });
  } else {
    clauses.push({ condition: 'c.queue >= 0', params: [] });
  }

  if (options.search) {
    clauses.push({ condition: 'n.flds LIKE ? COLLATE NOCASE', params: [`%${options.search}%`] });
  }

  for (const c of clauses) params.push(...c.params);

  const where = clauses.length > 0 ? `WHERE ${clauses.map((c) => c.condition).join(' AND ')}` : '';
  const join = options.search ? 'JOIN notes n ON n.id = c.nid' : '';

  return { sql: `SELECT COUNT(*) FROM cards c ${join} ${where}`, params };
}

/** 获取单个卡片 (by id) */
export async function getCardById(
  conn: DbConnection,
  cardId: number,
): Promise<CardRow | undefined> {
  return querySingle(
    conn,
    `SELECT ${COLUMNS} FROM cards WHERE id = ?`,
    [cardId],
    cardFromRow,
  );
}

/** 获取卡片关联的笔记 */
export async function getNoteById(
  conn: DbConnection,
  noteId: number,
): Promise<NoteRow | undefined> {
  return querySingle(
    conn,
    'SELECT id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data FROM notes WHERE id = ?',
    [noteId],
    noteFromRow,
  );
}

/** 获取笔记类型定义 */
export async function getNotetype(
  conn: DbConnection,
  modelId: number,
): Promise<NotetypeJson | undefined> {
  const models = await getModelsJson(conn);
  const model = models[String(modelId)];
  if (!model) return undefined;
  return model as unknown as NotetypeJson;
}

// ─── 卡片浏览器视图 ───

export interface CardBrowseRow {
  cardId: number;
  deckName: string;
  question: string;
  answer: string;
  due: string;
  interval: number;
  ease: number;
  reviews: number;
  lapses: number;
  queue: number;
}

/**
 * 为浏览器视图获取卡片列表 (含牌组名、笔记首字段)。
 */
export async function getCardBrowseRows(
  conn: DbConnection,
  options: CardQueryOptions = {},
): Promise<CardBrowseRow[]> {
  const cards = await queryCards(conn, options);
  const decks = await getDecksJson(conn);

  const rows: CardBrowseRow[] = [];
  for (const card of cards) {
    const note = await getNoteById(conn, card.nid);
    const deck = decks[String(card.did)];
    const deckName = deck?.name ?? 'Unknown Deck';

    const flds = note ? parseNoteFields(note.flds) : [];
    const question = flds[0] ?? '(empty)';

    let answer = flds[1] ?? '';
    // 限制回答长度
    if (answer.length > 200) answer = answer.slice(0, 200) + '...';

    rows.push({
      cardId: card.id,
      deckName,
      question: question.length > 100 ? question.slice(0, 100) + '...' : question,
      answer,
      due: formatDue(card),
      interval: card.ivl,
      ease: card.factor > 0 ? card.factor / 1000 : 2.5,
      reviews: card.reps,
      lapses: card.lapses,
      queue: card.queue,
    });
  }

  return rows;
}

function formatDue(card: CardRow): string {
  if (card.queue === -1) return 'Suspended';
  if (card.queue === 0) return `New #${card.due}`;
  if (card.queue === 1 || card.queue === 3) {
    const mins = Math.max(0, Math.ceil((card.due - Math.floor(Date.now() / 1000)) / 60));
    if (mins <= 0) return 'Now';
    if (mins < 60) return `${mins}m`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h`;
    return `${Math.floor(mins / 1440)}d`;
  }
  if (card.queue === 2) {
    const days = card.due - (Math.floor(Date.now() / 86400));
    if (days <= 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    return `${days}d`;
  }
  return 'Unknown';
}

// ─── 辅助 ───

async function getDeckAndChildIds(conn: DbConnection, deckId: number): Promise<number[]> {
  const decks = await getDecksJson(conn);
  const deck = decks[String(deckId)];
  if (!deck) return [deckId];

  const ids: number[] = [deckId];
  const prefix = deck.name + '::';
  for (const [id, d] of Object.entries(decks)) {
    if (d.name.startsWith(prefix)) {
      ids.push(Number(id));
    }
  }
  return ids;
}

/** 获取卡片所在的原牌组 ID (考虑筛选牌组) */
export function originalDeckId(card: CardRow): number {
  return card.odid !== 0 ? card.odid : card.did;
}
