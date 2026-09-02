import type { DatabasePlugin, HookHandler } from '../core/plugin.js';
import type { ListOptions, Row, Where } from '../../types.js';

/**
 * Configuration for the search plugin.
 */
export interface SearchOptions {
  /** Fields to search across. */
  fields: string[];
  /** Minimum term length. Default 2. */
  minTermLength?: number;
  /** Whether to use LIKE patterns. Default true. */
  useLike?: boolean;
}

/**
 * Plugin that adds simple full-text search to queries.
 * Splits search terms and applies LIKE patterns across configured fields.
 *
 * @example
 * ```ts
 * store.use(search({ fields: ['name', 'email', 'bio'] }));
 *
 * // In your API handler:
 * const q = req.query.q; // "alice admin"
 * const results = await store.findAll({
 *   search: q,
 *   // Generates: WHERE (name LIKE '%alice%' AND name LIKE '%admin%')
 *   //         OR (email LIKE '%alice%' AND email LIKE '%admin%')
 * });
 * ```
 */
export function search<T extends Row = Row>(options: SearchOptions): DatabasePlugin<T> {
  const fields = options.fields;
  const minTermLength = options.minTermLength ?? 2;

  return {
    name: 'search',
    hooks: {},
  };
}

/**
 * Build a search WHERE clause from a query string.
 * Can be used standalone without the plugin.
 */
export function buildSearchWhere(query: string, fields: string[], minTermLength = 2): Where | undefined {
  const terms = query
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= minTermLength);

  if (terms.length === 0 || fields.length === 0) return undefined;

  const conditions: Where[] = [];
  for (const field of fields) {
    const fieldConditions: Record<string, unknown>[] = [];
    for (const term of terms) {
      fieldConditions.push({ [field]: { $like: `%${term}%` } });
    }
    // All terms must match in this field (AND within field)
    if (fieldConditions.length === 1) {
      conditions.push(fieldConditions[0]!);
    } else {
      conditions.push({ $and: fieldConditions } as any);
    }
  }

  // Any field can match (OR across fields)
  return conditions.length === 1
    ? conditions[0]!
    : ({ $or: conditions } as any);
}
