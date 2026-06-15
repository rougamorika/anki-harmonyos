/**
 * Anki 统计计算 — 复习曲线 / 遗忘曲线 / 进度 / 预测
 *
 * 对应 Rust: rslib/src/stats/
 *
 * 所有函数均为纯计算，接受查询结果作为输入。
 */

// ─── 类型 ───

export interface DailyPoint {
  day: number;
  value: number;
}

export interface RatingDistribution {
  again: number;
  hard: number;
  good: number;
  easy: number;
}

export interface ReviewStats {
  totalCards: number;
  newCards: number;
  learningCards: number;
  reviewCards: number;
  suspendedCards: number;
  totalReviews: number;
  /** 平均简易度 (0-4) */
  avgEase: number;
  /** 总用时 (ms) */
  totalTime: number;
  /** 平均间隔 (天) */
  avgInterval: number;
  /** 评分分布 (%) */
  ratingDistribution: RatingDistribution;
}

export interface ForecastPoint {
  day: number;
  dueCount: number;
}

// ─── 卡片状态统计 ───

export function computeCardStats(allCards: Array<{ queue: number }>): {
  newCards: number;
  learningCards: number;
  reviewCards: number;
  suspendedCards: number;
} {
  let newCards = 0;
  let learningCards = 0;
  let reviewCards = 0;
  let suspendedCards = 0;

  for (const card of allCards) {
    switch (card.queue) {
      case 0: newCards++; break;
      case 1: case 3: learningCards++; break;
      case 2: reviewCards++; break;
      case -1: suspendedCards++; break;
    }
  }

  return { newCards, learningCards, reviewCards, suspendedCards };
}

// ─── 评分分布 ───

export function computeRatingDistribution(
  revlogEntries: Array<{ ease: number }>,
): RatingDistribution {
  let again = 0, hard = 0, good = 0, easy = 0;

  for (const entry of revlogEntries) {
    switch (entry.ease) {
      case 1: again++; break;
      case 2: hard++; break;
      case 3: good++; break;
      case 4: easy++; break;
    }
  }

  return { again, hard, good, easy };
}

export function ratingPercentages(dist: RatingDistribution): RatingDistribution {
  const total = dist.again + dist.hard + dist.good + dist.easy;
  if (total === 0) return { again: 0, hard: 0, good: 0, easy: 0 };
  return {
    again: Math.round((dist.again / total) * 100),
    hard: Math.round((dist.hard / total) * 100),
    good: Math.round((dist.good / total) * 100),
    easy: Math.round((dist.easy / total) * 100),
  };
}

// ─── 每日复习量 (复习曲线) ───

export interface DailyReviewPoint {
  /** Unix 天 (86400秒) */
  day: number;
  /** 复习数 */
  count: number;
  /** 平均用时 (ms) */
  avgTime: number;
  /** 累计复习数 */
  cumulative: number;
}

/**
 * 按天聚合复习日志为曲线数据。
 * 填充空白天数使曲线连续。
 */
export function buildReviewCurve(
  dailyAgg: Array<{ day: number; count: number; avgTime: number }>,
  daysBack: number = 30,
): DailyReviewPoint[] {
  const now = Math.floor(Date.now() / 1000 / 86400);
  const startDay = now - daysBack + 1;

  // 构建映射
  const dayMap = new Map<number, { count: number; avgTime: number }>();
  for (const row of dailyAgg) {
    dayMap.set(row.day, { count: row.count, avgTime: row.avgTime });
  }

  const points: DailyReviewPoint[] = [];
  let cumulative = 0;

  for (let d = startDay; d <= now; d++) {
    const data = dayMap.get(d) ?? { count: 0, avgTime: 0 };
    cumulative += data.count;
    points.push({
      day: d,
      count: data.count,
      avgTime: data.avgTime,
      cumulative,
    });
  }

  return points;
}

// ─── 遗忘曲线 (回顾率) ───

