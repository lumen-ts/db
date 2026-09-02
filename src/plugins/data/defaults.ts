import type { DatabasePlugin, HookHandler } from '../core/plugin.js';
import type { Row } from '../../types.js';

/**
 * Default value definition.
 */
export interface DefaultField {
  /** Field name. */
  field: string;
  /** Default value or factory function. */
  value: unknown | (() => unknown);
}

/**
 * Plugin that applies default values to fields on insert when they are undefined.
 *
 * @example
 * ```ts
 * store.use(defaults({
 *   fields: [
 *     { field: 'status', value: 'active' },
 *     { field: 'score', value: 0 },
 *     { field: 'uuid', value: () => crypto.randomUUID() },
 *     { field: 'createdAt', value: () => new Date().toISOString() },
 *   ],
 * }));
 * ```
 */
export function defaults<T extends Row = Row>(options: { fields: DefaultField[] }): DatabasePlugin<T> {
  const fields = options.fields;

  const applyDefaults = (data: Record<string, unknown>): void => {
    for (const { field, value } of fields) {
      if (data[field] === undefined) {
        data[field] = typeof value === 'function' ? (value as () => unknown)() : value;
      }
    }
  };

  const beforeInsert: HookHandler<T> = (_ctx, payload) => {
    applyDefaults(payload.data as Record<string, unknown>);
  };

  const beforeInsertMany: HookHandler<T> = (_ctx, payload) => {
    const rows = payload.rows as Record<string, unknown>[];
    for (const row of rows) applyDefaults(row);
  };

  return {
    name: 'defaults',
    hooks: {
      'before:insert': beforeInsert,
      'before:insertMany': beforeInsertMany,
    },
  };
}
