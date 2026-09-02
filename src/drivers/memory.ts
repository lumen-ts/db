import { DatabaseException, toDatabaseException } from '../exceptions.js';
import { assertIdentifier, likeToRegExp } from '../query/operators.js';
import { SqlTable } from '../stores/sql-table.js';
import type { MemoryConfig, QueryResult, Row, RowStore, SqlConnection, TableOptions, Transaction } from '../types.js';

/**
 * In-process SQL store used for local development and tests. It implements a
 * small, deterministic subset of the SQL the framework generates — SELECT/INSERT/
 * UPDATE/DELETE with parameterized WHERE, ORDER BY, LIMIT/OFFSET and transactions.
 * Anything outside that subset fails with `DATABASE_UNSUPPORTED_OPERATION`.
 */
export class MemoryConnection implements SqlConnection {
  readonly dialect = 'memory' as const;
  readonly name: string;
  private readonly db: MemoryDb;

  constructor(name = 'default', config: MemoryConfig = { driver: 'memory' }) {
    this.name = name;
    this.db = new MemoryDb();
    for (const [table, rows] of Object.entries(config.seed ?? {})) this.db.tables.set(table, structuredClone(rows));
  }

  async connect(): Promise<void> {}
  async ping(): Promise<void> {}

  async query<T extends Row = Row>(text: string, params: readonly unknown[] = []): Promise<QueryResult<T>> {
    return exec(this.db, text, params) as unknown as QueryResult<T>;
  }

  async transaction<R>(work: (tx: Transaction) => Promise<R>): Promise<R> {
    const tx = new MemoryTransaction(this.db, `${this.name}:tx`);
    await tx.begin();
    try {
      const result = await work(tx);
      await tx.commit();
      return result;
    } catch (error) {
      await tx.rollback().catch(() => undefined);
      if (error instanceof DatabaseException) throw error;
      throw toDatabaseException(error, 'DATABASE_TRANSACTION_ERROR');
    }
  }

  table<T extends Row = Row>(tableName: string, options?: TableOptions): RowStore<T> {
    return new SqlTable<T>(this, tableName, options);
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    this.db.tables.clear();
  }
}

function exec(db: MemoryDb, text: string, params: readonly unknown[]): QueryResult {
  const stmt = new Statement(text);
  switch (stmt.kind) {
    case 'begin':
      db.begin();
      return { rows: [], rowCount: 0 };
    case 'commit':
      db.commit();
      return { rows: [], rowCount: 0 };
    case 'rollback':
      db.rollback();
      return { rows: [], rowCount: 0 };
    case 'select': {
      const select = db.select(stmt, params);
      if (stmt.isCount) return { rows: [{ n: select.length }], rowCount: select.length };
      return { rows: select, rowCount: select.length };
    }
    case 'insert': {
      if (stmt.multiValues && stmt.multiValues.length > 1) {
        const inserted = db.insertMulti(stmt, params);
        return {
          rows: inserted,
          rowCount: inserted.length,
          affectedRows: inserted.length,
          insertId: inserted[0]![stmt.columns[0]!] as string | number | bigint,
        };
      }
      const inserted = db.insert(stmt, params);
      return {
        rows: [inserted],
        rowCount: 1,
        affectedRows: 1,
        insertId: inserted[stmt.columns[0]!] as string | number | bigint,
      };
    }
    case 'update': {
      const affected = db.update(stmt, params);
      return { rows: [], rowCount: affected, affectedRows: affected };
    }
    case 'delete': {
      const removed = db.delete(stmt, params);
      return { rows: [], rowCount: removed, affectedRows: removed };
    }
  }
}

/** Simple snapshot-based table collection powering the in-memory driver. */
class MemoryDb {
  readonly tables = new Map<string, Row[]>();
  private snapshot: Map<string, Row[]> | null = null;

  begin(): void {
    if (this.snapshot) throw new DatabaseException('Nested transactions are not supported by the memory driver', 'DATABASE_TRANSACTION_ERROR');
    this.snapshot = this.cloneTables();
  }

  commit(): void {
    this.snapshot = null;
  }

  rollback(): void {
    if (this.snapshot) {
      this.tables.clear();
      for (const [name, rows] of this.snapshot) this.tables.set(name, rows);
      this.snapshot = null;
    }
  }

  private cloneTables(): Map<string, Row[]> {
    const copy = new Map<string, Row[]>();
    for (const [name, rows] of this.tables) copy.set(name, structuredClone(rows));
    return copy;
  }

