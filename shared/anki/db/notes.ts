/**
 * Anki 笔记(NOTES) 和 复习日志(REVLOG) 数据库查询层
 */

import type { DbConnection } from './connection.ts';
import { querySingle, queryAll } from './connection.ts';
import type { NoteRow, RevlogRow } from './types.ts';

// ─── NOTES ───

export async function getNoteById(
  conn: DbConnection,
  noteId: number,
): Promise<NoteRow | undefined> {
  return querySingle(
    conn,
    `SELECT id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data
     FROM notes WHERE id = ?`,
    [noteId],
    noteFromRow,
  );
}

function noteFromRow(rs: import('./connection.ts').DbResultSet): NoteRow {
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

/** 获取某篇笔记关联的所有卡片 */
export async function getCardsByNoteId(
  conn: DbConnection,
  noteId: number,
): Promise<Array<{ id: number; ord: number; queue: number; due: number }>> {
  return queryAll(
    conn,
    `SELECT id, ord, queue, due FROM cards WHERE nid = ? ORDER BY ord`,
    [noteId],
    (rs) => ({
      id: rs.getLong(0),
      ord: rs.getLong(1),
      queue: rs.getLong(2),
      due: rs.getLong(3),
    }),
  );
}

/** 搜索笔记 (模糊匹配 flds 字段) */
export async function searchNotes(
  conn: DbConnection,
  query: string,
  limit: number = 50,
): Promise<NoteRow[]> {
  return queryAll(
    conn,
    `SELECT id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data
     FROM notes
     WHERE flds LIKE ? COLLATE NOCASE
     LIMIT ?`,
    [`%${query}%`, limit],
    noteFromRow,
  );
}

// ─── REVLOG ───

export async function getRevlogByCardId(
  conn: DbConnection,
  cardId: number,
  limit: number = 200,
): Promise<RevlogRow[]> {
  return queryAll(
    conn,
    `SELECT id, cid, usn, ease, ivl, lastIvl, factor, time, type
     FROM revlog
     WHERE cid = ?
     ORDER BY id DESC
     LIMIT ?`,
    [cardId, limit],
    revlogFromRow,
  );
}

function revlogFromRow(rs: import('./connection.ts').DbResultSet): RevlogRow {
  return {
    id: rs.getLong(0),
    cid: rs.getLong(1),
    usn: rs.getLong(2),
    ease: rs.getLong(3),
    ivl: rs.getLong(4),
    lastIvl: rs.getLong(5),
    factor: rs.getLong(6),
    time: rs.getLong(7),
    type: rs.getLong(8),
  };
}

export interface DailyReviewSummary {
  /** 日期 (Unix 天 — 86400 秒为单位) */
  day: number;
  /** 当天复习卡片总数 */
  count: number;
  /** 平均用时 (ms) */
  avgTime: number;
  /** 评分分布: [again, hard, good, easy] */
  ratings: [number, number, number, number];
}

/**
 * 按天聚合复习日志 — 用于复习曲线图。
 */
export async function getDailyReviewAggregation(
  conn: DbConnection,
  deckId?: number,
  daysBack: number = 30,
): Promise<DailyReviewSummary[]> {
  let sql: string;
  let params: Array<number | null>;

  if (deckId) {
    sql = `
      SELECT
        r.id / 1000 / 86400 AS day,
        COUNT(*)              AS cnt,
        AVG(r.time)           AS avg_time,
        SUM(CASE WHEN r.ease = 1 THEN 1 ELSE 0 END) AS again_cnt,
        SUM(CASE WHEN r.ease = 2 THEN 1 ELSE 0 END) AS hard_cnt,
        SUM(CASE WHEN r.ease = 3 THEN 1 ELSE 0 END) AS good_cnt,
        SUM(CASE WHEN r.ease = 4 THEN 1 ELSE 0 END) AS easy_cnt
      FROM revlog r
      JOIN cards c ON c.id = r.cid
      WHERE c.did = ?
        AND r.id > ?
      GROUP BY day
      ORDER BY day ASC
    `;
    const cutoff = (Math.floor(Date.now() / 1000) - daysBack * 86400) * 1000;
    params = [deckId, cutoff];
  } else {
    sql = `
      SELECT
        r.id / 1000 / 86400 AS day,
        COUNT(*)              AS cnt,
        AVG(r.time)           AS avg_time,
        SUM(CASE WHEN r.ease = 1 THEN 1 ELSE 0 END) AS again_cnt,
        SUM(CASE WHEN r.ease = 2 THEN 1 ELSE 0 END) AS hard_cnt,
        SUM(CASE WHEN r.ease = 3 THEN 1 ELSE 0 END) AS good_cnt,
        SUM(CASE WHEN r.ease = 4 THEN 1 ELSE 0 END) AS easy_cnt
      FROM revlog r
      WHERE r.id > ?
      GROUP BY day
      ORDER BY day ASC
    `;
    const cutoff = (Math.floor(Date.now() / 1000) - daysBack * 86400) * 1000;
    params = [cutoff];
  }

  return queryAll(conn, sql, params, (rs) => ({
    day: rs.getLong(0),
    count: rs.getLong(1),
    avgTime: rs.getDouble(2),
    ratings: [
      rs.getLong(3),
      rs.getLong(4),
      rs.getLong(5),
      rs.getLong(6),
    ] as [number, number, number, number],
  }));
}

/** 获取总复习统计 */
export async function getReviewStats(
  conn: DbConnection,
  deckId?: number,
): Promise<{ totalReviews: number; avgEase: number; totalTime: number }> {
  let sql: string;
  let params: number[] = [];

  if (deckId) {
    sql = `
      SELECT COUNT(*), AVG(r.ease), SUM(r.time)
      FROM revlog r
      JOIN cards c ON c.id = r.cid
      WHERE c.did = ?
    `;
    params = [deckId];
  } else {
    sql = `SELECT COUNT(*), AVG(ease), SUM(time) FROM revlog`;
  }

  return querySingle(conn, sql, params, (rs) => ({
    totalReviews: rs.getLong(0),
    avgEase: rs.getDouble(1),
    totalTime: rs.getLong(2),
  })) ?? { totalReviews: 0, avgEase: 0, totalTime: 0 };
}

/** 写入复习日志 */
export async function insertRevlog(
  conn: DbConnection,
  entry: {
    id: number;
    cid: number;
    usn: number;
    ease: number;
    ivl: number;
    lastIvl: number;
    factor: number;
    time: number;
    type: number;
  },
): Promise<void> {
  await conn.executeSql(
    `INSERT INTO revlog (id, cid, usn, ease, ivl, lastIvl, factor, time, type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [entry.id, entry.cid, entry.usn, entry.ease, entry.ivl, entry.lastIvl, entry.factor, entry.time, entry.type],
  );
}
