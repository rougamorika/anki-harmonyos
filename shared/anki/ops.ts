/**
 * Anki CRUD 操作 — 卡片/笔记/牌组 原子操作
 *
 * 对应 Rust: rslib/src/card/mod.rs + rslib/src/notes/ + rslib/src/ops.rs
 *
 * 所有操作返回参数化 SQL + 参数，由平台层执行。
 */

import type { DbConnection } from './db/connection.ts';
import { TABLE_CARDS, TABLE_NOTES, TABLE_REVLOG, TABLE_COL } from './db/schema.ts';
import type { CardRow, NoteRow } from './db/types.ts';

// ═══════════════════════════════════════════
// 卡片操作
// ═══════════════════════════════════════════

export interface CardUpdate {
  type: number;
  queue: number;
  due: number;
  ivl: number;
  factor: number;
  reps: number;
  lapses: number;
  left: number;
  odue?: number;
  odid?: number;
  data?: string;
}

/**
 * 更新卡片字段 (复习后写入)
 */
export async function updateCard(
  conn: DbConnection,
  cardId: number,
  update: CardUpdate,
): Promise<void> {
  await conn.executeSql(
    `UPDATE ${TABLE_CARDS}
     SET type = ?, queue = ?, due = ?, ivl = ?, factor = ?,
         reps = ?, lapses = ?, left = ?, mod = ?, usn = ?
     WHERE id = ?`,
    [
      update.type, update.queue, update.due, update.ivl, update.factor,
      update.reps, update.lapses, update.left,
      Math.floor(Date.now() / 1000), -1,
      cardId,
    ],
  );
}

/**
 * 暂停卡片 (queue = -1)
 */
export async function suspendCards(
  conn: DbConnection,
  cardIds: number[],
): Promise<void> {
  await conn.executeSql(
    `UPDATE ${TABLE_CARDS} SET queue = -1, mod = ?, usn = ? WHERE id IN (${cardIds.map(() => '?').join(',')})`,
    [Math.floor(Date.now() / 1000), -1, ...cardIds],
  );
}

/**
 * 取消暂停 (恢复为 New/queue=0)
 */
export async function unsuspendCards(
  conn: DbConnection,
  cardIds: number[],
): Promise<void> {
  await conn.executeSql(
    `UPDATE ${TABLE_CARDS} SET queue = 0, mod = ?, usn = ? WHERE id IN (${cardIds.map(() => '?').join(',')})`,
    [Math.floor(Date.now() / 1000), -1, ...cardIds],
  );
}

/**
 * 埋藏卡片 (暂时隐藏直到次日 — queue = -2)
 */
export async function buryCards(
  conn: DbConnection,
  cardIds: number[],
): Promise<void> {
  await conn.executeSql(
    `UPDATE ${TABLE_CARDS} SET queue = -2, mod = ?, usn = ? WHERE id IN (${cardIds.map(() => '?').join(',')})`,
    [Math.floor(Date.now() / 1000), -1, ...cardIds],
  );
}

/**
 * 取消埋藏 (恢复原队列)
 */
export async function unburyCards(
  conn: DbConnection,
  cardIds: number[],
): Promise<void> {
  await conn.executeSql(
    `UPDATE ${TABLE_CARDS} SET queue = 0, mod = ?, usn = ? WHERE id IN (${cardIds.map(() => '?').join(',')})`,
    [Math.floor(Date.now() / 1000), -1, ...cardIds],
  );
}

/**
 * 移动卡片到指定牌组
 */
export async function setCardDeck(
  conn: DbConnection,
  cardIds: number[],
  deckId: number,
): Promise<void> {
  await conn.executeSql(
    `UPDATE ${TABLE_CARDS} SET did = ?, mod = ?, usn = ? WHERE id IN (${cardIds.map(() => '?').join(',')})`,
    [deckId, Math.floor(Date.now() / 1000), -1, ...cardIds],
  );
}

/**
 * 设置卡片标记 (0-7)
 */
export async function setCardFlag(
  conn: DbConnection,
  cardIds: number[],
  flag: number,
): Promise<void> {
  const maskFlag = flag & 0b111;
  for (const cardId of cardIds) {
    await conn.executeSql(
      `UPDATE ${TABLE_CARDS} SET flags = (flags & ~7) | ?, usn = ? WHERE id = ?`,
      [maskFlag, -1, cardId],
    );
  }
}

/**
 * 重置卡片 (恢复为 New 状态)
 */
export async function resetCard(
  conn: DbConnection,
  cardId: number,
): Promise<void> {
  await conn.executeSql(
    `UPDATE ${TABLE_CARDS}
     SET type = 0, queue = 0, due = 0, ivl = 0, factor = 0,
         reps = 0, lapses = 0, left = 0, data = '',
         mod = ?, usn = ?
     WHERE id = ?`,
    [Math.floor(Date.now() / 1000), -1, cardId],
  );
}

/**
 * 删除卡片 (同时检查并删除孤儿笔记)
 */
