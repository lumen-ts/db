import type { DatabasePlugin, HookHandler } from '../core/plugin.js';
import type { Row, RowStore } from '../../types.js';

/**
 * Cascade rule definition.
 */
export interface CascadeRule<T extends Row = Row> {
  /** Store to cascade to. */
  store: RowStore<T>;
  /** Foreign key field in the related store. */
  foreignKey: string;
  /** Column in this store to match. Default 'id'. */
  localKey?: string;
}

/**
 * Plugin that cascades delete operations to related stores.
 * When a row is deleted, matching rows in related stores are also deleted.
 *
 * @example
 * ```ts
 * const orders = conn.table<Order>('orders');
 * const orderItems = conn.table<OrderItem>('order_items');
 *
 * orders.use(cascade({
 *   rules: [
 *     { store: orderItems, foreignKey: 'orderId', localKey: 'id' },
 *   ],
 * }));
 *
 * await orders.deleteById(1);
 * // Also deletes all order_items WHERE orderId = 1
 * ```
 */
export function cascade<T extends Row = Row>(
  options: { rules: CascadeRule[] },
): DatabasePlugin<T> {
  const rules = options.rules;

  const afterDelete: HookHandler<T> = async (ctx, payload) => {
    const rowId = payload.id as string | number | bigint | undefined;
    if (rowId === undefined) return;
    for (const rule of rules) {
      await rule.store.delete({ [rule.foreignKey]: rowId } as any);
    }
  };

  const afterDeleteById: HookHandler<T> = async (ctx, payload) => {
    const rowId = payload.id as string | number | bigint | undefined;
    if (rowId === undefined) return;
    for (const rule of rules) {
      await rule.store.delete({ [rule.foreignKey]: rowId } as any);
    }
  };

  return {
    name: 'cascade',
    hooks: {
      'after:delete': afterDelete,
      'after:deleteById': afterDeleteById,
    },
  };
}
