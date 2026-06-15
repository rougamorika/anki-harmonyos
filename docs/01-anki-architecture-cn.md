# Anki 整体架构与移植分析

> 版本：Anki 25.09.2 | 移植目标：HarmonyOS 6.1 (ArkTS)

---

## 一、Anki 架构分层

```
┌─────────────────────────────────────────────────┐
│              前端 (Svelte/TypeScript)              │
│               ts/  — Web UI 组件                   │
├─────────────────────────────────────────────────┤
│            Python Qt 壳 (PyQt / aqt/)              │
│        pylib/ — Python 库, rsbridge (Rust桥)      │
├─────────────────────────────────────────────────┤
│           ProtoBuf IPC (proto/)                     │
│     定义跨语言通信的 RPC 接口 (.proto 文件)          │
├─────────────────────────────────────────────────┤
│              Rust 核心库 (rslib/)                   │
│  调度 · 存储 · 模板 · 导入导出 · 同步 · 搜索        │
├─────────────────────────────────────────────────┤
│              SQLite 数据库                          │
│   collection.anki2 / collection.anki21            │
└─────────────────────────────────────────────────┘
```

核心组件说明：

| 层 | 路径 | 语言 | 职责 |
|----|------|------|------|
| Web UI | `ts/` | TypeScript/Svelte | 卡片渲染、用户交互 |
| Python 壳 | `pylib/`, `qt/` | Python + Rust | GUI 宿主、平台集成 |
| Rust 核心 | `rslib/` | Rust | 所有业务逻辑 |
| 协议层 | `proto/` | Protobuf | 层间 RPC 通信 |

**移植关键**：鸿蒙端不需要 Python/Qt 层。我们直接使用 Rust 核心（或者用 TypeScript 复刻核心逻辑），通过 ArkWeb + ArkData 实现 UI 和存储。

---

## 二、核心数据结构

### 2.1 Collection 数据库 (collection.anki2)

Anki 使用 SQLite 格式存储所有数据。核心表结构：

```sql
-- col 表：全局配置
CREATE TABLE col (
  id      INTEGER PRIMARY KEY,
  crt     INTEGER NOT NULL,  -- 创建时间戳
  mod     INTEGER NOT NULL,  -- 修改时间戳
  scm     INTEGER NOT NULL,  -- schema 版本
  conf    TEXT NOT NULL,     -- JSON: 全局配置
  models  TEXT NOT NULL,     -- JSON: 所有笔记类型(notetype)定义
  decks   TEXT NOT NULL,     -- JSON: 所有牌组(decks)定义
  dconf   TEXT NOT NULL,     -- JSON: 所有牌组配置(deckconfig)
  tags    TEXT NOT NULL      -- JSON: 标签
);

-- notes 表：笔记(原始数据)
CREATE TABLE notes (
  id    INTEGER PRIMARY KEY,
  mid   INTEGER NOT NULL,  -- 笔记类型 ID (model)
  tags  TEXT NOT NULL,
  flds  TEXT NOT NULL,     -- 所有字段值，用 \x1f 分隔
  sfld  INTEGER NOT NULL,  -- 排序字段
  csum  INTEGER NOT NULL   -- 校验和(去重用)
);

-- cards 表：卡片(每个卡片对应一个复习事件)
CREATE TABLE cards (
  id     INTEGER PRIMARY KEY,
  nid    INTEGER NOT NULL,  -- 关联笔记 ID
  did    INTEGER NOT NULL,  -- 牌组 ID
  ord    INTEGER NOT NULL,  -- 卡片模板序号(0=正面/1=背面...)
  type   INTEGER NOT NULL,  -- 卡片类型: 0=New, 1=Learn, 2=Review, 3=Relearn
  queue  INTEGER NOT NULL,  -- 队列: 0=New, 1=Learn, 2=Review, 3=DayLearn, -1=暂停
  due    INTEGER NOT NULL,  -- 到期时间(队列不同含义不同)
  ivl    INTEGER NOT NULL,  -- 当前间隔(天)
  factor INTEGER NOT NULL,  -- 简易度因子(ease factor * 1000)
  reps   INTEGER NOT NULL,  -- 复习次数
  lapses INTEGER NOT NULL,  -- 遗忘次数
  left   INTEGER NOT NULL,  -- 剩余步数(学习/重学中)
  data   TEXT NOT NULL      -- JSON: 扩展数据(FSRS 记忆状态等)
);

-- revlog 表：复习记录
CREATE TABLE revlog (
  id      INTEGER PRIMARY KEY,
  cid     INTEGER NOT NULL,  -- 卡片 ID
  ease    INTEGER NOT NULL,  -- 评分: 1=Again, 2=Hard, 3=Good, 4=Easy
  ivl     INTEGER NOT NULL,  -- 下次间隔
  lastIvl INTEGER NOT NULL,  -- 上次间隔
  factor  INTEGER NOT NULL,  -- 简易度
  time    INTEGER NOT NULL,  -- 答题用时(ms)
  type    INTEGER NOT NULL   -- 复习类型
);
```

