import type { DatabasePlugin, HookHandler, HookEvent } from '../core/plugin.js';
import type { Row } from '../../types.js';

/**
 * Event data emitted for each store operation.
 */
export interface StoreEvent<T extends Row = Row> {
  event: HookEvent;
  tableName: string;
  duration?: number | undefined;
  data?: unknown | undefined;
  result?: unknown | undefined;
  error?: unknown | undefined;
}

/**
 * Event listener type.
 */
export type StoreEventListener<T extends Row = Row> = (event: StoreEvent<T>) => void | Promise<void>;

/**
 * Plugin that emits events for all store operations.
 * Useful for logging, monitoring, and debugging.
 *
 * @example
 * ```ts
 * const store = conn.table<User>('users');
 * store.use(events({
 *   onEvent: (event) => {
 *     console.log(`[${event.event}] ${event.tableName} (${event.duration}ms)`);
 *   },
 *   onError: (event) => {
 *     logger.error(`Store error: ${event.event}`, event.error);
 *   },
 * }));
 * ```
 */
export function events<T extends Row = Row>(config?: {
  onEvent?: StoreEventListener<T>;
  onError?: StoreEventListener<T>;
  /** Only emit events for these operations (default: all) */
  events?: HookEvent[];
}): DatabasePlugin<T> {
  const listeners: StoreEventListener<T>[] = [];
  const errorListeners: StoreEventListener<T>[] = [];
  const filter = new Set(config?.events ?? []);

  if (config?.onEvent) listeners.push(config.onEvent);
  if (config?.onError) errorListeners.push(config.onError);

  const emit = async (event: StoreEvent<T>) => {
    if (filter.size > 0 && !filter.has(event.event)) return;
    for (const listener of listeners) await listener(event);
  };

  const emitError = async (event: StoreEvent<T>) => {
    if (filter.size > 0 && !filter.has(event.event)) return;
    for (const listener of errorListeners) await listener(event);
  };

  const beforeHandler: HookHandler<T> = (ctx, payload) => {
    payload._startTime = performance.now();
    emit({
      event: ctx.event,
      tableName: ctx.tableName,
      data: payload.data,
    });
  };

  const afterHandler: HookHandler<T> = (ctx, payload) => {
    const startTime = payload._startTime as number | undefined;
    const duration = startTime ? performance.now() - startTime : undefined;
    emit({
      event: ctx.event,
      tableName: ctx.tableName,
      duration,
      data: payload.data,
      result: payload.result,
    });
  };

  const errorBeforeHandler: HookHandler<T> = (ctx, payload) => {
    payload._startTime = performance.now();
  };

  const errorAfterHandler: HookHandler<T> = (ctx, payload) => {
    const startTime = payload._startTime as number | undefined;
    const duration = startTime ? performance.now() - startTime : undefined;
    emitError({
      event: ctx.event,
      tableName: ctx.tableName,
      duration,
      data: payload.data,
      error: payload._error,
    });
  };

  return {
    name: 'events',
    hooks: {
      'before:findAll': beforeHandler,
      'after:findAll': afterHandler,
      'before:findOne': beforeHandler,
      'after:findOne': afterHandler,
      'before:findById': beforeHandler,
      'after:findById': afterHandler,
      'before:count': beforeHandler,
      'after:count': afterHandler,
      'before:insert': beforeHandler,
      'after:insert': afterHandler,
      'before:insertMany': beforeHandler,
      'after:insertMany': afterHandler,
      'before:update': beforeHandler,
      'after:update': afterHandler,
      'before:updateById': beforeHandler,
      'after:updateById': afterHandler,
      'before:delete': beforeHandler,
      'after:delete': afterHandler,
      'before:deleteById': beforeHandler,
      'after:deleteById': afterHandler,
      'before:upsert': beforeHandler,
      'after:upsert': afterHandler,
    },
  };
}
