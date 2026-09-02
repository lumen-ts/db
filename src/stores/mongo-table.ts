import { DatabaseException } from '../exceptions.js';
import { PluginManager, type DatabasePlugin } from '../plugins/core/plugin.js';
import type { ScopeDefinition } from '../plugins/query/scopes.js';
import { likeToRegExp } from '../query/operators.js';
import type { MongoSessionLike } from '../drivers/mongo.js';
import type { MongoConnection } from '../drivers/mongo.js';
import type { ListOptions, Where, WhereOperators } from '../types.js';
import { Query } from '../query/query.js';
import type { PrimaryKey, QueryResult, Row, RowStore, TableOptions, Transaction } from '../types.js';

function toFilter(where?: Where): object {
  if (!where) return {};
  const out: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(where)) {
    if (value === undefined) continue;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const ops = value as WhereOperators;
      for (const [op, operand] of Object.entries(ops)) {
        out[field] = translateOperator(field, op, operand);
      }
    } else {
      out[field] = value;
    }
  }
  return out;
}

function translateOperator(field: string, op: string, operand: unknown): unknown {
  switch (op) {
    case '$eq':
      return operand;
    case '$ne':
      return { $ne: operand };
    case '$gt':
      return { $gt: operand };
    case '$gte':
      return { $gte: operand };
    case '$lt':
      return { $lt: operand };
    case '$lte':
      return { $lte: operand };
    case '$in':
      return { $in: Array.isArray(operand) ? operand : [operand] };
    case '$nin':
      return { $nin: Array.isArray(operand) ? operand : [operand] };
    case '$like':
      return { $regex: likeToRegExp(String(operand)).source };
    case '$isNull':
      return operand === true ? null : { $ne: null };
    case '$between': {
      const [low, high] = Array.isArray(operand) ? (operand as [unknown, unknown]) : [undefined, undefined];
      return { $gte: low ?? null, $lte: high ?? null };
    }
    default:
      throw new DatabaseException(`Unsupported Mongo operator "${op}" on field "${field}"`, 'DATABASE_UNSUPPORTED_OPERATION', { field, op });
  }
}

/**
 * A MongoDB-backed `RowStore`. Reaches the driver through a duck-typed
 * {@link MongoConnection}, so the real `mongodb` package stays optional.
 */
export class MongoTable<T extends Row = Row> implements RowStore<T> {
  readonly dialect = 'mongo' as const;
  readonly name: string;
  private readonly idColumn: string;
  private readonly autoId: boolean;
  private readonly timestamps: boolean;
  private readonly session: MongoSessionLike | undefined;
  private readonly _pluginManager = new PluginManager<T>();
  private readonly _scopes = new Map<string, ScopeDefinition<T>>();

  constructor(
    private readonly conn: MongoConnection,
    collectionName: string,
    options?: TableOptions,
    session?: MongoSessionLike,
  ) {
    this.name = collectionName;
    this.idColumn = options?.idColumn ?? 'id';
    this.autoId = options?.autoId ?? true;
    this.timestamps = options?.timestamps ?? false;
    this.session = session;
  }

  private options(opts?: object): object {
    return this.session ? { ...opts, session: this.session } : (opts ?? {});
  }

  private collection() {
    return this.conn.db().collection(this.name);
  }

  private async readMany(filter: object, opts: object): Promise<T[]> {
    const coll = this.collection();
    const result = coll.find?.(filter, opts);
    if (!result) return [];
    const rows = Array.isArray(result) ? result : (await result.toArray?.()) ?? [];
    return rows as T[];
  }