### 2.2 关键 JSON 结构

**models (笔记类型)**：
```json
{
  "model_id": {
    "name": "Basic",
    "flds": [{"name": "Front", "ord": 0}, {"name": "Back", "ord": 1}],
    "tmpls": [{
      "name": "Card 1",
      "qfmt": "{{Front}}",
      "afmt": "{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}"
    }],
    "css": ".card { font-family: arial; font-size: 20px; }"
  }
}
```

**decks (牌组)**：
```json
{
  "deck_id": {
    "name": "Default",
    "extendRev": 0, "extendNew": 0,
    "desc": "",
    "conf": 1   // 关联的配置 ID
  }
}
```

**dconf (牌组配置/DeckConfig)**：
```json
{
  "config_id": {
    "name": "Default",
    "new": { "perDay": 20, "steps": [1, 10] },
    "rev": { "perDay": 200 },
    "lapse": { "steps": [10], "mult": 0.0, "minInt": 1 }
  }
}
```

### 2.3 Card 字段详解

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | int64 | 卡片唯一 ID (= epoch毫秒) |
| `nid` | int | 关联 note 的 ID |
| `did` | int | 牌组 ID |
| `ord` | int | 模板序号，从 0 开始 |
| `type` | u8 | CardType: 0=New, 1=Learn, 2=Review, 3=Relearn |
| `queue` | i8 | CardQueue: 0=New, 1=Learn, 2=Review, 3=DayLearn, -1=Suspended, -2=SchedBuried, -3=UserBuried |
| `due` | i32 | 含义取决于 queue: New=位置序号, Learn=unix时间戳(秒), Review=自创建以来的天数 |
| `ivl` | u32 | 当前间隔(天)，仅 Review/Relearn 有意义 |
| `factor` | u16 | ease factor × 1000，默认 2500 |
| `reps` | u32 | 总复习次数 |
| `lapses` | u32 | 遗忘次数 |
| `left` | u32 | 剩余学习步数(使用 `left % 1000` 取底有效值) |
| `odue` | i32 | 原始到期(筛选牌组用) |
| `odid` | int | 原始牌组(筛选牌组用) |
| `data` | text | JSON 扩展字段：`{"s":"{stability}","d":"{difficulty}","dr":0.9,"dc":-0.2}` |

---

## 三、调度算法全解

Anki 25.09 支持两套调度算法：
1. **SM-2 (SuperMemo 2)** — 经典算法，基于 ease factor + interval multiplier
2. **FSRS (Free Spaced Repetition Scheduler)** — 新版算法，基于记忆状态(state)的三参数模型

### 3.1 卡片状态机 (CardState)

```
                    ┌──────────┐
                    │   New    │  (从未学习)
                    └────┬─────┘
                         │ 回答 Again/Good/Easy
                         ▼
              ┌──────────────────┐
              │    Learning       │  (学习中，按steps逐步推进)
              │  remaining_steps  │
              └────┬───┬────┬────┘
                   │   │    │
          Again    │ Good│    │ Easy
          (重置)   │     │    │
                   ▼     ▼    ▼
              ┌──────┐ ┌──────────┐
              │Learn │ │  Review  │  (复习中)
              │(继续)│ │          │
              └──────┘ └──┬───┬───┘
                          │   │
                    Again │   │ Good/Easy
                          ▼   ▼
                   ┌─────────────┐
                   │  Relearning  │  (重新学习)
                   │  (忘记后)    │
                   └──┬───────┬──┘
                      │       │
                Again │       │ Good
                      ▼       ▼
                  Relearn   Review
```