  select(stmt: Statement, params: readonly unknown[]): Row[] {
    const rows = this.rows(stmt.table);
    const filtered = stmt.where ? rows.filter((r) => evalCondition(stmt.where!, params, r)) : rows;
    return this.page(stmt, filtered).map((r) => project(r, stmt.columns));
  }

  insert(stmt: Statement, params: readonly unknown[]): Row {
    const row = buildRow(stmt, params);
    this.rows(stmt.table).push(row);
    return row;
  }

  insertMulti(stmt: Statement, params: readonly unknown[]): Row[] {
    const inserted: Row[] = [];
    for (const valueSet of stmt.multiValues ?? []) {
      const row: Row = {};
      stmt.columns.forEach((column, i) => {
        assertIdentifier(column, 'insert column');
        row[column] = refValue(valueSet[i]!, params);
      });
      this.rows(stmt.table).push(row);
      inserted.push(row);
    }
    return inserted;
  }

  update(stmt: Statement, params: readonly unknown[]): number {
    const rows = this.rows(stmt.table);
    let affected = 0;
    for (const row of rows) {
      if (!stmt.where || evalCondition(stmt.where, params, row)) {
        applySet(row, stmt, params);
        affected++;
      }
    }
    return affected;
  }

  delete(stmt: Statement, params: readonly unknown[]): number {
    const rows = this.rows(stmt.table);
    const kept: Row[] = [];
    let removed = 0;
    for (const row of rows) {
      if (stmt.where && evalCondition(stmt.where, params, row)) removed++;
      else kept.push(row);
    }
    this.tables.set(stmt.table, kept);
    return removed;
  }

  private rows(table: string): Row[] {
    let rows = this.tables.get(table);
    if (!rows) {
      rows = [];
      this.tables.set(table, rows);
    }
    return rows;
  }

  private page(stmt: Statement, rows: Row[]): Row[] {
    let out = rows;
    if (stmt.orderBy && stmt.orderBy.length > 0) {
      out = [...out].sort((a, b) => {
        for (const { field, dir } of stmt.orderBy) {
          const c = compare(a[field], b[field]);
          if (c !== 0) return dir === 'desc' ? -c : c;
        }
        return 0;
      });
    }
    const offset = stmt.offset ?? 0;
    const limit = stmt.limit;
    return limit === undefined ? out.slice(offset) : out.slice(offset, offset + limit);
  }
}

class MemoryTransaction implements Transaction {
  readonly name: string;
  constructor(
    private readonly db: MemoryDb,
    name: string,
  ) {
    this.name = name;
  }

  async begin(): Promise<void> {
    this.db.begin();
  }

  async query<T extends Row = Row>(text: string, params?: readonly unknown[]): Promise<QueryResult<T>> {
    return exec(this.db, text, params ?? []) as unknown as QueryResult<T>;
  }

  async commit(): Promise<void> {
    this.db.commit();
  }

  async rollback(): Promise<void> {
    this.db.rollback();
  }
}

type Kind = 'begin' | 'commit' | 'rollback' | 'select' | 'insert' | 'update' | 'delete';

interface Condition {
  and?: Condition[];
  or?: Condition[];
  not?: Condition;
  cmp?: { field: string; op: string; value: ValueRef };
  in?: { field: string; values: ValueRef[]; negate: boolean };
  like?: { field: string; value: ValueRef };
  isNull?: { field: string; negate: boolean };
  between?: { field: string; lo: ValueRef; hi: ValueRef };
}

type ValueRef = { kind: 'param'; index: number } | { kind: 'literal'; value: unknown };

interface OrderClause {
  field: string;
  dir: 'asc' | 'desc';
}

class Statement {
  kind!: Kind;
  table = '';
  columns: string[] = [];
  where: Condition | undefined = undefined;
  orderBy: OrderClause[] = [];
  limit: number | undefined = undefined;
  offset: number | undefined = undefined;
  values: ValueRef[] | undefined = undefined;
  multiValues: ValueRef[][] | undefined = undefined;
  set: Array<{ field: string; value: ValueRef }> = [];
  isCount = false;
  readonly text: string;
  params?: readonly unknown[];

