import type { DatabasePlugin } from '../core/plugin.js';
import type { Row } from '../../types.js';

/**
 * Cache entry with TTL.
 */
interface CacheEntry<T = unknown> {
  value: T;
  expiresAt: number;
}

/**
 * Configuration for the cache plugin.
 */
export interface CachePluginOptions {
  /** Default TTL in milliseconds. Default 60000 (1 minute). */
  defaultTtl?: number;
  /** Maximum number of entries. Default 1000. */
  maxSize?: number;
  /** Custom cache key generator */
  keyGenerator?: (tableName: string, event: string, args: Record<string, unknown>) => string;
  /** Custom invalidation patterns */
  invalidateOn?: ('insert' | 'update' | 'delete' | 'upsert')[];
}

function defaultKeyGenerator(tableName: string, event: string, args: Record<string, unknown>): string {
  const parts = [tableName, event];
  if (args.where) parts.push(JSON.stringify(args.where));
  if (args.id !== undefined) parts.push(String(args.id));
  if (args.options) parts.push(JSON.stringify(args.options));
  return parts.join(':');
}

/**
 * Plugin that caches query results with configurable TTL.
 * Cache is automatically invalidated on write operations.
 *
 * @example
 * ```ts
 * const store = conn.table<User>('users');
 * store.use(cache({
 *   defaultTtl: 30_000,  // 30 seconds
 *   maxSize: 500,
 *   invalidateOn: ['insert', 'update', 'delete'],
 * }));
 *
 * // First call hits database
 * const users = await store.findAll({ where: { role: 'admin' } });
 *
 * // Second call returns from cache (within TTL)
 * const cached = await store.findAll({ where: { role: 'admin' } });
 * ```
 */
export function cache<T extends Row = Row>(options: CachePluginOptions = {}): DatabasePlugin<T> {
  const ttl = options.defaultTtl ?? 60_000;
  const maxSize = options.maxSize ?? 1000;
  const keyGen = options.keyGenerator ?? defaultKeyGenerator;
  const invalidateOn = new Set(options.invalidateOn ?? ['insert', 'update', 'delete', 'upsert']);
  const cache = new Map<string, CacheEntry>();

  const get = (key: string): unknown | undefined => {
    const entry = cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      cache.delete(key);
      return undefined;
    }
    return entry.value;
  };

  const set = (key: string, value: unknown): void => {
    if (cache.size >= maxSize) {
      // Evict oldest entry
      const firstKey = cache.keys().next().value;
      if (firstKey !== undefined) cache.delete(firstKey);
    }
    cache.set(key, { value, expiresAt: Date.now() + ttl });
  };

  const invalidate = (tableName: string): void => {
    for (const key of cache.keys()) {
      if (key.startsWith(tableName)) cache.delete(key);
    }
  };

  const beforeCache = (event: string, extractArgs: (payload: Record<string, unknown>) => Record<string, unknown>) =>
    (ctx: { tableName: string }, payload: Record<string, unknown>) => {
      const key = keyGen(ctx.tableName, event, extractArgs(payload));
      const cached = get(key);
      if (cached !== undefined) {
        payload._cacheHit = true;
        payload._cacheResult = cached;
      }
    };

  const afterCache = (event: string, extractArgs: (payload: Record<string, unknown>) => Record<string, unknown>) =>
    (ctx: { tableName: string }, payload: Record<string, unknown>) => {
      if (payload._cacheResult !== undefined) {
        payload.result = payload._cacheResult;
      } else if (payload.result !== undefined) {
        const key = keyGen(ctx.tableName, event, extractArgs(payload));
        set(key, payload.result);
      }
    };

  const invalidateOnWrite = (ctx: { tableName: string }) => invalidate(ctx.tableName);

  return {
    name: 'cache',
    hooks: {
      'before:findAll': beforeCache('findAll', (p) => ({ where: p.where, options: p.options })),
      'after:findAll': afterCache('findAll', (p) => ({ where: p.where, options: p.options })),
      'before:findOne': beforeCache('findOne', (p) => ({ where: p.where })),
      'after:findOne': afterCache('findOne', (p) => ({ where: p.where })),
      'before:findById': beforeCache('findById', (p) => ({ id: p.id })),
      'after:findById': afterCache('findById', (p) => ({ id: p.id })),
      'after:insert': invalidateOnWrite,
      'after:insertMany': invalidateOnWrite,
      'after:update': invalidateOnWrite,
      'after:updateById': invalidateOnWrite,
      'after:delete': invalidateOnWrite,
      'after:deleteById': invalidateOnWrite,
      'after:upsert': invalidateOnWrite,
    },
  };
}

