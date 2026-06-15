/**
 * Anki 卡片/调度 统一类型定义
 *
 * 对应 Rust:
 *   rslib/src/card/mod.rs    (Card, CardId, CardType, CardQueue)
 *   rslib/src/scheduler/states/mod.rs  (CardState, SchedulingStates, StateContext)
 */

// ─── 标识符 ───

export type CardId = number;
export type NoteId = number;
export type DeckId = number;
export type NotetypeId = number;
export type DeckConfigId = number;

// ─── 卡片基础类型 (对应 Rust Card) ───

export enum CardType {
  New = 0,
  Learn = 1,
  Review = 2,
  Relearn = 3,
}

export enum CardQueue {
  New = 0,
  Learn = 1,
  Review = 2,
  DayLearn = 3,
  PreviewRepeat = 4,
  Suspended = -1,
  SchedBuried = -2,
  UserBuried = -3,
}

/** 卡片数据库行 (对应 cards 表) */
export interface CardRow {
  id: CardId;
  nid: NoteId;
  did: DeckId;
  ord: number;
  type: CardType;
  queue: CardQueue;
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

/** 笔记数据库行 (对应 notes 表) */
export interface NoteRow {
  id: NoteId;
  guid: string;
  mid: NotetypeId;
  tags: string;
  flds: string;
}

/** 模板规格 */
export interface TemplateSpec {
  questionTemplate: string;
  answerTemplate: string;
  css: string;
  fieldNames: string[];
}

// ─── DeckConfig (牌组配置) ───

export interface DeckConfig {
  id?: DeckConfigId;
  name: string;
  newPerDay: number;
  reviewPerDay: number;
  /** 学习步骤 (分钟) */
  learnSteps: number[];
  /** 毕业间隔 (Good) */
  graduatingIntervalGood: number;
  /** 毕业间隔 (Easy) */
  graduatingIntervalEasy: number;
  /** 初始简易度 (ease factor) */
  initialEase: number;
  /** 复习 - Hard 倍率 */
  hardMultiplier: number;
  /** 复习 - Easy 奖励 */
  easyMultiplier: number;
  /** 间隔倍率 */
  intervalMultiplier: number;
  /** 最大复习间隔 (天) */
  maximumReviewInterval: number;
  /** 遗忘后学习步骤 (分钟) */
  relearnSteps: number[];
  /** 遗忘后间隔乘数 */
  lapseMultiplier: number;
  /** 遗忘后最小间隔 (天) */
  minimumLapseInterval: number;
  /** Leech 阈值 */
  leechThreshold: number;
  /** Leech 后是否暂停 */
  leechSuspend: boolean;
}

export const DEFAULT_DECK_CONFIG: DeckConfig = {
  name: 'Default',
  newPerDay: 20,
  reviewPerDay: 200,
  learnSteps: [1, 10],
  graduatingIntervalGood: 1,
  graduatingIntervalEasy: 4,
  initialEase: 2.5,
  hardMultiplier: 1.2,
  easyMultiplier: 1.3,
  intervalMultiplier: 1.0,
  maximumReviewInterval: 36500,
  relearnSteps: [10],
  lapseMultiplier: 0.0,
  minimumLapseInterval: 1,
  leechThreshold: 8,
  leechSuspend: true,
};

// ─── SM-2 常数 ───

export const INITIAL_EASE_FACTOR = 2.5;
export const MINIMUM_EASE_FACTOR = 1.3;
export const EASE_FACTOR_AGAIN_DELTA = -0.20;
export const EASE_FACTOR_HARD_DELTA = -0.15;
export const EASE_FACTOR_EASY_DELTA = +0.15;

// ─── 调度计时 ───

export interface SchedTiming {
  /** 自集合创建以来的天数 */
  daysElapsed: number;
  /** 下次日期切换的时间戳 (秒) */
  nextDayAt: number;
  /** 当前时间戳 (秒) */
  now: number;
}

// ─── 评分 ───

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

export function ratingToNumber(rating: ReviewRating): number {
  switch (rating) {
    case 'again': return 1;
    case 'hard': return 2;
    case 'good': return 3;
    case 'easy': return 4;
  }
}

// ─── 卡片状态 ───

export interface NewState {
  kind: 'new';
  position: number;
}

export interface LearnState {
  kind: 'learn';
  remainingSteps: number;
  scheduledSecs: number;
  elapsedSecs: number;
}

export interface ReviewState {
  kind: 'review';
  scheduledDays: number;
  elapsedDays: number;
  easeFactor: number;
  lapses: number;
  leeched: boolean;
}

export interface RelearnState {
  kind: 'relearn';
  learning: LearnState;
  review: ReviewState;
}

export type NormalState =
  | NewState
  | LearnState
  | ReviewState
  | RelearnState;

export type CardState = NormalState;

/** 调度状态集 (5 个状态对应 4 个按钮 + 当前状态) */
export interface SchedulingStates {
  current: CardState;
  again: CardState;
  hard: CardState;
  good: CardState;
  easy: CardState;
}

// ─── 状态上下文 (SM-2 参数) ───

export interface StateContext {
  fuzzFactor: number | undefined;
  steps: number[];
  graduatingIntervalGood: number;
  graduatingIntervalEasy: number;
  initialEaseFactor: number;
  hardMultiplier: number;
  easyMultiplier: number;
  intervalMultiplier: number;
  maximumReviewInterval: number;
  leechThreshold: number;
  relearnSteps: number[];
  lapseMultiplier: number;
  minimumLapseInterval: number;
}

export function buildStateContext(config: DeckConfig, fuzzFactor?: number): StateContext {
  return {
    fuzzFactor,
    steps: config.learnSteps,
    graduatingIntervalGood: config.graduatingIntervalGood,
    graduatingIntervalEasy: config.graduatingIntervalEasy,
    initialEaseFactor: config.initialEase,
    hardMultiplier: config.hardMultiplier,
    easyMultiplier: config.easyMultiplier,
    intervalMultiplier: config.intervalMultiplier,
    maximumReviewInterval: config.maximumReviewInterval,
    leechThreshold: config.leechThreshold,
    relearnSteps: config.relearnSteps,
    lapseMultiplier: config.lapseMultiplier,
    minimumLapseInterval: config.minimumLapseInterval,
  };
}