  constructor(text: string) {
    this.text = normalize(text);
    const t = this.text;
    if (t === 'BEGIN') { this.kind = 'begin'; return; }
    if (t === 'COMMIT') { this.kind = 'commit'; return; }
    if (t === 'ROLLBACK') { this.kind = 'rollback'; return; }
    if (t.startsWith('SELECT')) { this.kind = 'select'; this.parseSelect(t); return; }
    if (t.startsWith('INSERT')) { this.kind = 'insert'; this.parseInsert(t); return; }
    if (t.startsWith('UPDATE')) { this.kind = 'update'; this.parseUpdate(t); return; }
    if (t.startsWith('DELETE')) { this.kind = 'delete'; this.parseDelete(t); return; }
    throw new DatabaseException(`Memory driver does not support "${t}"`, 'DATABASE_UNSUPPORTED_OPERATION', { sql: t });
  }

  private parseSelect(t: string): void {
    const m = t.match(/^SELECT\s+(.+?)\s+FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)([\s\S]*)$/);
    if (!m) throw unsupported(t);
    const colText = m[1]!.trim();
    if (colText === 'count(*) AS n' || colText === 'count(*)') {
      this.isCount = true;
      this.columns = [];
    } else if (colText === '*') {
      this.columns = [];
    } else {
      this.columns = colText.split(/,\s*/);
    }
    const rest = m[3] ?? '';
    let clause = rest;
    let whereText: string | undefined;
    if (/(?:^|\s)WHERE\s/i.test(clause)) {
      const idx = clause.search(/(?:^|\s)WHERE\s/i);
      const tail = clause.slice(idx).trim();
      const body = tail.replace(/^WHERE\s+/i, '');
      const next = body.search(/\s+(?:ORDER\s+BY|LIMIT|OFFSET)\b/i);
      whereText = next === -1 ? body : body.slice(0, next);
    }
    const orderMatch = clause.match(/\s+ORDER\s+BY\s+([^]+?)(?=\s+LIMIT\b|\s+OFFSET\b|$)/i);
    this.orderBy = [];
    if (orderMatch) {
      for (const part of orderMatch[1]!.split(/,\s*/)) {
        const om = part.trim().match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+(ASC|DESC)$/i);
        if (om) this.orderBy.push({ field: om[1]!, dir: om[2]!.toUpperCase() === 'DESC' ? 'desc' : 'asc' });
      }
    }
    const limitMatch = clause.match(/\s+LIMIT\s+([0-9]+)/i);
    const offsetMatch = clause.match(/\s+OFFSET\s+([0-9]+)/i);
    this.limit = limitMatch ? Number(limitMatch[1]) : undefined;
    this.offset = offsetMatch ? Number(offsetMatch[1]) : undefined;
    this.where = whereText ? parseConditionGroup(whereText) : undefined;
    this.ensureNoUnsupportedTail(clause);
    this.table = m[2]!;
  }

  /** After the known clauses are consumed, anything left indicates unsupported SQL. */
  private ensureNoUnsupportedTail(clause: string): void {
    let leftover = clause;
    const whereMatch = leftover.match(/\s+WHERE\s[\s\S]*$/i);
    if (whereMatch && whereMatch.index !== undefined) leftover = leftover.slice(0, whereMatch.index);
    leftover = leftover.replace(/\s+ORDER\s+BY[\s\S]*$/i, ' ');
    leftover = leftover.replace(/\s+LIMIT\s+[0-9]+/i, ' ');
    leftover = leftover.replace(/\s+OFFSET\s+[0-9]+/i, ' ');
    if (leftover.trim() !== '') throw unsupported(this.text);
  }

  private parseInsert(t: string): void {
    // Support both single and multi-row INSERT: VALUES (...), (...), ...
    const m = t.match(/^INSERT\s+INTO\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]+)\)\s*VALUES\s+(.+)$/);
    if (!m) throw unsupported(t);
    this.table = m[1]!;
    this.columns = m[2]!.split(/,\s*/);
    // Parse the value sets — split on '), (' pattern while respecting nested parens
    const valuesText = m[3]!.trim();
    this.multiValues = parseMultiValues(valuesText);
    // For backward compat, also store the first row as `values`
    this.values = this.multiValues[0];
  }

  private parseUpdate(t: string): void {
    const m = t.match(/^UPDATE\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+SET\s+(.+?)(?:\s+WHERE\s+([\s\S]+))?$/i);
    if (!m) throw unsupported(t);
    this.table = m[1]!;
    const set: Array<{ field: string; value: ValueRef }> = [];
    for (const part of m[2]!.split(/,\s*/)) {
      const sm = part.trim().match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/);
      if (!sm) throw unsupported(t);
      set.push({ field: sm[1]!, value: parseValueRef(sm[2]!) });
    }
    this.set = set;
    this.where = m[3] ? parseConditionGroup(m[3]) : undefined;
  }

  private parseDelete(t: string): void {
    const m = t.match(/^DELETE\s+FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:WHERE\s+([\s\S]+))?$/i);
    if (!m) throw unsupported(t);
    this.table = m[1]!;
    this.where = m[2] ? parseConditionGroup(m[2]) : undefined;
  }
}

