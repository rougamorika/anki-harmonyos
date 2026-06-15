# Anki for HarmonyOS

将 [Anki](https://github.com/ankitects/anki) 间隔重复记忆系统移植到 HarmonyOS Next (ArkTS)。

## 项目结构

```
├── shared/anki/           # 纯逻辑层 (TypeScript, 平台无关, Node 可测试)
│   ├── template/          # 模板引擎 (Lexer/Parser/Renderer)
│   ├── db/                # 数据库层 (Schema/查询/牌组树)
│   ├── package/           # .apkg 导入 (ZIP解析/集合检测)
│   ├── sm2.ts             # SM-2 调度器
│   ├── fsrs.ts            # FSRS-5 调度器
│   ├── search.ts          # 搜索引擎 (query→SQL)
│   ├── stats.ts           # 统计计算 (复习曲线/遗忘曲线)
│   ├── ops.ts             # CRUD 操作
│   ├── filters.ts         # 模板过滤器 (text/hint/furigana...)
│   ├── collection.ts      # 牌组配置/筛选牌组
│   └── card.ts            # 类型定义
├── entry/                 # ArkTS 平台层
│   └── src/main/ets/
│       ├── services/      # 平台桥接 (RDB/文件/导入)
│       └── pages/         # ArkUI 页面 (Index/Review/Browser/Stats/Import)
├── tests/                 # Node 单元测试 (~206 用例)
├── docs/                  # 中文技术文档 (8篇)
└── AppScope/              # HarmonyOS 应用配置
```

## 运行测试

```powershell
npx tsx tests/template.test.ts
npx tsx tests/sm2.test.ts
npx tsx tests/fsrs.test.ts
# ... 共 9 套 ~206 用例
```

## DevEco 编译

在 DevEco Studio 中打开本项目根目录，Build → Build Hap(s)。

## License

AGPL-3.0-or-later (与上游 Anki 一致)
