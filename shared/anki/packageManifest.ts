/**
 * Anki .apkg 包处理 — 向后兼容重导出
 *
 * 此文件保留原有 API，内部委托给新的 package/ 模块。
 */

// 类型重导出
export type {
  ImportManifest,
  MediaEntry,
  ProgressCallback,
  ImportProgress,
} from './package/types.ts';

export {
  PackageVersion,
  ImportError,
  ImportErrorCode,
} from './package/types.ts';

// ZIP 相关
export type {
  ZipEntry,
  ZipArchive,
  DeflateDecoder,
} from './package/zip.ts';

export {
  parseZipArchive,
  readEntryData,
  readEntryText,
  isZipFile as isZipBytes,
} from './package/zip.ts';

// 集合相关
export type {
  CollectionSelection,
  PackageMeta,
} from './package/types.ts';

export {
  detectPackageVersionFromBytes,
  selectCollectionFile,
  selectCollectionFileFromNames,
  extractCollection,
  validateCollection,
} from './package/collection.ts';

// 媒体相关
export {
  parseLegacyMediaMap,
  parseMediaEntries,
  safeNormalizeFilename,
  sanitizeFilename,
  isFilenameSafe,
  extractMediaFile,
} from './package/media.ts';

// 导入编排器
export type {
  PlatformIO,
  ImportConfig,
  ImportSource,
} from './package/import.ts';

export {
  importPackage,
  readManifest,
} from './package/import.ts';

// ——— 保留旧版便捷 API ———

import { parseLegacyMediaMap as parse } from './package/media.ts';

/** 解析 legacy 媒体映射 (保留旧版 API 名称) */
export const parseLegacyMediaMap = parse;
