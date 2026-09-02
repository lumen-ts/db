import type { DatabasePlugin, HookHandler } from '../core/plugin.js';
import type { Row } from '../../types.js';

/**
 * Configuration for the slug plugin.
 */
export interface SlugOptions {
  /** Source field to generate slug from. */
  sourceField: string;
  /** Target field for the slug. Default 'slug'. */
  slugField?: string;
  /** Whether to ensure uniqueness. Default false. */
  unique?: boolean;
}

/**
 * Simple slugify function: lowercase, replace spaces/special chars with hyphens.
 */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics
    .replace(/[^a-z0-9\s-]/g, '')    // remove non-alphanumeric
    .replace(/[\s_]+/g, '-')          // spaces/underscores â†’ hyphens
    .replace(/-+/g, '-')             // collapse multiple hyphens
    .replace(/^-|-$/g, '');           // trim leading/trailing hyphens
}

/**
 * Plugin that auto-generates URL slugs from a source field.
 *
 * @example
 * ```ts
 * store.use(slug({ sourceField: 'title', slugField: 'slug' }));
 *
 * await store.insert({ title: 'Hello World!' });
 * // row.slug = 'hello-world'
 * ```
 */
export function slug<T extends Row = Row>(options: SlugOptions): DatabasePlugin<T> {
  const sourceField = options.sourceField;
  const slugField = options.slugField ?? 'slug';

  const generateSlug = (data: Record<string, unknown>): void => {
    if (data[slugField] !== undefined) return; // don't overwrite explicit slug
    const source = data[sourceField];
    if (typeof source === 'string' && source.length > 0) {
      data[slugField] = slugify(source);
    }
  };

  const beforeInsert: HookHandler<T> = (_ctx, payload) => {
    generateSlug(payload.data as Record<string, unknown>);
  };

  const beforeInsertMany: HookHandler<T> = (_ctx, payload) => {
    const rows = payload.rows as Record<string, unknown>[];
    for (const row of rows) generateSlug(row);
  };

  const beforeUpdate: HookHandler<T> = (_ctx, payload) => {
    const changes = payload.changes as Record<string, unknown>;
    if (changes[sourceField] !== undefined && changes[slugField] === undefined) {
      changes[slugField] = slugify(changes[sourceField] as string);
    }
  };

  return {
    name: 'slug',
    hooks: {
      'before:insert': beforeInsert,
      'before:insertMany': beforeInsertMany,
      'before:update': beforeUpdate,
      'before:upsert': beforeInsert,
    },
  };
}

export { slugify };
