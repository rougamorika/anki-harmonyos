/**
 * Anki .apkg 包导入编排器 — 纯逻辑层
 *
 * 将 ZIP 解析、集合检测、媒体处理等模块组合成完整的导入流程。
 * 所有 I/O 操作通过回调委托给平台层实现。
 *
 * 对应 Rust: rslib/src/import_export/package/colpkg/import.rs (import_colpkg)
 *          rslib/src/import_export/package/apkg/import/mod.rs (import_apkg)
 */

import type { ZipArchive, DeflateDecoder } from './zip.ts';
import { parseZipArchive } from './zip.ts';
import {
  type CollectionSelection,
  type ImportManifest,
  type MediaEntry,
  type PackageMeta,
  type ProgressCallback,
  ImportError,
  ImportErrorCode,
  PackageVersion,
} from './types.ts';
import {
  detectPackageVersionFromBytes,
  selectCollectionFile,
  extractCollection,
  validateCollection,
  selectCollectionFileFromNames,
} from './collection.ts';
import {
  parseMediaEntries,
  safeNormalizeFilename,
  extractMediaFile,
} from './media.ts';

// ─── 平台 I/O 接口 ───

/**
 * 平台文件系统操作接口 (由 entry 层实现)
 */
export interface PlatformIO {
  /** 创建目录 (包括父目录) */
  mkdirSync: (path: string, recursive?: boolean) => void;
  /** 检查文件/目录是否存在 */
  existsSync: (path: string) => boolean;
  /** 读取文件全部内容为 Uint8Array */
  readFileSync: (path: string) => Uint8Array;
  /** 写入 Uint8Array 到文件 */
  writeFileSync: (path: string, data: Uint8Array) => void;
  /** 复制文件 */
  copyFileSync: (source: string, dest: string) => void;
  /** 写入 UTF-8 文本到文件 */
  writeTextSync: (path: string, text: string) => void;
  /** 读取文件为 UTF-8 文本 */
  readTextSync: (path: string) => string;
  /** 删除文件或目录 (递归) */
  removeSync: (path: string) => void;
  /** 获取临时目录路径 */
  getTempDir: () => string;
}

/** 完整的导入配置 */
export interface ImportConfig {
  /** 平台 I/O 实现 */
  io: PlatformIO;
  /** Deflate 解压器 (处理 ZIP deflate 压缩) */
  decoder: DeflateDecoder;
  /** 输出: 集合数据库目标路径 */
  databasePath: string;
  /** 输出: 媒体文件目标目录 */
  mediaDir: string;
  /** 输出: 工作目录 (存放集合副本和 manifest) */
  workingDir: string;
  /** 进度回调 (可选) */
  onProgress?: ProgressCallback;
}

/** 导入原料类型 */
export type ImportSource =
  | { kind: 'bytes'; data: Uint8Array; sourceUri: string }
  | { kind: 'file'; filePath: string; sourceUri: string };

// ─── 主入口 ───

/**
 * 导入 .apkg / .anki2 / .anki21 文件。
 *
 * 流程:
 * 1. 读取文件字节
 * 2. 检测输入类型 (ZIP/apkg vs 单独数据库)
 * 3. 如果是 ZIP: 解析归档 → 检测版本 → 选择集合文件 → 提取集合
 * 4. 验证集合数据库
 * 5. 解析媒体映射并提取媒体文件
 * 6. 写入目标位置并生成 manifest
 *
 * @param source 导入来源
 * @param config 导入配置
 * @returns 导入清单
 */
export function importPackage(
  source: ImportSource,
  config: ImportConfig,
): ImportManifest {
  const { io, decoder } = config;

  // 1. 确保目标目录存在
  io.mkdirSync(config.workingDir, true);
  io.mkdirSync(config.mediaDir, true);
  io.mkdirSync(config.databasePath.replace(/[/\\][^/\\]+$/, ''), true);

  // 2. 读取文件字节
  let fileBytes: Uint8Array;
  if (source.kind === 'bytes') {
    fileBytes = source.data;
  } else {
    config.onProgress?.({ kind: 'extracting' });
    fileBytes = io.readFileSync(source.filePath);
  }

  // 3. 收集阶段
  config.onProgress?.({ kind: 'gathering' });

  const result = importFromBytes(fileBytes, source.sourceUri, config);

  // 4. 持久化
  writeOutputs(result, config);

  return result.manifest;
}

// ─── 内部实现 ───

interface ImportResult {
  manifest: ImportManifest;
  collectionData: Uint8Array;
  mediaFiles: Array<{ entry: MediaEntry; data: Uint8Array }>;
}

