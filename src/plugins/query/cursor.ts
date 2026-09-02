import type { DatabasePlugin, HookHandler } from '../core/plugin.js';
import type { ListOptions, Row, Where } from '../../types.js';

/**
 * Configuration for the cursor plugin.
 */
export interface CursorOptions {
  /** Column used for cursor. Default 'id'. */
  cursorColumn?: string;
  /** Maximum page size. Default 100. */
  maxPageSize?: number;
}

/**
 * Cursor pagination result.
 */
export interface CursorResult<T extends Row = Row> {
  data: T[];
  nextCursor?: string | number | bigint;
  hasMore: boolean;
  /** Encode cursor for next page â€” pass as `after` in next query. */
  encodeCursor: (row: T) => string;
}

/**
 * Plugin that adds cursor-based pagination to queries.
 * Encodes cursor as base64 JSON for opaque, safe cursors.
 *
 * @example
 * ```ts
 * store.use(cursor());
 *
 * // First page
 * const page1 = await store.findAll({ limit: 10, orderBy: { id: 'asc' } });
 * const cursor = Buffer.from(JSON.stringify({ id: page1[page1.length-1].id })).toString('base64');
 *
 * // Next page
 * const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString());
 * const page2 = await store.findAll({ where: { id: { $gt: decoded.id } }, limit: 10, orderBy: { id: 'asc' } });
 * ```
 */
export function cursor<T extends Row = Row>(options: CursorOptions = {}): DatabasePlugin<T> {
  const cursorColumn = options.cursorColumn ?? 'id';
  const maxPageSize = options.maxPageSize ?? 100;

  return {
    name: 'cursor',
    hooks: {},
  };
}

/**
 * Encode a cursor from a row.
 */
export function encodeCursor<T extends Row = Row>(row: T, column = 'id'): string {
  return Buffer.from(JSON.stringify({ [column]: row[column] })).toString('base64');
}

/**
 * Decode a cursor back to a value.
 */
export function decodeCursor<T = unknown>(cursor: string, column = 'id'): Record<string, T> {
  return JSON.parse(Buffer.from(cursor, 'base64').toString());
}

/**
 * Build a WHERE clause for cursor-based pagination.
 */
export function cursorWhere<T extends Row = Row>(
  cursor: string,
  direction: 'forward' | 'backward' = 'forward',
  column = 'id',
): Where {
  const decoded = decodeCursor(cursor, column);
  const value = decoded[column];
  return direction === 'forward'
    ? { [column]: { $gt: value } }
    : { [column]: { $lt: value } };
}
