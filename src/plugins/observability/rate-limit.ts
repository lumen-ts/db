import type { DatabasePlugin, HookHandler } from '../core/plugin.js';
import type { Row } from '../../types.js';

/**
 * In-memory rate limiter entry.
 */
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * Configuration for the rate limit plugin.
 */
export interface RateLimitOptions {
  /** Maximum requests per window. Default 100. */
  max?: number;
  /** Window duration in milliseconds. Default 60000 (1 minute). */
  windowMs?: number;
  /** Function to extract the rate limit key (e.g. user ID). Default: 'global'. */
  getKey?: () => string;
  /** Called when a rate limit is exceeded. Default: throw error. */
  onExceeded?: (key: string, remaining: number) => void | never;
}

/**
 * Plugin that enforces in-memory rate limiting on write operations.
 *
 * @example
 * ```ts
 * store.use(rateLimit({
 *   max: 10,
 *   windowMs: 60_000,
 *   getKey: () => getCurrentUser()?.id ?? 'anonymous',
 * }));
 * ```
 */
export function rateLimit<T extends Row = Row>(options: RateLimitOptions = {}): DatabasePlugin<T> {
  const max = options.max ?? 100;
  const windowMs = options.windowMs ?? 60_000;
  const getKey = options.getKey ?? (() => 'global');
  const onExceeded = options.onExceeded;
  const limits = new Map<string, RateLimitEntry>();

  const check = (operation: string): void => {
    const key = `${getKey()}:${operation}`;
    const now = Date.now();
    let entry = limits.get(key);

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      limits.set(key, entry);
    }

    entry.count++;

    if (entry.count > max) {
      const remaining = Math.max(0, max - entry.count + 1);
      if (onExceeded) {
        onExceeded(key, remaining);
      } else {
        throw new Error(`Rate limit exceeded for "${operation}" â€” try again in ${Math.ceil((entry.resetAt - now) / 1000)}s`);
      }
    }
  };

  const guard: HookHandler<T> = (_ctx, payload) => {
    check(_ctx.event);
  };

  return {
    name: 'rate-limit',
    hooks: {
      'before:insert': guard,
      'before:insertMany': guard,
      'before:update': guard,
      'before:updateById': guard,
      'before:delete': guard,
      'before:deleteById': guard,
      'before:upsert': guard,
    },
  };
}