### 3.2 SM-2 算法核心公式

**复习卡片的间隔计算** (在 `rslib/src/scheduler/states/review.rs`):

```
// 核心参数 (来自 DeckConfig)
hard_multiplier     = 1.2     // 默认
easy_multiplier     = 1.3     // 默认
interval_multiplier = 1.0     // 默认
maximum_review_interval = 36500 天
ease_factor 初始值   = 2.5 (2500/1000)

// Hard 按钮:
new_interval = max(current_interval × hard_multiplier × interval_multiplier, current_interval + 1)
new_ease = max(ease - 0.15, 1.3)

// Good 按钮 (考虑延迟天数):
new_interval = max((current_interval + days_late/2) × ease_factor × interval_multiplier, hard_interval + 1)
new_ease = ease (不变)

// Easy 按钮:
new_interval = max((current_interval + days_late) × ease_factor × easy_multiplier × interval_multiplier, good_interval + 1)
new_ease = ease + 0.15 (上限不封顶)

// Again 按钮 (进入 Relearning):
failing_interval = max(current_interval × lapse_multiplier, minimum_lapse_interval)
new_ease = max(ease - 0.20, 1.3)
```

**Lapse 重新学习** (Relearning):
- Again 后进入 Learning 状态（使用 `relearn_steps`）
- 每个 step 完成后再次检查
- 全部 steps 通过后回到 Review，间隔 = failing_interval
- 不全部通过 -> 再次 Again → 重新开始

**Leech 检测**：
- 当 lapses >= leech_threshold (默认8) 时标记为 leech
- 此后每 half_threshold (默认4) 次再次 leech
- Leech 后自动暂停卡片 (如果配置 suspend = true)

### 3.3 FSRS 算法

FSRS 使用三参数模型描述记忆状态：
- **Stability (稳定性 S)**：记忆可保持的天数
- **Difficulty (难度 D)**：1.0 ~ 10.0
- **Retrievability (可提取概率 R)**：记忆保留概率

核心公式（来自 `rslib/src/scheduler/fsrs/`）：

```
R(t) = e^(-t/S)     // 遗忘曲线

// 复习后稳定性更新 (记住时的 S 增长):
S' = S × (1 + factor)  // factor 取决于评分和参数

// 忘记时:
S' = S × w[14]  (S 衰减)

// 难度更新:
D' = D + w[4] × (rating - 3) + ...
    (评分越高难度越低, Again 大幅增加难度)

// 下一个间隔 (在 desired_retention 下):
next_interval = -S × ln(R_desired)
```

FSRS 参数（17+ 个浮点数）通过用户历史数据优化得出。

### 3.4 当前 MVP 调度与标准调度的差异

| 特性 | 现有 MVP | 标准 Anki |
|------|---------|----------|
| 状态机 | 无区分 New/Learning/Review/Relearning | 完整 4 态 |
| 调度算法 | 简化版 SM-2 (4按钮) | SM-2 + FSRS 双模式 |
| Steps | 不支持 | 支持 Learning/Relearning 多步 |
| Fuzz (随机化) | 无 | 支持 ±25% 随机 |
| 负载均衡 | 无 | 支持 |
| Leech 检测 | 无 | 支持 |
| Bury siblings | 无 | 支持 |
| 日切(Rollover) | 无 | 支持时区感知 |
| 筛选牌组 | 不支持 | 支持 |
| FSRS | 不支持 | 支持 |
| 复习日志 | 简化记录 | 完整 revlog |

---

## 四、模板渲染引擎

### 4.1 模板语法

Anki 使用 Handlebars 风格的模板标记：

