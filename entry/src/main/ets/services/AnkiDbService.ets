/**
 * Anki 数据库服务 — strict mode v2
 */

import { common } from '@kit.AbilityKit';
import { relationalStore } from '@kit.ArkData';

export interface CardRow {
  id: number; nid: number; did: number; ord: number;
  type: number; queue: number; due: number; ivl: number;
  factor: number; reps: number; lapses: number; left: number;
  odue: number; odid: number; flags: number; data: string;
}

export interface NoteRow { id: number; mid: number; tags: string; flds: string; }

export interface DeckSummary {
  id: number; name: string; cardCount: number;
  newCount: number; learnCount: number; reviewCount: number;
}

export interface CardBrowseRow {
  cardId: number; deckName: string; question: string; answer: string;
  due: string; interval: number; ease: number; reviews: number; lapses: number; queue: number;
}

export interface CardUpdate {
  type: number; queue: number; due: number; ivl: number; factor: number;
  reps: number; lapses: number; left: number;
}

export interface RevlogEntry {
  id: number; cid: number; usn: number; ease: number; ivl: number;
  lastIvl: number; factor: number; time: number; type: number;
}

export interface NotetypeField { name: string; }
export interface NotetypeTemplate { name: string; qfmt: string; afmt: string; }
export interface NotetypeJson { id: number; name: string; type: number; flds: NotetypeField[]; tmpls: NotetypeTemplate[]; css: string; }

export interface DeckCounts { total: number; n: number; l: number; r: number; }

export interface DailyAggRow {
  day: number; count: number; avgTime: number;
  ratings: [number, number, number, number];
}

export interface ReviewStats { totalReviews: number; avgEase: number; totalTime: number; }

const STORE_CONFIG: relationalStore.StoreConfig = { name: 'collection.anki2', securityLevel: relationalStore.SecurityLevel.S1 };

export class AnkiDbService {
  private store: relationalStore.RdbStore | undefined = undefined;

  async open(context: common.UIAbilityContext): Promise<void> {
    if (this.store !== undefined) return;
    this.store = await relationalStore.getRdbStore(context, STORE_CONFIG);
  }

  async getDeckSummaries(): Promise<DeckSummary[]> {
    let decksJson: string = '';
    let rs1 = await this.store!.querySql('SELECT decks FROM col LIMIT 1');
    if (rs1.goToNextRow()) {
      decksJson = rs1.getString(rs1.getColumnIndex('decks'));
    }
    rs1.close();
    let decksObj: Record<string, Object> = {};
    if (decksJson.length > 0) {
      decksObj = JSON.parse(decksJson) as Record<string, Object>;
    }

    let rs2 = await this.store!.querySql('SELECT did, COUNT(*) as cnt, SUM(CASE WHEN queue=0 THEN 1 ELSE 0 END) as n, SUM(CASE WHEN queue IN (1,3) AND type!=3 THEN 1 ELSE 0 END) as l, SUM(CASE WHEN queue=2 OR (queue=3 AND type=3) THEN 1 ELSE 0 END) as r FROM cards WHERE queue>=0 GROUP BY did');
    let counts = new Map<number, DeckCounts>();
    while (rs2.goToNextRow()) {
      let did: number = rs2.getLong(0);
      let c: DeckCounts = { total: rs2.getLong(1), n: rs2.getLong(2), l: rs2.getLong(3), r: rs2.getLong(4) };
      counts.set(did, c);
    }
    rs2.close();

    let result: DeckSummary[] = [];
    let deckKeys: string[] = Object.keys(decksObj);
    for (let i = 0; i < deckKeys.length; i++) {
      let idStr: string = deckKeys[i];
      let idNum: number = Number(idStr);
      let deckVal: Object | undefined = decksObj[idStr];
      let deckName: string = 'Deck';
      if (deckVal !== undefined) {
        let d: Record<string, Object> = deckVal as Record<string, Object>;
        let dn: Object | undefined = d.name;
        if (dn !== undefined) {
          deckName = String(dn);
        }
      }
      let c: DeckCounts | undefined = counts.get(idNum);
      let s: DeckSummary = {
        id: idNum,
        name: deckName,
        cardCount: c !== undefined ? c.total : 0,
        newCount: c !== undefined ? c.n : 0,
        learnCount: c !== undefined ? c.l : 0,
        reviewCount: c !== undefined ? c.r : 0,
      };
      result.push(s);
    }
    return result.sort((a: DeckSummary, b: DeckSummary): number => a.name.localeCompare(b.name));
  }

