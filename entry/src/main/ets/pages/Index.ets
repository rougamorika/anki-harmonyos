/**
 * 牌组列表页 — 主页
 */

import { common } from '@kit.AbilityKit';
import { router } from '@kit.ArkUI';
import { ankiDbService, type DeckSummary } from '../services/AnkiDbService';

@Entry
@Component
struct Index {
  @State decks: DeckSummary[] = [];
  @State status: string = '加载中...';
  @State busy: boolean = false;

  aboutToAppear(): void {
    this.loadDecks();
  }

  async loadDecks(): Promise<void> {
    this.busy = true;
    this.status = '加载牌组...';
    try {
      await ankiDbService.open(getContext(this) as common.UIAbilityContext);
      this.decks = await ankiDbService.getDeckSummaries();
      this.status = this.decks.length > 0 ? `${this.decks.length} 个牌组` : '没有牌组';
    } catch (e) {
      this.status = `加载失败: ${JSON.stringify(e)}`;
    } finally {
      this.busy = false;
    }
  }

  totalCards(): number {
    return this.decks.reduce((s, d) => s + d.cardCount, 0);
  }

  build() {
    Column() {
      // 顶栏
      Row() {
        Text('Anki4Hap')
          .fontSize(22)
          .fontWeight(FontWeight.Bold)
          .fontColor('#1F2430')
          .layoutWeight(1)
        Button('导入')
          .type(ButtonType.Capsule)
          .fontSize(14)
          .onClick(() => router.pushUrl({ url: 'pages/ImportPage' }))
        Button('统计')
          .type(ButtonType.Capsule)
          .fontSize(14)
          .margin({ left: 8 })
          .onClick(() => router.pushUrl({ url: 'pages/StatsPage' }))
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 12, bottom: 8 })
      .backgroundColor('#F6F8FF')

      // 搜索栏
      Search({ placeholder: '搜索卡片...' })
        .width('100%')
        .margin({ left: 14, right: 14, top: 8, bottom: 4 })
        .onSubmit((value: string) => {
          router.pushUrl({ url: 'pages/BrowserPage', params: { search: value } });
        })
        .onChange((value: string) => {
          if (value.length > 0) {
            router.pushUrl({ url: 'pages/BrowserPage', params: { search: value } });
          }
        })

      // 统计摘要
      Row() {
        Text(`共 ${this.totalCards()} 张卡片`)
          .fontSize(13)
          .fontColor('#7A8499')
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 2, bottom: 6 })

      // 牌组列表
      if (this.decks.length === 0 && !this.busy) {
        Column() {
          Text('还没有牌组')
            .fontSize(16)
            .fontColor('#B0B8CC')
            .margin({ top: 60 })
          Button('导入 .apkg')
            .type(ButtonType.Capsule)
            .margin({ top: 16 })
            .onClick(() => router.pushUrl({ url: 'pages/ImportPage' }))
        }
        .width('100%')
        .layoutWeight(1)
      } else {
        List({ space: 6 }) {
          ForEach(this.decks, (deck: DeckSummary) => {
            ListItem() {
              this.DeckCard(deck)
            }
          })
        }
        .width('100%')
        .layoutWeight(1)
        .padding({ left: 14, right: 14 })
        .backgroundColor('#F6F8FF')
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#F6F8FF')
  }

  @Builder
  DeckCard(deck: DeckSummary) {
    Column() {
      Row() {
        Text(deck.name)
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .fontColor('#1F2430')
          .layoutWeight(1)
        Text(`${deck.cardCount}`)
          .fontSize(14)
          .fontColor('#7A8499')
      }
      .width('100%')

      if (deck.newCount + deck.learnCount + deck.reviewCount > 0) {
        Row({ space: 12 }) {
          if (deck.newCount > 0) Text(`新 ${deck.newCount}`).fontSize(12).fontColor('#246BFE')
          if (deck.learnCount > 0) Text(`学 ${deck.learnCount}`).fontSize(12).fontColor('#E39B33')
          if (deck.reviewCount > 0) Text(`复 ${deck.reviewCount}`).fontSize(12).fontColor('#2E8B57')
        }
        .width('100%')
        .margin({ top: 6 })
      }
    }
    .width('100%')
    .padding({ left: 14, right: 14, top: 14, bottom: 14 })
    .backgroundColor('#FFFFFF')
    .borderRadius(10)
    .onClick(() => {
      router.pushUrl({ url: 'pages/ReviewPage', params: { deckId: deck.id } });
    })
  }
}
