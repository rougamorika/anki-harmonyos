# Anki4Hap — 项目总览

> 将 Anki 间隔重复记忆系统移植到 HarmonyOS Next (ArkTS)

---

## 一、项目定位

Anki4Hap 是一个运行在 HarmonyOS 6.1+ 上的 Anki 兼容客户端。

- **源码基版**: Anki 25.09.2 (上游: `https://github.com/ankitects/anki`)
- **移植仓库**: `https://github.com/rougamorika/anki4hap`
- **架构**: shared 纯逻辑层 (平台无关) + entry 平台桥接层 (ArkTS)

---

## 二、架构分层

```
┌──────────────────────────────────────────────┐
│  ArkUI Pages                                 │
│  Index / Review / Browser / Stats / Import   │
├──────────────────────────────────────────────┤
│  Entry Services (ArkTS)                      │
│  AnkiDbService / ReviewService / ImportService│
├──────────────────────────────────────────────┤
│  shared/anki/ (纯 TypeScript, 平台无关)        │
│  ┌─────────┬──────────┬──────────┐           │
│  │模板引擎  │ SM-2/FSRS │ 搜索引擎 │           │
│  │过滤器    │ 统计计算  │ CRUD     │           │
│  │卡片状态  │ .apkg导入 │ 牌组配置 │           │
│  └─────────┴──────────┴──────────┘           │
├──────────────────────────────────────────────┤
│  HarmonyOS Platform (@kit.*)                 │
│  RDB / FileIO / zlib / WebView               │
└──────────────────────────────────────────────┘
```

---

## 三、代码统计

### shared/anki/ (27 文件, ~4700 行 TypeScript)

| 模块 | 文件 | 行数 | 对应 Rust |
|------|------|------|-----------|
| 包导入 | `package/*.ts` (5) | ~900 | `rslib/src/import_export/package/` |
| 数据库 | `db/*.ts` (8) | ~800 | `rslib/src/storage/` + `card/` + `decks/` |
| SM-2 调度 | `sm2.ts` | ~570 | `rslib/src/scheduler/states/review.rs` |
| 模板引擎 | `template/*.ts` (5) | ~750 | `rslib/src/template.rs` |
| 过滤器 | `filters.ts` | ~180 | `rslib/src/template_filters.rs` |
| 统计 | `stats.ts` | ~250 | `rslib/src/stats/` |
| FSRS 调度 | `fsrs.ts` | ~320 | `fsrs` crate v5.2 |
| 搜索 | `search.ts` | ~360 | `rslib/src/search/` |
| CRUD | `ops.ts` | ~280 | `rslib/src/card/` + `notes/` |
| 合集 | `collection.ts` | ~300 | `deckconfig/` + `collection/` |
| 类型 | `card.ts` | ~210 | 跨模块类型统一定义 |

### entry/ (14 文件)

| 类型 | 文件 | 说明 |
|------|------|------|
| 服务 | `AnkiDbService.ets` | RDB 桥接 + 全业务委托 |
| 服务 | `ReviewService.ets` | SM-2/FSRS 调度 + 模板渲染 |
| 服务 | `ImportService.ets` | .apkg 导入 (文件选择 + ZIP 解析) |
| 页面 | `Index.ets` | 牌组列表主页 |
| 页面 | `ReviewPage.ets` | 复习页 (WebView + 4按钮) |
| 页面 | `BrowserPage.ets` | 卡片浏览器 (搜索 + 浏览) |
| 页面 | `StatsPage.ets` | 统计页 (复习曲线 + 评分分布) |
| 页面 | `ImportPage.ets` | 导入页 (文件选择 + 进度) |
| 入口 | `EntryAbility.ets` | 应用入口 |
| 模型 | `AnkiModels.ets` | 类型重导出 |
| 资源 | `main_pages.json` | 路由配置 |
| 资源 | `reviewer.html` | 卡片渲染壳 |
| 资源 | `string.json` | 字符串资源 |
| 配置 | `module.json5` | 模块声明 + 权限 |

### 测试 (9 套, ~206 用例 | 全部 0 失败)

