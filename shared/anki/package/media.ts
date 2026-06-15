/**
 * Anki .apkg 媒体文件处理
 *
 * 对应 Rust: rslib/src/import_export/package/media.rs (SafeMediaEntry, safe_normalized_file_name)
 *          rslib/src/media/files/ (normalize_filename, filename_is_safe)
 */

import type { ZipArchive, DeflateDecoder } from './zip.ts';
import { readEntryText, readEntryData } from './zip.ts';
import {
  type MediaEntry,
  ImportError,
  ImportErrorCode,
  PackageVersion,
} from './types.ts';

// ─── 文件名安全 ───

/** Windows/NTFS 不允许的文件名 */
const UNSAFE_FILENAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

/** 文件名中不允许的字符 (含 DEL \x7f) */
const UNSAFE_CHARS_REGEX = /[<>:"/\\|?*\x00-\x1f\x7f]/;

/**
 * 检查文件名对于给定平台是否安全。
 * 对应 Rust `filename_is_safe()`
 */
export function isFilenameSafe(name: string): boolean {
  if (name.length === 0) return false;
  if (name === '.' || name === '..') return false;
  if (name.includes('/') || name.includes('\\')) return false;

  // Windows 保留名称
  const upper = name.toUpperCase();
  // 无扩展名的保留名
  if (UNSAFE_FILENAMES.has(upper)) return false;
  // 带扩展名的保留名 (如 CON.txt)
  const dotIdx = upper.indexOf('.');
  if (dotIdx > 0 && UNSAFE_FILENAMES.has(upper.substring(0, dotIdx))) return false;

  // 禁止字符
  if (UNSAFE_CHARS_REGEX.test(name)) return false;

  // 不以空格或点结尾 (Windows 限制)
  if (name.endsWith(' ') || name.endsWith('.')) return false;

  return true;
}

// ─── 文件名规范化 ───

/**
 * NFC 规范化文件名。
 * Anki 要求所有媒体文件名使用 NFC 格式 (Mac 使用 NFD)。
 * 对于 NFD 输入，转为 NFC；对于已安全的 NFC 名，返回原名。
 *
 * 对应 Rust `normalize_filename()`
 */
export function normalizeFilename(name: string): string {
  // 尝试 NFC 规范化 (JS 默认使用 NFC)
  const nfc = name.normalize('NFC');
  if (nfc !== name) {
    // 输入可能是 NFD → 转为 NFC
    // 检查 NFD 字符特征
    const nfd = name.normalize('NFD');
    if (nfd.length !== name.length) {
      // 已经是 NFD，转 NFC
      return nfc;
    }
  }
  return name;
}

/**
 * 验证并规范化文件名。
 * 返回规范化后的文件名，如果文件名不安全则抛出异常。
 *
 * 对应 Rust `safe_normalized_file_name()`
 */
export function safeNormalizeFilename(name: string): string {
  const normalized = normalizeFilename(name);
  if (!isFilenameSafe(normalized)) {
    throw new ImportError(
      `Unsafe media filename: '${name}'`,
      ImportErrorCode.UnsafeFilename,
    );
  }
  return normalized;
}

// ─── 媒体映射解析 ───

/**
 * 解析 legacy 媒体映射 (JSON 格式)。
 *
 * Legacy .apkg 中 `media` 文件是 JSON: {"0": "filename1.jpg", "1": "filename2.png"}
 * 键是 ZIP 中的数字序号，值是预期的文件名。
 *
 * 对应 Rust `SafeMediaEntry::from_legacy()`
 *
 * @param json 媒体映射 JSON 字符串
 * @returns 规范化后的媒体条目列表
 * @throws ImportError 如果文件名不安全
 */
export function parseLegacyMediaMap(json: string): MediaEntry[] {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ImportError('Failed to parse media map JSON', ImportErrorCode.Corrupt);
  }

  const entries: MediaEntry[] = [];

  for (const [zipEntryName, rawFilename] of Object.entries(parsed)) {
    if (typeof rawFilename !== 'string') continue;

    // 验证 ZIP 条目名是数字
    const zipIndex = Number(zipEntryName);
    if (!Number.isFinite(zipIndex)) continue;

    try {
      const normalized = safeNormalizeFilename(rawFilename);
      entries.push({
        zipEntryName,
        filename: normalized,
        size: 0,
      });
    } catch {
      // 跳过不安全的文件名
      continue;
    }
  }

  // 按序号排序
  entries.sort((a, b) => Number(a.zipEntryName) - Number(b.zipEntryName));

  return entries;
}

/**
 * 解析新 protobuf 媒体映射。
 *
 * 新格式使用了 Protocol Buffers (MediaEntries message)，暂未完整实现。
 * 这里返回空列表，后续可扩展。
 */
export function parseProtobufMediaMap(_data: Uint8Array): MediaEntry[] {
  // TODO: 实现 protobuf MediaEntries 解析
  // message MediaEntries { repeated MediaEntry entries = 1; }
  // message MediaEntry {
  //   string name = 1;
  //   uint32 size = 2;
  //   bytes sha1 = 3;
  // }
  return [];
}

// ─── 媒体文件提取 ───

/**
 * 从 ZIP 归档中提取单个媒体文件数据。
 *
 * @param archive ZIP 归档
 * @param zipEntryName ZIP 中的条目名
 * @param fileBytes 完整文件字节
 * @param decoder 可选的 deflate 解压器
 * @returns 媒体文件数据
 */
export function extractMediaFile(
  archive: ZipArchive,
  zipEntryName: string,
  fileBytes: Uint8Array,
  decoder?: DeflateDecoder,
): Uint8Array | undefined {
  const entry = archive.findEntry(zipEntryName);
  if (!entry) return undefined;

  try {
    return readEntryData(entry, fileBytes, decoder);
  } catch {
    return undefined;
  }
}

/**
 * 获取媒体映射数据 (原始 JSON 或 protobuf 字节)。
 * Legacy 版返回 JSON 字符串；新版返回 protobuf 字节。
 */
export function readMediaMap(
  archive: ZipArchive,
  version: PackageVersion,
  fileBytes: Uint8Array,
  decoder?: DeflateDecoder,
): { raw: Uint8Array; isJson: boolean } | undefined {
  const entry = archive.findEntry('media');
  if (!entry) return undefined;

  const data = readEntryData(entry, fileBytes, decoder);
  const isLegacy = version === PackageVersion.Legacy1 || version === PackageVersion.Legacy2;
  return { raw: data, isJson: isLegacy };
}

/**
 * 从 ZIP 归档中解析完整的媒体条目列表。
 *
 * @returns 媒体条目数组 (可能为空)
 */
export function parseMediaEntries(
  archive: ZipArchive,
  version: PackageVersion,
  fileBytes: Uint8Array,
  decoder?: DeflateDecoder,
): MediaEntry[] {
  const mapData = readMediaMap(archive, version, fileBytes, decoder);
  if (!mapData) return [];

  if (mapData.isJson) {
    const text = new TextDecoder().decode(mapData.raw);
    return parseLegacyMediaMap(text);
  }

  return parseProtobufMediaMap(mapData.raw);
}

/**
 * 清理文件名 — 仅替换常见危险字符为下划线。
 * 用于处理从旧版 apkg 导入的非标准命名文件。
 */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/^\.+$/, '_')
    .trimEnd();
}
