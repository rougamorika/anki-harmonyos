/**
 * 牌组配置管理 & 筛选牌组 & 集合操作
 *
 * 对应 Rust:
 *   Phase 5: rslib/src/deckconfig/
 *   Phase 6: rslib/src/scheduler/filtered/
 *   Phase 7: rslib/src/collection/
 */

import type { DbConnection } from './db/connection.ts';
import { TABLE_CARDS, TABLE_COL } from './db/schema.ts';
import type { DeckConfigJson, DeckJson } from './db/types.ts';
import { getDecksJson, getDconfJson } from './db/decks.ts';
import { parseQuery, buildSearchSql } from './search.ts';

// ═══════════════════════════════════════════
// Phase 5: 牌组配置管理
// ═══════════════════════════════════════════

/** 默认牌组配置 (对应 Anki 初始 dconf) */
export const DEFAULT_DECK_CONFIG: DeckConfigJson = {
  id: 1,
  name: 'Default',
  mtime_secs: 0,
  usn: 0,
  maxTaken: 60,
  autoplay: true,
  timer: 0,
  replayq: true,
  newMix: 0,
  newPerDay: 20,
  newPerDayMinimum: 0,
  newBury: false,
  newSteps: [1, 10],
  newGraduatingInterval: 1,
  newEasyInterval: 4,
  newInsertionOrder: 0,
  revMix: 0,
  revPerDay: 200,
  revHardFactor: 1.2,
  revEasyBonus: 1.3,
  revIvlFct: 1.0,
  revMaxIvl: 36500,
  revBury: false,
  lapseSteps: [10],
  lapseMult: 0.0,
  lapseMinInt: 1,
  lapseLeechFails: 8,
  lapseLeechAction: 0,
};

/**
 * 创建新的牌组配置
 */
export async function createDeckConfig(
  conn: DbConnection,
  config: DeckConfigJson,
): Promise<number> {
  const dconf = await getDconfJson(conn);
  // 生成新 ID
  const ids = Object.keys(dconf).map(Number);
  const newId = ids.length > 0 ? Math.max(...ids) + 1 : 1;
  config.id = newId;
  dconf[String(newId)] = config;
  await saveDconfJson(conn, dconf);
  return newId;
}

/**
 * 更新牌组配置
 */
export async function updateDeckConfig(
  conn: DbConnection,
  configId: number,
  updates: Partial<DeckConfigJson>,
): Promise<void> {
  const dconf = await getDconfJson(conn);
  const existing = dconf[String(configId)];
  if (!existing) return;
  Object.assign(existing, updates, { mtime_secs: Math.floor(Date.now()) });
  dconf[String(configId)] = existing;
  await saveDconfJson(conn, dconf);
}

/**
 * 删除牌组配置
 */
export async function deleteDeckConfig(
  conn: DbConnection,
  configId: number,
): Promise<void> {
  const dconf = await getDconfJson(conn);
  delete dconf[String(configId)];
  await saveDconfJson(conn, dconf);
}

async function saveDconfJson(
  conn: DbConnection,
  dconf: Record<string, DeckConfigJson>,
): Promise<void> {
  await conn.executeSql(
    `UPDATE ${TABLE_COL} SET dconf = ?, mod = ?`,
    [JSON.stringify(dconf), Math.floor(Date.now())],
  );
}

// ═══════════════════════════════════════════
// Phase 5b: 牌组管理
// ═══════════════════════════════════════════

/**
 * 创建新牌组
 */
