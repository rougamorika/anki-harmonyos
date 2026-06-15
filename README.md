# 🎴 Anki for HarmonyOS

> 把全球最流行的间隔重复记忆神器搬到鸿蒙生态。

[![License](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-206_passing-brightgreen)](#运行测试)
[![DevEco](https://img.shields.io/badge/DevEco-6.1.1-orange)](#-当前状态)

---

## 🤔 这是什么

[Anki](https://apps.ankiweb.net) 是全球 5000 万+ 用户使用的开源间隔重复记忆软件。**Anki4Hap** 是它的 HarmonyOS Next 移植版——让你在 MatePad、MatePhone 等鸿蒙设备上刷卡片、背单词。

**目前阶段：纯逻辑层 100% 完成，ArkTS 编译调试中。需要你的帮助！**

---

## 🧭 当前状态

| 层 | 完成度 | 状态 |
|----|--------|------|
| **shared 纯逻辑** | ✅ 100% | 27 文件, 9 套测试 ~206 用例, Node 全部通过 |
| **ArkTS 服务层** | ⚠️ 90% | 已适配 ArkTS strict mode, API 兼容性待验证 |
| **ArkUI 页面** | 🚧 骨架 | 5 页框架已搭建, 交互待完善 |
| **DevEco 编译** | 🔴 调试中 | ApkgReader 刚替换 zlib.decompressFile, 待验证 |

### 纯逻辑层覆盖 (node 测试全绿)

- 🧠 **SM-2 调度器** — 完整状态机, 4 按钮, Leech 检测, Fuzz
- 🧠 **FSRS-5 调度器** — 记忆状态计算, 参数优化, SM-2 桥接
- 📝 **模板引擎** — Lexer → Parser → Renderer 三阶段, 支持条件/过滤器/Cloze
- 🔍 **搜索引擎** — Anki 查询语法 → 参数化 SQL
- 📦 **.apkg 导入** — ZIP 解析, 集合检测, 媒体提取
- 📊 **统计计算** — 复习曲线, 遗忘曲线, 到期预测
- 💾 **完整数据库层** — Schema/Card/Note/Deck/Revlog CRUD

---

## 🆘 我们需要帮助

### 🔴 最紧急 — DevEco 编译调试

我只有一台 Windows 开发机，**没有真机/模拟器**。以下需要鸿蒙开发者帮忙：

1. **编译通过** — 打开 DevEco Studio, Build → 修复 API 差异
2. **真机运行** — 验证 RDB/SQLite 能正常打开 collection.anki2
3. **导入 .apkg** — 验证 ApkgReaderService 能正确解压 ZIP
4. **卡片渲染** — 验证 WebView + 模板引擎输出正确

### 🟡 需要的技能

- 用过 DevEco Studio / ArkTS
- 了解 HarmonyOS 文件系统 / SQLite API
- 或者只是想学鸿蒙开发想找个项目练手

### 🟢 如何参与

```powershell
git clone https://github.com/rougamorika/anki-harmonyos.git
cd anki-harmonyos
npx tsx tests/template.test.ts  # 跑测试
# 然后用 DevEco Studio 打开, Build!
```

直接提 Issue 或 PR，或者邮件联系。任何帮助都欢迎——修一个 API 签名、改一行颜色、写一句文档。

---

## 🏗 项目结构

```
entry/src/main/ets/      ← ArkTS 平台层 (需要调试!)
  ├── services/           ← AnkiDbService, ReviewService, ImportService, ApkgReaderService
  └── pages/              ← Index, Review, Browser, Stats, Import
shared/anki/              ← 纯逻辑层 (已完成, 可放心使用)
  ├── template/           ← 模板引擎    ├── sm2.ts / fsrs.ts  ← 调度器
  ├── db/                 ← 数据库层    ├── search.ts         ← 搜索引擎
  └── package/            ← apkg 导入   └── stats.ts          ← 统计计算
tests/                    ← Node 单元测试 (9 套, ~206 用例)
docs/                     ← 中文技术文档 (8 篇)
```

---

## 📖 相关文档

| 文档 | 内容 |
|------|------|
| [`docs/01-anki-architecture-cn.md`](docs/01-anki-architecture-cn.md) | Anki 整体架构与移植分析 |
| [`docs/02-scheduler-algorithm-cn.md`](docs/02-scheduler-algorithm-cn.md) | SM-2/FSRS 算法详细拆解 |
| [`docs/03-template-engine-cn.md`](docs/03-template-engine-cn.md) | 模板引擎分析 |
| [`docs/08-project-summary-cn.md`](docs/08-project-summary-cn.md) | 项目总览 |

---

## 📜 License

AGPL-3.0-or-later — 与上游 [Anki](https://github.com/ankitects/anki) 一致。
