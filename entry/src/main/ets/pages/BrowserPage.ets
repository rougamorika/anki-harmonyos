/**
 * 卡片浏览器 (strict mode)
 */

import { router } from '@kit.ArkUI';
import { ankiDbService } from '../services/AnkiDbService';
import type { CardBrowseRow } from '../services/AnkiDbService';

@Entry
@Component
struct BrowserPage {
  @State rows: CardBrowseRow[] = [];
  @State query: string = '';
  @State status: string = '';
  @State busy: boolean = false;

  aboutToAppear(): void {
    this.search();
  }

  async search(): Promise<void> {
    this.busy = true;
    try {
      this.rows = await ankiDbService.getCardBrowseRows(this.query);
      this.status = String(this.rows.length) + ' results';
    } catch (e) {
      this.status = 'Error: ' + JSON.stringify(e);
    } finally {
      this.busy = false;
    }
  }

  build() {
    Column() {
      Row() {
        TextInput({ placeholder: 'Search...', text: this.query })
          .layoutWeight(1).height(40).fontSize(15)
          .backgroundColor('#FFFFFF').borderRadius(8)
          .onChange((v: string) => { this.query = v })
          .onSubmit(() => { this.search() })
        Button('Go').height(40).fontSize(14).onClick(() => this.search())
      }
      .width('100%').padding({ left: 8, right: 8, top: 10, bottom: 8 }).backgroundColor('#F6F8FF')

      Text(this.status).fontSize(12).fontColor('#7A8499').width('100%').padding({ left: 16, top: 4 })

      List({ space: 2 }) {
        ForEach(this.rows, (row: CardBrowseRow) => {
          ListItem() {
            Column() {
              Text(row.question)
                .fontSize(15).fontColor('#1F2430')
                .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
                .width('100%')
              Row({ space: 8 }) {
                Text(row.deckName).fontSize(11).fontColor('#246BFE')
                Text(row.due).fontSize(11).fontColor('#7A8499')
                Text('I=' + String(row.interval)).fontSize(11).fontColor('#7A8499')
                Text(String(row.reviews) + 'R').fontSize(11).fontColor('#7A8499')
              }
              .width('100%').margin({ top: 4 })
            }
            .width('100%').padding({ left: 14, right: 14, top: 12, bottom: 12 })
            .backgroundColor('#FFFFFF')
          }
        })
      }
      .width('100%').layoutWeight(1).backgroundColor('#F6F8FF')
    }
    .width('100%').height('100%').backgroundColor('#F6F8FF')
  }
}
