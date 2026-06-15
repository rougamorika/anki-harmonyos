/**
 * Anki .apkg 包导入 - 类型定义
 *
 * 对应 Rust: rslib/src/import_export/package/meta.rs (Version, Meta)
 */

/** 包版本枚举 - 对应 Rust `meta::Version` */
export enum PackageVersion {
  /** 旧版 (collection.anki2, schema 11) */
  Legacy1 = 1,
  /** 旧版 (collection.anki21, schema 11) */
  Legacy2 = 2,
  /** 最新版 (collection.anki21b, zstd 压缩, schema 18+) */
  Latest = 3,
}

/** 包元数据 - 对应 Rust `meta::Meta` */
export interface PackageMeta {
  version: PackageVersion;
}

/** 集合文件候选名称 (按优先级排序) */
export const COLLECTION_CANDIDATES: ReadonlyArray<string> = [
  'collection.anki21b',
  'collection.anki21',
  'collection.anki2',
];

/** 集合文件选择结果 */
export interface CollectionSelection {
  collectionFile: string;
  /** ZIP 条目中是否包含 protobuf meta 文件 */
  hasMetaFile: boolean;
  /** ZIP 条目中是否包含 media 映射文件 */
  hasMediaMap: boolean;
  /** 是否为 zstd 压缩 (非 legacy 版本) */
  zstdCompressed: boolean;
}

/** 媒体条目 - 对应 Rust `SafeMediaEntry` */
export interface MediaEntry {
  /** ZIP 中的条目名 (legacy 为数字序号, 新版为文件名) */
  zipEntryName: string;
  /** 目标文件名 (NFC 规范化后) */
  filename: string;
  /** 文件大小 (legacy 版本在导入时更新) */
  size: number;
  /** SHA1 哈希 (新版 protobuf 中提供) */
  sha1?: Uint8Array;
}

/** 导入清单 (持久化到 import_manifest.json) */
export interface ImportManifest {
  /** 导入时间 (Unix 秒) */
  importedAt: number;
  /** 导入来源 URI */
  sourceUri: string;
  /** 集合文件名 (collection.anki2) */
  collectionDbName: string;
  /** 集合数据库路径 */
  collectionDbPath: string;
  /** 媒体目录路径 */
  mediaDir: string;
  /** 成功导入的媒体文件数 */
  mediaFileCount: number;
  /** 包版本 */
  version: PackageVersion;
}

/** 导入进度事件 */
export type ImportProgress =
  | { kind: 'extracting' }
  | { kind: 'validating' }
  | { kind: 'gathering' }
  | { kind: 'media'; current: number; total: number }
  | { kind: 'mediaCheck'; current: number; total: number };

/** 导入进度回调 */
export type ProgressCallback = (progress: ImportProgress) => void;

/** 导入错误类型 */
export class ImportError extends Error {
  constructor(
    message: string,
    public readonly code: ImportErrorCode,
  ) {
    super(message);
    this.name = 'ImportError';
  }
}

export enum ImportErrorCode {
  /** 包损坏或不完整 */
  Corrupt = 'CORRUPT',
  /** 版本太新, 不支持 */
  TooNew = 'TOO_NEW',
  /** 未找到支持的集合文件 */
  NoCollection = 'NO_COLLECTION',
  /** 媒体导入失败 */
  MediaImportFailed = 'MEDIA_IMPORT_FAILED',
  /** 文件名不安全 */
  UnsafeFilename = 'UNSAFE_FILENAME',
  /** 文件操作失败 */
  FileOperationFailed = 'FILE_OPERATION_FAILED',
  /** 数据库完整性检查失败 */
  IntegrityCheckFailed = 'INTEGRITY_CHECK_FAILED',
}