function unsupported(sql: string): DatabaseException {
  return new DatabaseException(`Memory driver does not support "${sql}"`, 'DATABASE_UNSUPPORTED_OPERATION', { sql });
}

function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

function parseValueRef(raw: string): ValueRef {
  const p = raw.trim();
  const param = p.match(/^\$([0-9]+)$/);
  if (param) return { kind: 'param', index: Number(param[1]) - 1 };
  if (p === '?') return { kind: 'literal', value: undefined };
  if (/^-?[0-9]+$/.test(p)) return { kind: 'literal', value: Number(p) };
  if (/^-?[0-9]+\.[0-9]+$/.test(p)) return { kind: 'literal', value: Number(p) };
  if (/^'[^']*'$/.test(p)) return { kind: 'literal', value: p.slice(1, -1) };
  throw new DatabaseException(`Memory driver cannot parse value "${p}"`, 'DATABASE_UNSUPPORTED_OPERATION', { value: p });
}

/**
 * Parses multi-row INSERT values text like `($1, $2), ($3, $4), ($5, $6)` into
 * an array of value-ref arrays.
 */
function parseMultiValues(text: string): ValueRef[][] {
  const sets: ValueRef[][] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '(' && depth === 0) {
      start = i + 1;
      depth = 1;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0 && start !== -1) {
        const inner = text.slice(start, i);
        sets.push(inner.split(/,\s*/).map(parseValueRef));
        start = -1;
      }
    }
  }
  return sets;
}

/**
 * Splits on a separator, honoring parentheses. For ` AND `, a separator whose
 * right-hand side starts with a value (parameter/number/string) is *not* a real
 * boundary — it is the second half of a `BETWEEN lo AND hi` pair.
 */
function splitClause(sql: string, separator: ' AND ' | ' OR '): string[] {
  const parts: string[] = [];
  let last = 0;
  let depth = 0;
  const len = separator.length;
  for (let i = 0; i <= sql.length; i++) {
    const ch = sql[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth === 0 && sql.startsWith(separator, i)) {
      if (separator === ' AND ') {
        const after = sql.slice(i + len).trimStart();
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*\b/.test(after)) continue;
      }
      parts.push(sql.slice(last, i));
      i += len - 1;
      last = i + 1;
    }
  }
  parts.push(sql.slice(last));
  return parts.map((s) => s.trim()).filter(Boolean);
}

function parseConditionGroup(expr: string): Condition {
  const ors = splitClause(expr, ' OR ');
  if (ors.length > 1) return { or: ors.map((o) => parseAndGroup(o)) };
  return parseAndGroup(expr);
}

function parseAndGroup(expr: string): Condition {
  const ands = splitClause(expr, ' AND ');
  if (ands.length > 1) return { and: ands.map((c) => parseCondition(c)) };
  return parseCondition(expr);
}

function parseCondition(expr: string): Condition {
  const e = expr.trim();

  // Handle NOT (...) — negate the inner condition
  const notMatch = e.match(/^NOT\s+\((.+)\)$/i);
  if (notMatch) {
    // We need to negate the result of the inner condition. We do this by
    // returning a special 'not' condition wrapper.
    return { not: parseConditionGroup(notMatch[1]!) };
  }

  const isNull = e.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+IS(?:\s+NOT)?\s+NULL$/i);
  if (isNull) return { isNull: { field: isNull[1]!, negate: /NOT/i.test(e) } };

  const between = e.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+BETWEEN\s+(.+?)\s+AND\s+(.+)$/i);
  if (between) {
    return { between: { field: between[1]!, lo: parseValueRef(between[2]!), hi: parseValueRef(between[3]!) } };
  }

  const inMatch = e.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+(NOT\s+)?IN\s*\(([^)]*)\)$/i);
  if (inMatch) {
    const values = inMatch[3]!.split(/,\s*/).filter((s) => s.trim() !== '').map(parseValueRef);
    return { in: { field: inMatch[1]!, values, negate: /NOT/i.test(inMatch[2] ?? '') } };
  }

  const like = e.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+LIKE\s+(.+)$/i);
  if (like) return { like: { field: like[1]!, value: parseValueRef(like[2]!) } };

  const cmp = e.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+(<=|>=|<>|!=|=|>|<)\s+(.+)$/);
  if (cmp) return { cmp: { field: cmp[1]!, op: cmp[2]!, value: parseValueRef(cmp[3]!) } };

  throw new DatabaseException(`Memory driver cannot parse condition "${e}"`, 'DATABASE_UNSUPPORTED_OPERATION', { condition: e });
}

