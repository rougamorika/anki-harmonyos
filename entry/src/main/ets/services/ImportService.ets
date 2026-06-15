/**
 * Anki .apkg 导入服务 — 使用 ApkgReader 解析 ZIP
 */

import { common } from '@kit.AbilityKit';
import { picker, fileIo } from '@kit.CoreFileKit';
import { apkgReader, type ApkgContents } from './ApkgReaderService';

export interface ImportManifest {
  importedAt: number;
  sourceUri: string;
  collectionDbName: string;
  collectionDbPath: string;
  mediaDir: string;
  mediaFileCount: number;
}

export class ImportService {
  async pickAndImportPackage(context: common.UIAbilityContext): Promise<ImportManifest> {
    let dp: picker.DocumentViewPicker = new picker.DocumentViewPicker(context);
    let opts: picker.DocumentSelectOptions = new picker.DocumentSelectOptions();
    opts.fileSuffixFilters = ['.apkg', '.anki2', '.anki21'];
    let uris: string[] = await dp.select(opts);
    if (uris.length === 0) throw new Error('No file selected');
    return this.importFromUri(context, uris[0]);
  }

  async importFromUri(context: common.UIAbilityContext, uri: string): Promise<ImportManifest> {
    let root: string = context.filesDir + '/collections/default';
    let mediaDir: string = root + '/media';
    let dbPath: string = context.databaseDir + '/collection.anki2';
    fileIo.mkdirSync(root, true);
    fileIo.mkdirSync(mediaDir, true);
    fileIo.mkdirSync(context.databaseDir, true);

    let fileName: string = this.basename(uri);

    // 直接数据库文件
    if (fileName.endsWith('.anki2') || fileName.endsWith('.anki21')) {
      fileIo.copyFileSync(uri, root + '/collection.anki2');
      fileIo.copyFileSync(uri, dbPath);
      let m: ImportManifest = {
        importedAt: Math.floor(Date.now() / 1000), sourceUri: uri,
        collectionDbName: 'collection.anki2', collectionDbPath: dbPath,
        mediaDir: mediaDir, mediaFileCount: 0,
      };
      this.writeJson(root + '/import_manifest.json', m);
      return m;
    }

    // .apkg — 使用 ApkgReader 直接解析 ZIP
    let cachePath: string = context.cacheDir + '/latest.apkg';
    fileIo.copyFileSync(uri, cachePath);
    let contents: ApkgContents = apkgReader.readApkg(cachePath);

    // 写入集合数据库
    this.writeBinary(dbPath, contents.collectionData);
    this.writeBinary(root + '/collection.anki2', contents.collectionData);

    // 写入媒体文件
    let mediaCount: number = 0;
    for (let i: number = 0; i < contents.mediaEntries.length; i++) {
      let me = contents.mediaEntries[i];
      let dest: string = mediaDir + '/' + me.filename;
      this.writeBinary(dest, me.data);
      mediaCount++;
    }

    let m: ImportManifest = {
      importedAt: Math.floor(Date.now() / 1000), sourceUri: uri,
      collectionDbName: 'collection.anki2', collectionDbPath: dbPath,
      mediaDir: mediaDir, mediaFileCount: mediaCount,
    };
    this.writeJson(root + '/import_manifest.json', m);
    return m;
  }

  readManifest(context: common.UIAbilityContext): ImportManifest | undefined {
    let p: string = context.filesDir + '/collections/default/import_manifest.json';
    if (!fileIo.accessSync(p)) return undefined;
    let text: string = fileIo.readTextSync(p);
    return JSON.parse(text) as ImportManifest;
  }

  private basename(uri: string): string {
    let normalized: string = uri.replace(/\\/g, '/');
    let idx: number = normalized.lastIndexOf('/');
    if (idx >= 0) return normalized.substring(idx + 1);
    return normalized;
  }

  private writeBinary(path: string, data: Uint8Array): void {
    let f = fileIo.openSync(path, fileIo.OpenMode.CREATE | fileIo.OpenMode.WRITE_ONLY);
    let buf: ArrayBuffer = new ArrayBuffer(data.length);
    let view: Uint8Array = new Uint8Array(buf);
    view.set(data);
    fileIo.writeSync(f.fd, buf);
    fileIo.closeSync(f);
  }

  private writeJson(path: string, obj: Object): void {
    let text: string = JSON.stringify(obj);
    let f = fileIo.openSync(path, fileIo.OpenMode.CREATE | fileIo.OpenMode.WRITE_ONLY);
    fileIo.writeSync(f.fd, text);
    fileIo.closeSync(f);
  }
}

export const importService: ImportService = new ImportService();