function importFromBytes(
  fileBytes: Uint8Array,
  sourceUri: string,
  config: ImportConfig,
): ImportResult {
  const { io, decoder } = config;

  // 检测: 是否为 ZIP (apkg) 或单独的数据库文件 (.anki2/.anki21)
  const isZip = isZipFile(fileBytes);
  const isSqlite = looksLikeSqliteFile(fileBytes);

  if (isZip) {
    return importZipPackage(fileBytes, sourceUri, config);
  }

  if (isSqlite) {
    return importRawDatabase(fileBytes, sourceUri, config);
  }

  throw new ImportError(
    'Unrecognized file format. Expected .apkg (ZIP), .anki2, or .anki21 file.',
    ImportErrorCode.Corrupt,
  );
}

// ─── ZIP 包导入 ───

function importZipPackage(
  fileBytes: Uint8Array,
  sourceUri: string,
  config: ImportConfig,
): ImportResult {
  const { io, decoder, onProgress } = config;

  // 解析 ZIP
  const archive = parseZipArchive(fileBytes);

  // 检测版本
  const meta = detectPackageVersionFromBytes(archive, fileBytes);

  // 选择集合文件
  const selection = selectCollectionFile(archive, meta);

  // 提取集合数据库
  onProgress?.({ kind: 'extracting' });
  const collectionData = extractCollection(archive, selection, fileBytes, decoder);

  // 验证
  onProgress?.({ kind: 'validating' });
  validateCollection(collectionData);

  // 解析媒体
  const mediaEntries = parseMediaEntries(archive, meta.version, fileBytes, decoder);
  onProgress?.({ kind: 'media', current: 0, total: mediaEntries.length });

  const mediaFiles: Array<{ entry: MediaEntry; data: Uint8Array }> = [];
  for (let i = 0; i < mediaEntries.length; i++) {
    const entry = mediaEntries[i];
    if (entry === undefined) continue;

    const data = extractMediaFile(archive, entry.zipEntryName, fileBytes, decoder);
    if (data) {
      mediaFiles.push({ entry, data });
    }
    onProgress?.({ kind: 'media', current: i + 1, total: mediaEntries.length });
  }

  const manifest: ImportManifest = {
    importedAt: Math.floor(Date.now() / 1000),
    sourceUri,
    collectionDbName: 'collection.anki2',
    collectionDbPath: config.databasePath,
    mediaDir: config.mediaDir,
    mediaFileCount: mediaFiles.length,
    version: meta.version,
  };

  return { manifest, collectionData, mediaFiles };
}

// ─── 单独数据库导入 ───

function importRawDatabase(
  fileBytes: Uint8Array,
  sourceUri: string,
  config: ImportConfig,
): ImportResult {
  const { onProgress } = config;

  onProgress?.({ kind: 'validating' });
  validateCollection(fileBytes);

  const manifest: ImportManifest = {
    importedAt: Math.floor(Date.now() / 1000),
    sourceUri,
    collectionDbName: 'collection.anki2',
    collectionDbPath: config.databasePath,
    mediaDir: config.mediaDir,
    mediaFileCount: 0,
    version: PackageVersion.Legacy2, // 假设 v2 格式
  };

  return { manifest, collectionData: fileBytes, mediaFiles: [] };
}

// ─── 输出写入 ───

function writeOutputs(result: ImportResult, config: ImportConfig): void {
  const { io } = config;

  // 写入集合数据库 (同时写入工作目录和数据库路径)
  io.writeFileSync(config.databasePath, result.collectionData);
  io.writeFileSync(`${config.workingDir}/${result.manifest.collectionDbName}`, result.collectionData);

  // 写入媒体文件
  for (const { entry, data } of result.mediaFiles) {
    const destPath = `${config.mediaDir}/${entry.filename}`;
    try {
      io.writeFileSync(destPath, data);
    } catch (e) {
      // 单个媒体文件失败不中断整个导入
      console.warn(`Failed to write media file '${entry.filename}': ${String(e)}`);
    }
  }

  // 写入 manifest
  io.writeTextSync(
    `${config.workingDir}/import_manifest.json`,
    JSON.stringify(result.manifest, null, 2),
  );
}

// ─── 辅助 ───

/**
 * 检查字节数组前 4 字节是否是 ZIP 本地文件头签名
 */
function isZipFile(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/**
 * 检查字节数组是否是 SQLite 数据库文件 (完整 16 字节头校验)
 */
function looksLikeSqliteFile(data: Uint8Array): boolean {
  if (data.length < 16) return false;
  return new TextDecoder().decode(data.slice(0, 16)) === 'SQLite format 3\x00';
}

/**
 * 读取之前保存的导入清单。
 */
export function readManifest(io: PlatformIO, workingDir: string): ImportManifest | undefined {
  const manifestPath = `${workingDir}/import_manifest.json`;
  if (!io.existsSync(manifestPath)) return undefined;

  try {
    const text = io.readTextSync(manifestPath);
    return JSON.parse(text) as ImportManifest;
  } catch {
    return undefined;
  }
}
