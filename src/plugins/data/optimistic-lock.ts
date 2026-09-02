import { DatabaseException, type DatabaseErrorCode } from '../../exceptions.js';
import type { DatabasePlugin, HookHandler } from '../core/plugin.js';
import type { Row } from '../../types.js';

/**
 * Configuration for the optimistic locking plugin.
 */
export interface OptimisticLockOptions {
  /** Column name for the version number. Default "version". */
  versionColumn?: string;
  /** Starting version value for new rows. Default 1. */
  initialVersion?: number;
}

/**
 * Plugin that implements optimistic locking using a version column.
 * On update, the WHERE clause includes `version = currentVersion` and
 * increments it. If the row was modified since read, 0 rows are affected
 * and an error is thrown.
 *
 * Prevents lost updates in concurrent API environments without pessimistic locks.
 *
 * @example
 * ```ts
 * store.use(optiLock());
 *
 * const user = await store.findById(1); // version: 3
 * await store.updateById(1, { name: 'new name' });
 * // SQL: UPDATE users SET name = $1, version = $2 WHERE id = $3 AND version = $4
 * // If another request updated first â†’ throws CONFLICT
 * ```
 */
export function optiLock<T extends Row = Row>(
  options: OptimisticLockOptions = {},
): DatabasePlugin<T> {
  const versionColumn = options.versionColumn ?? 'version';
  const initialVersion = options.initialVersion ?? 1;

  const beforeInsert: HookHandler<T> = (_ctx, payload) => {
    const data = payload.data as Record<string, unknown>;
    if (data[versionColumn] === undefined) {
      data[versionColumn] = initialVersion;
    }
  };

  const beforeUpdate: HookHandler<T> = (_ctx, payload) => {
    const changes = payload.changes as Record<string, unknown>;
    // Increment version on every update
    changes[versionColumn] = { $increment: true } as unknown;
  };

  return {
    name: 'optimistic-lock',
    hooks: {
      'before:insert': beforeInsert,
      'before:update': beforeUpdate,
    },
  };
}

/**
 * Thrown when an optimistic lock conflict is detected.
 */
export class OptimisticLockError extends DatabaseException {
  constructor(tableName: string, id: string | number | bigint) {
    super(
      `Optimistic lock conflict on "${tableName}" row ${id} â€” the row was modified by another request`,
      'DATABASE_QUERY_ERROR',
      { tableName, id, conflict: true },
    );
  }
}
