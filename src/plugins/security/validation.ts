import type { DatabasePlugin, HookHandler } from '../core/plugin.js';
import type { Row } from '../../types.js';

/**
 * Validation rule for a single field.
 */
export interface ValidationRule {
  /** Field name to validate. */
  field: string;
  /** Validate function. Return true if valid, error message if invalid. */
  validate: (value: unknown, row: Record<string, unknown>) => true | string;
}

/**
 * Configuration for the validation plugin.
 */
export interface ValidationOptions<T extends Row = Row> {
  /** Rules to apply on insert. */
  onCreate?: ValidationRule[];
  /** Rules to apply on update (validates only changed fields). */
  onUpdate?: ValidationRule[];
  /** Rules to apply on both insert and update. */
  rules?: ValidationRule[];
}

function runRules(rules: ValidationRule[], data: Record<string, unknown>): void {
  const errors: string[] = [];
  for (const rule of rules) {
    const result = rule.validate(data[rule.field], data);
    if (result !== true) errors.push(`${rule.field}: ${result}`);
  }
  if (errors.length > 0) {
    throw new Error(`Validation failed: ${errors.join(', ')}`);
  }
}

/**
 * Plugin that validates data before writes using configurable rules.
 *
 * @example
 * ```ts
 * store.use(validate({
 *   rules: [
 *     { field: 'email', validate: (v) => typeof v === 'string' && v.includes('@') || 'Invalid email' },
 *     { field: 'name', validate: (v) => typeof v === 'string' && v.length >= 2 || 'Name too short' },
 *     { field: 'age', validate: (v) => typeof v === 'number' && v >= 0 || 'Invalid age' },
 *   ],
 * }));
 * ```
 */
export function validate<T extends Row = Row>(options: ValidationOptions<T>): DatabasePlugin<T> {
  const insertRules = [...(options.rules ?? []), ...(options.onCreate ?? [])];
  const updateRules = [...(options.rules ?? []), ...(options.onUpdate ?? [])];

  const beforeInsert: HookHandler<T> = (_ctx, payload) => {
    if (insertRules.length > 0) {
      runRules(insertRules, payload.data as Record<string, unknown>);
    }
  };

  const beforeInsertMany: HookHandler<T> = (_ctx, payload) => {
    if (insertRules.length > 0) {
      const rows = payload.rows as Record<string, unknown>[];
      for (const row of rows) runRules(insertRules, row);
    }
  };

  const beforeUpdate: HookHandler<T> = (_ctx, payload) => {
    if (updateRules.length > 0) {
      runRules(updateRules, payload.changes as Record<string, unknown>);
    }
  };

  return {
    name: 'validation',
    hooks: {
      'before:insert': beforeInsert,
      'before:insertMany': beforeInsertMany,
      'before:update': beforeUpdate,
      'before:upsert': beforeInsert,
    },
  };
}
