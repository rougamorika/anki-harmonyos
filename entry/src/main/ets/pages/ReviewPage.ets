/**
 * 复习页面 — WebView 渲染卡片, SM-2 调度
 */

import { common } from '@kit.AbilityKit';
import { router } from '@kit.ArkUI';
import { webview } from '@kit.ArkWeb';
import { reviewService, type ReviewCard, type ReviewRating } from '../services/ReviewService';

@Entry
@Component
struct ReviewPage {
  private controller: webview.WebviewController = new webview.WebviewController();
  @State currentCard?: ReviewCard = undefined;
  @State answerShown: boolean = false;
  @State status: string = '加载中...';
  @State busy: boolean = false;
  private deckId: number = 0;

  aboutToAppear(): void {
    const params = router.getParams() as Record<string, Object>;
    this.deckId = (params?.['deckId'] as number) ?? 0;
    this.nextCard();
  }

  async nextCard(): Promise<void> {
    this.busy = true;
    this.answerShown = false;
    this.status = '加载...';
    try {
      const card = await reviewService.nextCard(getContext(this) as common.UIAbilityContext);
      this.currentCard = card;
      if (!card) {
        this.status = '完成! 没有待复习卡片';
        await this.setHtml('<div style="text-align:center;padding-top:80px;color:#7A8499;font-size:16px">今天没有待复习卡片</div>');
        return;
      }
      this.status = `#${card.cardId}`;
      await this.setHtml(card.questionHtml);
    } catch (e) {
      this.status = `错误: ${JSON.stringify(e)}`;
    } finally {
      this.busy = false;
    }
  }

  async setHtml(html: string): Promise<void> {
    const escaped = JSON.stringify(html);
    await this.controller.runJavaScript(`Anki4Hap.setHtml(${escaped});`);
  }

  async showAnswer(): Promise<void> {
    if (!this.currentCard) return;
    this.answerShown = true;
    await this.setHtml(this.currentCard.answerHtml);
  }

  async answer(rating: ReviewRating): Promise<void> {
    if (!this.currentCard || this.busy) return;
    this.busy = true;
    try {
      await reviewService.answer(this.currentCard, rating);
    } catch (e) {
      console.error(`answer error: ${JSON.stringify(e)}`);
    }
    await this.nextCard();
  }

  @Builder
  Btn(label: string, rating: ReviewRating, color: string) {
    Button(label)
      .layoutWeight(1)
      .height(48)
      .fontSize(15)
      .fontWeight(FontWeight.Medium)
      .backgroundColor(color)
      .enabled(this.answerShown && !this.busy && !!this.currentCard)
      .onClick(() => this.answer(rating))
  }

  build() {
    Column() {
      Row() {
        Button('←').type(ButtonType.Normal).height(36).width(44)
          .onClick(() => router.back())
        Text(this.status).fontSize(15).fontColor('#4F5B76').margin({ left: 12 }).layoutWeight(1)
      }
      .width('100%').padding({ left: 12, right: 12, top: 10, bottom: 10 }).backgroundColor('#F6F8FF')

      Web({ src: $rawfile('reviewer/reviewer.html'), controller: this.controller })
        .layoutWeight(1).width('100%').backgroundColor('#F7F8FC')
        .onPageEnd(() => {
          if (this.currentCard && !this.answerShown) this.setHtml(this.currentCard.questionHtml);
        })

      if (!this.answerShown) {
        Button(this.currentCard ? '显示答案' : '无卡片')
          .width('100%').height(56).fontSize(17)
          .enabled(!!this.currentCard && !this.busy)
          .margin({ left: 14, right: 14, top: 10, bottom: 14 })
          .onClick(() => this.showAnswer())
      } else {
        Row({ space: 8 }) {
          this.Btn('Again', 'again', '#E95F5F')
          this.Btn('Hard', 'hard', '#E39B33')
          this.Btn('Good', 'good', '#2E8B57')
          this.Btn('Easy', 'easy', '#246BFE')
        }
        .width('100%').padding({ left: 12, right: 12, top: 10, bottom: 14 }).backgroundColor('#F6F8FF')
      }
    }
    .width('100%').height('100%').backgroundColor('#F6F8FF')
  }
}
