import type { DatabasePlugin, HookHandler } from '../core/plugin.js';
import type { Row } from '../../types.js';

/**
 * Trim mode for string cleaning.
 */
export type TrimMode = 'trim' | 'trimStart' | 'trimEnd' | 'lower' | 'upper' | 'normalize';

/**
 * Configuration for the trim plugin.
 */
export interface TrimOptions {
  /** Fields to clean. If omitted, cleans ALL string fields. */
  fields?: string[];
  /** Cleaning mode. Default 'trim'. */
  mode?: TrimMode | TrimMode[];
}

const processors: Record<TrimMode, (v: string) => string> = {
  trim: (v) => v.trim(),
  trimStart: (v) => v.trimStart(),
  trimEnd: (v) => v.trimEnd(),
  lower: (v) => v.toLowerCase(),
  upper: (v) => v.toUpperCase(),
  normalize: (v) => v.replace(/\s+/g, ' ').trim(),
};

/**
 * Plugin that automatically trims/cleans string fields on writes.
 *
 * @example
 * ```ts
 * // Trim all string fields
 * store.use(trim());
 *
 * // Normalize whitespace + lowercase for specific fields
 * store.use(trim({
 *   fields: ['email', 'username'],
 *   mode: ['normalize', 'lower'],
 * }));
 * ```
 */
export function trim<T extends Row = Row>(options: TrimOptions = {}): DatabasePlugin<T> {
  const modes = Array.isArray(options.mode) ? options.mode : [options.mode ?? 'trim'];
  const fieldSet = options.fields ? new Set(options.fields) : null;

  const processValue = (v: unknown): unknown => {
    if (typeof v !== 'string') return v;
    let result = v;
    for (const mode of modes) {
      result = processors[mode](result);
    }
    return result;
  };

  const cleanRow = (data: Record<string, unknown>): void => {
    for (const [key, value] of Object.entries(data)) {
      if (fieldSet) {
        if (fieldSet.has(key)) data[key] = processValue(value);
      } else {
        data[key] = processValue(value);
      }
    }
  };

  const beforeInsert: HookHandler<T> = (_ctx, payload) => {
    cleanRow(payload.data as Record<string, unknown>);
  };

  const beforeInsertMany: HookHandler<T> = (_ctx, payload) => {
    const rows = payload.rows as Record<string, unknown>[];
    for (const row of rows) cleanRow(row);
  };

  const beforeUpdate: HookHandler<T> = (_ctx, payload) => {
    cleanRow(payload.changes as Record<string, unknown>);
  };

  return {
    name: 'trim',
    hooks: {
      'before:insert': beforeInsert,
      'before:insertMany': beforeInsertMany,
      'before:update': beforeUpdate,
      'before:upsert': beforeInsert,
    },
  };
}
