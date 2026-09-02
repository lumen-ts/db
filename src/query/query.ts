import { toOffset, type Paginated, type PaginationParams } from '@lumen/common';
import type { ListOptions, PrimaryKey, Row, RowStore, Where } from '../types.js';

/**
 * A fluent, chainable query builder over any {@link RowStore}.
 *
 * @example
 * ```ts
 * const results = await store.table<User>('users')
 *   .query()
 *   .select('id', 'name')
 *   .where({ role: 'admin', age: { $gte: 18 } })
 *   .orderBy({ name: 'asc' })
 *   .limit(10)
 *   .offset(5)
 *   .exec();
 *
 * // Or a single row
 * const admin = await store.table<User>('users')
 *   .query()
 *   .where({ role: 'admin' })
 *   .first();
 *
 * // Count matching rows
 * const total = await store.table<User>('users')
 *   .query()
 *   .where({ role: 'admin' })
 *   .count();
 *
 * // Paginated results
 * const page = await store.table<User>('users')
 *   .query()
 *   .where({ role: 'admin' })
 *   .orderBy({ name: 'asc' })
 *   .toPaged({ page: 1, limit: 20 });
 * ```
 */
export class Query<T extends Row = Row> {
  private _where: Where | undefined = undefined;
  private _orderBy: Record<string, 'asc' | 'desc'> | undefined = undefined;
  private _select: string[] | undefined = undefined;
  private _limit: number | undefined = undefined;
  private _offset: number | undefined = undefined;

  constructor(private readonly store: RowStore<T>) {}

  /** Add equality and operator filters. Merges with any existing filters. */
  where(filter: Where): this {
    if (this._where) {
      this._where = { ...this._where, ...filter };
    } else {
      this._where = { ...filter };
    }
    return this;
  }

  /** Add a single field equality filter (shorthand for `.where({ field: value })`). */
  and(field: string, value: unknown): this {
    if (!this._where) this._where = {};
    this._where[field] = value;
    return this;
  }

  /** Explicit column projection. When omitted, all columns are selected. */
  select(...columns: string[]): this {
    this._select = columns;
    return this;
  }

  /** Add an `ORDER BY` clause. Subsequent calls add more sort columns. */
  orderBy(field: string, dir: 'asc' | 'desc' = 'asc'): this {
    if (!this._orderBy) this._orderBy = {};
    this._orderBy[field] = dir;
    return this;
  }

  /** Set the maximum number of rows to return. */
  limit(n: number): this {
    this._limit = n;
    return this;
  }

  /** Skip the first `n` rows. */
  offset(n: number): this {
    this._offset = n;
    return this;
  }

  /**
   * Apply a named scope (defined by the scopes plugin).
   * @example
   * ```ts
   * await store.query().applyScope('active').applyScope('admins').exec();
   * ```
   */
  applyScope(name: string): this {
    const store = this.store as any;
    if (typeof store.getScope === 'function') {
      const scope = store.getScope(name);
      if (scope) {
        return scope(this);
      }
    }
    return this;
  }

  /** Add an OR group: rows matching any of the given filters are included. */
  or(...filters: Where[]): this {
    if (filters.length === 0) return this;
    // Merge OR into the existing where using $or semantics
    // If there's already a where, wrap both sides in an OR
    if (this._where && Object.keys(this._where).length > 0) {
      this._where = { $or: [this._where, ...filters] } as any;
    } else {
      this._where = filters.length === 1 ? { ...filters[0] } : ({ $or: filters } as any);
    }
    return this;
  }

  /** Execute the query and return true if at least one row matches. */
  async exists(): Promise<boolean> {
    const row = await this.limit(1).first();
    return row !== undefined;
  }

  /** Execute the query and return distinct values for a given column. */
  async distinct<K extends keyof T>(field: K): Promise<T[K][]> {
    const rows = await this.select(field as string).exec();
    return [...new Set(rows.map((r) => r[field]))];
  }

  /** Execute the query and return all matching rows. */
  exec(): Promise<T[]> {
    return this.store.findAll(this.buildOptions());
  }

  /** Execute the query and return the first matching row, or `undefined`. */
  first(): Promise<T | undefined> {
    if (this._where && Object.keys(this._where).length > 0) {
      return this.store.findOne(this._where);
    }
    // No filter — just grab the first row
    return this.store.findAll({ ...this.buildOptions(), limit: 1 }).then((rows) => rows[0]);
  }

  /** Execute the query and return the count of matching rows. */
  count(): Promise<number> {
    return this.store.count(this._where);
  }

  /**
   * Execute the query with pagination using `@lumen/common` semantics.
   * `where` filters from the builder are merged with any explicit `where` param.
   */
  async toPaged(
    params: PaginationParams,
    extraWhere?: Where,
  ): Promise<Paginated<T>> {
    const limit = params.limit ?? 20;
    const offset = toOffset(params);
    const where = extraWhere
      ? { ...this._where, ...extraWhere }
      : this._where;
    const options: ListOptions = { limit, offset };
    if (where !== undefined) options.where = where;
    if (this._select !== undefined) options.select = this._select;
    if (params.sortBy !== undefined) {
      options.orderBy = { [params.sortBy]: params.sortDir ?? 'asc' };
    } else if (this._orderBy !== undefined) {
      options.orderBy = this._orderBy;
    }
    const [items, total] = await Promise.all([
      this.store.findAll(options),
      this.store.count(where),
    ]);
    const page =
      params.offset !== undefined
        ? Math.floor(offset / limit) + 1
        : (params.page ?? 1);
    return {
      data: items,
      meta: {
        page,
        limit,
        offset,
        total,
        hasNext: offset + limit < total,
        hasPrevious: offset > 0,
      },
    };
  }

  /** Execute the query and return a primary key list. */
  async ids(idColumn = 'id'): Promise<PrimaryKey[]> {
    const rows = await this.exec();
    return rows.map((r) => r[idColumn] as PrimaryKey);
  }

  /** Execute the query and group results by a field. Returns a map of field value -> rows. */
  async groupBy(field: string): Promise<Map<unknown, T[]>> {
    const rows = await this.exec();
    const map = new Map<unknown, T[]>();
    for (const row of rows) {
      const key = row[field];
      const group = map.get(key);
      if (group) {
        group.push(row);
      } else {
        map.set(key, [row]);
      }
    }
    return map;
  }

  /** Execute the query and reduce rows into a map by a key field. */
  async toMap(keyField: string): Promise<Map<unknown, T>> {
    const rows = await this.exec();
    const map = new Map<unknown, T>();
    for (const row of rows) map.set(row[keyField], row);
    return map;
  }

  /** Execute the query and return a single aggregated value from the first row. */
  async pluck<K extends keyof T>(field: K): Promise<T[K][]> {
    const rows = await this.exec();
    return rows.map((r) => r[field]);
  }

  /** Build the underlying `ListOptions` from the accumulated chain state. */
  private buildOptions(): ListOptions {
    const options: ListOptions = {};
    if (this._where !== undefined) options.where = this._where;
    if (this._orderBy !== undefined) options.orderBy = this._orderBy;
    if (this._select !== undefined) options.select = this._select;
    if (this._limit !== undefined) options.limit = this._limit;
    if (this._offset !== undefined) options.offset = this._offset;
    return options;
  }
}
