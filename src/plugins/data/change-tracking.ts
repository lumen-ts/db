import type { DatabasePlugin, HookHandler } from '../core/plugin.js';
import type { Row } from '../../types.js';

/**
 * A single field change record.
 */
export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

/**
 * Change record for an operation.
 */
export interface ChangeRecord<T extends Row = Row> {
  operation: 'update' | 'upsert';
  tableName: string;
  rowId?: string | number | bigint;
  changes: FieldChange[];
  timestamp: string;
}

/**
 * Configuration for the change tracking plugin.
 */
export interface ChangeTrackingOptions<T extends Row = Row> {
  /** Called whenever changes are detected. */
  onChange?: (record: ChangeRecord<T>) => void | Promise<void>;
  /** Fields to ignore in change detection. Default: ['updatedAt']. */
  ignoreFields?: string[];
}

/**
 * Plugin that tracks field-level changes on update operations.
 * Captures before/after values for each changed field.
 *
 * @example
 * ```ts
 * store.use(track({
 *   onChange: (record) => {
 *     for (const c of record.changes) {
 *       console.log(`${c.field}: ${c.before} â†’ ${c.after}`);
 *     }
 *   },
 * }));
 * ```
 */
export function track<T extends Row = Row>(
  options: ChangeTrackingOptions<T> = {},
): DatabasePlugin<T> {
  const onChange = options.onChange;
  const ignoreSet = new Set(options.ignoreFields ?? ['updatedAt']);

  const computeChanges = (before: Record<string, unknown>, after: Record<string, unknown>): FieldChange[] => {
    const changes: FieldChange[] = [];
    for (const [key, newVal] of Object.entries(after)) {
      if (ignoreSet.has(key)) continue;
      const oldVal = before[key];
      if (oldVal !== newVal && JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        changes.push({ field: key, before: oldVal, after: newVal });
      }
    }
    return changes;
  };

  const beforeUpdate: HookHandler<T> = (_ctx, payload) => {
    // Store the changes for comparison in after hook
    payload._trackedChanges = payload.changes;
  };

  const afterUpdate: HookHandler<T> = (ctx, payload) => {
    const changes = payload._trackedChanges as Record<string, unknown> | undefined;
    if (!changes || !onChange) return;
    const fieldChanges = Object.entries(changes)
      .filter(([key]) => !ignoreSet.has(key))
      .map(([field, after]) => ({ field, before: undefined, after }));
    if (fieldChanges.length > 0) {
      onChange({
        operation: 'update',
        tableName: ctx.tableName,
        changes: fieldChanges,
        timestamp: new Date().toISOString(),
      });
    }
  };

  const afterUpsert: HookHandler<T> = (ctx, payload) => {
    if (!onChange) return;
    const data = payload.data as Record<string, unknown>;
    onChange({
      operation: 'upsert',
      tableName: ctx.tableName,
      changes: Object.entries(data)
        .filter(([key]) => !ignoreSet.has(key))
        .map(([field, after]) => ({ field, before: undefined, after })),
      timestamp: new Date().toISOString(),
    });
  };

  return {
    name: 'change-tracking',
    hooks: {
      'before:update': beforeUpdate,
      'after:update': afterUpdate,
      'after:upsert': afterUpsert,
    },
  };
}
