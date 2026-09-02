import { DatabaseException } from '../exceptions.js';
import { PluginManager, type DatabasePlugin } from '../plugins/core/plugin.js';
import type { ScopeDefinition } from '../plugins/query/scopes.js';
import { assertIdentifier, renderOrderBy, renderSelect, renderWhere } from '../query/operators.js';
import { Query } from '../query/query.js';
import {
  type ListOptions,
  type PrimaryKey,
  type QueryResult,
  type Row,
  type RowStore,
  type SqlDialect,
  type TableOptions,
  type Transaction,
  type Where,
} from '../types.js';

/** Minimal query surface a `SqlTable` needs from a connection or transaction. */
export interface SqlExecutor {
  readonly dialect: SqlDialect;
  query<T extends Row = Row>(text: string, params?: readonly unknown[]): Promise<QueryResult<T>>;
  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
}

function number(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new DatabaseException(`Invalid pagination value ${n}`, 'DATABASE_UNSUPPORTED_OPERATION', { value: n });
  }
  return String(n);
}

/**
 * A `RowStore` bound to a SQL table. All statements are generated with validated
 * identifiers and parameterized values; never interpolate raw user input here.
 *
 * Supports a plugin system for intercepting and augmenting CRUD operations.
 */
export class SqlTable<T extends Row = Row> implements RowStore<T> {
  readonly dialect: SqlDialect;
  readonly name: string;
  private readonly idColumn: string;
  private readonly autoId: boolean;
  private readonly timestamps: boolean;
  private readonly _pluginManager = new PluginManager<T>();
  private readonly _scopes = new Map<string, ScopeDefinition<T>>();

  constructor(
    private readonly conn: SqlExecutor,
    tableName: string,
    options: TableOptions = {},
  ) {
    assertIdentifier(tableName, 'table name');
    this.dialect = this.conn.dialect;
    this.name = tableName;
    this.idColumn = options.idColumn ?? 'id';
    this.autoId = options.autoId ?? false;
    this.timestamps = options.timestamps ?? false;
    assertIdentifier(this.idColumn, 'id column');
  }

  /** Register one or more plugins on this store. */
  use(...plugins: DatabasePlugin<T>[]): void {
    for (const plugin of plugins) {
      this._pluginManager.register(plugin);
      // Run init synchronously so scopes are available immediately
      const initFn = plugin.init;
      if (initFn) initFn(this as unknown as import('../plugins/core/plugin.js').RowStoreLike<T>);
    }
  }

  /** Access the plugin manager for this store. */
  pluginManager(): PluginManager<T> {
    return this._pluginManager;
  }

  /** Register a named scope on this store. */
  registerScope(name: string, scope: ScopeDefinition<T>): void {
    this._scopes.set(name, scope);
  }

  /** Get a named scope by name. */
  getScope(name: string): ScopeDefinition<T> | undefined {
    return this._scopes.get(name);
  }

  /** Run before/after hooks for an operation. */
  private async runHooks<R>(
    event: import('../plugins/core/plugin.js').HookEvent,
    payload: Record<string, unknown>,
    execute: () => Promise<R>,
  ): Promise<R> {
    if (this._pluginManager.hasPlugins) {
      await this._pluginManager.executeHooks(event, { tableName: this.name, event }, payload);
    }
    const result = await execute();
    payload.result = result;
    if (this._pluginManager.hasPlugins) {
      const afterEvent = event.replace('before:', 'after:') as import('../plugins/core/plugin.js').HookEvent;
      await this._pluginManager.executeHooks(afterEvent, { tableName: this.name, event: afterEvent }, payload);
    }
    return (payload.result as R) ?? result;
  }

  async findAll(options: ListOptions = {}): Promise<T[]> {
    const payload = { options: { ...options } } as Record<string, unknown>;
    return this.runHooks('before:findAll', payload, async () => {
      const opts = payload.options as ListOptions;
      const where = renderWhere(this.dialect, opts.where);
      const text =
        `SELECT ${renderSelect(opts.select)} FROM ${this.name}` +
        (where ? ` WHERE ${where.text}` : '') +
        renderOrderBy(opts.orderBy) +
        (opts.limit !== undefined ? ` LIMIT ${number(opts.limit)}` : '') +
        (opts.offset !== undefined ? ` OFFSET ${number(opts.offset)}` : '');
      const result = await this.conn.query<T>(text, where?.params);
      return result.rows;
    });
  }

