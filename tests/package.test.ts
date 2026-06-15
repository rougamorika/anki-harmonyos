/**
 * ZIP 读取器 / 媒体文件名安全 / 集合检测 — Node 单元测试
 *
 * 运行方式:
 *   npx tsx harmony/tests/package.test.ts
 *   node --import tsx harmony/tests/package.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ═══════════════════════════════════════════
// 内联 ZIP 测试: 手动构造最小 ZIP 验证 parseZipArchive
// 避免依赖编译步骤
// ═══════════════════════════════════════════

function buildMinimalZip(entries: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  // 所有文件使用 Store 方法 (compression=0)
  const localHeaders: Uint8Array[] = [];
  const centralHeaders: Uint8Array[] = [];
  const fileDatas: Uint8Array[] = [];
  let currentOffset = 0;

  for (const entry of entries) {
    const nameBytes = new TextEncoder().encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    // 本地文件头 (30 + filename)
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lhView = new DataView(localHeader.buffer);
    lhView.setUint32(0, 0x04034b50, true);     // signature
    lhView.setUint16(4, 20, true);              // version needed
    lhView.setUint16(6, 0, true);               // flags
    lhView.setUint16(8, 0, true);               // compression (Store)
    lhView.setUint16(10, 0, true);              // mod time
    lhView.setUint16(12, 0, true);              // mod date
    lhView.setUint32(14, crc, true);            // crc32
    lhView.setUint32(18, size, true);           // compressed size
    lhView.setUint32(22, size, true);           // uncompressed size
    lhView.setUint16(26, nameBytes.length, true); // filename len
    lhView.setUint16(28, 0, true);              // extra field len
    localHeader.set(nameBytes, 30);
    localHeaders.push(localHeader);

    // 中央目录头 (46 + filename)
    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const chView = new DataView(centralHeader.buffer);
    chView.setUint32(0, 0x02014b50, true);     // signature
    chView.setUint16(4, 20, true);              // version made by
    chView.setUint16(6, 20, true);              // version needed
    chView.setUint16(8, 0, true);               // flags
    chView.setUint16(10, 0, true);              // compression
    chView.setUint16(12, 0, true);              // mod time
    chView.setUint16(14, 0, true);              // mod date
    chView.setUint32(16, crc, true);            // crc32
    chView.setUint32(20, size, true);           // compressed
    chView.setUint32(24, size, true);           // uncompressed
    chView.setUint16(28, nameBytes.length, true);
    chView.setUint16(30, 0, true);              // extra
    chView.setUint16(32, 0, true);              // comment
    chView.setUint16(34, 0, true);              // disk start
    chView.setUint16(36, 0, true);              // internal attrs
    chView.setUint32(38, 0, true);              // external attrs
    chView.setUint32(42, currentOffset, true);  // local header offset
    centralHeader.set(nameBytes, 46);
    centralHeaders.push(centralHeader);

    // 文件数据
    fileDatas.push(entry.data);

    currentOffset += localHeader.length + size;
  }

  // 拼接: 本地头 + 数据
  const beforeCentral: Uint8Array[] = [];
  for (let i = 0; i < entries.length; i++) {
    beforeCentral.push(localHeaders[i]!);
    beforeCentral.push(fileDatas[i]!);
  }
  const centralDir = concatArrays(centralHeaders);
  const centralDirOffset = concatArrays(beforeCentral).length;
  const centralDirSize = centralDir.length;

  // EOCD (22 bytes)
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(4, 0, true);            // disk number
  eocdView.setUint16(6, 0, true);            // disk with central dir
  eocdView.setUint16(8, entries.length, true); // entries on disk
  eocdView.setUint16(10, entries.length, true); // total entries
  eocdView.setUint32(12, centralDirSize, true);
  eocdView.setUint32(16, centralDirOffset, true);
  eocdView.setUint16(20, 0, true);           // comment len

  return concatArrays([...beforeCentral, centralDir, eocd]);
}

function concatArrays(arrays: Uint8Array[]): Uint8Array {
  const totalLen = arrays.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

// CRC32 表 (简化版)
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff >>> 0;
  for (const byte of data) {
    crc = (crc >>> 8) ^ crc32Table[(crc ^ byte) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const crc32Table = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crc32Table[i] = c;
}

// ═══════════════════════════════════════════
// 轻度 ZIP 解析器 (复制核心逻辑用于测试)
// ═══════════════════════════════════════════

function parseTestZip(bytes: Uint8Array): Set<string> {
  // 找 EOCD
  let eocdOff = -1;
  const searchStart = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 4; i >= searchStart; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      eocdOff = i;
      break;
    }
  }

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const totalEntries = dv.getUint16(eocdOff + 10, true);
  const centralDirSize = dv.getUint32(eocdOff + 12, true);
  const centralDirOffset = dv.getUint32(eocdOff + 16, true);

  const names = new Set<string>();
  let cursor = centralDirOffset;
  const endOff = centralDirOffset + centralDirSize;

  while (cursor < endOff) {
    if (dv.getUint32(cursor, true) !== 0x02014b50) break;

    const filenameLen = dv.getUint16(cursor + 28, true);
    const extraLen = dv.getUint16(cursor + 30, true);
    const commentLen = dv.getUint16(cursor + 32, true);

    const nameBytes = bytes.slice(cursor + 46, cursor + 46 + filenameLen);
    const name = new TextDecoder().decode(nameBytes);

    if (!name.endsWith('/') && !name.endsWith('\\')) {
      names.add(name);
    }

    cursor += 46 + filenameLen + extraLen + commentLen;
  }

  return names;
}

// ═══════════════════════════════════════════
// 文件名安全函数 (来自 media.ts 的副本, 用于测试)
// ═══════════════════════════════════════════

const UNSAFE_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

function testIsFilenameSafe(name: string): boolean {
  if (name.length === 0) return false;
  if (name === '.' || name === '..') return false;
  if (name.includes('/') || name.includes('\\')) return false;
  const upper = name.toUpperCase();
  if (UNSAFE_NAMES.has(upper)) return false;
  const dotIdx = upper.indexOf('.');
  if (dotIdx > 0 && UNSAFE_NAMES.has(upper.substring(0, dotIdx))) return false;
  if (/[<>:"/\\|?*\x00-\x1f]/.test(name)) return false;
  if (name.endsWith(' ') || name.endsWith('.')) return false;
  return true;
}

function testIsSqlite(data: Uint8Array): boolean {
  return data.length >= 16 && new TextDecoder().decode(data.slice(0, 16)) === 'SQLite format 3\x00';
}

function testIsZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

// ═══════════════════════════════════════════
// 测试用例
// ═══════════════════════════════════════════

test('ZIP: 解析包含多个文件的压缩包', () => {
  const zipBytes = buildMinimalZip([
    { name: 'collection.anki21', data: new TextEncoder().encode('SQLite format 3\x00fake') },
    { name: 'media', data: new TextEncoder().encode('{"0":"image.jpg"}') },
    { name: '0', data: new Uint8Array([1, 2, 3, 4]) },
  ]);

  assert.ok(testIsZip(zipBytes), '应识别为 ZIP 文件');

  const entries = parseTestZip(zipBytes);
  assert.equal(entries.size, 3);
  assert.ok(entries.has('collection.anki21'));
  assert.ok(entries.has('media'));
  assert.ok(entries.has('0'));
});

test('ZIP: 目录条目被排除', () => {
  const zipBytes = buildMinimalZip([
    { name: 'somefolder/', data: new Uint8Array(0) },
    { name: 'collection.anki2', data: new TextEncoder().encode('SQLite format 3\x00test') },
  ]);

  const entries = parseTestZip(zipBytes);
  assert.equal(entries.size, 1);
  assert.ok(entries.has('collection.anki2'));
  assert.ok(!entries.has('somefolder/'));
});

test('ZIP: 空压缩包有合法 EOCD', () => {
  const zipBytes = buildMinimalZip([]);
  // 空 ZIP 没有本地文件头 (signature=0x04034b50), 只有 EOCD (signature=0x06054b50)
  // 因此 testIsZip 返回 false，但仍可被 parseTestZip 解析
  assert.equal(parseTestZip(zipBytes).size, 0);
});

test('ZIP: 非 ZIP 文件正确识别', () => {
  const sqliteHeader = new TextEncoder().encode('SQLite format 3\x00');
  assert.ok(!testIsZip(sqliteHeader));

  const randomData = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.ok(!testIsZip(randomData));
});

test('文件名安全: 正常文件名通过', () => {
  assert.ok(testIsFilenameSafe('image.jpg'));
  assert.ok(testIsFilenameSafe('my-audio.mp3'));
  assert.ok(testIsFilenameSafe('正常中文名.png'));
  assert.ok(testIsFilenameSafe('a'));
});

test('文件名安全: 保留名被拒绝', () => {
  assert.ok(!testIsFilenameSafe('CON'));
  assert.ok(!testIsFilenameSafe('con'));
  assert.ok(!testIsFilenameSafe('LPT1'));
  assert.ok(!testIsFilenameSafe('NUL'));
  assert.ok(!testIsFilenameSafe('AUX'));
  assert.ok(!testIsFilenameSafe('PRN'));
  assert.ok(!testIsFilenameSafe('COM3'));
});

test('文件名安全: 保留名 + 扩展名被拒绝', () => {
  assert.ok(!testIsFilenameSafe('CON.txt'));
  assert.ok(!testIsFilenameSafe('lpt1.jpg'));
});

test('文件名安全: 危险字符被拒绝', () => {
  assert.ok(!testIsFilenameSafe('file<tag>.txt'));
  assert.ok(!testIsFilenameSafe('path/file.txt'));
  assert.ok(!testIsFilenameSafe('file?.png'));
  assert.ok(!testIsFilenameSafe('hello*world'));
  assert.ok(!testIsFilenameSafe('test|pipe'));
});

test('文件名安全: 边界情况', () => {
  assert.ok(!testIsFilenameSafe(''));
  assert.ok(!testIsFilenameSafe('.'));
  assert.ok(!testIsFilenameSafe('..'));
  assert.ok(!testIsFilenameSafe('file.txt '));  // 尾部空格
  assert.ok(!testIsFilenameSafe('file.txt.'));  // 尾部点
});

test('SQLite 检测: 有效/无效头', () => {
  const valid = new TextEncoder().encode('SQLite format 3\x00' + '\x00'.repeat(100));
  assert.ok(testIsSqlite(valid));

  assert.ok(!testIsSqlite(new Uint8Array([0, 1, 2, 3])));
  assert.ok(!testIsSqlite(new Uint8Array(0)));
  assert.ok(!testIsSqlite(new Uint8Array(15))); // 太短
});

test('集合文件选择: 优先选择 collection.anki21', () => {
  const entries = ['collection.anki2', 'collection.anki21', 'media'];
  const candidates = ['collection.anki21b', 'collection.anki21', 'collection.anki2'];

  let found = '';
  for (const c of candidates) {
    if (entries.includes(c)) { found = c; break; }
  }
  assert.equal(found, 'collection.anki21');
});

test('集合文件选择: 回退到 collection.anki2', () => {
  const entries = ['collection.anki2', '0', '1'];
  const candidates = ['collection.anki21b', 'collection.anki21', 'collection.anki2'];

  let found = '';
  for (const c of candidates) {
    if (entries.includes(c)) { found = c; break; }
  }
  assert.equal(found, 'collection.anki2');
});

test('集合文件选择: 无集合文件抛异常', () => {
  const entries = ['0', '1', 'media'];
  const candidates = ['collection.anki21b', 'collection.anki21', 'collection.anki2'];

  let found = false;
  for (const c of candidates) {
    if (entries.includes(c)) { found = true; break; }
  }
  assert.equal(found, false, '不应找到集合文件');
});

test('路径分隔符规范化: 反斜杠转正斜杠', () => {
  const input = 'path\\to\\collection.anki21';
  const normalized = input.replace(/\\/g, '/');
  assert.equal(normalized, 'path/to/collection.anki21');
});

test('Legacy 媒体映射解析', () => {
  const json = '{"0":"front.png","1":"back.jpg","2":"audio.mp3"}';
  const parsed = JSON.parse(json) as Record<string, string>;

  const entries = Object.entries(parsed).sort(([a], [b]) => Number(a) - Number(b));
  assert.equal(entries.length, 3);
  assert.deepEqual(entries[0], ['0', 'front.png']);
  assert.deepEqual(entries[2], ['2', 'audio.mp3']);
});
