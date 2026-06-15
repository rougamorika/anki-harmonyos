# Anki SM-2/FSRS 调度算法详细拆解与重构方案

> 基于 rslib/src/scheduler/ 源码分析

---

## 一、状态机详解

### 1.1 完整状态图

```
                           ┌──────────┐
                           │   New    │ queue=0, type=0
                           │ due=位置 │ due = 位置序号
                           └────┬─────┘
                                │ 首次呈现，用户必须作答 (不能跳过)
         ┌──────────────────────┼──────────────────────┐
         │ Again                │ Good                 │ Easy
         ▼                      ▼                      ▼
   ┌──────────┐          ┌──────────┐           ┌──────────┐
   │ Learning │          │ Learning │           │  Review  │ (跳过学习)
   │ step重设 │          │ steps-1 │           │ Easy毕业 │
   └────┬─────┘          └────┬─────┘           └──────────┘
        │                     │
   再次Again              steps=0?
        │                     │ Yes         No
        ▼                     ▼             ▼
   重复Learning          ┌──────────┐   继续Learning
                        │  Review  │   (当前step)
                        │ (毕业)   │
                        └────┬─────┘
                             │
            ┌────────────────┼────────────┬──────────┐
            │ Again          │ Hard       │ Good     │ Easy
            ▼                ▼            ▼          ▼
      ┌──────────┐     ┌──────────┐  ┌──────────┐ ┌──────────┐
      │Relearning│     │  Review  │  │  Review  │ │  Review  │
      │重新学习  │     │(新间隔)  │  │(新间隔)  │ │(新间隔)  │
      └────┬─────┘     └──────────┘  └──────────┘ └──────────┘
           │
   ┌───────┼───────┐
   │ Again │ Good  │
   ▼       ▼       │
Relearn  Review    │
(重置)  (完成重学)  │
                   │
   lapses >= leech_threshold?
   → 如果配置了 suspend: queue = -1 (暂停)
```

### 1.2 CardQueue 含义对照表

| queue 值 | 名称 | due 含义 |
|----------|------|---------|
| 0 | New | 牌组新队列中的序号，越小越先出现 |
| 1 | Learn | Unix 时间戳(秒)，到期时显示 |
| 2 | Review | 自 collection 创建日以来的天数 |
| 3 | DayLearn | 自 collection 创建日以来的天数 (跨日学习) |
| -1 | Suspended | N/A |
| -2 | SchedBuried | 被调度自动暂停 |
| -3 | UserBuried | 被用户手动暂停 |

### 1.3 学习步骤 (LearningSteps)

来自 DeckConfig 的 `learn_steps` 和 `relearn_steps`，例如 `[1, 10]` 表示：
- Step 1: 1分钟后再次出现
- Step 2: 10分钟后再次出现

`remaining_steps` 的编码：
- 高位 = 当天剩余步数
- `remaining_steps % 1000` → 真实剩余步数

---

## 二、SM-2 算法伪代码

```
function answer_card(card, rating, now, timing, config):
    """
    card: Card 结构体
    rating: Rating {Again, Hard, Good, Easy}
    timing: SchedTimingToday (当前日期, rollover信息)
    config: DeckConfig (牌组配置)
    """
    
    state = determine_current_state(card, timing)
    next_state = state.next_states(ctx)  # ctx 包含所有配置参数
    
    # 应用状态变化
    card = apply_state(card, next_state, rating, timing)
    return card

function determine_current_state(card, timing):
    if card.type == New:
        return NewState(position = card.due)
    
    if card.type == Learn:
        elapsed = now - card.due   # 已过秒数
        return LearnState(
            remaining_steps = card.left % 1000,
            scheduled_secs = 步骤间隔,
            elapsed_secs = elapsed
        )
    
    if card.type == Review or card.type == Relearn:
        elapsed_days = timing.days_elapsed - card.due
        review = ReviewState(
            scheduled_days = card.ivl,
            elapsed_days = elapsed_days,
            ease_factor = card.factor / 1000,
            lapses = card.lapses
        )
        if card.type == Relearn:
            return RelearnState(review=review, learning=...)
        return review

function compute_intervals_sm2(review_state, ctx):
    """
    计算三个按钮的间隔 (无 FSRS 时)
    """
    current = max(review_state.scheduled_days, 1)
    days_late = max(0, review_state.days_late())
    
    # Hard
    hard_factor = ctx.hard_multiplier  # 默认 1.2
    hard_interval = constrain(
        current * hard_factor * ctx.interval_multiplier,
        min = current + 1,
        max = ctx.maximum_review_interval,
        fuzz = true
    )
    
    # Good
    good_interval = constrain(
        (current + days_late / 2) * review_state.ease_factor * ctx.interval_multiplier,
        min = hard_interval + 1,
        max = ctx.maximum_review_interval,
        fuzz = true
    )
    
    # Easy
    easy_interval = constrain(
        (current + days_late) * review_state.ease_factor * ctx.easy_multiplier * ctx.interval_multiplier,
        min = good_interval + 1,
        max = ctx.maximum_review_interval,
        fuzz = true
    )
    
    return (hard_interval, good_interval, easy_interval)
```

