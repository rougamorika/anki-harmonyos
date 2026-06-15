/**
 * 统计页面 (strict mode)
 */

import { router } from '@kit.ArkUI';
import { ankiDbService } from '../services/AnkiDbService';
import type { DailyAggRow } from '../services/AnkiDbService';

interface CurvePoint { day: number; count: number; cumulative: number; }
interface RatingPct { again: number; hard: number; good: number; easy: number; }

@Entry
@Component
struct StatsPage {
  @State totalReviews: number = 0;
  @State avgEase: number = 0;
  @State totalTime: number = 0;
  @State curve: CurvePoint[] = [];
  @State ratingPct: RatingPct = { again: 0, hard: 0, good: 0, easy: 0 };
  @State busy: boolean = false;

  aboutToAppear(): void {
    this.load();
  }

  async load(): Promise<void> {
    this.busy = true;
    try {
      let stats = await ankiDbService.getReviewStats();
      let daily: DailyAggRow[] = await ankiDbService.getDailyAggregation(undefined, 30);

      this.totalReviews = stats.totalReviews;
      this.avgEase = stats.avgEase;
      this.totalTime = stats.totalTime;

      let distAgain: number = 0;
      let distHard: number = 0;
      let distGood: number = 0;
      let distEasy: number = 0;
      for (let i: number = 0; i < daily.length; i++) {
        let d: DailyAggRow = daily[i];
        distAgain += d.ratings[0];
        distHard += d.ratings[1];
        distGood += d.ratings[2];
        distEasy += d.ratings[3];
      }
      let total: number = distAgain + distHard + distGood + distEasy;
      if (total > 0) {
        this.ratingPct = {
          again: Math.round(distAgain / total * 100),
          hard: Math.round(distHard / total * 100),
          good: Math.round(distGood / total * 100),
          easy: Math.round(distEasy / total * 100),
        };
      }

      let now: number = Math.floor(Date.now() / 1000 / 86400);
      let startDay: number = now - 29;
      let dayMap: Map<number, number> = new Map<number, number>();
      for (let i: number = 0; i < daily.length; i++) {
        dayMap.set(daily[i].day, daily[i].count);
      }
      let curveData: CurvePoint[] = [];
      let cum: number = 0;
      for (let d: number = startDay; d <= now; d++) {
        let cnt: number = dayMap.get(d) ?? 0;
        cum += cnt;
        curveData.push({ day: d, count: cnt, cumulative: cum });
      }
      this.curve = curveData;
    } catch (e) {
      console.error('stats error: ' + JSON.stringify(e));
    } finally {
      this.busy = false;
    }
  }

  build() {
    Column() {
      Row() {
        Text('Statistics').fontSize(18).fontWeight(FontWeight.Bold).layoutWeight(1)
      }
      .width('100%').padding({ left: 12, right: 12, top: 10, bottom: 8 }).backgroundColor('#F6F8FF')

      Scroll() {
        Column({ space: 14 }) {
          Row({ space: 12 }) {
            this.StatCard('Reviews', String(this.totalReviews))
            this.StatCard('Avg Ease', this.avgEase.toFixed(1))
            this.StatCard('Time', String(Math.round(this.totalTime / 60000)) + 'm')
          }.width('100%').padding({ left: 14, right: 14 })

          Column() {
            Text('Rating Distribution').fontSize(15).fontWeight(FontWeight.Medium).margin({ bottom: 8 })
            Row({ space: 8 }) {
              this.RatingBar('Again', this.ratingPct.again, '#E95F5F')
              this.RatingBar('Hard', this.ratingPct.hard, '#E39B33')
              this.RatingBar('Good', this.ratingPct.good, '#2E8B57')
              this.RatingBar('Easy', this.ratingPct.easy, '#246BFE')
            }.width('100%')
          }
          .width('100%').padding(14).backgroundColor('#FFFFFF').borderRadius(10)

          Column() {
            Text('Daily Reviews (30d)').fontSize(15).fontWeight(FontWeight.Medium).margin({ bottom: 8 })
            Row({ space: 1 }) {
              ForEach(this.curve.slice(-30), (p: CurvePoint) => {
                Column() {
                  Blank().height(String(Math.min(60, p.count * 3)) + 'px').width('100%').backgroundColor('#246BFE').borderRadius(2)
                }.layoutWeight(1)
              })
            }.width('100%').height(64).alignItems(VerticalAlign.Bottom)
          }
          .width('100%').padding(14).backgroundColor('#FFFFFF').borderRadius(10)
        }
        .width('100%').padding({ top: 10, bottom: 20 })
      }
      .layoutWeight(1).width('100%').backgroundColor('#F6F8FF')
    }
    .width('100%').height('100%').backgroundColor('#F6F8FF')
  }

  @Builder
  StatCard(label: string, value: string) {
    Column() {
      Text(value).fontSize(22).fontWeight(FontWeight.Bold).fontColor('#1F2430')
      Text(label).fontSize(12).fontColor('#7A8499').margin({ top: 2 })
    }
    .layoutWeight(1).padding(14).backgroundColor('#FFFFFF').borderRadius(10).alignItems(HorizontalAlign.Center)
  }

  @Builder
  RatingBar(label: string, pct: number, color: string) {
    Column() {
      Text(String(pct) + '%').fontSize(14).fontWeight(FontWeight.Bold).fontColor(color)
      Text(label).fontSize(11).fontColor('#7A8499')
    }.layoutWeight(1).alignItems(HorizontalAlign.Center)
  }
}