  async getNextDueCard(): Promise<CardRow | undefined> {
    let rs = await this.store!.querySql('SELECT id,nid,did,ord,type,queue,due,ivl,factor,reps,lapses,left,odue,odid,flags,data FROM cards WHERE queue>=0 ORDER BY CASE queue WHEN 0 THEN 0 ELSE 1 END, due LIMIT 1');
    let card: CardRow | undefined = undefined;
    if (rs.goToNextRow()) {
      card = this.cardFromRow(rs);
    }
    rs.close();
    return card;
  }

  async getCardById(cardId: number): Promise<CardRow | undefined> {
    let rs = await this.store!.querySql('SELECT id,nid,did,ord,type,queue,due,ivl,factor,reps,lapses,left,odue,odid,flags,data FROM cards WHERE id=?', [cardId]);
    let card: CardRow | undefined = undefined;
    if (rs.goToNextRow()) {
      card = this.cardFromRow(rs);
    }
    rs.close();
    return card;
  }

  async getNoteById(noteId: number): Promise<NoteRow | undefined> {
    let rs = await this.store!.querySql('SELECT id,mid,tags,flds FROM notes WHERE id=?', [noteId]);
    let note: NoteRow | undefined = undefined;
    if (rs.goToNextRow()) {
      note = { id: rs.getLong(0), mid: rs.getLong(1), tags: rs.getString(2), flds: rs.getString(3) };
    }
    rs.close();
    return note;
  }

  async getNotetype(modelId: number): Promise<NotetypeJson | undefined> {
    let json: string = '';
    let rs = await this.store!.querySql('SELECT models FROM col LIMIT 1');
    if (rs.goToNextRow()) {
      json = rs.getString(rs.getColumnIndex('models'));
    }
    rs.close();
    if (json.length === 0) return undefined;
    let models: Record<string, NotetypeJson> = JSON.parse(json) as Record<string, NotetypeJson>;
    return models[String(modelId)];
  }

  async queryCards(search: string, limit: number): Promise<CardRow[]> {
    let sql: string;
    let bind: (string | number)[];
    if (search.length > 0) {
      sql = 'SELECT c.id,c.nid,c.did,c.ord,c.type,c.queue,c.due,c.ivl,c.factor,c.reps,c.lapses,c.left,c.odue,c.odid,c.flags,c.data FROM cards c JOIN notes n ON n.id=c.nid WHERE n.flds LIKE ? COLLATE NOCASE AND c.queue>=0 ORDER BY c.due LIMIT ?';
      bind = ['%' + search + '%', limit];
    } else {
      sql = 'SELECT id,nid,did,ord,type,queue,due,ivl,factor,reps,lapses,left,odue,odid,flags,data FROM cards WHERE queue>=0 ORDER BY due LIMIT ?';
      bind = [limit];
    }
    let rs = await this.store!.querySql(sql, bind);
    let rows: CardRow[] = [];
    while (rs.goToNextRow()) {
      rows.push(this.cardFromRow(rs));
    }
    rs.close();
    return rows;
  }

  async getCardBrowseRows(search: string): Promise<CardBrowseRow[]> {
    let cards: CardRow[] = await this.queryCards(search, 100);
    let decksJson: string = '';
    let rs1 = await this.store!.querySql('SELECT decks FROM col LIMIT 1');
    if (rs1.goToNextRow()) {
      decksJson = rs1.getString(rs1.getColumnIndex('decks'));
    }
    rs1.close();
    let decksObj: Record<string, Object> = {};
    if (decksJson.length > 0) {
      decksObj = JSON.parse(decksJson) as Record<string, Object>;
    }

    let rows: CardBrowseRow[] = [];
    for (let i = 0; i < cards.length; i++) {
      let c: CardRow = cards[i];
      let deckVal: Object | undefined = decksObj[String(c.did)];
      let deckName: string = '?';
      if (deckVal !== undefined) {
        let d: Record<string, Object> = deckVal as Record<string, Object>;
        let dn: Object | undefined = d.name;
        if (dn !== undefined) {
          deckName = String(dn);
        }
      }
      let row: CardBrowseRow = {
        cardId: c.id, deckName: deckName,
        question: '', answer: '',
        due: this.formatDue(c), interval: c.ivl,
        ease: c.factor > 0 ? c.factor / 1000 : 2.5,
        reviews: c.reps, lapses: c.lapses, queue: c.queue,
      };
      rows.push(row);
    }
    return rows;
  }

  async updateCard(cardId: number, u: CardUpdate): Promise<void> {
    await this.store!.executeSql('UPDATE cards SET type=?,queue=?,due=?,ivl=?,factor=?,reps=?,lapses=?,left=?,mod=? WHERE id=?', [u.type, u.queue, u.due, u.ivl, u.factor, u.reps, u.lapses, u.left, Math.floor(Date.now()/1000), cardId]);
  }

