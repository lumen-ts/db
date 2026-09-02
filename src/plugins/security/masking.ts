import type { DatabasePlugin, HookHandler } from '../core/plugin.js';
import type { Row } from '../../types.js';

/**
 * Masking function: receives the raw value and returns the masked version.
 */
export type MaskFunction = (value: string) => string;

/**
 * Configuration for a single field mask.
 */
export interface FieldMask {
  /** Column name to mask. */
  field: string;
  /** Masking function. Default: shows first 2 and last 2 chars with **** in between. */
  mask?: MaskFunction;
}

/**
 * Configuration for the masking plugin.
 */
export interface MaskingOptions<T extends Row = Row> {
  /** Fields to mask and their masking functions. */
  fields: Array<FieldMask | string>;
}

const defaultMask: MaskFunction = (value) => {
  if (value.length <= 4) return '****';
  const prefix = value.slice(0, 2);
  const suffix = value.slice(-2);
  const middle = '*'.repeat(Math.min(value.length - 4, 8));
  return `${prefix}${middle}${suffix}`;
};

/**
 * Plugin that masks sensitive fields in query results.
 * Data is stored unmasked but returned masked to API consumers.
 *
 * @example
 * ```ts
 * store.use(mask({
 *   fields: [
 *     { field: 'email', mask: (v) => v.replace(/(.{2}).*(@.*)/, '$1***$2') },
 *     { field: 'ssn' },          // uses default mask: **-**-6789
 *     { field: 'creditCard' },
 *   ],
 * }));
 *
 * const user = await store.findById(1);
 * console.log(user.email);   // 'al***@example.com'
 * console.log(user.ssn);     // '12****89'
 * ```
 */
export function mask<T extends Row = Row>(options: MaskingOptions<T>): DatabasePlugin<T> {
  const masks = new Map<string, MaskFunction>();
  for (const entry of options.fields) {
    if (typeof entry === 'string') {
      masks.set(entry, defaultMask);
    } else {
      masks.set(entry.field, entry.mask ?? defaultMask);
    }
  }

  const applyMask = (row: Record<string, unknown>): void => {
    for (const [field, maskFn] of masks) {
      if (row[field] !== undefined && row[field] !== null && typeof row[field] === 'string') {
        row[field] = maskFn(row[field] as string);
      }
    }
  };

  const maskArray = (rows: unknown[]): void => {
    for (const row of rows) {
      if (row && typeof row === 'object') applyMask(row as Record<string, unknown>);
    }
  };

  const maskSingle = (result: unknown): void => {
    if (result && typeof result === 'object') applyMask(result as Record<string, unknown>);
  };

  return {
    name: 'masking',
    hooks: {
      'after:findAll': (_ctx, payload) => {
        const rows = payload.result;
        if (Array.isArray(rows)) maskArray(rows);
      },
      'after:findOne': (_ctx, payload) => {
        maskSingle(payload.result);
      },
      'after:findById': (_ctx, payload) => {
        maskSingle(payload.result);
      },
      'after:insert': (_ctx, payload) => {
        maskSingle(payload.result);
      },
      'after:upsert': (_ctx, payload) => {
        maskSingle(payload.result);
      },
    },
  };
}
