import type { DatabasePlugin, HookHandler } from '../core/plugin.js';
import type { Row } from '../../types.js';

/**
 * Socket plugin options.
 */
export interface SocketPluginOptions<T extends Row = Row> {
  /** Socket server instance with broadcast method. */
  server: {
    broadcast(event: string, data: unknown, options?: { room?: string }): void;
  };
  /** Room name prefix. Default: table name. */
  roomPrefix?: string;
  /** Events to broadcast. Default: all CRUD operations. */
  events?: string[];
  /** Transform data before broadcasting. */
  transform?: (event: string, data: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * Plugin that broadcasts database changes via WebSocket.
 * Automatically notifies connected clients when data changes.
 *
 * @example
 * ```ts
 * import { SocketServer } from '@lumen/socket';
 *
 * const socket = new SocketServer({ port: 3001 });
 * const table = conn.table<User>('users');
 *
 * table.use(socket({
 *   server: socket,
 *   roomPrefix: 'db',
 * }));
 *
 * // Clients receive: { event: 'db:users:insert', data: { id: '1', name: 'Alice' } }
 * // Clients receive: { event: 'db:users:update', data: { id: '1', name: 'Bob' } }
 * // Clients receive: { event: 'db:users:delete', data: { id: '1' } }
 * ```
 */
export function socket<T extends Row = Row>(
  options: SocketPluginOptions<T>,
): DatabasePlugin<T> {
  const server = options.server;
  const roomPrefix = options.roomPrefix ?? '';
  const transform = options.transform;

  const broadcast = (tableName: string, event: string, data: Record<string, unknown>) => {
    const room = roomPrefix ? `${roomPrefix}:${tableName}` : tableName;
    const payload = transform ? transform(event, data) : data;
    server.broadcast(event, payload, { room });
  };

  const afterInsert: HookHandler<T> = (ctx, payload) => {
    broadcast(ctx.tableName, `${ctx.tableName}:insert`, payload.data as Record<string, unknown>);
  };

  const afterUpdate: HookHandler<T> = (ctx, payload) => {
    broadcast(ctx.tableName, `${ctx.tableName}:update`, {
      where: payload.where,
      changes: payload.changes,
    });
  };

  const afterDelete: HookHandler<T> = (ctx, payload) => {
    broadcast(ctx.tableName, `${ctx.tableName}:delete`, {
      id: payload.id,
      where: payload.where,
    });
  };

  const afterUpsert: HookHandler<T> = (ctx, payload) => {
    broadcast(ctx.tableName, `${ctx.tableName}:upsert`, payload.data as Record<string, unknown>);
  };

  return {
    name: 'socket',
    hooks: {
      'after:insert': afterInsert,
      'after:update': afterUpdate,
      'after:delete': afterDelete,
      'after:deleteById': afterDelete,
      'after:upsert': afterUpsert,
    },
  };
}
