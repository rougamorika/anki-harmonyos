/**
 * .apkg ZIP 读取器 — 直接解析 ZIP 中央目录并提取文件
 *
 * 替代 zlib.decompressFile 方案。
 * .apkg 本质是标准 ZIP 文件，通过解析其结构即可提取 collection.anki2 和媒体文件。
 */

import { fileIo } from '@kit.CoreFileKit';
import zlib from '@ohos.zlib';

// ─── 类型 ───

export interface ZipEntry {
  filename: string;
  uncompressedSize: number;
  compressedSize: number;
  compressionMethod: number;    // 0=Store, 8=Deflate
  dataOffset: number;           // 本地文件头后数据起始偏移
}

export interface ApkgContents {
  collectionData: Uint8Array;
  collectionFilename: string;
  mediaEntries: MediaFileEntry[];
}

export interface MediaFileEntry {
  zipEntryName: string;
  filename: string;
  data: Uint8Array;
}

// ─── 常量 ───

let SIG_LOCAL_FILE_HEADER: number = 0x04034b50;
let SIG_CENTRAL_DIRECTORY: number = 0x02014b50;
let SIG_EOCD: number = 0x06054b50;

let COLLECTION_CANDIDATES: string[] = ['collection.anki21b', 'collection.anki21', 'collection.anki2'];
let MEDIA_MAP_NAME: string = 'media';

// ─── 二进制读取 ───

function readUint16LE(buf: ArrayBuffer, offset: number): number {
  let dv: DataView = new DataView(buf);
  return dv.getUint16(offset, true);
}

function readUint32LE(buf: ArrayBuffer, offset: number): number {
  let dv: DataView = new DataView(buf);
  return dv.getUint32(offset, true);
}

// ─── 主入口 ───

export class ApkgReaderService {
  /**
   * 从 .apkg 文件路径读取并提取内容
   */
  readApkg(path: string): ApkgContents {
    let stat = fileIo.statSync(path);
    let fileSize: number = stat.size;

    // 1. 读取文件末尾 64KB 来定位 EOCD
    let tailSize: number = Math.min(65536, fileSize);
    let tailBuf: ArrayBuffer = new ArrayBuffer(tailSize);
    let fd: File = fileIo.openSync(path);
    let tailOffset: number = fileSize - tailSize;
    fileIo.readSync(fd.fd, tailBuf, { offset: Number(tailOffset), length: tailSize });
    fileIo.closeSync(fd);

    // 2. 找到 EOCD 并解析中央目录
    let eocdOffset: number = this.findEocdOffset(tailBuf, tailOffset);
    let centralDirOffset: number = readUint32LE(tailBuf, eocdOffset - tailOffset + 16);
    let totalEntries: number = readUint16LE(tailBuf, eocdOffset - tailOffset + 10);
    let centralDirSize: number = readUint32LE(tailBuf, eocdOffset - tailOffset + 12);

    // 3. 读取中央目录
    let cdBuf: ArrayBuffer = new ArrayBuffer(centralDirSize);
    fd = fileIo.openSync(path);
    fileIo.readSync(fd.fd, cdBuf, { offset: Number(centralDirOffset), length: centralDirSize });

    // 4. 解析所有条目
    let entries: ZipEntry[] = [];
    let cursor: number = 0;
    while (cursor < centralDirSize && entries.length < totalEntries) {
      if (readUint32LE(cdBuf, cursor) !== SIG_CENTRAL_DIRECTORY) break;

      let compressionMethod: number = readUint16LE(cdBuf, cursor + 10);
      let compressedSize: number = readUint32LE(cdBuf, cursor + 20);
      let uncompressedSize: number = readUint32LE(cdBuf, cursor + 24);
      let filenameLen: number = readUint16LE(cdBuf, cursor + 28);
      let extraFieldLen: number = readUint16LE(cdBuf, cursor + 30);
      let commentLen: number = readUint16LE(cdBuf, cursor + 32);
      let localHeaderOffset: number = readUint32LE(cdBuf, cursor + 42);

      // 读取文件名
      let fnBytes: Uint8Array = new Uint8Array(cdBuf.slice(cursor + 46, cursor + 46 + filenameLen));
      let filename: string = this.decodeUtf8(fnBytes).replace(/\\/g, '/');

      if (!filename.endsWith('/') && !filename.endsWith('\\')) {
        // 读取本地文件头中的文件名和 extra field 长度 (用于计算 dataOffset)
        let lhBuf: ArrayBuffer = new ArrayBuffer(30);
        fileIo.readSync(fd.fd, lhBuf, { offset: Number(localHeaderOffset), length: 30 });
        let localFilenameLen: number = readUint16LE(lhBuf, 26);
        let localExtraFieldLen: number = readUint16LE(lhBuf, 28);
        let dataOffset: number = localHeaderOffset + 30 + localFilenameLen + localExtraFieldLen;

        let entry: ZipEntry = {
          filename: filename,
          uncompressedSize: uncompressedSize,
          compressedSize: compressedSize,
          compressionMethod: compressionMethod,
          dataOffset: dataOffset,
        };
        entries.push(entry);
      }

      cursor += 46 + filenameLen + extraFieldLen + commentLen;
    }

    // 5. 提取集合文件和媒体映射
    let collectionData: Uint8Array = new Uint8Array(0);
    let collectionFilename: string = '';
    let mediaMapRaw: string = '';

    // 先提取 media 映射 (JSON)
    for (let i: number = 0; i < entries.length; i++) {
      let e: ZipEntry = entries[i];
      if (e.filename === MEDIA_MAP_NAME) {
        let raw: Uint8Array = this.readEntryData(fd, e);
        mediaMapRaw = this.decodeUtf8(raw);
      }
    }

    // 提取集合文件 (优先级: anki21b > anki21 > anki2)
    for (let ci: number = 0; ci < COLLECTION_CANDIDATES.length; ci++) {
      let candidate: string = COLLECTION_CANDIDATES[ci];
      for (let i: number = 0; i < entries.length; i++) {
        let e: ZipEntry = entries[i];
        if (e.filename === candidate) {
          collectionData = this.readEntryData(fd, e);
          collectionFilename = candidate;
          break;
        }
      }
      if (collectionData.length > 0) break;
    }

    fileIo.closeSync(fd);

    if (collectionData.length === 0) {
      throw new Error('No valid collection file found in .apkg');
    }

    // 6. 解析媒体映射并提取媒体文件
    let mediaEntries: MediaFileEntry[] = [];
    if (mediaMapRaw.length > 0) {
      let map: Record<string, string> = JSON.parse(mediaMapRaw) as Record<string, string>;
      let mapKeys: string[] = Object.keys(map);

      fd = fileIo.openSync(path);
      for (let i: number = 0; i < mapKeys.length; i++) {
        let key: string = mapKeys[i];
        let filename: string = map[key];
        for (let j: number = 0; j < entries.length; j++) {
          let e: ZipEntry = entries[j];
          if (e.filename === key) {
            let data: Uint8Array = this.readEntryData(fd, e);
            let me: MediaFileEntry = { zipEntryName: key, filename: filename, data: data };
            mediaEntries.push(me);
            break;
          }
        }
      }
      fileIo.closeSync(fd);
    }

    let result: ApkgContents = {
      collectionData: collectionData,
      collectionFilename: collectionFilename,
      mediaEntries: mediaEntries,
    };
    return result;
  }