function refValue(ref: ValueRef, params: readonly unknown[]): unknown {
  return ref.kind === 'param' ? params[ref.index] : ref.value;
}

function evalCondition(cond: Condition, params: readonly unknown[], row: Row): boolean {
  if (cond.and) return cond.and.every((c) => evalCondition(c, params, row));
  if (cond.or) return cond.or.some((c) => evalCondition(c, params, row));
  if (cond.not) return !evalCondition(cond.not, params, row);
  if (cond.isNull) {
    const v = row[cond.isNull.field];
    const isNull = v === null || v === undefined;
    return cond.isNull.negate ? !isNull : isNull;
  }
  if (cond.between) {
    const a = row[cond.between.field];
    const lo = refValue(cond.between.lo, params);
    const hi = refValue(cond.between.hi, params);
    return compare(a, lo) >= 0 && compare(a, hi) <= 0;
  }
  if (cond.in) {
    const a = row[cond.in.field];
    const hit = cond.in.values.some((v) => equals(a, refValue(v, params)));
    return cond.in.negate ? !hit : hit;
  }
  if (cond.like) {
    const a = row[cond.like.field];
    const pattern = String(refValue(cond.like.value, params));
    const re = likeToRegExp(pattern);
    return a === null || a === undefined ? false : re.test(String(a));
  }
  if (cond.cmp) {
    const a = row[cond.cmp.field];
    const b = refValue(cond.cmp.value, params);
    return evaluateComparison(a, cond.cmp.op, b);
  }
  return true;
}

function evaluateComparison(a: unknown, op: string, b: unknown): boolean {
  switch (op) {
    case '=': return equals(a, b);
    case '!=':
    case '<>': return !equals(a, b);
    case '>': return compare(a, b) > 0;
    case '>=': return compare(a, b) >= 0;
    case '<': return compare(a, b) < 0;
    case '<=': return compare(a, b) <= 0;
    default: return false;
  }
}

function normalizeValue(v: unknown): unknown {
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) {
    const n = Number(v);
    return Number.isFinite(n) ? n : v;
  }
  return v;
}

function equals(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  return normalizeValue(a) === normalizeValue(b);
}

function compare(a: unknown, b: unknown): number {
  const an = normalizeValue(a) as number | string;
  const bn = normalizeValue(b) as number | string;
  const anum = typeof an === 'number';
  const bnum = typeof bn === 'number';
  if (anum && bnum) return an === bn ? 0 : an < bn ? -1 : 1;
  if (anum) return (an as number) < (bn as unknown as number) ? -1 : 1;
  if (bnum) return (bn as unknown as number) < (an as unknown as number) ? 1 : -1;
  const sa = String(an);
  const sb = String(bn);
  return sa === sb ? 0 : sa < sb ? -1 : 1;
}

function project(row: Row, columns: string[]): Row {
  const out: Row = {};
  const effective = columns.length === 0 ? Object.keys(row) : columns;
  for (const spec of effective) {
    const as = spec.match(/^([a-zA-Z_][a-zA-Z0-9_.]*)\s+AS\s+([a-zA-Z_][a-zA-Z0-9_]*)$/i);
    if (as) {
      out[as[2]!] = row[as[1]!];
      continue;
    }
    assertIdentifier(spec, 'selected column');
    out[spec] = row[spec];
  }
  return out;
}

function buildRow(stmt: Statement, params: readonly unknown[]): Row {
  const row: Row = {};
  stmt.columns.forEach((column, i) => {
    assertIdentifier(column, 'insert column');
    row[column] = refValue(stmt.values![i]!, params);
  });
  return row;
}

function applySet(row: Row, stmt: Statement, params: readonly unknown[]): void {
  for (const { field, value } of stmt.set) row[field] = refValue(value, params);
}