  async findOne(where: Where): Promise<T | undefined> {
    const payload = { where: { ...where } } as Record<string, unknown>;
    return this.runHooks('before:findOne', payload, async () => {
      const w = payload.where as Where;
      const rendered = renderWhere(this.dialect, w);
      const text = `SELECT * FROM ${this.name}` + (rendered ? ` WHERE ${rendered.text}` : '') + ' LIMIT 1';
      const result = await this.conn.query<T>(text, rendered?.params);
      return result.rows[0];
    });
  }

  async findById(id: PrimaryKey): Promise<T | undefined> {
    const payload = { id } as Record<string, unknown>;
    return this.runHooks('before:findById', payload, async () => {
      const rendered = renderWhere(this.dialect, { [this.idColumn]: payload.id as PrimaryKey });
      const text = `SELECT * FROM ${this.name} WHERE ${rendered!.text} LIMIT 1`;
      const result = await this.conn.query<T>(text, rendered!.params);
      return result.rows[0];
    });
  }

  async count(where: Where | undefined): Promise<number> {
    const payload = { where: where ? { ...where } : undefined } as Record<string, unknown>;
    return this.runHooks('before:count', payload, async () => {
      const w = payload.where as Where | undefined;
      const rendered = renderWhere(this.dialect, w);
      const text = `SELECT count(*) AS n FROM ${this.name}` + (rendered ? ` WHERE ${rendered.text}` : '');
      const result = await this.conn.query<Row>(text, rendered?.params);
      const row = result.rows[0];
      return row ? Number(row['n']) : 0;
    });
  }

  async insert(data: Partial<T>): Promise<T> {
    const payload = { data: { ...data } } as Record<string, unknown>;
    return this.runHooks('before:insert', payload, async () => {
      const row = this.enrich(payload.data as Partial<T>);
      const columns = Object.keys(row);
      if (columns.length === 0) {
        throw new DatabaseException('Cannot insert an empty row', 'DATABASE_QUERY_ERROR');
      }
      const params = columns.map((c) => row[c]);
      const placeholders = params.map((_, i) => (this.dialect === 'mysql' ? '?' : `$${i + 1}`)).join(', ');
      const returning = this.dialect === 'postgres' ? ' RETURNING *' : '';
      const text = `INSERT INTO ${this.name} (${columns.join(', ')}) VALUES (${placeholders})${returning}`;
      const result = await this.conn.query<Row>(text, params);

      if (this.dialect === 'postgres' && result.rows.length > 0) {
        return result.rows[0] as unknown as T;
      }

      const idValue = row[this.idColumn];
      if (idValue !== undefined) {
        const inserted = await this.findById(idValue as PrimaryKey);
        if (inserted) return inserted;
      }
      const insertId = result.insertId;
      if (insertId !== undefined) {
        const inserted = await this.findById(insertId);
        if (inserted) return inserted;
      }
      return row as unknown as T;
    });
  }

  async insertMany(rows: Partial<T>[]): Promise<T[]> {
    if (rows.length === 0) return [];
    if (rows.length === 1) return [await this.insert(rows[0]!)];

    const payload = { rows: rows.map((r) => ({ ...r })) } as Record<string, unknown>;
    return this.runHooks('before:insertMany', payload, async () => {
      const enriched = (payload.rows as Partial<T>[]).map((r) => this.enrich(r));
      const columns = Object.keys(enriched[0]!);
      if (columns.length === 0) {
        throw new DatabaseException('Cannot insert an empty row', 'DATABASE_QUERY_ERROR');
      }

      const params: unknown[] = [];
      const valueSets: string[] = [];
      for (const row of enriched) {
        const placeholders = columns.map((_, i) => {
          params.push(row[columns[i]!]);
          return this.dialect === 'mysql' ? '?' : `$${params.length}`;
        });
        valueSets.push(`(${placeholders.join(', ')})`);
      }

      const returning = this.dialect === 'postgres' ? ' RETURNING *' : '';
      const text = `INSERT INTO ${this.name} (${columns.join(', ')}) VALUES ${valueSets.join(', ')}${returning}`;
      const result = await this.conn.query<Row>(text, params);

      if (this.dialect === 'postgres' && result.rows.length > 0) {
        return result.rows as unknown as T[];
      }

      // Fallback for mysql/memory: fetch back by ID if available
      const idColumn = this.idColumn;
      const hasIds = enriched.every((r) => r[idColumn] !== undefined);
      if (hasIds) {
        const ids = enriched.map((r) => r[idColumn] as PrimaryKey);
        const rendered = renderWhere(this.dialect, { [idColumn]: { $in: ids } });
        const text = `SELECT * FROM ${this.name} WHERE ${rendered!.text}`;
        const result = await this.conn.query<T>(text, rendered!.params);
        return result.rows;
      }
      // Last resort: re-insert individually
      const originalRows = payload.rows as Partial<T>[];
      const inserted: T[] = [];
      for (const row of originalRows) inserted.push(await this.insert(row));
      return inserted;
    });
  }

