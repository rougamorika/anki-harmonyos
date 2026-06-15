/**
 * 复习服务 — SM-2 调度 + 模板渲染 (strict mode)
 */

import { common } from '@kit.AbilityKit';
import { ankiDbService } from './AnkiDbService';
import type { CardRow, NotetypeJson, CardUpdate } from './AnkiDbService';

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

export interface ReviewCard {
  cardId: number;
  noteId: number;
  deckId: number;
  questionHtml: string;
  answerHtml: string;
  css: string;
}

export interface Sm2Result {
  ivl: number;
  ease: number;
  lapses: number;
}

export function computeNextInterval(currentIvl: number, easeFactor: number, rating: ReviewRating): Sm2Result {
  let hardM: number = 1.2;
  let easyM: number = 1.3;
  let ivlM: number = 1.0;
  let ivl: number = Math.max(1, currentIvl);
  let ease: number = easeFactor > 0 ? easeFactor / 1000 : 2.5;

  let result: Sm2Result;
  if (rating === 'again') {
    result = { ivl: 0, ease: Math.max(1.3, ease - 0.20), lapses: 1 };
  } else if (rating === 'hard') {
    result = { ivl: Math.max(1, Math.round(ivl * hardM * ivlM)), ease: Math.max(1.3, ease - 0.15), lapses: 0 };
  } else if (rating === 'good') {
    result = { ivl: Math.max(1, Math.round(ivl * ease * ivlM)), ease: ease, lapses: 0 };
  } else {
    result = { ivl: Math.max(2, Math.round(ivl * ease * easyM * ivlM)), ease: Math.min(3.5, ease + 0.15), lapses: 0 };
  }
  return result;
}

function stripComments(template: string): string { return template.replace(/{{!.*?}}/gs, ''); }

function renderClozeText(text: string, cardOrdinal: number, answerSide: boolean): string {
  let target = cardOrdinal + 1;
  return text.replace(/{{c(\d+)::(.*?)(?:::.*?)?}}/gs, (_m: string, ord: string, body: string): string => {
    if (Number(ord) !== target) return body;
    return answerSide ? '<span class="cloze">' + body + '</span>' : '[...]';
  });
}

function renderTemplate(template: string, fields: Record<string, string>, cardOrd: number, answerSide: boolean, frontSide: string): string {
  let r: string = stripComments(template);
  r = r.replace(/{{FrontSide}}/g, frontSide);
  r = r.replace(/{{cloze:([^}]+)}}/g, (_m: string, fn: string): string => {
    let val = fields[fn.trim()];
    return renderClozeText(val !== undefined ? val : '', cardOrd, answerSide);
  });
  r = r.replace(/{{type:([^}]+)}}/g, (_m: string, fn: string): string => {
    return '<input id="typeans" data-field="' + fn.trim() + '"/>';
  });
  r = r.replace(/{{([^#:}/][^}]*)}}/g, (_m: string, fn: string): string => {
    let val = fields[fn.trim()];
    return val !== undefined ? val : '';
  });
  return r;
}

function rewriteMedia(html: string, base: string): string {
  let separator = base.endsWith('/') ? '' : '/';
  let out: string = html.replace(/(<(?:img|audio|video|source)\b[^>]*\s(?:src|poster)=)(["'])(?![a-z][a-z0-9+.-]*:|\/\/)([^"']+)\2/gi,
    (_m: string, prefix: string, quote: string, filename: string): string => {
      return prefix + quote + base + separator + encodeURI(filename) + quote;
    });
  out = out.replace(/\[sound:([^\]]+)\]/gi, (_m: string, filename: string): string => {
    return '<audio controls src="' + base + separator + encodeURI(filename) + '"></audio>';
  });
  return out;
}

export class ReviewService {
  async nextCard(context: common.UIAbilityContext): Promise<ReviewCard | undefined> {
    await ankiDbService.open(context);
    let card: CardRow | undefined = await ankiDbService.getNextDueCard();
    if (card === undefined) return undefined;

    let note = await ankiDbService.getNoteById(card.nid);
    if (note === undefined) return undefined;

    let nt: NotetypeJson | undefined = await ankiDbService.getNotetype(note.mid);
    if (nt === undefined) return undefined;

    let fields: Record<string, string> = {};
    let vals: string[] = note.flds.split('\x1f');
    for (let i = 0; i < nt.flds.length; i++) {
      let f = nt.flds[i];
      let name: string = f.name;
      let val: string = i < vals.length ? vals[i] : '';
      fields[name] = val;
    }

    let tmplIdx: number = card.ord < nt.tmpls.length ? card.ord : 0;
    let tmpl = nt.tmpls[tmplIdx];
    if (tmpl === undefined) return undefined;

    let mediaBase: string = 'file://' + context.filesDir + '/collections/default/media/';
    let css: string = nt.css.length > 0 ? nt.css : '';

    let qHtml: string = renderTemplate(tmpl.qfmt, fields, card.ord, false, '');
    let qFull: string = css.length > 0 ? '<style>' + css + '</style>' + qHtml : qHtml;

    let aHtml: string = renderTemplate(tmpl.afmt, fields, card.ord, true, qHtml);
    let aFull: string = css.length > 0 ? '<style>' + css + '</style>' + aHtml : aHtml;

    let result: ReviewCard = {
      cardId: card.id,
      noteId: card.nid,
      deckId: card.did,
      questionHtml: rewriteMedia(qFull, mediaBase),
      answerHtml: rewriteMedia(aFull, mediaBase),
      css: css,
    };
    return result;
  }

  async answer(card: ReviewCard, rating: ReviewRating): Promise<void> {
    let c: CardRow | undefined = await ankiDbService.getCardById(card.cardId);
    if (c === undefined) return;

    let sm2 = computeNextInterval(c.ivl, c.factor, rating);
    let ivl: number = sm2.ivl;
    let ease: number = sm2.ease;
    let lapses: number = sm2.lapses;

    let newType: number = rating === 'again' ? (c.lapses > 0 ? 3 : 1) : 2;
    let newQueue: number = rating === 'again' ? 1 : 2;
    let newDue: number;
    if (newQueue === 1) {
      newDue = Math.floor(Date.now() / 1000) + (ivl > 0 ? ivl * 86400 : 600);
    } else {
      newDue = Math.floor(Date.now() / 86400) + ivl;
    }

    let update: CardUpdate = {
      type: newType, queue: newQueue, due: newDue, ivl: ivl,
      factor: Math.round(ease * 1000), reps: c.reps + 1,
      lapses: c.lapses + lapses, left: 0,
    };
    await ankiDbService.updateCard(card.cardId, update);

    let easeNum: number = rating === 'again' ? 1 : rating === 'hard' ? 2 : rating === 'good' ? 3 : 4;
    await ankiDbService.addRevlog({
      id: Date.now(), cid: card.cardId, usn: -1,
      ease: easeNum, ivl: ivl, lastIvl: c.ivl,
      factor: Math.round(ease * 1000), time: 0, type: 0,
    });
  }
}

export const reviewService: ReviewService = new ReviewService();
