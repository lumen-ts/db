import { DatabaseException } from '../exceptions.js';
import type { SqlDialect, Where } from '../types.js';

const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Validates a raw identifier against the safe whitelist. Throws `DATABASE_INVALID_IDENTIFIER`. */
export function assertIdentifier(identifier: string, label = 'identifier'): void {
  if (!IDENTIFIER_RE.test(identifier)) {
    throw new DatabaseException(
      `Invalid ${label} "${identifier}": only letters, digits and underscores are allowed.`,
      'DATABASE_INVALID_IDENTIFIER',
      { identifier },
    );
  }
}

/**
 * Renders a `Where` tree into a parameterized SQL condition.
 * Values are always bound as parameters (`$n` for postgres/memory, `?` for mysql);
 * identifiers are validated and never interpolated from raw input.
 * Returns `undefined` when the filter is empty (no WHERE clause).
 * `fromIndex` offsets the `$n` cardinality so clauses compose (e.g. after SET params).
 */
export function renderWhere(dialect: SqlDialect, where: Where | undefined, fromIndex = 1): { text: string; params: unknown[] } | undefined {
  if (!where) return undefined;
  const entries = Object.entries(where);
  if (entries.length === 0) return undefined;

  const params: unknown[] = [];
  const bind = (value: unknown): string => {
    params.push(value);
    return dialect === 'mysql' ? '?' : `$${fromIndex + params.length - 1}`;
  };

  const parts: string[] = [];
  for (const [field, value] of entries) {
    assertIdentifier(field, 'filter field');
    if (value === undefined) continue;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const ops = value as Record<string, unknown>;
      const opEntries = Object.entries(ops).filter(([k]) => k.startsWith('$'));
      if (opEntries.length === 0) {
        parts.push(`${field} = ${bind(ops)}`);
        continue;
      }
      for (const [op, operand] of opEntries) parts.push(renderOperator(field, op, operand, bind));
    } else {
      parts.push(`${field} = ${bind(value)}`);
    }
  }

  return { text: parts.join(' AND '), params };
}

function renderOperator(
  field: string,
  op: string,
  operand: unknown,
  bind: (value: unknown) => string,
): string {
  switch (op) {
    case '$eq':
      return `${field} = ${bind(operand)}`;
    case '$ne':
      return `${field} != ${bind(operand)}`;
    case '$gt':
      return `${field} > ${bind(operand)}`;
    case '$gte':
      return `${field} >= ${bind(operand)}`;
    case '$lt':
      return `${field} < ${bind(operand)}`;
    case '$lte':
      return `${field} <= ${bind(operand)}`;
    case '$in': {
      const values = operand as unknown[];
      return `${field} IN (${values.map(bind).join(', ')})`;
    }
    case '$nin': {
      const values = operand as unknown[];
      return `${field} NOT IN (${values.map(bind).join(', ')})`;
    }
    case '$like':
      return `${field} LIKE ${bind(operand)}`;
    case '$isNull':
      return operand === true ? `${field} IS NULL` : `${field} IS NOT NULL`;
    case '$between': {
      const [lo, hi] = operand as [unknown, unknown];
      return `${field} BETWEEN ${bind(lo)} AND ${bind(hi)}`;
    }
    case '$not': {
      const inner = operand as Record<string, unknown>;
      const innerOp = Object.entries(inner)[0];
      if (!innerOp) throw new DatabaseException(`$not requires an inner operator`, 'DATABASE_UNSUPPORTED_OPERATION', { field, op });
      return `NOT (${renderOperator(field, innerOp[0], innerOp[1], bind)})`;
    }
    default:
      throw new DatabaseException(`Unsupported filter operator "${op}"`, 'DATABASE_UNSUPPORTED_OPERATION', { field, op });
  }
}

/** Renders an `ORDER BY` clause from validated fields and directions. */
export function renderOrderBy(orderBy: Record<string, 'asc' | 'desc'> | undefined): string {
  if (!orderBy) return '';
  const parts: string[] = [];
  for (const [field, dir] of Object.entries(orderBy)) {
    assertIdentifier(field, 'order field');
    parts.push(`${field} ${dir === 'desc' ? 'DESC' : 'ASC'}`);
  }
  return parts.length > 0 ? ` ORDER BY ${parts.join(', ')}` : '';
}

/** Validates a projection and returns its text (or `*`). */
export function renderSelect(select: string[] | undefined): string {
  if (!select || select.length === 0) return '*';
  for (const column of select) assertIdentifier(column, 'selected column');
  return select.join(', ');
}

/** Converts a SQL `LIKE` pattern (`%`, `_`) into a RegExp. */
export function likeToRegExp(pattern: string): RegExp {
  let out = '';
  for (const ch of pattern) {
    if (ch === '%') out += '.*';
    else if (ch === '_') out += '.';
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}