---

## 三、FSRS 算法伪代码

```
function compute_intervals_fsrs(memory_state, desired_retention, days_elapsed, params):
    """
    memory_state: { stability: f32, difficulty: f32 }
    desired_retention: f32 (e.g. 0.9)
    days_elapsed: u32
    params: [f32; 17+]  -- FSRS 参数数组
    """
    
    fsrs = FSRS(params)
    next_states = fsrs.next_states(memory_state, desired_retention, days_elapsed)
    
    return {
        again: next_states.again.interval,
        hard:  next_states.hard.interval,
        good:  next_states.good.interval,
        easy:  next_states.easy.interval
    }

function fsrs_next_states(FSRS, memory_state, retention, days_elapsed):
    """
    核心: 计算 4 个按钮的下一状态
    """
    S = memory_state.stability
    D = memory_state.difficulty
    
    # 当前可提取概率
    R = exp(-days_elapsed / S)
    
    # --- Again ---
    S_again = S * w[14]  # w 为参数数组
    D_again = min(10.0, max(1.0, D + w[4] * (1 - 3) + w[5] * ...))
    
    # --- Hard ---
    S_hard = S * (1 + exp(w[6]) * (11 - D) * pow(S, -w[7]) * (exp((1 - R) * w[8]) - 1) * w[9])
    D_hard = min(10.0, max(1.0, D + w[4] * (2 - 3) + ...))
    
    # --- Good ---
    S_good = S * (1 + exp(w[6]) * (11 - D) * pow(S, -w[7]) * (exp((1 - R) * w[8]) - 1))
    D_good = min(10.0, max(1.0, D + w[4] * (3 - 3) + ...))
    
    # --- Easy ---
    S_easy = S * (1 + exp(w[6]) * (11 - D) * pow(S, -w[7]) * (exp((1 - R) * w[8]) - 1) * w[10])
    D_easy = min(10.0, max(1.0, D + w[4] * (4 - 3) + ...))
    
    return {
        again: { interval: next_interval(S_again, retention), memory: {S_again, D_again} },
        hard:  { interval: next_interval(S_hard, retention),  memory: {S_hard, D_hard} },
        good:  { interval: next_interval(S_good, retention),  memory: {S_good, D_good} },
        easy:  { interval: next_interval(S_easy, retention),  memory: {S_easy, D_easy} }
    }

function next_interval(stability, retention):
    return stability * ln(retention) * decay
```

---

## 四、重构方案：统一 shared/ 与 entry/ 代码

### 4.1 当前问题

```
shared/anki/reviewScheduler.ts  ← "纯逻辑版" (Node 可测试)
entry/.../ReviewScheduler.ets   ← "ArkTS版" (功能重复!)
```

两个文件有 90% 相同的逻辑但类型定义分开。

### 4.2 目标架构

```
shared/anki/
├── types.ts              # 统一类型定义
├── cardState.ts          # 状态机 (纯函数, 无副作用)
├── sm2Scheduler.ts       # SM-2 算法
├── fsrsScheduler.ts      # FSRS 算法
├── templateEngine.ts     # 完整模板引擎
├── ankiSchema.ts         # 字段/JSON 解析
├── dbSchema.ts           # 数据库 schema 常量
└── packageManifest.ts    # .apkg 解析

entry/src/main/ets/
├── services/
│   ├── AnkiDbService.ets   # 数据访问 (import shared types)
│   ├── ImportService.ets   # 导入 (import shared packageManifest)
│   ├── ReviewService.ets   # 复习 (import shared scheduler)
│   └── TemplateService.ets # 渲染 (import shared templateEngine)
├── models/                 # ArkTS 专用类型(如有)
└── pages/                  # UI 页面
```

### 4.3 状态机纯函数设计

为了实现可测试、无副作用的状态机，采用纯函数模式：

```typescript
// shared/anki/cardState.ts

export interface CardData {
  id: number;
  type: CardType;    // 0=New, 1=Learn, 2=Review, 3=Relearn
  queue: CardQueue;  // 0=New, 1=Learn, 2=Review, 3=DayLearn
  due: number;
  ivl: number;
  factor: number;    // ease * 1000
  reps: number;
  lapses: number;
  left: number;      // remaining_steps
  data: string;      // JSON (FSRS memory state)
}

// 纯函数：计算当前状态
export function computeCurrentState(
  card: CardData,
  timing: SchedTiming
): CardState;

// 纯函数：计算下一状态 (输入当前状态+评分 -> 输出新状态)
export function computeNextStates(
  current: CardState,
  config: DeckConfig,
  timing: SchedTiming,
  fsrsParams?: FsrsParams
): SchedulingStates;

// SchedulingStates 包含 5 个 CardState:
// { current, again, hard, good, easy }
```