export interface RetentionPoint {
  /** 间隔天数 */
  interval: number;
  /** 回顾率 (0-1) */
  retention: number;
  /** 该间隔的复习总数 */
  count: number;
}

/**
 * 从复习日志计算回顾率曲线。
 *
 * 分组方法: 按 lastIvl 分桶，统计 ease >= 3 (Good/Easy) 的比例。
 */
export function buildRetentionCurve(
  revlogEntries: Array<{ ease: number; lastIvl: number }>,
): RetentionPoint[] {
  // 按 lastIvl 分桶
  const buckets = new Map<number, { passed: number; total: number }>();

  for (const entry of revlogEntries) {
    if (entry.lastIvl <= 0) continue;
    const bucket = getIntervalBucket(entry.lastIvl);
    let b = buckets.get(bucket);
    if (!b) {
      b = { passed: 0, total: 0 };
      buckets.set(bucket, b);
    }
    b.total++;
    if (entry.ease >= 3) b.passed++;
  }

  // 转换为曲线点
  const points: RetentionPoint[] = [];
  for (const [interval, { passed, total }] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    points.push({
      interval,
      retention: total > 0 ? passed / total : 0,
      count: total,
    });
  }

  return points;
}

function getIntervalBucket(intervalDays: number): number {
  // 分桶策略:
  if (intervalDays <= 1) return 1;
  if (intervalDays <= 3) return 3;
  if (intervalDays <= 7) return 7;
  if (intervalDays <= 14) return 14;
  if (intervalDays <= 30) return 30;
  if (intervalDays <= 90) return 90;
  if (intervalDays <= 180) return 180;
  if (intervalDays <= 365) return 365;
  return Math.ceil(intervalDays / 365) * 365;
}

// ─── 到期预测 ───

/**
 * 预测未来 N 天每天的到期卡片数。
 * 基于每张卡片的当前间隔。
 */
export function forecastDueCards(
  reviewCards: Array<{ due: number; ivl: number }>,
  daysAhead: number = 30,
): ForecastPoint[] {
  const today = Math.floor(Date.now() / 1000 / 86400);
  const forecast = new Map<number, number>();

  for (let i = 1; i <= daysAhead; i++) {
    forecast.set(today + i, 0);
  }

  for (const card of reviewCards) {
    // 预测下一次复习的日期
    const nextDue = card.due + card.ivl;
    const day = nextDue - today;
    if (day > 0 && day <= daysAhead) {
      const key = today + day;
      forecast.set(key, (forecast.get(key) ?? 0) + 1);
    }
  }

  const points: ForecastPoint[] = [];
  for (const [day, count] of [...forecast.entries()].sort((a, b) => a[0] - b[0])) {
    points.push({ day, dueCount: count });
  }

  return points;
}

// ─── 学习进度 (今日) ───

export interface TodayProgress {
  /** 新卡已学 / 目标 */
  newDone: number;
  newTarget: number;
  /** 复习已完成 / 目标 */
  reviewDone: number;
  reviewTarget: number;
  /** 学习已完成 / 目标 */
  learnDone: number;
  learnTarget: number;
  /** 总用时 (ms) */
  timeSpent: number;
}

export function computeTodayProgress(
  todayRevlogEntries: Array<{ ease: number; time: number }>,
  cardCounts: { newCards: number; learnCards: number; reviewCards: number },
  deckConfig: { newPerDay: number; reviewPerDay: number },
): TodayProgress {
  const done = computeRatingDistribution(todayRevlogEntries);
  const totalDone = done.again + done.hard + done.good + done.easy;

  let timeSpent = 0;
  for (const e of todayRevlogEntries) {
    timeSpent += e.time;
  }

  return {
    newDone: Math.min(totalDone, cardCounts.newCards),
    newTarget: deckConfig.newPerDay,
    reviewDone: totalDone, // 简化
    reviewTarget: deckConfig.reviewPerDay,
    learnDone: cardCounts.learnCards,
    learnTarget: 0,
    timeSpent,
  };
}