  // ─── 内部方法 ───

  private findEocdOffset(tailBuf: ArrayBuffer, baseOffset: number): number {
    let searchStart: number = Math.max(0, tailBuf.byteLength - 22 - 0xffff);
    for (let i: number = tailBuf.byteLength - 4; i >= searchStart; i--) {
      if (readUint32LE(tailBuf, i) === SIG_EOCD) {
        return baseOffset + i;
      }
    }
    throw new Error('Invalid .apkg: EOCD record not found');
  }

  private readEntryData(fd: File, entry: ZipEntry): Uint8Array {
    if (entry.compressedSize === 0) {
      return new Uint8Array(0);
    }

    let rawBuf: ArrayBuffer = new ArrayBuffer(entry.compressedSize);
    fileIo.readSync(fd.fd, rawBuf, { offset: Number(entry.dataOffset), length: entry.compressedSize });
    let raw: Uint8Array = new Uint8Array(rawBuf);

    if (entry.compressionMethod === 0) {
      // Store — 直接返回
      return raw;
    }

    if (entry.compressionMethod === 8) {
      // Deflate — 使用 @ohos.zlib 解压
      let decompressed: Uint8Array = zlib.decompressSync(raw, undefined, entry.uncompressedSize);
      return decompressed;
    }

    throw new Error('Unsupported compression method: ' + String(entry.compressionMethod));
  }

  private decodeUtf8(data: Uint8Array): string {
    let result: string = '';
    let i: number = 0;
    while (i < data.length) {
      let b: number = data[i];
      if (b === undefined) break;
      i++;
      if (b < 0x80) {
        result += String.fromCharCode(b);
      } else if ((b & 0xE0) === 0xC0) {
        let b2: number = data[i] ?? 0; i++;
        result += String.fromCharCode(((b & 0x1F) << 6) | (b2 & 0x3F));
      } else if ((b & 0xF0) === 0xE0) {
        let b2: number = data[i] ?? 0; i++;
        let b3: number = data[i] ?? 0; i++;
        result += String.fromCharCode(((b & 0x0F) << 12) | ((b2 & 0x3F) << 6) | (b3 & 0x3F));
      } else {
        result += '?';
      }
    }
    return result;
  }
}

export const apkgReader: ApkgReaderService = new ApkgReaderService();
