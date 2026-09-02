import type { DatabasePlugin, HookHandler, HookContext } from '../core/plugin.js';
import type { ListOptions, Row, Where } from '../../types.js';
import type { Query } from '../../query/query.js';

/**
 * A named scope is a reusable query preset.
 */
export type ScopeDefinition<T extends Row = Row> = (query: Query<T>) => Query<T>;

/**
 * Interface for stores that support registering scopes.
 */
interface ScopeableStore<T extends Row = Row> {
  registerScope?(name: string, scope: ScopeDefinition<T>): void;
}

/**
 * Plugin that adds named scopes to a RowStore.
 * Scopes are pre-defined query patterns that can be composed together.
 *
 * @example
 * ```ts
 * const store = conn.table<User>('users', { timestamps: true });
 * store.use(scopes({
 *   active: (q) => q.where({ deletedAt: null, status: 'active' }),
 *   admins: (q) => q.where({ role: 'admin' }),
 *   recent: (q) => q.orderBy('createdAt', 'desc').limit(10),
 * }));
 *
 * // Usage
 * const activeAdmins = await store.query()
 *   .applyScope('active')
 *   .applyScope('admins')
 *   .exec();
 * ```
 */
export function scopes<T extends Row = Row>(
  scopeDefinitions: Record<string, ScopeDefinition<T>>,
): DatabasePlugin<T> {
  return {
    name: 'scopes',
    hooks: {},
    init(store) {
      const registerStore = store as unknown as ScopeableStore<T>;
      if (registerStore.registerScope) {
        for (const [name, scope] of Object.entries(scopeDefinitions)) {
          registerStore.registerScope(name, scope);
        }
      }
    },
  };
}

