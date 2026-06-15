/**
 * 轻量级 ZIP 文件读取器 (纯 TypeScript, 无平台依赖)
 *
 * 用于解析 .apkg (ZIP 格式) 中的文件条目。
 * 支持 Store(0) 和 Deflate(8) 压缩方法。
 *
 * ZIP 格式参考: APPNOTE.TXT (PKWARE)
 */

export interface ZipEntry {
  /** 文件名 (已规范化路径分隔符) */
  filename: string;
  /** 未压缩大小 */
  uncompressedSize: number;
  /** 压缩大小 */
  compressedSize: number;
  /** 压缩方法: 0=Store, 8=Deflate */
  compressionMethod: number;
  /** CRC32 校验值 */
  crc32: number;
  /** 在文件中的偏移量 (本地文件头之后的数据起始位置) */
  dataOffset: number;
}

export interface ZipArchive {
  /** 所有条目列表 (仅文件名安全、不属于目录的条目) */
  entries: ZipEntry[];
  /** 获取条目的原始数据 (不解压) */
  getRawData(entry: ZipEntry, fileBytes: Uint8Array): Uint8Array;
  /** 获取条目名称列表 */
  getEntryNames(): string[];
  /** 按名称查找条目 */
  findEntry(name: string): ZipEntry | undefined;
}

/** Deflate 解压器接口 (由平台层实现) */
export interface DeflateDecoder {
  /** 解压 deflate 压缩数据 */
  decompress(compressed: Uint8Array, uncompressedSize: number): Uint8Array;
}

// ─── 常量 ───

const SIG_LOCAL_FILE_HEADER = 0x04034b50;
const SIG_CENTRAL_DIRECTORY = 0x02014b50;
const SIG_EOCD = 0x06054b50;

const TEXT_DECODER = new TextDecoder('utf-8');
const TEXT_ENCODER = new TextEncoder();

// ─── 文件路径工具 ───

function normalizePathSeparator(filename: Uint8Array): string {
  return TEXT_DECODER.decode(filename).replace(/\\/g, '/');
}

function isDirectory(filename: string): boolean {
  return filename.endsWith('/') || filename.endsWith('\\');
}

// ─── 二进制读取工具 ───

function readUint16LE(buf: Uint8Array, offset: number): number {
  return buf[offset] | (buf[offset + 1] << 8);
}

function readUint32LE(buf: Uint8Array, offset: number): number {
  return (
    buf[offset] |
    (buf[offset + 1] << 8) |
    (buf[offset + 2] << 16) |
    (buf[offset + 3] << 24)
  ) >>> 0;
}

// ─── EOCD 扫描 ───

/**
 * 从字节数组中搜索 EOCD 签名。
 * EOCD 位于文件末尾附近，可能带有注释。
 */
function findEocdOffset(bytes: Uint8Array): number {
  const maxCommentLen = 0xffff;
  const searchStart = Math.max(0, bytes.length - 22 - maxCommentLen);
  const searchEnd = bytes.length - 4;

  for (let i = searchEnd; i >= searchStart; i--) {
    if (readUint32LE(bytes, i) === SIG_EOCD) {
      return i;
    }
  }
  throw new Error('Invalid ZIP: EOCD not found');
}

// ─── ZIP 解析 ───

/**
 * 从原始字节数组解析 ZIP 文件结构。
 * 仅解析中央目录以获取条目列表。
 */
export function parseZipArchive(bytes: Uint8Array): ZipArchive {
  const eocdOffset = findEocdOffset(bytes);

  // 从 EOCD 读取中央目录信息
  const totalEntries = readUint16LE(bytes, eocdOffset + 10);
  const centralDirSize = readUint32LE(bytes, eocdOffset + 12);
  const centralDirOffset = readUint32LE(bytes, eocdOffset + 16);

  if (totalEntries === 0) {
    return { entries: [], getRawData, getEntryNames: () => [], findEntry: () => undefined };
  }

  // 解析中央目录中的所有条目
  const entries: ZipEntry[] = [];
  let cursor = centralDirOffset;
  const endOffset = centralDirOffset + centralDirSize;

  while (cursor < endOffset) {
    if (readUint32LE(bytes, cursor) !== SIG_CENTRAL_DIRECTORY) {
      break;
    }

    const compressionMethod = readUint16LE(bytes, cursor + 10);
    const crc32 = readUint32LE(bytes, cursor + 16);
    const compressedSize = readUint32LE(bytes, cursor + 20);
    const uncompressedSize = readUint32LE(bytes, cursor + 24);
    const filenameLen = readUint16LE(bytes, cursor + 28);
    const extraFieldLen = readUint16LE(bytes, cursor + 30);
    const commentLen = readUint16LE(bytes, cursor + 32);

    // 读取本地文件头偏移量 (需要先读取本地文件头以定位数据)
    const localHeaderOffset = readUint32LE(bytes, cursor + 42);

    // 读取文件名
    const filenameBytes = bytes.slice(cursor + 46, cursor + 46 + filenameLen);
    const filename = normalizePathSeparator(filenameBytes);

    // 跳过目录条目和不安全的文件名
    if (!isDirectory(filename)) {
      // 计算数据在文件中的偏移量
      // 本地文件头: 30 字节固定 + filename + extra field → data
      const localFilenameLen = readUint16LE(bytes, localHeaderOffset + 26);
      const localExtraFieldLen = readUint16LE(bytes, localHeaderOffset + 28);
      const dataOffset = localHeaderOffset + 30 + localFilenameLen + localExtraFieldLen;

      entries.push({
        filename,
        uncompressedSize,
        compressedSize,
        compressionMethod,
        crc32,
        dataOffset,
      });
    }

    cursor += 46 + filenameLen + extraFieldLen + commentLen;
  }

  return {
    entries,
    getRawData,
    getEntryNames: () => entries.map((e) => e.filename),
    findEntry: (name: string) => entries.find((e) => e.filename === name),
  };
}

function getRawData(entry: ZipEntry, fileBytes: Uint8Array): Uint8Array {
  return fileBytes.slice(entry.dataOffset, entry.dataOffset + entry.compressedSize);
}

/**
 * 从 ZIP 条目中读取解压后的数据。
 * @param entry ZIP 条目
 * @param fileBytes 完整文件字节
 * @param decoder Deflate 解压器 (Store 方法不需要)
 */
export function readEntryData(
  entry: ZipEntry,
  fileBytes: Uint8Array,
  decoder?: DeflateDecoder,
): Uint8Array {
  const raw = getRawData(entry, fileBytes);

  if (entry.compressionMethod === 0) {
    return raw;
  }

  if (entry.compressionMethod === 8) {
    if (!decoder) {
      throw new Error('Deflate decoder is required for compressed entries');
    }
    return decoder.decompress(raw, entry.uncompressedSize);
  }

  throw new Error(`Unsupported compression method: ${entry.compressionMethod}`);
}

/**
 * 读取 ZIP 条目并转换为 UTF-8 字符串
 */
export function readEntryText(
  entry: ZipEntry,
  fileBytes: Uint8Array,
  decoder?: DeflateDecoder,
): string {
  const data = readEntryData(entry, fileBytes, decoder);
  return TEXT_DECODER.decode(data);
}

/**
 * 测试一个字节数组是否是有效的 ZIP 文件。
 * 检查前 4 字节: 本地文件头 (0x04034b50) 或 空压缩包的 EOCD (0x06054b50)。
 */
export function isZipFile(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const sig = readUint32LE(bytes, 0);
  return sig === SIG_LOCAL_FILE_HEADER || sig === SIG_EOCD;
}
