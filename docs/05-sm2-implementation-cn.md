# Anki SM-2 调度器 — 鸿蒙移植实现文档

> 实现: `harmony/shared/anki/sm2.ts` | 测试: `harmony/tests/sm2.test.ts`
> 对应 Rust: `rslib/src/scheduler/states/review.rs` + `learning.rs` + `relearning.rs`

---

## 一、已实现功能

| 功能 | 状态 | 说明 |
|------|------|------|
| 4 态状态机 (New/Learn/Review/Relearn) | ✅ | `computeCurrentState()` |
| 4 按钮下一状态计算 | ✅ | `computeNextStates()` |
| SM-2 间隔公式 | ✅ | Hard/Good/Easy 间隔 + Again 遗忘处理 |
| 学习步骤 (LearningSteps) | ✅ | 多步 `[1, 10]` 推进 |
| 重新学习步骤 (RelearnSteps) | ✅ | 遗忘后 `[10]` 推进 |
| Leech 检测 | ✅ | `isLeeched()` + leechSuspend 自动暂停 |
| 确定性 Fuzz | ✅ | `fuzzSeed()` + `fuzzFactor()` (Mulberry32) |
| DeckConfig 读取 | ✅ | `buildStateContext()` 从配置构建参数 |
| 跨天学习 (DayLearn) | ✅ | `stepSecs >= 86400` → `DayLearn` queue |
| 简易度 (ease factor) 边界 | ✅ | min 1.3, 4 按钮各有 delta |

## 二、API 速查

```typescript
// 状态推导
const state = computeCurrentState(cardRow, timing);

// 计算 4 按钮
const ctx = buildStateContext(deckConfig);
const states = computeNextStates(state, ctx);

// 应用评分
const { update, leeched } = applyRating(cardRow, states, 'good', timing, deckConfig);
// update: CardUpdate — 直接写回卡片字段
// leeched: boolean — 是否需要暂停

// Leech 检测
isLeeched(lapses, threshold); // → boolean

// Fuzz
const seed = fuzzSeed(cardId, reps);
const factor = fuzzFactor(seed); // 0.0..1.0 or undefined
```

## 三、关键常数

| 常数 | 值 | Rust 对应 |
|------|---|----------|
| `INITIAL_EASE_FACTOR` | 2.5 | `review::INITIAL_EASE_FACTOR` |
| `MINIMUM_EASE_FACTOR` | 1.3 | `review::MINIMUM_EASE_FACTOR` |
| `EASE_FACTOR_AGAIN_DELTA` | -0.20 | `review::EASE_FACTOR_AGAIN_DELTA` |
| `EASE_FACTOR_HARD_DELTA` | -0.15 | `review::EASE_FACTOR_HARD_DELTA` |
| `EASE_FACTOR_EASY_DELTA` | +0.15 | `review::EASE_FACTOR_EASY_DELTA` |

## 四、与 Rust 实现的差异

| 项目 | Rust | 本实现 | 影响 |
|------|------|--------|------|
| 部分学习/重新学习进度追踪 | `remaining_steps % 1000` 高位编码 | 直接使用 `left % 1000` | 无 |
| FSRS | 完整支持 | 未实现 | 高—需后续补充 |
| 负载均衡 (LoadBalancer) | 支持 | 未实现 | 中 |
| Bury siblings | 支持 | 未实现 | 低 |
| 筛选牌组 (Filtered decks) | 完整支持 | 未实现 | 中 |
| 时区感知 (Rollover) | 完整支持 | 简化 (`daysElapsed` 手动传入) | 中 |
| 复习进度持久化 | 写标准 cards + revlog 表 | 仅返回 CardUpdate (调用方自行写入) | 无 |

## 五、测试覆盖

| 测试场景 | 说明 |
|----------|------|
| `computeCurrentState` × 5 | New / Learn / Review(按时) / Review(迟到) / Relearn |
| New→Again→Learning | 进入 L 态, steps=2 |
| Learning→Good→Review | 最后一步毕业 |
| Review→Good/Hard/Easy | SM-2 间隔验证 |
| Review→Again→Relearning | 遗忘 + lapses+1 |
| Relearning→Good→Review | 重学完成回 Review |
| Leech 检测 × 3 | 阈值 8/0/5 |
| Fuzz × 2 | 确定性种子 + 因子范围 |
| applyRating × 3 | 端到端 + leech 暂停 |
| 完整流转 × 1 | New→L→Review→Relearn→Review |

---

*实现时间：2026-06-14 | 下一步：FSRS 移植 或 模板引擎重构*
