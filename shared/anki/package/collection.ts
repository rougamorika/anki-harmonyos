/**
 * Anki 集合文件（collection DB）的检测、提取与验证
 *
 * 对应 Rust: rslib/src/import_export/package/meta.rs (VersionExt, MetaExt)
 *          rslib/src/import_export/package/colpkg/import.rs (check_collection_and_mod_schema)
 */

import type { ZipArchive, ZipEntry, DeflateDecoder } from './zip.ts';
import { readEntryData } from './zip.ts';
import {
  type CollectionSelection,
  type PackageMeta,
  COLLECTION_CANDIDATES,
  ImportError,
  ImportErrorCode,
  PackageVersion,
} from './types.ts';

// ─── 版本检测 ───

/** 尝试从 ZIP 中的 meta 文件解析 protobuf 元数据 */
function tryParseProtobufMeta(data: Uint8Array): PackageMeta | undefined {
  // protobuf 结构简单时的最小解析:
  // message Meta { int32 version = 1; }
  // wire type 0 (varint) for field 1, tag = (1 << 3) | 0 = 8
  let offset = 0;
  while (offset < data.length) {
    const tag = data[offset];
    if (tag === undefined) break;
    offset++;

    const fieldNumber = tag >> 3;
    const wireType = tag & 0x07;

    if (wireType === 0) {
      // varint
      let value = 0;
      let shift = 0;
      while (offset < data.length) {
        const byte = data[offset];
        if (byte === undefined) break;
        offset++;
        value |= (byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) break;
        shift += 7;
      }
      if (fieldNumber === 1) {
        return { version: value as PackageVersion };
      }
    } else if (wireType === 2) {
      // length-delimited
      let length = 0;
      let shift = 0;
      while (offset < data.length) {
        const byte = data[offset];
        if (byte === undefined) break;
        offset++;
        length |= (byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) break;
        shift += 7;
      }
      offset += length;
    } else {
      // skip unknown wire types
      break;
    }
  }
  return undefined;
}

/**
 * 从 ZIP 归档中检测包版本。
 *
 * 检测策略 (对应 Rust `Meta::from_archive`):
 * 1. 查找 "meta" protobuf 文件 → 如果 version 为 Unknown/0 → 版本太新
 * 2. 无 meta 文件 → 检查 collection.anki21 存在 → Legacy2; 否则 Legacy1
 */
export function detectPackageVersion(archive: ZipArchive): PackageMeta {
  const metaEntry = archive.findEntry('meta');
  if (metaEntry) {
    try {
      const metaBytes = archive.getRawData(metaEntry, new Uint8Array(0));
      // 需要外部传入完整 bytes，这里仅作占位 —
      // 实际解析在 detectFromRawBytes 中完成
    } catch {
      // 忽略
    }
  }

  // 无 meta 文件 → 根据存在的集合文件判断
  if (archive.findEntry('collection.anki21') || archive.findEntry('collection.anki21b')) {
    return { version: PackageVersion.Legacy2 };
  }
  return { version: PackageVersion.Legacy1 };
}

/**
 * 从原始 ZIP 字节中检测包版本（完整实现，需要文件数据来解析 meta protobuf）
 */
export function detectPackageVersionFromBytes(
  archive: ZipArchive,
  fileBytes: Uint8Array,
): PackageMeta {
  const metaEntry = archive.findEntry('meta');
  if (metaEntry) {
    const rawMeta = archive.getRawData(metaEntry, fileBytes);
    const parsed = tryParseProtobufMeta(rawMeta);
    if (parsed) {
      if (parsed.version === 0) {
        throw new ImportError('Package version too new; this application does not support it.', ImportErrorCode.TooNew);
      }
      return parsed;
    }
    // 有 meta 文件但解析失败 — 仍视为最新版
    return { version: PackageVersion.Latest };
  }

  // 无 meta → legacy 检测
  if (archive.findEntry('collection.anki21') || archive.findEntry('collection.anki21b')) {
    return { version: PackageVersion.Legacy2 };
  }
  return { version: PackageVersion.Legacy1 };
}

// ─── 集合文件选择 ───

/**
 * 从 ZIP 归档中选择集合文件。
 * 按优先级: collection.anki21b > collection.anki21 > collection.anki2
 *
 * 对应 Rust `selectCollectionFile()` 和 `MetaExt::collection_filename()`
 */
