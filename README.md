# 🎴 Anki4Hap — 鸿蒙上的 Anki

> # ⚠️ 这是一座屎山
>
> **核心逻辑（shared/）对着 Anki Rust 源码一行行抄的，Node 测试 206 个全绿。**
> **ArkTS 层（entry/）正在 DevEco 上逐行调编译——strict mode 有一万个坑。**
>
> 架构是对的，算法是对的，测试是对的。但 DevEco 编译器不认。你看到的 entry/ 代码大概率编译不过，需要逐行踩坑踩过去。
> **作者有 DevEco 也有鸿蒙设备，但没时间一个个 API 调。**
> 如果你有 DevEco 环境，这就是你来拯救的项目。
>
> **现在你知道了。往下看吧。**

[![Tests](https://img.shields.io/badge/Node_tests-206_passing-brightgreen)](https://github.com/rougamorika/anki-harmonyos/actions)
[![DevEco](https://img.shields.io/badge/DevEco_compile-🔥_调试中-red)](https://github.com/rougamorika/anki-harmonyos/issues)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)

---

## 🤔 这是什么

[Anki](https://apps.ankiweb.net) 是全球最流行的开源间隔重复记忆软件（5000万+用户）。**Anki4Hap** 是它的 **HarmonyOS Next 移植版**。

不是套壳。纯逻辑层（调度、模板、搜索、统计）从 Anki 25.09.2 的 Rust 源码一行行对照写出来的 TypeScript，Node 可独立运行和测试。ArkTS 层通过严格的 strict mode 编译，目标是生成可在 MatePad/MatePhone/Pura 上运行的 HAP 包。

**目前的阶段：纯逻辑层已完成, 正在 DevEco 上逐行调编译。调通了就能在真机上跑。**

最大的瓶颈是时间——DevEco strict mode 要求每行代码都带显式类型、不能解构、不能用索引签名、不能动态属性访问。一份算法逻辑要改三四遍才能过编译。

---

## 📊 进度清单

### shared 纯逻辑层 (TypeScript, Node 运行)

所有模块均可在 Node 下独立测试, 不依赖任何 HarmonyOS API。

| # | 模块 | 功能 | 对应 Rust 源码 | 状态 |
|---|------|------|----------------|------|
| 1 | `template/` | 模板引擎: Lexer → Parser → Renderer | `rslib/src/template.rs` (1377行) | ✅ |
| 2 | `sm2.ts` | SM-2 调度器: 4态状态机, Leech, Fuzz | `rslib/src/scheduler/states/*.rs` | ✅ |
| 3 | `fsrs.ts` | FSRS-5 调度器: memoryState, nextStates | `fsrs` crate v5.2.0 | ✅ |
| 4 | `search.ts` | Anki 查询语法 → 参数化 SQL | `rslib/src/search/parser.rs` (1308行) | ✅ |
| 5 | `db/` | 数据库层: Schema, DeckTree, CardQuery, Revlog | `rslib/src/storage/` | ✅ |
| 6 | `package/` | .apkg ZIP 导入: 中央目录解析, 媒体提取 | `rslib/src/import_export/package/` | ✅ |
| 7 | `filters.ts` | 模板过滤器: text, hint, furigana, kanji, kana | `rslib/src/template_filters.rs` (303行) | ✅ |
| 8 | `stats.ts` | 统计: 复习曲线, 遗忘曲线, 到期预测 | `rslib/src/stats/` | ✅ |
| 9 | `ops.ts` | CRUD: updateCard, buryCard, addNote, addRevlog | `rslib/src/card/mod.rs` + `notes/` | ✅ |
| 10 | `collection.ts` | 牌组配置管理, 筛选牌组, 集合完整性检查 | `rslib/src/deckconfig/` + `collection/` | ✅ |
| 11 | `card.ts` | 类型定义: CardRow, CardType, CardQueue, StateContext | 跨模块类型 | ✅ |

### DevEco / ArkUI 层

| # | 任务 | 说明 |
|---|------|------|
| 12 | 🔥 `ApkgReaderService` 编译通过 | ZIP 直接解析替代 zlib.decompressFile |
| 13 | 🔥 导入 .apkg 真机验证 | 选文件 → 解析 ZIP → 写入 RDB → 显示牌组 |
| 14 | 🔥 复习页面真机验证 | WebView 渲染卡片 → 点按钮 → SM-2 调度 → 写回 DB |
| 15 | 卡片浏览器 | 搜索+浏览+分页 |
| 16 | 统计页面 | 复习曲线柱状图 + 评分分布 |
| 17 | HAP 打包签名 | Build → Sign → 安装到真机 |

> ✅ = 已完成, 🔥 = 正在进行, 空白 = 未开始

---

## 🏗 架构

```
┌─────────────────────────────────────────┐
│ ArkUI Pages                              │
│ Index / Review / Browser / Stats / Import│
├─────────────────────────────────────────┤
│ Entry Services (ArkTS strict mode)       │
│ AnkiDbService / ReviewService             │
│ ImportService / ApkgReaderService         │
├─────────────────────────────────────────┤
│ shared/anki/ (平台无关 TypeScript)         │
│ 模板引擎 │ SM-2/FSRS │ 搜索 │ 统计 │ CRUD │
├─────────────────────────────────────────┤
│ HarmonyOS Platform (@kit.*)              │
│ RDB / FileIO / WebView / zlib             │
└─────────────────────────────────────────┘
```

**设计原则:** shared 层是纯函数/无副作用, 接口驱动 (DbConnection, PlatformIO, DeflateDecoder)。entry 层实现这些接口, 注入到 shared 层调用。shared 层 Node 可测试, entry 层在 DevEco 编译。

---

## 🧪 运行测试

Node 18+ 即可, 不需要 DevEco:

```powershell
npm install -g tsx
tsx tests/template.test.ts    # 模板引擎 (43 cases)
tsx tests/sm2.test.ts         # SM-2 调度 (18 cases)
tsx tests/fsrs.test.ts        # FSRS 调度 (25 cases)
tsx tests/search.test.ts      # 搜索引擎 (35 cases)
tsx tests/db.test.ts          # 数据库层 (28 cases)
tsx tests/package.test.ts     # .apkg 导入 (15 cases)
tsx tests/package.stress.test.ts  # 压测 (17 cases)
tsx tests/ops.test.ts         # CRUD (13 cases)
tsx tests/collection.test.ts  # 合集 (12 cases)
```

共 **~206 用例, 0 失败** (2026-06-14)。

---

## 📁 项目结构

```
anki-harmonyos/
├── entry/src/main/ets/      ← ArkTS 平台层
│   ├── entryability/        ← EntryAbility
│   ├── model/               ← AnkiModels.ets (类型导出)
│   ├── pages/               ← 5 个 ArkUI 页面
│   │   ├── Index.ets        ← 牌组列表主页
│   │   ├── ReviewPage.ets   ← 复习页 (WebView + 4按钮)
│   │   ├── BrowserPage.ets  ← 卡片浏览器
│   │   ├── StatsPage.ets    ← 统计页
│   │   └── ImportPage.ets   ← 导入页
│   └── services/            ← 平台桥接服务
│       ├── AnkiDbService.ets   ← RDB 数据库
│       ├── ReviewService.ets   ← SM-2 调度 + 模板渲染
│       ├── ImportService.ets   ← 文件选择 + 导入编排
│       └── ApkgReaderService.ets ← .apkg ZIP 直接解析
├── shared/anki/             ← 纯逻辑 (27 文件, ~4700 行)
│   ├── template/            ← 模板引擎
│   ├── db/                  ← 数据库层
│   ├── package/             ← .apkg 导入
│   ├── sm2.ts / fsrs.ts     ← 调度器
│   ├── search.ts            ← 搜索引擎
│   ├── stats.ts             ← 统计
│   ├── ops.ts               ← CRUD
│   ├── filters.ts           ← 模板过滤器
│   ├── collection.ts        ← 牌组配置/筛选牌组
│   └── card.ts              ← 类型定义
├── tests/                   ← Node 单元测试 (9 套)
├── docs/                    ← 中文技术文档 (8 篇)
├── AppScope/                ← 鸿蒙应用配置
├── build-profile.json5      ← 构建配置
└── hvigorfile.ts            ← 构建入口
```

---

## 📖 开发者文档

如果你是第一次接触这个项目, 按顺序阅读:

1. **[01-anki-architecture-cn.md](docs/01-anki-architecture-cn.md)** — Anki 整体架构剖析, 数据库 Schema, Card 结构
2. **[02-scheduler-algorithm-cn.md](docs/02-scheduler-algorithm-cn.md)** — SM-2/FSRS 调度算法伪代码和公式
3. **[03-template-engine-cn.md](docs/03-template-engine-cn.md)** — 模板引擎三阶段: Lex → Parse → Render
4. **[04-apkg-import-cn.md](docs/04-apkg-import-cn.md)** — .apkg ZIP 格式解析和导入流程
5. **[08-project-summary-cn.md](docs/08-project-summary-cn.md)** — 项目总览, 完成度矩阵

### 关键技术对照表

| Anki Rust | 本项目 TS | 说明 |
|-----------|----------|------|
| `rslib/src/template.rs` | `shared/anki/template/` | 模板引擎 (5文件) |
| `rslib/src/scheduler/states/review.rs` | `shared/anki/sm2.ts` | SM-2 间隔公式 |
| `fsrs` crate v5.2 | `shared/anki/fsrs.ts` | FSRS-5 调度 |
| `rslib/src/search/parser.rs` | `shared/anki/search.ts` | 搜索语法 → SQL |
| `rslib/src/import_export/package/` | `shared/anki/package/` | .apkg 导入 |
| `rslib/src/storage/schema11.sql` | `shared/anki/db/schema.ts` | 数据库 Schema |

### ArkTS strict mode 要点

HarmonyOS Next 的 ArkTS 编译器非常挑剔。写代码时必须遵守:

- ❌ **不能解构** — `const { a, b } = obj` → `let a = obj.a; let b = obj.b`
- ❌ **不能动态属性** — `obj[key]` 不行 → 用 `Record<string, X>` cast 后访问
- ❌ **不能索引签名** — `interface X { [key: string]: Y }` 不行 → 用 `Record<string, Y>`
- ❌ **所有对象字面量必须有类型** — `{ a: 1 }` 不行 → `let x: MyType = { a: 1 }`
- ❌ **TextEncoder/TextDecoder 不存在** → 手写 UTF-8 解码, 或用 `util.TextEncoder`
- ❌ **`fileIo.writeTextSync` 不存在** → 用 `openSync` + `writeSync(fd.fd, str)` + `closeSync`

---

## 🆘 我们需要你

### 🔴 已知问题 (Issue 欢迎认领)

1. **ApkgReaderService 编译不通过** — `fileIo.readSync(fd.fd, buf, options)` API 签名需要确认
2. **zlib.decompressSync 参数** — 3 参数的 deflate 解压是否支持
3. **导入后 RDB 打开失败** — `collection.anki2` 写入后 `getRdbStore` 能否正常打开
4. **WebView 卡片渲染** — `reviewer.html` 加载后 `runJavaScript` 能否正常执行
5. **复习按钮事件** — 4 个 Again/Hard/Good/Easy 按钮点到后是否正确写回 DB

### 🟡 需要用到的

- **DevEco Studio 6.1+** (我们用的是 6.1.1.280)
- **HarmonyOS 真机或模拟器** (不需要签名, Debug 模式即可)
- 或者你只是想看看 ArkTS strict mode 有多变态

### 🟢 参与方式

```powershell
git clone https://github.com/rougamorika/anki-harmonyos.git
cd anki-harmonyos
npx tsx tests/template.test.ts    # 确认测试通过
```

然后在 DevEco Studio 中 `File → Open → 选择 anki-harmonyos 目录`，Build → 修 Bug → PR。

有任何问题直接开 Issue, 不用客气。

---

## 📜 License

AGPL-3.0-or-later — 与上游 [Anki](https://github.com/ankitects/anki) 一致。
