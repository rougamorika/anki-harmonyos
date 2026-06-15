/**
 * Anki 数据库 Schema — 表定义 & 常量
 *
 * 对应: rslib/src/storage/schema11.sql
 */

// ─── 表名 ───

export const TABLE_COL = 'col';
export const TABLE_NOTES = 'notes';
export const TABLE_CARDS = 'cards';
export const TABLE_REVLOG = 'revlog';
export const TABLE_GRAVES = 'graves';

// ─── DDL ───

export const DDL = `
CREATE TABLE IF NOT EXISTS col (
  id      integer PRIMARY KEY,
  crt     integer NOT NULL,
  mod     integer NOT NULL,
  scm     integer NOT NULL,
  ver     integer NOT NULL,
  dty     integer NOT NULL,
  usn     integer NOT NULL,
  ls      integer NOT NULL,
  conf    text NOT NULL,
  models  text NOT NULL,
  decks   text NOT NULL,
  dconf   text NOT NULL,
  tags    text NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id    integer PRIMARY KEY,
  guid  text NOT NULL,
  mid   integer NOT NULL,
  mod   integer NOT NULL,
  usn   integer NOT NULL,
  tags  text NOT NULL,
  flds  text NOT NULL,
  sfld  integer NOT NULL,
  csum  integer NOT NULL,
  flags integer NOT NULL,
  data  text NOT NULL
);

CREATE TABLE IF NOT EXISTS cards (
  id     integer PRIMARY KEY,
  nid    integer NOT NULL,
  did    integer NOT NULL,
  ord    integer NOT NULL,
  mod    integer NOT NULL,
  usn    integer NOT NULL,
  type   integer NOT NULL,
  queue  integer NOT NULL,
  due    integer NOT NULL,
  ivl    integer NOT NULL,
  factor integer NOT NULL,
  reps   integer NOT NULL,
  lapses integer NOT NULL,
  left   integer NOT NULL,
  odue   integer NOT NULL,
  odid   integer NOT NULL,
  flags  integer NOT NULL,
  data   text NOT NULL
);

CREATE TABLE IF NOT EXISTS revlog (
  id      integer PRIMARY KEY,
  cid     integer NOT NULL,
  usn     integer NOT NULL,
  ease    integer NOT NULL,
  ivl     integer NOT NULL,
  lastIvl integer NOT NULL,
  factor  integer NOT NULL,
  time    integer NOT NULL,
  type    integer NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_cards_sched ON cards (did, queue, due);
CREATE INDEX IF NOT EXISTS ix_cards_nid   ON cards (nid);
CREATE INDEX IF NOT EXISTS ix_revlog_cid ON revlog (cid);
CREATE INDEX IF NOT EXISTS ix_notes_csum ON notes (csum);
`;

// ─── cards 表列名 ───

export const CARD_COLS = {
  id: 'id', nid: 'nid', did: 'did', ord: 'ord',
  mod: 'mod', usn: 'usn', type: 'type', queue: 'queue',
  due: 'due', ivl: 'ivl', factor: 'factor', reps: 'reps',
  lapses: 'lapses', left: 'left', odue: 'odue', odid: 'odid',
  flags: 'flags', data: 'data',
} as const;

export const CARD_COL_NAMES = Object.values(CARD_COLS).join(', ');

// ─── notes 表列名 ───

export const NOTE_COLS = {
  id: 'id', guid: 'guid', mid: 'mid', mod: 'mod',
  usn: 'usn', tags: 'tags', flds: 'flds', sfld: 'sfld',
  csum: 'csum', flags: 'flags', data: 'data',
} as const;

// ─── revlog 表列名 ───

export const REVLOG_COLS = {
  id: 'id', cid: 'cid', usn: 'usn', ease: 'ease',
  ivl: 'ivl', lastIvl: 'lastIvl', factor: 'factor',
  time: 'time', type: 'type',
} as const;

// ─── card queue → 类别 ───

export enum QueueCategory {
  New = 0,
  Learning = 1,
  Review = 2,
  DayLearn = 3,
  Suspended = -1,
  Buried = -2,
}

export function queueCategory(queue: number): QueueCategory | undefined {
  if (queue === -1) return QueueCategory.Suspended;
  if (queue === -2 || queue === -3) return QueueCategory.Buried;
  if (queue === 0) return QueueCategory.New;
  if (queue === 1) return QueueCategory.Learning;
  if (queue === 2) return QueueCategory.Review;
  if (queue === 3) return QueueCategory.DayLearn;
  return undefined;
}