```
{{FieldName}}              — 字段替换
{{FieldName:filter1:filter2}}  — 带过滤器的字段
{{#FieldName}}...{{/FieldName}}   — 条件(字段非空)
{{^FieldName}}...{{/FieldName}}   — 否定条件(字段为空)
{{FrontSide}}                   — 正面内容引用(仅背面)
{{cloze:FieldName}}             — 完形填空
{{type:FieldName}}              — 打字输入
{{c1::answer::hint}}            — 挖空标记(笔记字段中)
<!--{{ ... }}-->                — 注释(HTML注释隐藏模板标签)
```

### 4.2 渲染流程 (rslib/src/template.rs)

```
原始模板文本
    │
    ▼
Lexing (词法分析) → Token 流
    │  Token::Text / Replacement / OpenConditional / OpenNegated / CloseConditional / Comment
    ▼
Parsing (语法分析) → ParsedNode 树
    │  Text / Replacement / Conditional / NegatedConditional
    ▼
Rendering (渲染) → RenderedNode 列表
    │  替换 {{FieldName}} → 字段值
    │  应用过滤器 (text:, hint:, furigana: 等)
    │  处理 {{FrontSide}}
    │  处理 {{cloze:}} / {{type:}}
    │  处理条件判断 {{#}} / {{^}}
    ▼
HTML 字符串输出
```

### 4.3 现有 MVP 的模板渲染

当前 MVP 使用字符串正则替换（`TemplateRenderer.ets/ts`），部分功能已实现：
- ✅ `{{FieldName}}` 简单字段替换
- ✅ `{{FrontSide}}` 引用
- ✅ `{{cloze:FieldName}}` 基础挖空
- ✅ `{{type:FieldName}}` 文本输入
- ✅ `{{!comments}}` 剥离
- ✅ CSS 注入
- ✅ 媒体路径重写 (img/audio/sound)
- ❌ 过滤器 (`text:`, `hint:`, `furigana:` 等)
- ❌ 条件判断 `{{#}}...{{/}}` 和 `{{^}}...{{/}}`
- ❌ 词法/语法分析 → 无法报告模板错误

---

## 五、现有鸿蒙 MVP 代码评估

### 5.1 架构概览

```
harmony/
├── AppScope/                   # 应用全局配置
├── entry/src/main/ets/
│   ├── entryability/           # EntryAbility (ArkTS 入口)
│   ├── model/AnkiModels.ets    # TS 类型定义
│   ├── pages/
│   │   ├── Index.ets           # 主页面 (牌组列表 + 导入)
│   │   └── ReviewPage.ets      # 复习页面 (WebView 渲染)
│   └── services/
│       ├── AnkiDbService.ets   # SQLite/RDB 访问层
│       ├── AnkiSchema.ets      # 字段解析 / JSON 工具
│       ├── ImportService.ets   # .apkg 导入
│       ├── ReviewScheduler.ets # 简化调度器
│       ├── ReviewService.ets   # 复习业务流程
│       └── TemplateRenderer.ets# 模板渲染器
├── shared/anki/                # 可复用核心逻辑(Node可测试)
│   ├── ankiSchema.ts           # 字段解析(复用版)
│   ├── packageManifest.ts      # .apkg 解析
│   ├── reviewScheduler.ts      # 简版调度器(复用版)
│   └── templateRenderer.ts     # 模板渲染器(复用版)
└── tests/                      # Node 单元测试
    ├── core.test.mjs           # 核心逻辑测试
    └── scaffold.test.mjs       # 脚手架测试
```

### 5.2 已实现 vs 待实现

| 功能 | MVP 状态 | 说明 |
|------|---------|------|
| .apkg 导入 | ✅ 完成 | 支持 apkg/anki2/anki21 格式 |
| 数据库读取 | ✅ 完成 | 可读 col/decks/models/notes/cards |
| 模板渲染 | ⚠️ 基础 | 缺条件、过滤器 |
| 复习调度 | ⚠️ 简化 | 4按钮但缺状态机/FSRS |
| Deck 列表 | ✅ 完成 | |
| WebView 复习页 | ✅ 完成 | |
| 媒体文件 | ✅ 完成 | 解压 + 路径重写 |
| 复习历史 | ⚠️ 简化 | 自定义 hap_review_state/revlog 表 |

### 5.3 代码质量问题

