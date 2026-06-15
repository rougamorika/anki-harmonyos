/**
 * Anki 数据库访问层 — 统一导出
 */

export type {
  DbRow,
  DbResultSet,
  DbConnection,
} from './connection.ts';

export {
  querySingle,
  queryAll,
  queryScalar,
} from './connection.ts';

export {
  TABLE_COL,
  TABLE_NOTES,
  TABLE_CARDS,
  TABLE_REVLOG,
  TABLE_GRAVES,
  DDL,
  QueueCategory,
  queueCategory,
} from './schema.ts';

export type {
  ColRow,
  CardRow,
  NoteRow,
  RevlogRow,
  DeckJson,
  DecksJson,
  DeckSummary,
  NotetypeField,
  NotetypeTemplate,
  NotetypeJson,
  NotetypesJson,
  DeckConfigJson,
  DeckConfigsJson,
} from './types.ts';

export {
  FIELD_SEPARATOR,
  parseNoteFields,
  fieldsToRecord,
  parseJsonSafe,
} from './types.ts';

export {
  buildDeckTree,
  flattenDeckTree,
  getDeckCardCounts,
  getDeckSummaries,
  getDecksJson,
  getModelsJson,
  getDconfJson,
  getDeckConfig,
  getDeckById,
  getCardCountInDeck,
} from './decks.ts';

export type {
  CardQueryOptions,
  CardBrowseRow,
} from './cards.ts';

export {
  queryCards,
  getNextDueCard,
  countCards,
  getCardById,
  getNoteById as getNoteByIdFromCards,
  getNotetype,
  getCardBrowseRows,
  originalDeckId,
} from './cards.ts';

export type {
  DailyReviewSummary,
} from './notes.ts';

export {
  getNoteById,
  getCardsByNoteId,
  searchNotes,
  getRevlogByCardId,
  getDailyReviewAggregation,
  getReviewStats,
  insertRevlog,
} from './notes.ts';