export async function createDeck(
  conn: DbConnection,
  name: string,
  configId?: number,
): Promise<number> {
  const decks = await getDecksJson(conn);
  const ids = Object.keys(decks).map(Number);
  const newId = ids.length > 0 ? Math.max(...ids) + 1 : 1;

  // 确定 config ID
  let confId = configId;
  if (confId === undefined) {
    const dconf = await getDconfJson(conn);
    const confIds = Object.keys(dconf).map(Number);
    confId = confIds.length > 0 ? Math.min(...confIds) : 1;
  }

  decks[String(newId)] = {
    id: newId,
    name,
    desc: '',
    extendRev: 0,
    extendNew: 0,
    collapse: false,
    browserCollapse: false,
    conf: confId,
    dyn: 0,
  };

  await conn.executeSql(
    `UPDATE ${TABLE_COL} SET decks = ?, mod = ?`,
    [JSON.stringify(decks), Math.floor(Date.now())],
  );

  return newId;
}

/**
 * 重命名牌组
 */
export async function renameDeck(
  conn: DbConnection,
  deckId: number,
  newName: string,
): Promise<void> {
  const decks = await getDecksJson(conn);
  const deck = decks[String(deckId)];
  if (!deck) return;

  const oldName = deck.name;

  // 更新当前牌组
  deck.name = newName;
  decks[String(deckId)] = deck;

  // 更新子牌组 (前缀重命名)
  const oldPrefix = oldName + '::';
  const newPrefix = newName + '::';
  for (const d of Object.values(decks)) {
    if (d.id !== deckId && d.name.startsWith(oldPrefix)) {
      d.name = newPrefix + d.name.substring(oldPrefix.length);
    }
  }

  await conn.executeSql(
    `UPDATE ${TABLE_COL} SET decks = ?, mod = ?`,
    [JSON.stringify(decks), Math.floor(Date.now())],
  );
}

/**
 * 删除牌组 (及其子牌组)
 */
export async function deleteDeck(
  conn: DbConnection,
  deckId: number,
): Promise<number> {
  const decks = await getDecksJson(conn);
  const deck = decks[String(deckId)];
  if (!deck) return 0;

  // 收集所有要删除的牌组 ID
  const idsToDelete = new Set<number>();
  idsToDelete.add(deckId);
  const prefix = deck.name + '::';
  for (const d of Object.values(decks)) {
    if (d.name.startsWith(prefix)) {
      idsToDelete.add(d.id);
    }
  }

  // 从 decks JSON 中删除
  for (const id of idsToDelete) {
    delete decks[String(id)];
  }

  await conn.executeSql(
    `UPDATE ${TABLE_COL} SET decks = ?, mod = ?`,
    [JSON.stringify(decks), Math.floor(Date.now())],
  );

  return idsToDelete.size;
}

// ═══════════════════════════════════════════
// Phase 6: 筛选牌组
// ═══════════════════════════════════════════

/**
 * 构建筛选牌组 (从搜索条件)
 *
 * 对应 Rust: rslib/src/scheduler/filtered/
 *
 * @param conn 数据库连接
 * @param searchQuery Anki 搜索字符串
 * @param targetDeckId 目标筛选牌组 ID
 * @param reschedule 是否重新调度卡片
 * @returns 添加的卡片数
 */