1. **代码重复**: `shared/anki/` 和 `entry/src/main/ets/services/` 中有大量重复逻辑
2. **类型不统一**: `AnkiModels.ets` 用 `interface`，`shared/anki/` 用 `type`，需要统一
3. **硬编码**: SM-2 参数硬编码在 `ReviewScheduler` 中，未读取 dconf
4. **未读 deck config**: 当前实现不读取用户的牌组配置(`dconf`)，使用默认参数

---

## 六、移植路线图

### 阶段1：补齐核心调度 (优先级最高)

1. **读取 DeckConfig**：从 `col.dconf` JSON 解析用户的牌组配置
2. **实现完整状态机**：`New → Learning → Review → Relearning` 四态转换
3. **实现完整 SM-2 算法**：包括 steps、fuzz、leech、rollover
4. **使用标准 revlog 写入**：直接写回 cards 表而非 MVP 自定义表

### 阶段2：模板渲染增强

1. **实现词法/语法分析**：Token + Parser (可参考 Rust 的 `template.rs`)
2. **支持条件判断**：`{{#Field}}...{{/Field}}`
3. **支持过滤器**：`text:`, `hint:`, `furigana:`, `type:` 等

### 阶段3：FSRS 支持

1. **实现 FSRS 记忆状态计算**：stability/difficulty → next interval
2. **实现参数优化**：从 Anki 的参数导出
3. **FSRS + 短期学习步骤**：`fsrs_short_term_with_steps` 模式

### 阶段4：增强功能

1. **浏览器/卡片列表**
2. **编辑笔记/卡片**
3. **搜索**
4. **统计**
5. **同步** (AnkiWeb)

---

## 七、关键源码文件索引

### Rust 核心 (rslib/src/)

| 文件 | 内容 |
|------|------|
| `card/mod.rs` | Card 结构体、CardId、CardType、CardQueue 定义 |
| `scheduler/mod.rs` | 调度入口、时区处理 |
| `scheduler/answering/mod.rs` | 答题流程：`answer_card()`、`get_scheduling_states()` |
| `scheduler/answering/review.rs` | 复习状态应用 |
| `scheduler/answering/learning.rs` | 学习状态应用 |
| `scheduler/states/mod.rs` | CardState 枚举、SchedulingStates、StateContext |
| `scheduler/states/normal.rs` | NormalState (New/Learning/Review/Relearning) |
| `scheduler/states/review.rs` | ReviewState 及 SM-2 间隔计算公式 |
| `scheduler/states/learning.rs` | LearnState、学习步骤 |
| `scheduler/states/relearning.rs` | RelearnState、重新学习 |
| `scheduler/states/new.rs` | NewState |
| `scheduler/states/fuzz.rs` | 间隔随机化 |
| `scheduler/states/steps.rs` | LearningSteps (学习/重新学习步骤) |
| `scheduler/fsrs/mod.rs` | FSRS 入口 |
| `scheduler/fsrs/memory_state.rs` | 记忆状态计算、FSRSItem |
| `template.rs` | 模板引擎 (词法分析+语法分析+渲染) |
| `template_filters.rs` | 内置过滤器 (text/hint/furigana/tts 等) |
| `cloze.rs` | 完形填空处理 |
| `storage/schema11.sql` | 数据库 schema |
| `deckconfig/` | 牌组配置 (DeckConfig) |
| `decks/` | 牌组 (Deck) |

### 鸿蒙 MVP (harmony/)

| 文件 | 内容 |
|------|------|
| `shared/anki/reviewScheduler.ts` | 简化调度器（可复用版） |
| `shared/anki/templateRenderer.ts` | 模板渲染器（可复用版） |
| `shared/anki/ankiSchema.ts` | 数据模型/解析 |
| `entry/.../AnkiDbService.ets` | 数据库服务 |
| `entry/.../ImportService.ets` | 导入服务 |
| `entry/.../ReviewService.ets` | 复习服务 |
| `entry/.../TemplateRenderer.ets` | 模板渲染(ArkTS版) |
| `entry/.../ReviewPage.ets` | 复习页面 |

---

*文档生成时间：2026-06-14 | 下一步：实现完整 SM-2 调度器*
