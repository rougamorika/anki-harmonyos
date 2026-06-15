/**
 * Anki 牌组(DECK)数据库访问层
 *
 * 对应 Rust: rslib/src/decks/ (Deck, DeckTree)
 *
 * 功能:
 * - 从 col.decks JSON 解析牌组树
 * - 查询牌组下的卡片数量 (by queue category)
 * - 构建 DeckSummary 用于首页列表
 */

import type { DbConnection } from './connection.ts';
import { queryScalar } from './connection.ts';
import type {
  DeckJson,
  DecksJson,
  DeckSummary,
  DeckConfigJson,
  DeckConfigsJson,
} from './types.ts';
import { parseJsonSafe } from './types.ts';

// ─── 牌组树操作 ───

/** 牌组名分隔符 */
const DECK_SEP = '::';

interface DeckTreeNode {
  deck: DeckJson;
  children: DeckTreeNode[];
}

/**
 * 解析 decks JSON 并构建树结构。
 * Anki 使用 '::' 分隔的扁平名称表示层级。
 */
export function buildDeckTree(decks: DecksJson): DeckTreeNode[] {
  const roots: DeckTreeNode[] = [];

  // 按名称排序确保父牌组先处理
  const sorted = Object.values(decks).sort((a, b) => a.name.localeCompare(b.name));

  for (const deck of sorted) {
    const parts = deck.name.split(DECK_SEP);
    if (parts.length === 1) {
      roots.push({ deck, children: [] });
      continue;
    }

    // 找到父牌组并插入
    const parentName = parts.slice(0, -1).join(DECK_SEP);
    const parent = findNodeByName(roots, parentName);
    if (parent) {
      parent.children.push({ deck, children: [] });
    } else {
      // 父牌组缺失 — 作为根节点
      roots.push({ deck, children: [] });
    }
  }

  return roots;
}

function findNodeByName(nodes: DeckTreeNode[], name: string): DeckTreeNode | undefined {
  for (const node of nodes) {
    if (node.deck.name === name) return node;
    const found = findNodeByName(node.children, name);
    if (found) return found;
  }
  return undefined;
}

/**
 * 扁平化牌组树为 DeckSummary 列表。
 * 每个牌组包含其完整路径名。
 */
export function flattenDeckTree(
  nodes: DeckTreeNode[],
  ancestorName: string = '',
): DeckSummary[] {
  const result: DeckSummary[] = [];
  for (const node of nodes) {
    const fullName = ancestorName ? `${ancestorName}${DECK_SEP}${node.deck.name}` : node.deck.name;
    result.push({
      id: node.deck.id,
      name: node.deck.name,
      cardCount: 0,
      newCount: 0,
      learnCount: 0,
      reviewCount: 0,
      namePath: fullName,
    });
    result.push(...flattenDeckTree(node.children, fullName));
  }
  return result;
}

// ─── 卡片计数查询 ───

/**
 * 按 queue 类别统计每个牌组的卡片数。
 * 返回 Map<deckId, { new, learn, review, total }>
 */
export async function getDeckCardCounts(
  conn: DbConnection,
): Promise<Map<number, { newCards: number; learnCards: number; reviewCards: number; total: number }>> {
  const counts = new Map<number, { newCards: number; learnCards: number; reviewCards: number; total: number }>();

  // 使用 CASE 聚合一次查询
  const rs = await conn.querySql(`
    SELECT
      did,
      SUM(CASE WHEN queue = 0 THEN 1 ELSE 0 END)                              AS new_count,
      SUM(CASE WHEN queue IN (1, 3) AND type != 3 THEN 1 ELSE 0 END)           AS learn_count,
      SUM(CASE WHEN queue = 2 OR (queue = 3 AND type = 3) THEN 1 ELSE 0 END)   AS review_count,
      COUNT(*)                                                                  AS total
    FROM cards
    WHERE queue >= 0
    GROUP BY did
  `);

  try {
    while (rs.goToNextRow()) {
      const did = rs.getLong(0);
      counts.set(did, {
        newCards: rs.getLong(1),
        learnCards: rs.getLong(2),
        reviewCards: rs.getLong(3),
        total: rs.getLong(4),
      });
    }
  } finally {
    rs.close();
  }

  return counts;
}