  async suspendCards(cardIds: number[]): Promise<void> {
    let ph: string = cardIds.map((): string => '?').join(',');
    await this.store!.executeSql('UPDATE cards SET queue=-1 WHERE id IN (' + ph + ')', cardIds);
  }

  async addRevlog(e: RevlogEntry): Promise<void> {
    await this.store!.executeSql('INSERT INTO revlog (id,cid,usn,ease,ivl,lastIvl,factor,time,type) VALUES (?,?,?,?,?,?,?,?,?)', [e.id, e.cid, e.usn, e.ease, e.ivl, e.lastIvl, e.factor, e.time, e.type]);
  }

  async getDailyAggregation(deckId: number | undefined, daysBack: number): Promise<DailyAggRow[]> {
    let cutoff: number = (Math.floor(Date.now()/1000) - daysBack * 86400) * 1000;
    let rs: relationalStore.ResultSet;
    if (deckId !== undefined) {
      rs = await this.store!.querySql('SELECT r.id/1000/86400 AS day, COUNT(*), AVG(r.time), SUM(CASE WHEN r.ease=1 THEN 1 ELSE 0 END), SUM(CASE WHEN r.ease=2 THEN 1 ELSE 0 END), SUM(CASE WHEN r.ease=3 THEN 1 ELSE 0 END), SUM(CASE WHEN r.ease=4 THEN 1 ELSE 0 END) FROM revlog r JOIN cards c ON c.id=r.cid WHERE c.did=? AND r.id>? GROUP BY day ORDER BY day', [deckId, cutoff]);
    } else {
      rs = await this.store!.querySql('SELECT r.id/1000/86400 AS day, COUNT(*), AVG(r.time), SUM(CASE WHEN r.ease=1 THEN 1 ELSE 0 END), SUM(CASE WHEN r.ease=2 THEN 1 ELSE 0 END), SUM(CASE WHEN r.ease=3 THEN 1 ELSE 0 END), SUM(CASE WHEN r.ease=4 THEN 1 ELSE 0 END) FROM revlog r WHERE r.id>? GROUP BY day ORDER BY day', [cutoff]);
    }
    let rows: DailyAggRow[] = [];
    while (rs.goToNextRow()) {
      let ratings: [number, number, number, number] = [rs.getLong(3), rs.getLong(4), rs.getLong(5), rs.getLong(6)];
      let row: DailyAggRow = { day: rs.getLong(0), count: rs.getLong(1), avgTime: rs.getDouble(2), ratings: ratings };
      rows.push(row);
    }
    rs.close();
    return rows;
  }

  async getReviewStats(): Promise<ReviewStats> {
    let rs = await this.store!.querySql('SELECT COUNT(*), AVG(ease), SUM(time) FROM revlog');
    let result: ReviewStats = { totalReviews: 0, avgEase: 0, totalTime: 0 };
    if (rs.goToNextRow()) {
      result.totalReviews = rs.getLong(0);
      result.avgEase = rs.getDouble(1);
      result.totalTime = rs.getLong(2);
    }
    rs.close();
    return result;
  }

  private cardFromRow(rs: relationalStore.ResultSet): CardRow {
    return {
      id: rs.getLong(0), nid: rs.getLong(1), did: rs.getLong(2), ord: rs.getLong(3),
      type: rs.getLong(4), queue: rs.getLong(5), due: rs.getLong(6), ivl: rs.getLong(7),
      factor: rs.getLong(8), reps: rs.getLong(9), lapses: rs.getLong(10), left: rs.getLong(11),
      odue: rs.getLong(12), odid: rs.getLong(13), flags: rs.getLong(14), data: rs.getString(15),
    };
  }

  private formatDue(card: CardRow): string {
    if (card.queue === -1) return '\u6682\u505c'; // 暂停
    if (card.queue === 0) return '\u65b0 #' + String(card.due); // 新 #
    if (card.queue === 1 || card.queue === 3) {
      let m: number = Math.max(0, Math.ceil((card.due - Math.floor(Date.now()/1000)) / 60));
      if (m <= 0) return '\u73b0\u5728'; // 现在
      if (m < 60) return String(m) + '\u5206'; // 分
      if (m < 1440) return String(Math.floor(m/60)) + '\u65f6'; // 时
      return String(Math.floor(m/1440)) + '\u5929'; // 天
    }
    if (card.queue === 2) {
      let d: number = card.due - Math.floor(Date.now()/86400);
      if (d <= 0) return '\u4eca\u5929'; // 今天
      if (d === 1) return '\u660e\u5929'; // 明天
      return String(d) + '\u5929'; // 天
    }
    return '?';
  }
}

export const ankiDbService: AnkiDbService = new AnkiDbService();
