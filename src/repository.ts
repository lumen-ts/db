import { toOffset, type Paginated, type PaginationParams } from '@lumen/common';
import type { SchemaLike } from '@lumen/core';
import type { DatabasePlugin } from './plugins/core/plugin.js';
import type { ScopeDefinition } from './plugins/query/scopes.js';
import { Query } from './query/query.js';
import type { Dialect, ListOptions, PrimaryKey, Row, RowStore, Where } from './types.js';

/** A schema able to validate full rows and (optionally) partial updates. */
export interface RepositorySchema<T = Row> extends SchemaLike<T> {
  /** When present, used to validate partial updates safely. */
  partial?(): SchemaLike<Partial<T>>;
}

export interface RepositoryOptions<T extends Row = Row> {
  /** Optional schema used to validate writes and reads. */
  schema?: RepositorySchema<T>;
}

/**
 * A typed, documented data-access object over a `RowStore` (SQL table or Mongo
 * collection). Adds schema validation and pagination on top of plain CRUD.
 */
export class Repository<T extends Row = Row> implements RowStore<T> {
  readonly dialect: Dialect;
  readonly name: string;

  constructor(
    readonly store: RowStore<T>,
    private readonly options: RepositoryOptions<T> = {},
  ) {
    this.dialect = store.dialect;
    this.name = store.name;
  }

  private parse(value: unknown): T {
    return this.options.schema ? this.options.schema.parse(value) : (value as T);
  }

  private parseMany(values: unknown[]): T[] {
    return values.map((v) => this.parse(v));
  }

  private validateWrite(value: unknown): Partial<T> {
    const schema = this.options.schema;
    if (!schema) return value as Partial<T>;
    const partial = schema.partial ? schema.partial() : undefined;
    return (partial ? partial.parse(value) : value) as Partial<T>;
  }

  async findAll(options: ListOptions = {}): Promise<T[]> {
    return this.parseMany(await this.store.findAll(options));
  }

  async findOne(where: Where): Promise<T | undefined> {
    const row = await this.store.findOne(where);
    return row === undefined ? undefined : this.parse(row);
  }

  async findById(id: PrimaryKey): Promise<T | undefined> {
    const row = await this.store.findById(id);
    return row === undefined ? undefined : this.parse(row);
  }

  async count(where?: Where): Promise<number> {
    return this.store.count(where);
  }

  async insert(data: Partial<T>): Promise<T> {
    const parsed = this.validateWrite(data);
    const row = await this.store.insert(parsed);
    return this.parse(row);
  }

  async insertMany(rows: Partial<T>[]): Promise<T[]> {
    const parsed = rows.map((r) => this.validateWrite(r));
    const inserted = await this.store.insertMany(parsed);
    return this.parseMany(inserted);
  }

  async update(where: Where, changes: Partial<T>): Promise<number> {
    const parsed = this.validateWrite(changes);
    return this.store.update(where, parsed);
  }

  async updateById(id: PrimaryKey, changes: Partial<T>): Promise<T | undefined> {
    const parsed = this.validateWrite(changes);
    const row = await this.store.updateById(id, parsed);
    return row === undefined ? undefined : this.parse(row);
  }

  async delete(where: Where): Promise<number> {
    return this.store.delete(where);
  }

  async deleteById(id: PrimaryKey): Promise<boolean> {
    return this.store.deleteById(id);
  }

  async upsert(data: Partial<T>, changes: Partial<T>, matchOn: string[]): Promise<T> {
    const parsedData = this.validateWrite(data);
    const parsedChanges = this.validateWrite(changes);
    const row = await this.store.upsert(parsedData, parsedChanges, matchOn);
    return this.parse(row);
  }

  transaction<R>(work: (store: Repository<T>) => Promise<R>): Promise<R> {
    return this.store.transaction((bound) => work(new Repository<T>(bound, this.options)));
  }

  /** Creates a fluent {@link Query} builder with automatic schema validation on results. */
  query(): Query<T> {
    return new Query<T>(this);
  }

  /** Register plugins on the underlying store. */
  use(...plugins: DatabasePlugin<T>[]): void {
    this.store.use(...plugins);
  }

  /** Access a named scope from the underlying store. */
  getScope(name: string): ScopeDefinition<T> | undefined {
    return this.store.getScope?.(name);
  }

  /** Paginate the underlying store using `@lumen/common` pagination semantics. */
  async paged(params: PaginationParams, where?: Where): Promise<Paginated<T>> {
    const limit = params.limit ?? 20;
    const offset = toOffset(params);
    const options: ListOptions = { limit, offset };
    if (where !== undefined) options.where = where;
    if (params.sortBy !== undefined) options.orderBy = { [params.sortBy]: params.sortDir ?? 'asc' };
    const [items, total] = await Promise.all([this.findAll(options), this.store.count(where)]);
    const page = params.offset !== undefined ? Math.floor(offset / limit) + 1 : (params.page ?? 1);
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
}

/** Creates a `Repository` over any `RowStore`. */
export function createRepository<T extends Row = Row>(
  store: RowStore<T>,
  options?: RepositoryOptions<T>,
): Repository<T> {
  return new Repository<T>(store, options);
}