  async update(where: Where, changes: Partial<T>): Promise<number> {
    const payload = { where: { ...where }, changes: { ...changes } } as Record<string, unknown>;
    return this.runHooks('before:update', payload, async () => {
      const enriched = this.updated(payload.changes as Partial<T>);
      const setColumns = Object.keys(enriched);
      if (setColumns.length === 0) return 0;

      const params: unknown[] = [];
      const setSql = setColumns.map((c) => {
        params.push(enriched[c]);
        return `${c} = ${this.dialect === 'mysql' ? '?' : `$${params.length}`}`;
      });
      const rendered = renderWhere(this.dialect, payload.where as Where, params.length + 1);
      const text = `UPDATE ${this.name} SET ${setSql.join(', ')}` + (rendered ? ` WHERE ${rendered.text}` : '');
      const result = await this.conn.query<Row>(text, [...params, ...(rendered?.params ?? [])]);
      return result.affectedRows ?? result.rowCount;
    });
  }

  async updateById(id: PrimaryKey, changes: Partial<T>): Promise<T | undefined> {
    const payload = { id, changes: { ...changes } } as Record<string, unknown>;
    return this.runHooks('before:updateById', payload, async () => {
      const affected = await this.update({ [this.idColumn]: payload.id as PrimaryKey }, payload.changes as Partial<T>);
      if (affected === 0) return undefined;
      return this.findById(payload.id as PrimaryKey);
    });
  }

  async delete(where: Where): Promise<number> {
    const payload = { where: { ...where } } as Record<string, unknown>;
    return this.runHooks('before:delete', payload, async () => {
      // Check if soft-delete plugin flagged this as a soft delete
      if (payload._softDelete) {
        const col = payload._softDeleteColumn as string;
        const val = payload._softDeleteValue as string;
        return this.update(payload.where as Where, { [col]: val } as Partial<T>);
      }
      const rendered = renderWhere(this.dialect, payload.where as Where);
      if (!rendered) {
        throw new DatabaseException('A filter is required to delete rows', 'DATABASE_QUERY_ERROR');
      }
      const text = `DELETE FROM ${this.name} WHERE ${rendered.text}`;
      const result = await this.conn.query<Row>(text, rendered.params);
      return result.affectedRows ?? result.rowCount;
    });
  }

  async deleteById(id: PrimaryKey): Promise<boolean> {
    const payload = { id } as Record<string, unknown>;
    return this.runHooks('before:deleteById', payload, async () => {
      // Check if soft-delete plugin flagged this
      if (payload._softDelete) {
        const col = payload._softDeleteColumn as string;
        const val = payload._softDeleteValue as string;
        await this.update({ [this.idColumn]: payload.id as PrimaryKey }, { [col]: val } as Partial<T>);
        return true;
      }
      const affected = await this.delete({ [this.idColumn]: payload.id as PrimaryKey });
      return affected > 0;
    });
  }