/**
 * 构建带计数的 DeckSummary 列表 (直接给首页用)。
 */
export async function getDeckSummaries(conn: DbConnection): Promise<DeckSummary[]> {
  // 1. 读取 decks JSON
  const decksJson = await getDecksJson(conn);
  const tree = buildDeckTree(decksJson);

  // 2. 获取计数
  const counts = await getDeckCardCounts(conn);

  // 3. 扁平化并填充计数
  const flat = flattenDeckTree(tree);
  for (const summary of flat) {
    const c = counts.get(summary.id);
    if (c) {
      summary.cardCount = c.total;
      summary.newCount = c.newCards;
      summary.learnCount = c.learnCards;
      summary.reviewCount = c.reviewCards;
    }
  }

  return flat;
}

// ─── col JSON 读取 ───

export async function getDecksJson(conn: DbConnection): Promise<DecksJson> {
  const rs = await conn.querySql('SELECT decks FROM col LIMIT 1');
  try {
    if (!rs.goToNextRow()) return {};
    return parseJsonSafe<DecksJson>(rs.getString(0), {});
  } finally {
    rs.close();
  }
}

export async function getModelsJson(conn: DbConnection): Promise<Record<string, unknown>> {
  const rs = await conn.querySql('SELECT models FROM col LIMIT 1');
  try {
    if (!rs.goToNextRow()) return {};
    return parseJsonSafe<Record<string, unknown>>(rs.getString(0), {});
  } finally {
    rs.close();
  }
}

export async function getDconfJson(conn: DbConnection): Promise<DeckConfigsJson> {
  const rs = await conn.querySql('SELECT dconf FROM col LIMIT 1');
  try {
    if (!rs.goToNextRow()) return {};
    return parseJsonSafe<DeckConfigsJson>(rs.getString(0), {});
  } finally {
    rs.close();
  }
}

/**
 * 获取单个牌组的 DeckConfig。
 * 先查 `dconf[id]`，找不到返回第一个配置。
 */
export async function getDeckConfig(
  conn: DbConnection,
  configId: number,
): Promise<DeckConfigJson | undefined> {
  const dconf = await getDconfJson(conn);
  const config = dconf[String(configId)];
  if (config) return config;

  // 回退: 返回第一个可用配置
  const keys = Object.keys(dconf);
  if (keys.length > 0) return dconf[keys[0]!];
  return undefined;
}

/**
 * 获取单个牌组 (by id)。
 */
export async function getDeckById(
  conn: DbConnection,
  deckId: number,
): Promise<DeckJson | undefined> {
  const decks = await getDecksJson(conn);
  return decks[String(deckId)];
}

// ─── 牌组下的卡片数 ───

export async function getCardCountInDeck(
  conn: DbConnection,
  deckId: number,
  includeChildren: boolean = false,
): Promise<number> {
  if (!includeChildren) {
    return (await queryScalar(conn, 'SELECT COUNT(*) FROM cards WHERE did = ?', [deckId])) ?? 0;
  }

  // 包含子牌组 — 需要先获取所有子牌组 ID
  const decks = await getDecksJson(conn);
  const deck = decks[String(deckId)];
  if (!deck) return 0;

  const childIds = getChildDeckIds(decks, deck.name);
  childIds.push(deckId);

  const placeholders = childIds.map(() => '?').join(',');
  return (await queryScalar(conn,
    `SELECT COUNT(*) FROM cards WHERE did IN (${placeholders})`,
    childIds,
  )) ?? 0;
}

function getChildDeckIds(decks: DecksJson, parentName: string): number[] {
  const prefix = parentName + DECK_SEP;
  const ids: number[] = [];
  for (const [id, deck] of Object.entries(decks)) {
    if (deck.name.startsWith(prefix)) {
      ids.push(Number(id));
    }
  }
  return ids;
}