export async function removeCards(
  conn: DbConnection,
  cardIds: number[],
): Promise<number> {
  // 先获取关联的笔记 ID
  const placeholders = cardIds.map(() => '?').join(',');
  const rs = await conn.querySql(
    `SELECT DISTINCT nid FROM ${TABLE_CARDS} WHERE id IN (${placeholders})`,
    cardIds,
  );
  const noteIds: number[] = [];
  try {
    while (rs.goToNextRow()) noteIds.push(rs.getLong(0));
  } finally {
    rs.close();
  }

  // 删除卡片
  await conn.executeSql(
    `DELETE FROM ${TABLE_CARDS} WHERE id IN (${placeholders})`,
    cardIds,
  );

  // 检查并删除孤儿笔记
  for (const nid of noteIds) {
    const rs2 = await conn.querySql(
      `SELECT COUNT(*) FROM ${TABLE_CARDS} WHERE nid = ?`,
      [nid],
    );
    let remaining = 0;
    try {
      if (rs2.goToNextRow()) remaining = rs2.getLong(0);
    } finally {
      rs2.close();
    }
    if (remaining === 0) {
      await conn.executeSql(`DELETE FROM ${TABLE_NOTES} WHERE id = ?`, [nid]);
    }
  }

  return cardIds.length;
}

// ═══════════════════════════════════════════
// 笔记操作
// ═══════════════════════════════════════════

export interface NoteCreate {
  guid: string;
  mid: number;
  tags: string;
  flds: string;
  /** 自动计算 csum */
}

/**
 * 添加笔记 (同时生成卡片)
 *
 * @param note 笔记数据
 * @param deckId 目标牌组
 * @param templateOrdinals 要生成的卡片模板序号 (默认 [0])
 * @returns 创建的笔记 ID
 */
export async function addNote(
  conn: DbConnection,
  note: NoteCreate,
  deckId: number,
  templateOrdinals: number[] = [0],
): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const noteId = Date.now(); // Anki 使用时间戳作为 ID
  const csum = simpleChecksum(note.flds);

  await conn.executeSql(
    `INSERT INTO ${TABLE_NOTES} (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [noteId, note.guid, note.mid, now, -1, note.tags, note.flds,
     0, csum, 0, '{}'],
  );

  // 生成卡片
  for (let i = 0; i < templateOrdinals.length; i++) {
    const ord = templateOrdinals[i]!;
    const cardId = Date.now() + i + 1;
    await conn.executeSql(
      `INSERT INTO ${TABLE_CARDS} (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [cardId, noteId, deckId, ord, now, -1, 0, 0, i, 0, 0, 0, 0, 0, 0, 0, 0, '{}'],
    );
  }

  return noteId;
}

/**
 * 更新笔记字段
 */
export async function updateNote(
  conn: DbConnection,
  noteId: number,
  fields: string,
  tags?: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const csum = simpleChecksum(fields);

  if (tags !== undefined) {
    await conn.executeSql(
      `UPDATE ${TABLE_NOTES} SET flds = ?, tags = ?, csum = ?, mod = ?, usn = ? WHERE id = ?`,
      [fields, tags, csum, now, -1, noteId],
    );
  } else {
    await conn.executeSql(
      `UPDATE ${TABLE_NOTES} SET flds = ?, csum = ?, mod = ?, usn = ? WHERE id = ?`,
      [fields, csum, now, -1, noteId],
    );
  }
}

/**
 * 删除笔记及其所有卡片
 */
export async function removeNotes(
  conn: DbConnection,
  noteIds: number[],
): Promise<number> {
  const placeholders = noteIds.map(() => '?').join(',');

  // 先删除关联卡片
  await conn.executeSql(
    `DELETE FROM ${TABLE_CARDS} WHERE nid IN (${placeholders})`,
    noteIds,
  );
  // 再删除笔记
  await conn.executeSql(
    `DELETE FROM ${TABLE_NOTES} WHERE id IN (${placeholders})`,
    noteIds,
  );

  return noteIds.length;
}

// ═══════════════════════════════════════════
// 复习日志操作
// ═══════════════════════════════════════════

export interface RevlogEntry {
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

export async function addRevlog(
  conn: DbConnection,
  entry: RevlogEntry,
): Promise<void> {
  await conn.executeSql(
    `INSERT INTO ${TABLE_REVLOG} (id, cid, usn, ease, ivl, lastIvl, factor, time, type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [entry.id, entry.cid, entry.usn, entry.ease, entry.ivl, entry.lastIvl, entry.factor, entry.time, entry.type],
  );
}

// ═══════════════════════════════════════════
// 集合操作
// ═══════════════════════════════════════════

/**
 * 将整个集合的到期日期重置 (如更改了 rollover 时间后)
 */
export async function resetAllDueDates(
  conn: DbConnection,
): Promise<void> {
  await conn.executeSql(
    `UPDATE ${TABLE_CARDS} SET due = 0 WHERE queue = 2`,
  );
}

/**
 * 获取集合创建时间戳
 */
export async function getCollectionCreationStamp(
  conn: DbConnection,
): Promise<number> {
  const rs = await conn.querySql(`SELECT crt FROM ${TABLE_COL} LIMIT 1`);
  try {
    if (rs.goToNextRow()) return rs.getLong(0);
    return 0;
  } finally {
    rs.close();
  }
}

// ═══════════════════════════════════════════
// 工具
// ═══════════════════════════════════════════

/**
 * 简单校验和 (用于去重)。
 * 对应 Rust 中 notes 表的 csum 字段。
 */
export function simpleChecksum(text: string): number {
  let hash = 0;
  // 去掉 HTML 后的前 100 个字符
  const stripped = text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  const sample = stripped.substring(0, 100);
  for (let i = 0; i < sample.length; i++) {
    const ch = sample.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return hash >>> 0;
}

/**
 * 生成 GUID (用于笔记去重)
 */
export function generateGuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