  async upsert(data: Partial<T>, changes: Partial<T>, matchOn: string[]): Promise<T> {
    if (matchOn.length === 0) {
      throw new DatabaseException('upsert() requires at least one matchOn column', 'DATABASE_QUERY_ERROR');
    }
    const payload = { data: { ...data }, changes: { ...changes }, matchOn } as Record<string, unknown>;
    return this.runHooks('before:upsert', payload, async () => {
      const enriched = this.enrich(payload.data as Partial<T>);
      const updated = this.updated(payload.changes as Partial<T>);

      if (this.dialect === 'postgres') {
        const allCols = Object.keys(enriched);
        const placeholders = allCols.map((_, i) => `$${i + 1}`).join(', ');
        const setCols = Object.keys(updated).filter((c) => !matchOn.includes(c));
        const setClauses = setCols.map((c) => `${c} = EXCLUDED.${c}`);
        const text = `INSERT INTO ${this.name} (${allCols.join(', ')}) VALUES (${placeholders}) ON CONFLICT (${matchOn.join(', ')}) DO UPDATE SET ${setClauses.join(', ')} RETURNING *`;
        const params = allCols.map((c) => enriched[c]);
        const result = await this.conn.query<Row>(text, params);
        return result.rows[0] as unknown as T;
      }

      if (this.dialect === 'mysql') {
        const allCols = Object.keys(enriched);
        const placeholders = allCols.map(() => '?').join(', ');
        const setCols = Object.keys(updated).filter((c) => !matchOn.includes(c));
        const setClauses = setCols.map((c) => `${c} = VALUES(${c})`);
        const text = `INSERT INTO ${this.name} (${allCols.join(', ')}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${setClauses.join(', ')}`;
        const params = allCols.map((c) => enriched[c]);
        await this.conn.query<Row>(text, params);
        const matchWhere = renderWhere(this.dialect, Object.fromEntries(matchOn.map((col) => [col, enriched[col]])));
        const selectText = `SELECT * FROM ${this.name} WHERE ${matchWhere!.text} LIMIT 1`;
        const result = await this.conn.query<T>(selectText, matchWhere!.params);
        return result.rows[0] as unknown as T;
      }

      // Memory driver: find-or-insert
      const matchWhere = renderWhere(this.dialect, Object.fromEntries(matchOn.map((col) => [col, enriched[col]])));
      const selectText = `SELECT * FROM ${this.name} WHERE ${matchWhere!.text} LIMIT 1`;
      const existing = await this.conn.query<T>(selectText, matchWhere!.params);
      if (existing.rows.length > 0) {
        const idVal = existing.rows[0]![this.idColumn] as PrimaryKey;
        await this.updateById(idVal, payload.changes as Partial<T>);
        return (await this.findById(idVal)) as T;
      }
      return this.insert(payload.data as Partial<T>);
    });
  }

  transaction<R>(work: (store: RowStore<T>) => Promise<R>): Promise<R> {
    return this.conn.transaction((tx) => {
      const bound = new SqlTable<T>(txExecutor(this.conn.dialect, tx), this.name, {
        idColumn: this.idColumn,
        autoId: this.autoId,
        timestamps: this.timestamps,
      });
      // Propagate scopes
      for (const [name, scope] of this._scopes) bound.registerScope(name, scope);
      // Propagate plugin registrations (hooks only — re-init not needed)
      for (const entry of this._pluginManager.pluginEntries()) {
        bound._pluginManager.register(entry);
      }
      return work(bound);
    });
  }

  query(): Query<T> {
    return new Query<T>(this);
  }

  private enrich(data: Partial<T>): Record<string, unknown> {
    const row: Record<string, unknown> = { ...data };
    const now = new Date().toISOString();
    if (this.autoId && row[this.idColumn] === undefined) row[this.idColumn] = crypto.randomUUID();
    if (this.timestamps) {
      if (row['createdAt'] === undefined) row['createdAt'] = now;
      row['updatedAt'] = now;
    }
    return row;
  }

  private updated(changes: Partial<T>): Record<string, unknown> {
    const row: Record<string, unknown> = { ...changes };
    if (this.timestamps) row['updatedAt'] = new Date().toISOString();
    return row;
  }
}

/** Adapts a `Transaction` into a `SqlExecutor` so tables can be re-bound mid-transaction. */
function txExecutor(dialect: SqlDialect, tx: Transaction): SqlExecutor {
  return {
    dialect,
    query: (text, params) => tx.query(text, params),
    transaction: (work) => work(tx),
  };
}
