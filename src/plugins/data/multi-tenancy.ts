import type { DatabasePlugin, HookHandler } from '../core/plugin.js';
import type { ListOptions, Row, Where } from '../../types.js';

/**
 * Configuration for the multi-tenancy plugin.
 */
export interface MultiTenancyOptions<T extends Row = Row> {
  /** Column name for the tenant identifier. Default "tenantId". */
  tenantColumn?: string;
  /** Function to resolve the current tenant. Required. */
  getTenant: () => string | number | undefined;
  /** Throw on missing tenant. Default true. */
  strict?: boolean;
}

/**
 * Plugin that enforces row-level multi-tenancy.
 * Automatically adds tenant_id to all WHERE clauses and stamps it on inserts.
 *
 * @example
 * ```ts
 * store.use(tenant({
 *   getTenant: () => getCurrentUser()?.tenantId,
 * }));
 *
 * // Automatically filtered by tenant
 * const users = await store.findAll();
 * // SQL: SELECT * FROM users WHERE tenantId = $1
 *
 * // Automatically stamped on insert
 * await store.insert({ name: 'alice' });
 * // SQL: INSERT INTO users (name, tenantId) VALUES ($1, $2)
 * ```
 */
export function tenant<T extends Row = Row>(
  options: MultiTenancyOptions<T>,
): DatabasePlugin<T> {
  const tenantColumn = options.tenantColumn ?? 'tenantId';
  const getTenant = options.getTenant;
  const strict = options.strict ?? true;

  const requireTenant = (): string | number | undefined => {
    const tenant = getTenant();
    if (strict && (tenant === undefined || tenant === null)) {
      throw new Error(`Multi-tenancy: no tenant resolved â€” all queries require a tenant context`);
    }
    return tenant;
  };

  const stampTenant = (data: Record<string, unknown>) => {
    const tenant = getTenant();
    if (tenant !== undefined && data[tenantColumn] === undefined) {
      data[tenantColumn] = tenant;
    }
  };

  const filterByTenant = (where: Where | undefined): Where => {
    const tenant = requireTenant();
    if (tenant === undefined) return where ?? {};
    return { ...where, [tenantColumn]: tenant };
  };

  const findAll: HookHandler<T> = (_ctx, payload) => {
    const opts = payload.options as ListOptions | undefined;
    if (opts) opts.where = filterByTenant(opts.where);
  };

  const findOne: HookHandler<T> = (_ctx, payload) => {
    payload.where = filterByTenant(payload.where as Where | undefined);
  };

  const count: HookHandler<T> = (_ctx, payload) => {
    payload.where = filterByTenant(payload.where as Where | undefined);
  };

  const beforeInsert: HookHandler<T> = (_ctx, payload) => {
    stampTenant(payload.data as Record<string, unknown>);
  };

  const beforeInsertMany: HookHandler<T> = (_ctx, payload) => {
    const rows = payload.rows as Record<string, unknown>[];
    for (const row of rows) stampTenant(row);
  };

  const beforeUpdate: HookHandler<T> = (_ctx, payload) => {
    stampTenant(payload.changes as Record<string, unknown>);
    // Ensure updates only affect current tenant's rows
    payload.where = filterByTenant(payload.where as Where | undefined);
  };

  const beforeDelete: HookHandler<T> = (_ctx, payload) => {
    payload.where = filterByTenant(payload.where as Where | undefined);
  };

  return {
    name: 'multi-tenancy',
    hooks: {
      'before:findAll': findAll,
      'before:findOne': findOne,
      'before:count': count,
      'before:insert': beforeInsert,
      'before:insertMany': beforeInsertMany,
      'before:update': beforeUpdate,
      'before:delete': beforeDelete,
      'before:deleteById': (_ctx, payload) => {
        // deleteById uses id only, tenant filtering is applied
        // by the delete hook chain
      },
    },
  };
}