### 4.4 关键重构点

1. **统一类型**: 删除 `AnkiModels.ets` 的重复定义，统一使用 `shared/anki/types.ts`
2. **抽离纯逻辑**: `buildInitialReviewState` 改为 `computeCurrentState`（从 card 数据推导状态）
3. **新增 DeckConfig 读取**: `AnkiDbService` 需要能读取 `col.dconf` JSON
4. **完整 SM-2 实现**: 基于 `rslib/src/scheduler/states/review.rs` 的公式
5. **Learning Steps**: 支持多步学习流程

### 4.5 数据流重构

```
当前 MVP:
  DB → getNextDueCard() → buildInitialReviewState() → UI
  UI → rating → applyReviewRating() → saveReviewOutcome() → DB
  
目标:
  DB → getDueCard() → computeCurrentState() → computeNextStates() → UI
  UI → rating → pickNextState() → writeCardState() + writeRevlog() → DB
```

变化点：
- `buildInitialReviewState` 被 `computeCurrentState` 取代（状态机推导当前态）
- `applyReviewRating` 被 `computeNextStates` + `pickNextState` 取代（计算所有可能态，选择评分对应的那一个）
- 写回使用标准 cards 表字段（不再用 `hap_review_state` 表）

---

## 五、DeckConfig 读取方案

### 5.1 Deck → DeckConfig 关联链

```
cards.did → decks(id) → decks.conf → dconf(config_id)

查询路径:
1. SELECT decks FROM col → JSON 解析
2. 根据 cards.did 找到 deck entry
3. deck.conf → dconf JSON 中对应的 config
```

### 5.2 DeckConfig 关键参数

| 参数路径 | SM-2 默认值 | 说明 |
|----------|------------|------|
| `new.steps` | `[1, 10]` | 学习步骤(分钟) |
| `new.graduatingInterval` | 1 天 | Good 毕业间隔 |
| `new.easyInterval` | 4 天 | Easy 毕业间隔 |
| `new.initialEase` | 2.5 | 初始简易度 |
| `rev.hardFactor` | 1.2 | Hard 倍率 |
| `rev.easyBonus` | 1.3 | Easy 奖励倍率 |
| `rev.ivlFct` | 1.0 | 间隔倍率 |
| `rev.maxIvl` | 36500 | 最大间隔(天) |
| `lapse.steps` | `[10]` | 遗忘后学习步骤 |
| `lapse.mult` | 0.0 | 遗忘后间隔乘数 |
| `lapse.minInt` | 1 | 遗忘后最小间隔 |
| `lapse.leechFails` | 8 | Leech 阈值 |

---

## 六、实现优先级

### P0: 立即实施
- [ ] 统一 `shared/anki/types.ts`
- [ ] 实现 `computeCurrentState()` 纯函数
- [ ] 读取 DeckConfig 从 `col.dconf`
- [ ] 完整 SM-2 间隔计算
- [ ] LearningSteps 支持
- [ ] 写回标准 cards 表字段

### P1: 短期计划
- [ ] Relearning 状态支持
- [ ] Leech 检测与暂停
- [ ] Bury siblings
- [ ] Fuzz 随机化
- [ ] 模板条件判断 `{{#}}...{{/}}`

### P2: 中期计划
- [ ] FSRS 算法移植
- [ ] 复习历史 (revlog) 完整读写
- [ ] 模板引擎完整化

### P3: 长期计划
- [ ] 编辑/浏览器功能
- [ ] 同步
- [ ] 统计

---

## 七、参考测试用例

从 Rust 测试 (`rslib/src/scheduler/answering/mod.rs:state_application`) 推导的关键测试场景：

```
测试1: New → Learning (Again)
  - 新建卡片，按下 Again
  - 预期: queue=Learn, type=Learn, remaining_steps=2

测试2: Learning → Learning (Good 未毕业)
  - 学习中的卡片，按 Good
  - 预期: queue=Learn, remaining_steps=1

测试3: Learning → Review (Good 毕业)
  - 学习中的卡片，全部steps完成
  - 预期: queue=Review, type=Review, ivl=1, ease=2500

测试4: Review → Review (Easy 增强)
  - Review 卡片按 Easy
  - 预期: queue=Review, ivl=4, ease=2650

测试5: Review → Relearning (Again 遗忘)
  - Review 卡片按 Again
  - 预期: queue=Learn, type=Relearn, ivl=1, ease=2450, lapses=1

测试6: Relearning → Review (Good 重学完成)
  - Relearning 卡片完成所有步骤
  - 预期: queue=Review, type=Review
```

---

*文档生成时间：2026-06-14 | 下一步：实施 unified types + 完整 SM-2*