| 文件 | 用例 | 覆盖 |
|------|------|------|
| `package.test.ts` | 15 | ZIP/SQLite/文件名/媒体 |
| `package.stress.test.ts` | 17 | 大文件/海量条目/损坏输入 |
| `sm2.test.ts` | 18 | 状态机/四按钮/Leech/Fuzz |
| `template.test.ts` | 43 | Lex/Parse/Render/renderCard |
| `db.test.ts` | 28 | 牌组树/字段解析/过滤器/统计 |
| `fsrs.test.ts` | 25 | nextStates/memoryState/SM-2桥接 |
| `search.test.ts` | 35 | 查询解析/SQL生成/通配符 |
| `ops.test.ts` | 13 | checksum/GUID/字段分割 |
| `collection.test.ts` | 12 | 配置/搜索/重命名/checksum |

---

## 四、完成度矩阵

### shared 层 — 100%

| 模块 | 状态 |
|------|------|
| .apkg 导入 (ZIP/collection/media) | ✅ |
| 数据库层 (schema/查询/牌组树) | ✅ |
| SM-2 调度器 (4态/4按钮/Leech/Fuzz) | ✅ |
| FSRS 调度器 (nextStates/memoryState/参数) | ✅ |
| 模板引擎 (Lexer/Parser/Renderer) | ✅ |
| 过滤器 (text/hint/furigana/kanji/kana/type) | ✅ |
| 搜索引擎 (query→SQL/20+运算符) | ✅ |
| CRUD (卡片/笔记/牌组/revlog) | ✅ |
| 统计 (复习曲线/遗忘曲线/到期预测) | ✅ |
| 牌组配置管理 | ✅ |
| 筛选牌组 | ✅ |
| 集合操作 | ✅ |

### entry 层 — 90%

| 模块 | 状态 |
|------|------|
| DbConnection 桥接 (RDB) | ✅ |
| 牌组列表页 | ✅ |
| 复习页 (WebView + SM-2) | ✅ |
| 卡片浏览器 | ✅ |
| 统计页 | ✅ |
| 导入页 | ✅ |
| 路由配置 | ✅ |
| DevEco 编译验证 | ❌ (无环境) |
| HAP 打包签名 | ❌ (无环境) |

---

## 五、DevEco 编译验证清单

在 DevEco Studio 中打开 `harmony/` 目录后，需检查：

1. **工程配置**: `build-profile.json5` SDK 版本匹配
2. **模块声明**: `entry/module.json5` 权限和 Ability 配置
3. **依赖**: `shared/oh-package.json5` 是否需要声明为 HSP/HAR
4. **ArkTS 编译**:
   - `@kit.AbilityKit` / `@kit.ArkData` / `@kit.CoreFileKit` / `@kit.ArkWeb` API 签名
   - `@ohos.zlib.decompressSync` 是否存在
   - `$rawfile()` 路径引用是否正确
   - shared 模块路径引用 (相对路径 `../../shared/anki/...`)
5. **资源**: `string.json` 的 key 是否被引用
6. **预期修正点** (参考 feature/harmony-mvp README):
   - `@kit.CoreFileKit` picker/fileIo API 签名
   - `@ohos.zlib` 解压 API
   - `@kit.ArkData` relationalStore ResultSet 类型
   - `@kit.ArkWeb` WebviewController 时序

---

## 六、运行测试

```powershell
# 单套
npx tsx harmony/tests/template.test.ts
npx tsx harmony/tests/sm2.test.ts

# 全部 (PowerShell)
foreach ($t in @("template","package","package.stress","sm2","db","fsrs","search","ops","collection")) {
  Write-Host "--- $t ---" -ForegroundColor Cyan
  npx tsx "harmony/tests/$t.test.ts" 2>&1 | Select-String "pass|fail" | Select-Object -Last 1
}
```

---

## 七、文档索引

| 文档 | 内容 |
|------|------|
| `01-anki-architecture-cn.md` | 整体架构、数据库 Schema |
| `02-scheduler-algorithm-cn.md` | SM-2/FSRS 算法详细拆解 |
| `03-template-engine-cn.md` | 模板引擎分析 (Lex/Parse/Render) |
| `04-apkg-import-cn.md` | .apkg 格式、导入流程、PlatformIO |
| `05-sm2-implementation-cn.md` | SM-2 API/常数/测试覆盖 |
| `06-template-engine-cn.md` | 新模板引擎实现文档 |
| `07-fsrs-implementation-cn.md` | FSRS API/公式/测试覆盖 |
| `08-project-summary-cn.md` | 本文档 — 项目总览 |

---

*生成时间: 2026-06-14 | 下一步: DevEco Studio 编译 & HAP 打包*
