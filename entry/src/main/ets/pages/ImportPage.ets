/**
 * 导入页面 — .apkg 文件导入
 */

import { common } from '@kit.AbilityKit';
import { router } from '@kit.ArkUI';
import { importService, type ImportManifest } from '../services/ImportService';

@Entry
@Component
struct ImportPage {
  @State status: string = '选择 .apkg 文件导入';
  @State busy: boolean = false;
  @State lastManifest?: ImportManifest = undefined;

  aboutToAppear(): void {
    this.checkExisting();
  }

  checkExisting(): void {
    try {
      this.lastManifest = importService.readManifest(getContext(this) as common.UIAbilityContext);
      if (this.lastManifest) {
        this.status = `已导入: ${this.lastManifest.collectionDbName} (${this.lastManifest.mediaFileCount} 媒体文件)`;
      }
    } catch { /* ignore */ }
  }

  async doImport(): Promise<void> {
    this.busy = true;
    this.status = '正在导入...';
    try {
      const manifest = await importService.pickAndImportPackage(getContext(this) as common.UIAbilityContext);
      this.lastManifest = manifest;
      this.status = `导入完成! ${manifest.mediaFileCount} 媒体文件`;
    } catch (e) {
      this.status = `导入失败: ${JSON.stringify(e)}`;
    } finally {
      this.busy = false;
    }
  }

  build() {
    Column() {
      Row() {
        Button('←').type(ButtonType.Normal).height(36).width(44).onClick(() => router.back())
        Text('导入').fontSize(18).fontWeight(FontWeight.Bold).layoutWeight(1)
      }
      .width('100%').padding({ left: 12, right: 12, top: 10, bottom: 8 }).backgroundColor('#F6F8FF')

      Column({ space: 16 }) {
        Text(this.status)
          .fontSize(15).fontColor('#4F5B76')
          .textAlign(TextAlign.Center).width('100%')

        Button('选择 .apkg 文件')
          .type(ButtonType.Capsule).fontSize(16).height(48)
          .enabled(!this.busy)
          .onClick(() => this.doImport())

        if (this.lastManifest) {
          Column() {
            Text('导入详情').fontSize(14).fontWeight(FontWeight.Medium).margin({ bottom: 8 })
            Text(`数据库: ${this.lastManifest.collectionDbName}`).fontSize(13).fontColor('#7A8499')
            Text(`媒体数: ${this.lastManifest.mediaFileCount}`).fontSize(13).fontColor('#7A8499')
            Text(`来源: ${this.lastManifest.sourceUri}`).fontSize(12).fontColor('#B0B8CC').maxLines(1)
            Button('返回牌组列表').type(ButtonType.Capsule).margin({ top: 10 })
              .onClick(() => router.pushUrl({ url: 'pages/Index' }))
          }
          .width('100%').padding(14).backgroundColor('#FFFFFF').borderRadius(10)
        }
      }
      .width('100%').layoutWeight(1).padding(20)
      .justifyContent(FlexAlign.Center)
    }
    .width('100%').height('100%').backgroundColor('#F6F8FF')
  }
}