  async findAll(options: ListOptions = {}): Promise<T[]> {
    const { where, orderBy, select, limit, offset } = options;
    const opts = this.options({
      ...(orderBy && Object.keys(orderBy).length ? { sort: Object.fromEntries(Object.entries(orderBy).map(([field, dir]) => [field, dir === 'desc' ? -1 : 1])) } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(offset !== undefined ? { skip: offset } : {}),
      ...(select && select.length ? { projection: Object.fromEntries(select.map((c) => [`${c}`, 1])) } : {}),
    });
    return this.readMany(toFilter(where), opts);
  }

  async findOne(where: Where, options: Omit<ListOptions, 'where'> = {}): Promise<T | undefined> {
    const { select } = options;
    const opts = this.options({
      ...(select && select.length ? { projection: Object.fromEntries(select.map((c) => [`${c}`, 1])) } : {}),
      limit: 1,
    });
    const row = await this.collection().findOne?.(toFilter(where), opts);
    return (row as T | null) ?? undefined;
  }

  async findById(id: PrimaryKey, options: Omit<ListOptions, 'where'> = {}): Promise<T | undefined> {
    return this.findOne({ [`${this.idColumn}`]: id }, options);
  }

  async count(where?: Where): Promise<number> {
    const coll = this.collection();
    if (!coll.countDocuments) return 0;
    return coll.countDocuments(where ? toFilter(where) : {}, this.options());
  }

  private stampExisting(row: Row): Row {
    if (!this.timestamps || row.updatedAt !== undefined) return row;
    return { ...row, updatedAt: new Date().toISOString() };
  }

  private stampNew(row: Row): Row {
    const out: Row = { ...row };
    if (this.autoId && out[this.idColumn] === undefined) out[this.idColumn] = crypto.randomUUID();
    if (this.timestamps) {
      const now = new Date().toISOString();
      if (out.createdAt === undefined) out.createdAt = now;
      if (out.updatedAt === undefined) out.updatedAt = now;
    }
    return out;
  }

  async insert(row: T): Promise<T> {
    const stamped = this.stampNew(row);
    const coll = this.collection();
    if (!coll.insertOne) throw new DatabaseException(`Collection "${this.name}" cannot insert`, 'DATABASE_UNSUPPORTED_OPERATION', { name: this.name });
    await coll.insertOne(stamped as Row, this.options());
    return stamped as T;
  }

  async insertMany(rows: T[]): Promise<T[]> {
    const stamped = rows.map((r) => this.stampNew(r));
    const coll = this.collection();
    if (coll.insertMany) await coll.insertMany(stamped as Row[], this.options());
    return stamped as T[];
  }

  async update(where: Where, changes: Partial<T>): Promise<number> {
    const coll = this.collection();
    if (!coll.updateMany) throw new DatabaseException(`Collection "${this.name}" cannot update`, 'DATABASE_UNSUPPORTED_OPERATION', { name: this.name });
    const result = await coll.updateMany(toFilter(where), { $set: this.stampExisting(changes as Row) }, this.options());
    return result.modifiedCount ?? result.matchedCount ?? 0;
  }

  async updateById(id: PrimaryKey, changes: Partial<T>): Promise<T | undefined> {
    const filter = toFilter({ [`${this.idColumn}`]: id });
    const update = { $set: this.stampExisting(changes as Row) };
    const coll = this.collection();
    const updated = coll.findOneAndUpdate ? await coll.findOneAndUpdate(filter, update, this.options({ returnDocument: 'after' })) : null;
    if (updated) return (updated as T) ?? undefined;
    if (!coll.updateOne) throw new DatabaseException(`Collection "${this.name}" cannot update`, 'DATABASE_UNSUPPORTED_OPERATION', { name: this.name });
    const result = await coll.updateOne(filter, update, this.options());
    if ((result.matchedCount ?? 0) === 0) return undefined;
    return this.findOne({ [`${this.idColumn}`]: id });
  }

  async delete(where: Where): Promise<number> {
    const coll = this.collection();
    if (!coll.deleteMany) throw new DatabaseException(`Collection "${this.name}" cannot delete`, 'DATABASE_UNSUPPORTED_OPERATION', { name: this.name });
    const result = await coll.deleteMany(toFilter(where), this.options());
    return result.deletedCount ?? 0;
  }

  async deleteById(id: PrimaryKey): Promise<boolean> {
    const coll = this.collection();
    if (!coll.deleteOne) throw new DatabaseException(`Collection "${this.name}" cannot delete`, 'DATABASE_UNSUPPORTED_OPERATION', { name: this.name });
    const result = await coll.deleteOne(toFilter({ [`${this.idColumn}`]: id }), this.options());
    return (result.deletedCount ?? 0) > 0;
  }

  async upsert(data: Partial<T>, changes: Partial<T>, matchOn: string[]): Promise<T> {
    if (matchOn.length === 0) {
      throw new DatabaseException('upsert() requires at least one matchOn column', 'DATABASE_QUERY_ERROR');
    }
    const matchFilter = Object.fromEntries(matchOn.map((col) => [col, (data as Row)[col]]));
    const coll = this.collection();
    if (coll.findOneAndUpdate) {
      const result = await coll.findOneAndUpdate(
        toFilter(matchFilter),
        { $set: this.stampExisting(changes as Row), $setOnInsert: this.stampNew(data as Row) },
        this.options({ upsert: true, returnDocument: 'after' }),
      );
      return (result as T | null) ?? (data as T);
    }
    // Fallback
    const existing = await this.findOne(matchFilter);
    if (existing) {
      const id = existing[this.idColumn] as PrimaryKey;
      await this.updateById(id, changes);
      return (await this.findById(id)) as T;
    }
    return this.insert(data as T);
  }

  async transaction<R>(work: (store: RowStore<T>) => Promise<R>): Promise<R> {
    return this.conn.runInSession(async (session: MongoSessionLike) => {
      const bound = new MongoTable<T>(this.conn, this.name, { idColumn: this.idColumn, autoId: this.autoId, timestamps: this.timestamps }, session);
      return work(bound);
    });
  }

  use(...plugins: DatabasePlugin<T>[]): void {
    for (const plugin of plugins) {
      this._pluginManager.register(plugin);
      const initFn = plugin.init;
      if (initFn) initFn(this as unknown as import('../plugins/core/plugin.js').RowStoreLike<T>);
    }
  }

  pluginManager(): PluginManager<T> {
    return this._pluginManager;
  }

  registerScope(name: string, scope: ScopeDefinition<T>): void {
    this._scopes.set(name, scope);
  }

  getScope(name: string): ScopeDefinition<T> | undefined {
    return this._scopes.get(name);
  }

  query(): Query<T> {
    return new Query<T>(this);
  }
}

export type { Transaction };