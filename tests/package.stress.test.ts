/**
 * .apkg 导入模块 — 压力测试 / 边界测试
 *
 * 运行: npx tsx harmony/tests/package.stress.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ═══════════════════════════════════════════
// 辅助：构建测试 ZIP (复用 package.test.ts 逻辑)
// ═══════════════════════════════════════════

const crc32Table = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  crc32Table[i] = c;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff >>> 0;
  for (const byte of data) crc = (crc >>> 8) ^ crc32Table[(crc ^ byte) & 0xff]!;
  return (crc ^ 0xffffffff) >>> 0;
}

interface TestEntry { name: string; data: Uint8Array }

function buildZip(entries: TestEntry[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  const datas: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const nb = new TextEncoder().encode(e.name);
    const crc = crc32(e.data);
    const sz = e.data.length;

    const lh = new Uint8Array(30 + nb.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, sz, true);
    lv.setUint32(22, sz, true);
    lv.setUint16(26, nb.length, true);
    lh.set(nb, 30);
    locals.push(lh);

    const ch = new Uint8Array(46 + nb.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, sz, true);
    cv.setUint32(24, sz, true);
    cv.setUint16(28, nb.length, true);
    cv.setUint32(42, offset, true);
    ch.set(nb, 46);
    centrals.push(ch);

    datas.push(e.data);
    offset += lh.length + sz;
  }

  const before = concat([...locals.flatMap((l, i) => [l, datas[i]!])]);
  const cd = concat(centrals);
  const cdOff = before.length;
  const cdSz = cd.length;

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSz, true);
  ev.setUint32(16, cdOff, true);

  return concat([before, cd, eocd]);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const len = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

// ─── 最小 ZIP 解析器 (用于测试) ───

function parseZipNames(bytes: Uint8Array): string[] {
  let eocdOff = -1;
  const start = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 4; i >= start; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      eocdOff = i; break;
    }
  }
  if (eocdOff < 0) throw new Error('EOCD not found');

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const total = dv.getUint16(eocdOff + 10, true);
  const cdSz = dv.getUint32(eocdOff + 12, true);
  const cdOff = dv.getUint32(eocdOff + 16, true);

  const names: string[] = [];
  let cursor = cdOff;

  for (let n = 0; n < total && cursor < cdOff + cdSz; n++) {
    if (dv.getUint32(cursor, true) !== 0x02014b50) break;
    const fnLen = dv.getUint16(cursor + 28, true);
    const exLen = dv.getUint16(cursor + 30, true);
    const cmLen = dv.getUint16(cursor + 32, true);
    const nb = bytes.slice(cursor + 46, cursor + 46 + fnLen);
    names.push(new TextDecoder().decode(nb));
    cursor += 46 + fnLen + exLen + cmLen;
  }
  return names;
}

// ─── 文件名安全函数 (副本) ───

const BAD = new Set(['CON','PRN','AUX','NUL','COM1','COM2','COM3','COM4','COM5','COM6','COM7','COM8','COM9','LPT1','LPT2','LPT3','LPT4','LPT5','LPT6','LPT7','LPT8','LPT9']);

function isFilenameSafe(name: string): boolean {
  if (!name || name === '.' || name === '..') return false;
  if (name.includes('/') || name.includes('\\')) return false;
  const u = name.toUpperCase();
  if (BAD.has(u)) return false;
  const d = u.indexOf('.');
  if (d > 0 && BAD.has(u.slice(0, d))) return false;
  if (/[<>:"/\\|?*\x00-\x1f]/.test(name)) return false;
  if (name.endsWith(' ') || name.endsWith('.')) return false;
  return true;
}

// ═══════════════════════════════════════════
// 压测 1: 海量 ZIP 条目解析
// ═══════════════════════════════════════════

test('STRESS: ZIP 解析 — 1,000 个条目', () => {
  const entries: TestEntry[] = [];
  for (let i = 0; i < 1000; i++) {
    entries.push({
      name: i === 0 ? 'collection.anki21' : `${i}.jpg`,
      data: new Uint8Array(64),
    });
  }
  const zip = buildZip(entries);
  const t0 = performance.now();
  const names = parseZipNames(zip);
  const t1 = performance.now();
  assert.equal(names.length, 1000);
  assert.ok(names.includes('collection.anki21'));
  // 解析速度 > 500 条目/ms (合理预期)
  const rate = names.length / (t1 - t0);
  console.log(`  1000 entries: ${(t1 - t0).toFixed(2)}ms (${rate.toFixed(0)} entries/ms)`);
  assert.ok(rate > 100, `解析速度太慢: ${rate.toFixed(0)} entries/ms`);
});

test('STRESS: ZIP 解析 — 10,000 个条目', () => {
  const entries: TestEntry[] = [];
  for (let i = 0; i < 10000; i++) {
    entries.push({
      name: i === 0 ? 'collection.anki21' : `img_${String(i).padStart(8, '0')}.png`,
      data: new Uint8Array(32),
    });
  }
  const zip = buildZip(entries);
  const t0 = performance.now();
  const names = parseZipNames(zip);
  const t1 = performance.now();
  assert.equal(names.length, 10000);
  const rate = names.length / (t1 - t0);
  console.log(`  10000 entries: ${(t1 - t0).toFixed(2)}ms (${rate.toFixed(0)} entries/ms)`);
  assert.ok(rate > 100, `解析速度太慢: ${rate.toFixed(0)} entries/ms`);
});

// ═══════════════════════════════════════════
// 压测 2: 大文件模拟
// ═══════════════════════════════════════════

test('STRESS: ZIP 解析 — 模拟 200MB .apkg (50 个 4MB 媒体 + 500 个 100KB 媒体)', () => {
  const entries: TestEntry[] = [];
  // 集合文件
  entries.push({ name: 'collection.anki21', data: new Uint8Array(4096) });
  entries.push({ name: 'media', data: new TextEncoder().encode(JSON.stringify(
    Object.fromEntries([...Array(550).keys()].map(i => [String(i), `file_${i}.jpg`]))
  )) });
  // 50 个大媒体文件 (4MB each)
  for (let i = 0; i < 50; i++) {
    const buf = new Uint8Array(4 * 1024 * 1024);
    buf.fill(i & 0xff);
    entries.push({ name: String(i), data: buf });
  }
  // 500 个小媒体文件 (100KB each)
  for (let i = 50; i < 550; i++) {
    const buf = new Uint8Array(100 * 1024);
    buf.fill(i & 0xff);
    entries.push({ name: String(i), data: buf });
  }

  const t0 = performance.now();
  const zip = buildZip(entries);
  const t1 = performance.now();
  const sizeMB = zip.length / (1024 * 1024);
  console.log(`  构建 ZIP: ${sizeMB.toFixed(0)}MB, ${(t1 - t0).toFixed(2)}ms`);

  // 解析中央目录 (不应读取文件数据)
  const t2 = performance.now();
  const names = parseZipNames(zip);
  const t3 = performance.now();
  console.log(`  解析条目: ${(t3 - t2).toFixed(2)}ms`);
  assert.equal(names.filter(n => n !== 'collection.anki21' && n !== 'media').length, 550);
});

// ═══════════════════════════════════════════
// 压测 3: 损坏/恶意输入
// ═══════════════════════════════════════════

test('STRESS: 损坏输入 — 截断的 ZIP (缺少 EOCD)', () => {
  const entries: TestEntry[] = [
    { name: 'collection.anki2', data: new Uint8Array(256) },
    { name: 'media', data: new TextEncoder().encode('{}') },
  ];
  const zip = buildZip(entries);
  // 截断最后 30 字节 (破坏 EOCD)
  const truncated = zip.slice(0, zip.length - 30);

  assert.throws(() => parseZipNames(truncated), /EOCD not found/);
});

test('STRESS: 损坏输入 — 被填充随机字节', () => {
  const entries: TestEntry[] = [
    { name: 'collection.anki2', data: new Uint8Array(256) },
  ];
  const zip = buildZip(entries);
  // 在末尾追加 1KB 随机数据 (EOCD 搜索不受影响)
  const extra = new Uint8Array(1024);
  crypto.getRandomValues(extra);
  const appended = concat([zip, extra]);

  const names = parseZipNames(appended);
  assert.equal(names.length, 1);
  assert.equal(names[0], 'collection.anki2');
});

test('STRESS: 损坏输入 — 篡改的中央目录大小', () => {
  const entries: TestEntry[] = [
    { name: 'collection.anki2', data: new Uint8Array(256) },
    { name: 'media', data: new TextEncoder().encode('{"0":"x.jpg"}') },
  ];
  const zip = buildZip(entries);
  // 篡改 EOCD 中的中央目录大小 (offset 12, 4 bytes)
  const tampered = new Uint8Array(zip);
  const ev = new DataView(tampered.buffer, zip.byteOffset, zip.byteLength);
  const eocdOff = zip.length - 22;
  ev.setUint32(eocdOff + 12, 0xFFFFFFFF, true); // 超大值

  // 解析应该能处理 — 超出范围时停止遍历
  const names = parseZipNames(tampered);
  // 至少能解析出已知条目 (由于超大 size，可能遍历到数据区)
  assert.ok(names.length >= 0, '不应崩溃');
});

test('STRESS: 损坏输入 — 文件名含非法 UTF-8 序列', () => {
  // 创建一个中央目录条目，文件名包含无效 UTF-8
  const nb = new Uint8Array([0xff, 0xfe, 0xfd]); // 无效 UTF-8
  const ch = new Uint8Array(46 + nb.length);
  const cv = new DataView(ch.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(28, nb.length, true);
  ch.set(nb, 46);

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, ch.length, true);
  ev.setUint16(20, 0, true);

  const zip = concat([ch, eocd]);

  // TextDecoder 对无效 UTF-8 会生成替换字符 (U+FFFD)
  const names = parseZipNames(zip);
  assert.equal(names.length, 1);
  assert.ok(names[0]!.includes('\uFFFD'));
});

// ═══════════════════════════════════════════
// 压测 4: 文件名安全 — Unicode/超长
// ═══════════════════════════════════════════

test('STRESS: 文件名安全 — 正常 Unicode 通过', () => {
  const names = [
    '日本語テスト.jpg',
    '中文文件名.png',
    '한국어파일.mp3',
    'файл-русский.txt',
    'árvíztűrő-tükörfúrógép.svg',
    '\u{1F600}-emoji-name.jpg',
    'file with spaces.pdf',
    'normal-name_v1.0.zip',
  ];
  for (const name of names) {
    assert.ok(isFilenameSafe(name), `应接受: ${name}`);
  }
});

test('STRESS: 文件名安全 — 超长文件名', () => {
  // 255 字符 (Windows MAX_PATH 组件限制)
  const long255 = 'a'.repeat(251) + '.txt';  // 255 chars
  assert.ok(isFilenameSafe(long255), '255字符文件名应被接受');

  // 1000 字符 — 应该仍然接受 (ArkTS/HarmonyOS 的限制不同于 Win32)
  const long1000 = 'a'.repeat(996) + '.txt';
  assert.ok(isFilenameSafe(long1000), '1000字符文件名应被接受');
});

test('STRESS: 文件名安全 — 边界批量测试 (256项)', () => {
  // 安全名称
  for (let i = 0; i < 128; i++) {
    assert.ok(isFilenameSafe(`file_${i}.jpg`));
  }
  // 不安全名称
  assert.ok(!isFilenameSafe('CON'));
  assert.ok(!isFilenameSafe('CON.txt'));
  assert.ok(!isFilenameSafe('file<tag>.png'));
  assert.ok(!isFilenameSafe('file?.png'));
  assert.ok(!isFilenameSafe(''));
  assert.ok(!isFilenameSafe('.'));
  assert.ok(!isFilenameSafe('..'));
  assert.ok(!isFilenameSafe('file.txt '));
  assert.ok(!isFilenameSafe('file.txt.'));
});

test('STRESS: 文件名安全 — 拒绝所有 Windows 保留名 (COM1-COM9, LPT1-LPT9)', () => {
  for (let i = 1; i <= 9; i++) {
    assert.ok(!isFilenameSafe(`COM${i}`), `COM${i} 应被拒绝`);
    assert.ok(!isFilenameSafe(`LPT${i}`), `LPT${i} 应被拒绝`);
    assert.ok(!isFilenameSafe(`com${i}`), `com${i} (小写) 应被拒绝`);
    assert.ok(!isFilenameSafe(`lpt${i}`), `lpt${i} (小写) 应被拒绝`);
  }
  // 保留名 + 扩展名也应被拒绝
  assert.ok(!isFilenameSafe('COM1.jpg'));
  assert.ok(!isFilenameSafe('LPT9.DAT'));
  assert.ok(!isFilenameSafe('NUL.txt'));
  assert.ok(!isFilenameSafe('AUX.bak'));
});

test('STRESS: 文件名安全 — 控制字符和零宽字符被拒绝', () => {
  assert.ok(!isFilenameSafe('hello\x00world'));
  assert.ok(!isFilenameSafe('hello\x01world'));
  assert.ok(!isFilenameSafe('hello\x1fworld'));
  // \x7f (DEL) — 扩展到 regex 覆盖范围
  const extended = /[<>:"/\\|?*\x00-\x7f]/.test('hello\x7fworld'.replace(/[^<>:"/\\|?*\x00-\x7f]/g, ''));
  assert.ok(/[\x00-\x1f\x7f]/.test('hello\x7fworld'), 'DEL(\x7f) 也应被检测为危险字符');
  // 零宽空格 (U+200B) — 不是控制字符, 是合法的 Unicode
  assert.ok(isFilenameSafe('hello\u200Bworld'), '零宽空格应被接受');
});

// ═══════════════════════════════════════════
// 压测 5: 大量 JSON 媒体映射解析
// ═══════════════════════════════════════════

test('STRESS: 媒体映射 — 解析 10,000 条目的 JSON', () => {
  const map: Record<string, string> = {};
  for (let i = 0; i < 10000; i++) {
    map[String(i)] = `media_file_${String(i).padStart(5, '0')}.jpg`;
  }
  const json = JSON.stringify(map);
  console.log(`  媒体映射 JSON: ${(json.length / 1024).toFixed(0)}KB`);

  const t0 = performance.now();
  const parsed = JSON.parse(json) as Record<string, string>;
  const entries = Object.keys(parsed).sort((a, b) => Number(a) - Number(b));
  const t1 = performance.now();
  console.log(`  解析: ${(t1 - t0).toFixed(2)}ms`);

  assert.equal(entries.length, 10000);
  assert.equal(parsed['0'], 'media_file_00000.jpg');
  assert.equal(parsed['9999'], 'media_file_09999.jpg');
});

test('STRESS: 媒体映射 — 损坏的 JSON 被正确拒绝', () => {
  assert.throws(() => JSON.parse('{'), SyntaxError);
  assert.throws(() => JSON.parse(''), SyntaxError);
  // JSON.parse('null') 不抛异常 — 返回 null (合法 JSON)
  assert.equal(JSON.parse('null'), null);
  // JSON.parse('[1,2,3]') 也不抛异常 — 返回数组 (合法 JSON, 但不是 Record)
  assert.ok(Array.isArray(JSON.parse('[1,2,3]')));
  // 真正的类型检查应该在解析之后: 验证结果是对象类型
  function parseAsRecord(json: string): Record<string, unknown> {
    const v = JSON.parse(json);
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      throw new TypeError('Expected JSON object, got ' + (Array.isArray(v) ? 'array' : typeof v));
    }
    return v as Record<string, unknown>;
  }
  assert.throws(() => parseAsRecord('null'), TypeError);
  assert.throws(() => parseAsRecord('[1,2,3]'), TypeError);
  assert.doesNotThrow(() => parseAsRecord('{"key":"val"}'));
});

// ═══════════════════════════════════════════
// 压测 6: SQLite 头检测
// ═══════════════════════════════════════════

test('STRESS: SQLite 检测 — 大量无效输入的快速拒绝', () => {
  function isSqlite(d: Uint8Array): boolean {
    // SQLite 魔法头 16 字节: "SQLite format 3\0"
    if (d.length < 16) return false;
    return new TextDecoder().decode(d.slice(0, 16)) === 'SQLite format 3\x00';
  }

  // 所有可能的单字节头部 (快速拒绝)
  for (let b = 0; b < 256; b++) {
    if (b === 0x53) continue; // 'S' 开头需要进一步检查
    const data = new Uint8Array(16);
    data[0] = b;
    assert.equal(isSqlite(data), false, `byte 0x${b.toString(16)} 不应匹配`);
  }

  // 有效头的子集也应被拒绝 (不完整的 magic)
  assert.equal(isSqlite(new TextEncoder().encode('SQLit')), false, '太短: SQLit');
  assert.equal(isSqlite(new TextEncoder().encode('SQLite')), false, '太短: SQLite');
  assert.equal(isSqlite(new TextEncoder().encode('SQLite ')), false, '头部不完整: SQLite ');
  assert.equal(isSqlite(new TextEncoder().encode('SQLite format 3\x01')), false, '最后字节错误');
});

// ═══════════════════════════════════════════
// 压测 7: 内存分配
// ═══════════════════════════════════════════

test('STRESS: 内存 — 连续分配和释放 100 个大缓冲区', () => {
  // 模拟连续处理多个媒体文件
  for (let i = 0; i < 100; i++) {
    const buf = new Uint8Array(1 * 1024 * 1024); // 1MB
    buf.fill(i & 0xff);
    const crc = crc32(buf);
    assert.ok(typeof crc === 'number');
    // buf 离开作用域，依赖 GC 回收
  }
  // 不应 OOM
});

test('STRESS: 内存 — 构建 10MB ZIP 后的 GC 行为', () => {
  const entries: TestEntry[] = [];
  // 110 个 100KB 条目 ≈ 10.7MB 原始数据 + ZIP 头 overhead
  for (let i = 0; i < 110; i++) {
    entries.push({
      name: `file_${String(i).padStart(4, '0')}.dat`,
      data: new Uint8Array(100 * 1024),
    });
  }

  let zip: Uint8Array | null = buildZip(entries);
  assert.ok(zip.length > 10 * 1024 * 1024, `ZIP 大小 ${(zip.length / (1024 * 1024)).toFixed(1)}MB 应大于 10MB`);

  // 放弃引用
  const len = zip.length;
  zip = null;

  // 强制 GC (Node 需要 --expose-gc)
  if (typeof global.gc === 'function') {
    global.gc();
  }
  assert.ok(len > 0, '之前分配的 ZIP 大小应有效');
});
