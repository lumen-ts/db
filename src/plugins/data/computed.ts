import type { DatabasePlugin, HookHandler } from '../core/plugin.js';
import type { Row } from '../../types.js';

/**
 * A computed field definition.
 */
export interface ComputedField<T extends Row = Row> {
  /** Virtual field name. */
  name: string;
  /** Function that computes the value from the row. */
  compute: (row: T) => unknown;
}

/**
 * Plugin that adds virtual/computed fields to query results.
 * Fields are computed in memory after fetching from the database.
 *
 * @example
 * ```ts
 * store.use(computed({
 *   fields: [
 *     { name: 'fullName', compute: (row) => `${row.firstName} ${row.lastName}` },
 *     { name: 'isAdult', compute: (row) => (row.age as number) >= 18 },
 *     { name: 'profileUrl', compute: (row) => `/api/users/${row.id}/profile` },
 *   ],
 * }));
 *
 * const users = await store.findAll();
 * console.log(users[0].fullName); // 'Alice Smith'
 * console.log(users[0].isAdult);  // true
 * ```
 */
export function computed<T extends Row = Row>(
  options: { fields: Array<ComputedField<T>> },
): DatabasePlugin<T> {
  const fields = options.fields;

  const applyComputed = (row: Record<string, unknown>): void => {
    for (const field of fields) {
      row[field.name] = field.compute(row as unknown as T);
    }
  };

  const applyToArray = (rows: unknown[]): void => {
    for (const row of rows) {
      if (row && typeof row === 'object') applyComputed(row as Record<string, unknown>);
    }
  };

  const applyToSingle = (result: unknown): void => {
    if (result && typeof result === 'object') applyComputed(result as Record<string, unknown>);
  };

  return {
    name: 'computed-fields',
    hooks: {
      'after:findAll': (_ctx, payload) => {
        if (Array.isArray(payload.result)) applyToArray(payload.result);
      },
      'after:findOne': (_ctx, payload) => {
        applyToSingle(payload.result);
      },
      'after:findById': (_ctx, payload) => {
        applyToSingle(payload.result);
      },
      'after:insert': (_ctx, payload) => {
        applyToSingle(payload.result);
      },
      'after:upsert': (_ctx, payload) => {
        applyToSingle(payload.result);
      },
    },
  };
}
