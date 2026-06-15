/**
 * Anki 数据库抽象接口
 *
 * shared 层通过此接口访问 SQLite，不依赖具体 RDB 实现。
 * entry 层用 HarmonyOS @kit.ArkData.relationalStore 实现。
 */

export interface DbRow {
  getLong(columnIndex: number): number;
  getString(columnIndex: number): string;
  getDouble(columnIndex: number): number;
  getBlob(columnIndex: number): Uint8Array;
  isNull(columnIndex: number): boolean;
}

export interface DbResultSet {
  goToNextRow(): boolean;
  getColumnIndex(name: string): number;
  getLong(columnIndex: number): number;
  getString(columnIndex: number): string;
  getDouble(columnIndex: number): number;
  getBlob(columnIndex: number): Uint8Array;
  isNull(columnIndex: number): boolean;
  close(): void;
}

export interface DbConnection {
  /** 执行查询并返回结果集 */
  querySql(sql: string, bindArgs?: Array<string | number | null>): Promise<DbResultSet>;

  /** 执行写操作 (INSERT/UPDATE/DELETE) */
  executeSql(sql: string, bindArgs?: Array<string | number | null>): Promise<void>;

  /** 执行原始 SQL (批量) */
  executeBatch(sql: string): Promise<void>;
}

/** 查询单行工具 — 从结果集读取第一行到目标对象 */
export async function querySingle<T>(
  conn: DbConnection,
  sql: string,
  bind: Array<string | number | null>,
  map: (rs: DbResultSet) => T,
): Promise<T | undefined> {
  const rs = await conn.querySql(sql, bind);
  try {
    if (!rs.goToNextRow()) return undefined;
    return map(rs);
  } finally {
    rs.close();
  }
}

/** 查询多行 */
export async function queryAll<T>(
  conn: DbConnection,
  sql: string,
  bind: Array<string | number | null>,
  map: (rs: DbResultSet) => T,
): Promise<T[]> {
  const rs = await conn.querySql(sql, bind);
  const rows: T[] = [];
  try {
    while (rs.goToNextRow()) {
      rows.push(map(rs));
    }
  } finally {
    rs.close();
  }
  return rows;
}

/** 查询标量值 (第一行第一列) */
export async function queryScalar(
  conn: DbConnection,
  sql: string,
  bind: Array<string | number | null> = [],
): Promise<number | undefined> {
  const rs = await conn.querySql(sql, bind);
  try {
    if (!rs.goToNextRow()) return undefined;
    return rs.getLong(0);
  } finally {
    rs.close();
  }
}
