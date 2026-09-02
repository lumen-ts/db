import type { DatabasePlugin, HookHandler } from '../core/plugin.js';
import type { Row } from '../../types.js';

/**
 * Configuration for the archival plugin.
 */
export interface ArchivalOptions {
  /** Name of the archive table. Default: `${tableName}_archive`. */
  archiveTable?: string;
  /** Column name for the archive timestamp. Default "archivedAt". */
  archivedAtColumn?: string;
  /** Column name for the archive reason. Default "archiveReason". */
  reasonColumn?: string;
  /** Function to get the archive reason from the payload. */
  getReason?: (payload: Record<string, unknown>) => string | undefined;
}

/**
 * Plugin that intercepts DELETE operations and moves rows to an archive table
 * instead of permanently removing them.
 *
 * Requires a raw query executor on the store (works with SqlTable).
 *
 * @example
 * ```ts
 * store.use(archive({ archiveTable: 'users_archive' }));
 *
 * await store.deleteById(1); // moved to users_archive with archivedAt
 * ```
 */
export function archive<T extends Row = Row>(
  options: ArchivalOptions = {},
): DatabasePlugin<T> {
  const archiveTable = options.archiveTable;
  const archivedAtColumn = options.archivedAtColumn ?? 'archivedAt';
  const reasonColumn = options.reasonColumn ?? 'archiveReason';
  const getReason = options.getReason;

  const beforeDelete: HookHandler<T> = (ctx, payload) => {
    // Flag for the SqlTable to handle â€” the actual archive logic
    // is handled by the SqlTable's delete method checking _archiveMove
    payload._archiveMove = true;
    payload._archiveTable = archiveTable ?? `${ctx.tableName}_archive`;
    payload._archiveColumn = archivedAtColumn;
    payload._archiveReason = getReason?.(payload);
    payload._archiveReasonColumn = reasonColumn;
  };

  return {
    name: 'archival',
    hooks: {
      'before:delete': beforeDelete,
      'before:deleteById': beforeDelete,
    },
  };
}

/**
 * Check if a row was archived (has an archive timestamp).
 */
export function isArchived<T extends Row = Row>(row: T, column = 'archivedAt'): boolean {
  return row[column] !== null && row[column] !== undefined;
}
