# FSRS (Free Spaced Repetition Scheduler) — 鸿蒙移植实现

> 实现: `shared/anki/fsrs.ts` (320行)
> 测试: `harmony/tests/fsrs.test.ts` (25 cases)
> 基于: FSRS-5 规范 (fsrs crate v5.2.0)

---

## 一、核心公式

### 双曲记忆模型

```
R(t, S) = 1 / (1 + factor * t / S)

t = S * (1/R - 1) / factor    ← nextInterval()
```

其中 S=稳定性(天), R=期望保持率, factor=1.0

### 稳定性更新

```
S' = S * (1 +
  exp(w6) *           // ln(稳定性增益系数)
  (11 - D) *          // 难度越高, 增长越慢
  S^(-w7) *           // 已有稳定性越高, 增长越慢
  (exp((1-R)*w8) - 1) *  // 遗忘风险越高, 增长越快
  bonus               // Hard = w9, Good = 1, Easy = w10
)
```

遗忘后: `S' = max(0.01, S * w14)`

### 难度更新

```
D' = clamp(D + (w4/50)*(R - 3) + (w5/10)*(5 - D), 1, 10)

Again (rating=1): D 上升  (+0.3)
Hard  (rating=2): D 微升  (+0.15)
Good  (rating=3): D 不变  (0)
Easy  (rating=4): D 下降  (-0.15)
```

---

## 二、API 速查

```typescript
import {
  nextInterval,           // S + retention → 天数
  nextStates,             // memory → {again,hard,good,easy}
  memoryState,            // reviewHistory → current state
  memoryStateFromSm2,     // ease + interval → inferred state
  DEFAULT_FSRS_PARAMS,    // 17+ 默认参数
} from './shared/anki/fsrs';

// 计算下一状态
const states = nextStates(
  { stability: 10, difficulty: 5 },
  0.9,  // desired retention
  1,    // days elapsed
);

// states.again.interval   → 遗忘后的间隔
// states.hard.interval    → Hard 按钮间隔
// states.good.interval    → Good 按钮间隔
// states.easy.interval    → Easy 按钮间隔

// 从复习历史推断记忆状态
const ms = memoryState({
  reviews: [{ rating: 3, deltaT: 1 }, { rating: 3, deltaT: 5 }]
}, undefined);
```

---

## 三、SM-2 ↔ FSRS 桥接

```typescript
// 已有 SM-2 数据的卡片转为 FSRS 状态
const ms = memoryStateFromSm2(
  card.easeFactor,   // 2.5
  card.interval,     // 30 days
  0.9,               // desired retention
);

// 然后直接用 FSRS 调度
const states = nextStates(ms, 0.9, card.daysElapsed);
```

---

## 四、测试覆盖 (25 用例)

| 类别 | 说明 |
|------|------|
| nextInterval | 3 — 正常/短间隔/边界retention |
| nextStates | 5 — 新卡/有状态/过期/高难度/稳定性更新 |
| memoryState | 3 — 单次/多次/含遗忘 |
| memoryStateFromSm2 | 3 — 默认/高低ease/零间隔 |
| retrievability | 3 — 刚复习/半衰期/零 |
| validateParams | 4 — 有效/短/空/NaN |
| 确定性 | 2 — 相同输入相同输出 |
| 集成 | 2 — SM2桥接/新卡流程 |

---

*实现时间：2026-06-14*