export function selectCollectionFile(archive: ZipArchive, meta: PackageMeta): CollectionSelection {
  // 根据版本确定期望的集合文件名
  let expectedFile: string;
  switch (meta.version) {
    case PackageVersion.Latest:
      expectedFile = 'collection.anki21b';
      break;
    case PackageVersion.Legacy2:
      expectedFile = 'collection.anki21';
      break;
    case PackageVersion.Legacy1:
    default:
      expectedFile = 'collection.anki2';
      break;
  }

  const collectionEntry = archive.findEntry(expectedFile);
  if (!collectionEntry) {
    // 回退: 按候选列表逐个查找
    for (const candidate of COLLECTION_CANDIDATES) {
      if (archive.findEntry(candidate)) {
        return {
          collectionFile: candidate,
          hasMetaFile: meta.version === PackageVersion.Latest,
          hasMediaMap: archive.findEntry('media') !== undefined,
          zstdCompressed: meta.version === PackageVersion.Latest,
        };
      }
    }
    throw new ImportError(
      'No supported Anki collection file found in package. Expected one of: ' + COLLECTION_CANDIDATES.join(', '),
      ImportErrorCode.NoCollection,
    );
  }

  return {
    collectionFile: expectedFile,
    hasMetaFile: meta.version === PackageVersion.Latest,
    hasMediaMap: archive.findEntry('media') !== undefined,
    zstdCompressed: meta.version === PackageVersion.Latest,
  };
}

/**
 * 从 ZIP 中选择集合文件（无需元数据，简单回退模式）。
 * 用于直接导入 .anki2/.anki21 文件或快速检测。
 */
export function selectCollectionFileFromNames(entryNames: string[]): CollectionSelection {
  const normalized = new Set(entryNames.map((n) => n.replace(/\\/g, '/')));
  for (const candidate of COLLECTION_CANDIDATES) {
    if (normalized.has(candidate)) {
      return {
        collectionFile: candidate,
        hasMetaFile: normalized.has('meta'),
        hasMediaMap: normalized.has('media'),
        zstdCompressed: candidate === 'collection.anki21b',
      };
    }
  }
  throw new ImportError(
    'No supported Anki collection file found. Expected one of: ' + COLLECTION_CANDIDATES.join(', '),
    ImportErrorCode.NoCollection,
  );
}

// ─── 集合提取 ───

/**
 * 从 ZIP 归档中提取集合并写入目标。
 *
 * @param archive ZIP 归档
 * @param selection 集合文件选择结果
 * @param fileBytes 完整 ZIP 字节
 * @param decoder 可选的 deflate 解压器
 * @returns 集合文件数据
 */
export function extractCollection(
  archive: ZipArchive,
  selection: CollectionSelection,
  fileBytes: Uint8Array,
  decoder?: DeflateDecoder,
): Uint8Array {
  const entry = archive.findEntry(selection.collectionFile);
  if (!entry) {
    throw new ImportError(
      `Collection file '${selection.collectionFile}' not found in archive`,
      ImportErrorCode.Corrupt,
    );
  }

  try {
    const data = readEntryData(entry, fileBytes, decoder);
    return data;
  } catch (cause) {
    throw new ImportError(
      `Failed to extract collection file: ${String(cause)}`,
      ImportErrorCode.Corrupt,
    );
  }
}

// ─── 集合验证 ───

/**
 * SQLite 数据库文件的最小验证。
 * SQLite 文件头: "SQLite format 3\0" (16 字节)
 *
 * @param data 数据库文件字节
 * @returns true 如果文件以有效的 SQLite 头开始
 */
export function looksLikeSqlite(data: Uint8Array): boolean {
  if (data.length < 16) return false;
  const header = new TextDecoder().decode(data.slice(0, 16));
  return header === 'SQLite format 3\x00';
}

/**
 * 验证提取的集合文件是否是有效的 SQLite 数据库。
 * 进行基本结构检查，不尝试打开文件。
 */
export function validateCollection(data: Uint8Array): void {
  if (!looksLikeSqlite(data)) {
    throw new ImportError(
      'Extracted collection file does not appear to be a valid SQLite database',
      ImportErrorCode.Corrupt,
    );
  }

  // SQLite 头结构检查:
  // offset 16: page size (2 bytes)
  // offset 18: file format write version (1 byte)
  // offset 19: file format read version (1 byte)
  // offset 52: "Write-Ahead Log" check
  const pageSize = (data[16] ?? 0) | ((data[17] ?? 0) << 8);
  if (pageSize === 0) {
    throw new ImportError(
      'Collection database has invalid page size (0)',
      ImportErrorCode.Corrupt,
    );
  }

  if (data.length < pageSize) {
    throw new ImportError(
      'Collection database is smaller than a single page',
      ImportErrorCode.Corrupt,
    );
  }
}
