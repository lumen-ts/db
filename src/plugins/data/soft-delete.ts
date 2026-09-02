import type { HookHandler, DatabasePlugin } from '../core/plugin.js';
import type { ListOptions, Row, Where } from '../../types.js';

/**
 * Configuration for the soft delete plugin.
 */
export interface SoftDeleteOptions {
  /** Column name for the deletion timestamp. Default "deletedAt". */
  column?: string;
  /** Value to set when "deleting". Default: current ISO timestamp. */
  value?: string | (() => string);
}

/**
 * Plugin that implements soft deletes â€” instead of DELETE FROM, sets `deletedAt` to a timestamp.
 * Queries automatically exclude soft-deleted rows.
 *
 * @example
 * ```ts
 * const store = conn.table<User>('users', { timestamps: true });
 * store.use(softDelete({ column: 'deletedAt' }));
 *
 * await store.deleteById(1); // sets deletedAt instead of DELETE
 * await store.findAll();     // automatically filters out deletedAt IS NULL
 * ```
 */
export function softDelete<T extends Row = Row>(options: SoftDeleteOptions = {}): DatabasePlugin<T> {
  const column = options.column ?? 'deletedAt';
  const getValue = options.value ?? (() => new Date().toISOString());

  const applySoftDeleteFilter = (where: Where | undefined): Where => {
    if (!where) return { [column]: null };
    return { ...where, [column]: null };
  };

  const findAll: HookHandler<T> = (_ctx, payload) => {
    const opts = payload.options as ListOptions | undefined;
    if (opts) {
      opts.where = applySoftDeleteFilter(opts.where);
    }
  };

  const findOne: HookHandler<T> = (_ctx, payload) => {
    const where = payload.where as Where | undefined;
    payload.where = applySoftDeleteFilter(where);
  };

  const count: HookHandler<T> = (_ctx, payload) => {
    const where = payload.where as Where | undefined;
    payload.where = applySoftDeleteFilter(where);
  };

  const deleteHandler: HookHandler<T> = (_ctx, payload) => {
    // Convert DELETE to UPDATE with deletedAt
    payload._softDelete = true;
    payload._softDeleteValue = typeof getValue === 'function' ? getValue() : getValue;
    payload._softDeleteColumn = column;
  };

  return {
    name: 'soft-delete',
    hooks: {
      'before:findAll': findAll,
      'before:findOne': findOne,
      'before:count': count,
      'before:delete': deleteHandler,
      'before:deleteById': deleteHandler,
    },
  };
}

/**
 * Helper to check if a row is soft-deleted.
 */
export function isSoftDeleted<T extends Row = Row>(row: T, column = 'deletedAt'): boolean {
  return row[column] !== null && row[column] !== undefined;
}

/**
 * Helper to restore a soft-deleted row.
 */
export function restoreSoftDeleted<T extends Row = Row>(row: T, column = 'deletedAt'): T {
  return { ...row, [column]: null };
}