export async function rebuildFilteredDeck(
  conn: DbConnection,
  searchQuery: string,
  targetDeckId: number,
  reschedule: boolean = true,
): Promise<number> {
  // 1. 清空筛选牌组中已有的卡片
  await conn.executeSql(
    `DELETE FROM ${TABLE_CARDS} WHERE did = ?`,
    [targetDeckId],
  );

  // 2. 解析搜索
  const nodes = parseQuery(searchQuery);
  const result = buildSearchSql(nodes, 0);

  // 3. 查询匹配的卡片
  const sql = `SELECT c.id, c.nid, c.did, c.ord, c.type, c.queue, c.due, c.ivl, c.factor, c.reps, c.lapses, c.left, c.odue, c.odid, c.flags, c.data, c.mod, c.usn
    FROM ${TABLE_CARDS} c
    JOIN notes n ON n.id = c.nid
    WHERE ${result.whereClause} AND c.queue >= 0
    ORDER BY c.due ASC`;

  const rs = await conn.querySql(sql, result.params);
  const cards: Array<{
    id: number; nid: number; did: number; ord: number;
    type: number; queue: number; due: number; ivl: number;
    factor: number; reps: number; lapses: number; left: number;
    odue: number; odid: number; flags: number; data: string;
    mod: number; usn: number;
  }> = [];

  try {
    while (rs.goToNextRow()) {
      cards.push({
        id: rs.getLong(0), nid: rs.getLong(1), did: rs.getLong(2),
        ord: rs.getLong(3), type: rs.getLong(4), queue: rs.getLong(5),
        due: rs.getLong(6), ivl: rs.getLong(7), factor: rs.getLong(8),
        reps: rs.getLong(9), lapses: rs.getLong(10), left: rs.getLong(11),
        odue: rs.getLong(12), odid: rs.getLong(13), flags: rs.getLong(14),
        data: rs.getString(15), mod: rs.getLong(16), usn: rs.getLong(17),
      });
    }
  } finally {
    rs.close();
  }

  // 4. 将卡片复制到筛选牌组
  const now = Math.floor(Date.now() / 1000);
  for (const card of cards) {
    const newCardId = Date.now() + Math.random();
    await conn.executeSql(
      `INSERT INTO ${TABLE_CARDS} (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newCardId, card.nid, targetDeckId, card.ord, now, -1,
       card.type, card.queue, card.due, card.ivl, card.factor,
       card.reps, card.lapses, card.left,
       card.did,  // odue (原 due)
       card.did,  // odid (原 deck)
       card.flags, '{}'],
    );
  }

  return cards.length;
}

/**
 * 清空筛选牌组 (将所有卡片移回原牌组或删除)
 */
export async function emptyFilteredDeck(
  conn: DbConnection,
  deckId: number,
  returnToOriginal: boolean = false,
): Promise<void> {
  if (returnToOriginal) {
    // 将卡片移回原牌组
    await conn.executeSql(
      `UPDATE ${TABLE_CARDS} SET did = odid, odid = 0, odue = 0, mod = ?, usn = ? WHERE did = ? AND odid != 0`,
      [Math.floor(Date.now()), -1, deckId],
    );
  }
  // 删除剩余卡片
  await conn.executeSql(
    `DELETE FROM ${TABLE_CARDS} WHERE did = ?`,
    [deckId],
  );
}

// ═══════════════════════════════════════════
// Phase 7: 集合操作
// ═══════════════════════════════════════════

/**
 * 检查数据库完整性
 */
export async function checkDatabaseIntegrity(
  conn: DbConnection,
): Promise<boolean> {
  try {
    const rs = await conn.querySql('PRAGMA integrity_check');
    try {
      if (rs.goToNextRow()) {
        return rs.getString(0) === 'ok';
      }
    } finally {
      rs.close();
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * 获取集合信息
 */
export async function getCollectionInfo(
  conn: DbConnection,
): Promise<{ crt: number; mod: number; scm: number; ver: number; cardCount: number; noteCount: number }> {
  const rs = await conn.querySql(
    `SELECT crt, mod, scm, ver, (SELECT COUNT(*) FROM ${TABLE_CARDS}), (SELECT COUNT(*) FROM notes) FROM ${TABLE_COL} LIMIT 1`,
  );
  try {
    if (!rs.goToNextRow()) return { crt: 0, mod: 0, scm: 0, ver: 0, cardCount: 0, noteCount: 0 };
    return {
      crt: rs.getLong(0),
      mod: rs.getLong(1),
      scm: rs.getLong(2),
      ver: rs.getLong(3),
      cardCount: rs.getLong(4),
      noteCount: rs.getLong(5),
    };
  } finally {
    rs.close();
  }
}

/**
 * 优化数据库 (VACUUM + ANALYZE)
 */
export async function optimizeCollection(
  conn: DbConnection,
): Promise<void> {
  await conn.executeSql('PRAGMA optimize');
}

/** 当前 schema 版本 */
export const SCHEMA_VERSION = 11;
