# Anki .apkg 包导入 — 鸿蒙移植文档

> 对应 Rust: `rslib/src/import_export/package/` + `colpkg/import.rs`

---

## 一、.apkg 格式概述

.apkg 文件是标准 ZIP 压缩包，包含：
- **集合数据库** (`collection.anki2` / `collection.anki21` / `collection.anki21b`)
- **媒体文件** (图片/音频等，数字序号命名)
- **媒体映射** (`media` 文件，JSON 或 Protobuf)
- **元数据** (`meta` 文件，版本 ≥ Latest 时出现)

### 版本体系

| 版本 | 枚举值 | 集合文件 | 压缩 | SCHEMA | 媒体映射格式 |
|------|--------|---------|------|--------|------------|
| Legacy1 | 1 | `collection.anki2` | Store (无) | V11 | JSON `{"数字": "文件名"}` |
| Legacy2 | 2 | `collection.anki21` | Store (无) | V11 | JSON `{"数字": "文件名"}` |
| Latest | 3 | `collection.anki21b` | zstd | V18+ | Protobuf |

---

## 二、导入流程

```
用户选择文件(.apkg/.anki2/.anki21)
  │
  ▼
读取文件字节 → 检测类型
  ├─ 前4字节 = 0x04034b50 → ZIP (.apkg)
  └─ 前16字节 = "SQLite format 3\0" → 单独数据库 (.anki2/.anki21)
  │
  ▼
【ZIP 路径】
  1. parseZipArchive() — 解析中央目录
  2. detectPackageVersionFromBytes() — 版本检测
     ├─ 有 meta 文件 → 解析 protobuf version 字段
     ├─ 有 collection.anki21 → Legacy2
     └─ 只有 collection.anki2 → Legacy1
  3. selectCollectionFile() — 选择集合文件
  4. extractCollection() — 提取集合字节
  5. validateCollection() — SQLite 头校验
  6. parseMediaEntries() — 解析媒体映射
  7. extractMediaFile() × N — 逐个提取媒体文件
  │
  ▼
【输出】
  - collection.anki2 → databasePath
  - media/* → mediaDir
  - import_manifest.json → workingDir
```

---

## 三、模块职责

### shared/anki/package/ (纯逻辑层)

| 文件 | 职责 | 对应 Rust |
|------|------|----------|
| `types.ts` | 类型、枚举、错误类 | `meta.rs`, `mod.rs` |
| `zip.ts` | ZIP 中央目录解析 | `ZipArchive` (zip crate) |
| `collection.ts` | 版本检测、集合选择、SQLite 校验 | `meta.rs`, `colpkg/import.rs` |
| `media.ts` | 媒体映射解析、文件名安全检查 | `media.rs` |
| `import.ts` | 导入编排器、PlatformIO 接口 | `colpkg/import.rs` |

### entry/services/ (平台层)

| 文件 | 职责 |
|------|------|
| `ImportService.ets` | `PlatformIO` + `DeflateDecoder` ArkTS 实现 |

---

## 四、文件格式细节

### 4.1 ZIP 中央目录解析

ZIP 文件结构 (EOCD 在末尾):

```
[本地文件头1][文件数据1]
[本地文件头2][文件数据2]
  ...
[中央目录1][中央目录2]...
[EOCD 记录]
```

解析流程:
1. 从末尾向前扫描 `0x06054b50` → 找到 EOCD
2. 从 EOCD 读取中央目录偏移量和大小
3. 遍历中央目录，为每个条目记录: 文件名、偏移量、大小、压缩方法

### 4.2 文件名安全

媒体文件名必须通过安全检查 (对应 Rust `filename_is_safe()`):

- 不能是 Windows 保留名 (`CON`, `PRN`, `NUL`, `COM1-9`, `LPT1-9`)
- 不能含路径分隔符 (`/`, `\`)
- 不能含危险字符 (`<>:"\|?*`, 控制字符)
- 不能以空格或点结尾
- 文件名非空，不能是 `.` 或 `..`

### 4.3 SQLite 头校验

有效 SQLite 数据库的前 16 字节必须是 `SQLite format 3\0`。

额外校验:
- 页大小 (offset 16-17) 不能为 0
- 文件大小 ≥ 页大小

---

## 五、PlatformIO 接口

平台层需实现以下接口，注入到 `importPackage()`:

```typescript
export interface PlatformIO {
  mkdirSync(path: string, recursive?: boolean): void;
  existsSync(path: string): boolean;
  readFileSync(path: string): Uint8Array;
  writeFileSync(path: string, data: Uint8Array): void;
  copyFileSync(source: string, dest: string): void;
  writeTextSync(path: string, text: string): void;
  readTextSync(path: string): string;
  removeSync(path: string): void;
  getTempDir(): string;
}
```

HarmonyOS 实现使用 `@kit.CoreFileKit.fileIo`。

### DeflateDecoder 接口

```typescript
export interface DeflateDecoder {
  decompress(compressed: Uint8Array, uncompressedSize: number): Uint8Array;
}
```

HarmonyOS 实现使用 `@ohos.zlib.decompressSync()`。

---

## 六、错误处理

| 错误码 | 触发条件 | 用户提示 |
|--------|---------|---------|
| `CORRUPT` | 集合文件缺失、损坏、非 SQLite | "文件损坏或不完整" |
| `TOO_NEW` | meta version = 0 (未知版本) | "文件版本太新" |
| `NO_COLLECTION` | ZIP 中无任何受支持的集合文件 | "未找到可用的集合文件" |
| `UNSAFE_FILENAME` | 媒体文件名含危险字符/保留名 | "文件名不安全: ..." |
| `MEDIA_IMPORT_FAILED` | 单个媒体文件提取失败 | "媒体文件导入失败" |

---

## 七、测试覆盖

测试文件: `harmony/tests/package.test.ts`

- ZIP 解析: 多文件、目录排除、空压缩包、非 ZIP 检测
- 文件名安全: 正常名、保留名、保留名+扩展名、危险字符、边界
- SQLite 检测: 有效/无效头、空数据
- 集合选择: 优先级、回退、无文件抛错
- 路径规范化: 反斜杠转正斜杠
- 媒体映射: Legacy JSON 解析

---

## 八、后续改进方向

1. **zstd 解压支持**: 当前仅支持 Store/Deflate，Latest 版本需要 zstd
2. **Protobuf 媒体映射完整解析**: 当前仅实现 JSON/varint 解析
3. **调度导入选项**: 对应 Rust 的 `with_scheduling`/`with_deck_configs`
4. **增量导入/去重**: 对应 Rust 的 `UpdateCondition` 逻辑
5. **进度百分比**: 与 UI 层集成进度条

---

*文档生成时间：2026-06-14 | 实现版本：v0.2.0*
