import type { DatabasePlugin, HookHandler } from '../core/plugin.js';
import type { ListOptions, Row, Where } from '../../types.js';

/**
 * Configuration for the audit plugin.
 */
export interface AuditOptions<T extends Row = Row> {
  /** Column name for who made the change. Default "updatedBy". */
  actorColumn?: string;
  /** Column name for creation actor. Default "createdBy". */
  creatorColumn?: string;
  /** Column name for change reason. Default "auditReason". */
  reasonColumn?: string;
  /** Function to resolve the current actor identity. */
  getActor?: () => string | undefined;
  /** Track reads (findAll/findOne/findById). Default false. */
  trackReads?: boolean;
  /** Custom logger for audit events. */
  onAudit?: (event: AuditEvent<T>) => void | Promise<void>;
}

/**
 * Audit event recorded for each operation.
 */
export interface AuditEvent<T extends Row = Row> {
  operation: 'insert' | 'update' | 'delete' | 'upsert';
  tableName: string;
  actor?: string | undefined;
  rowId?: string | number | bigint | undefined;
  before?: Partial<T> | undefined;
  after?: Partial<T> | undefined;
  timestamp: string;
}

/**
 * Plugin that automatically stamps audit columns (updatedBy, createdBy)
 * on writes and optionally logs all operations.
 *
 * @example
 * ```ts
 * store.use(audit({
 *   getActor: () => getCurrentUser()?.id,
 *   onAudit: (e) => console.log(`[${e.operation}] ${e.tableName} by ${e.actor}`),
 * }));
 * ```
 */
export function audit<T extends Row = Row>(options: AuditOptions<T> = {}): DatabasePlugin<T> {
  const actorColumn = options.actorColumn ?? 'updatedBy';
  const creatorColumn = options.creatorColumn ?? 'createdBy';
  const getActor = options.getActor;
  const onAudit = options.onAudit;

  const emit = (event: AuditEvent<T>) => {
    if (onAudit) onAudit(event);
  };

  const beforeInsert: HookHandler<T> = (_ctx, payload) => {
    const actor = getActor?.();
    if (actor !== undefined) {
      const data = payload.data as Record<string, unknown>;
      if (data[creatorColumn] === undefined) data[creatorColumn] = actor;
      data[actorColumn] = actor;
    }
  };

  const afterInsert: HookHandler<T> = (ctx, payload) => {
    const result = payload.result as T | undefined;
    emit({
      operation: 'insert',
      tableName: ctx.tableName,
      actor: getActor?.(),
      rowId: result?.['id'] as string | number | bigint | undefined,
      after: result as Partial<T>,
      timestamp: new Date().toISOString(),
    });
  };

  const beforeUpdate: HookHandler<T> = (_ctx, payload) => {
    const actor = getActor?.();
    if (actor !== undefined) {
      const changes = payload.changes as Record<string, unknown>;
      changes[actorColumn] = actor;
    }
  };

  const afterUpdate: HookHandler<T> = (ctx, payload) => {
    emit({
      operation: 'update',
      tableName: ctx.tableName,
      actor: getActor?.(),
      after: payload.changes as Partial<T>,
      timestamp: new Date().toISOString(),
    });
  };

  const afterDelete: HookHandler<T> = (ctx, payload) => {
    emit({
      operation: 'delete',
      tableName: ctx.tableName,
      actor: getActor?.(),
      rowId: payload.id as string | number | bigint | undefined,
      timestamp: new Date().toISOString(),
    });
  };

  const afterUpsert: HookHandler<T> = (ctx, payload) => {
    const actor = getActor?.();
    if (actor !== undefined) {
      const data = payload.data as Record<string, unknown>;
      if (data[creatorColumn] === undefined) data[creatorColumn] = actor;
      data[actorColumn] = actor;
    }
    emit({
      operation: 'upsert',
      tableName: ctx.tableName,
      actor,
      after: payload.data as Partial<T>,
      timestamp: new Date().toISOString(),
    });
  };

  return {
    name: 'audit',
    hooks: {
      'before:insert': beforeInsert,
      'after:insert': afterInsert,
      'before:update': beforeUpdate,
      'after:update': afterUpdate,
      'after:delete': afterDelete,
      'after:upsert': afterUpsert,
    },
  };
}
