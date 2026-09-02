import type { DatabasePlugin, HookHandler } from '../core/plugin.js';
import type { Row } from '../../types.js';

/**
 * Configuration for the request-id plugin.
 */
export interface RequestIdOptions {
  /** Column name for the request ID. Default "requestId". */
  column?: string;
  /** Function to get the current request ID. */
  getRequestId: () => string | undefined;
}

/**
 * Plugin that stamps a request ID on all writes for traceability.
 * Useful for debugging and correlating database changes with HTTP requests.
 *
 * @example
 * ```ts
 * import { randomUUID } from 'crypto';
 *
 * store.use(requestId({
 *   getRequestId: () => randomUUID(),
 * }));
 *
 * // All inserts/updates will have requestId stamped
 * await store.insert({ name: 'alice' });
 * // row.requestId = '550e8400-e29b-41d4-a716-446655440000'
 * ```
 */
export function requestId<T extends Row = Row>(options: RequestIdOptions): DatabasePlugin<T> {
  const column = options.column ?? 'requestId';
  const getRequestId = options.getRequestId;

  const stamp: HookHandler<T> = (_ctx, payload) => {
    const requestId = getRequestId();
    if (requestId !== undefined) {
      const data = payload.data as Record<string, unknown> | undefined;
      const changes = payload.changes as Record<string, unknown> | undefined;
      if (data && data[column] === undefined) data[column] = requestId;
      if (changes && changes[column] === undefined) changes[column] = requestId;
    }
  };

  return {
    name: 'request-id',
    hooks: {
      'before:insert': stamp,
      'before:insertMany': stamp,
      'before:update': stamp,
      'before:upsert': stamp,
    },
  };
}
