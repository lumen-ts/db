import type { SchemaLike } from '@lumen/core';
import type { MysqlPoolLike } from './drivers/mysql.js';
import type { MongoClientLike } from './drivers/mongo.js';
import type { PgPoolLike } from './drivers/postgres.js';

/** SQL dialects that speak SQL across a parameterized query API. */
export type SqlDialect = 'postgres' | 'mysql' | 'memory';
/** Every driver shipped with `@lumen/db`. */
export type Dialect = SqlDialect | 'mongo';

/** A plain row of data returned by a store. */
export type Row = Record<string, unknown>;
/** Primary key a repository can address rows with. */
export type PrimaryKey = string | number | bigint;

/** Field-level comparison operators understood by the query builder. */
export interface WhereOperators {
  $eq?: unknown;
  $ne?: unknown;
  $gt?: unknown;
  $gte?: unknown;
  $lt?: unknown;
  $lte?: unknown;
  $in?: unknown[];
  $nin?: unknown[];
  /** `%`-wildcard pattern, always parameterized. */
  $like?: string;
  /** `true` -> `IS NULL`, `false` -> `IS NOT NULL`. */
  $isNull?: boolean;
  $between?: [unknown, unknown];
  /** Negate any inner operator, e.g. `$not: { $gt: 5 }` -> `NOT (field > 5)`. */
  $not?: Record<string, unknown>;
}

/**
 * A filter tree: plain values become equality checks, operator objects become
 * the corresponding comparison. Rendered as parameterized SQL/query objects.
 */
export type Where = Record<string, unknown | WhereOperators>;

export interface ListOptions {
  /** Equality and operator filters. */
  where?: Where;
  /** `field -> 'asc' | 'desc'` ordering. Keys are validated identifiers. */
  orderBy?: Record<string, 'asc' | 'desc'>;
  limit?: number;
  offset?: number;
  /** Explicit column/field projection. When omitted, all fields are selected. */
  select?: string[];
}

export interface QueryResult<T extends Row = Row> {
  rows: T[];
  rowCount: number;
  affectedRows?: number;
  insertId?: string | number | bigint;
}

/** A unit of work wrapping an open database transaction. */
export interface Transaction {
  readonly name: string;
  query<T extends Row = Row>(text: string, params?: readonly unknown[]): Promise<QueryResult<T>>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface TableOptions {
  /** Column holding the primary key. Default `"id"`. */
  idColumn?: string;
  /** Generate a UUID primary key on insert when the row has none. Default `false`. */
  autoId?: boolean;
  /** Maintain `createdAt`/`updatedAt` timestamps. Default `false`. */
  timestamps?: boolean;
}

/** A connection speaking a parameterized SQL dialect. */
export interface SqlConnection {
  readonly dialect: SqlDialect;
  readonly name: string;
  connect(): Promise<void>;
  ping(): Promise<void>;
  query<T extends Row = Row>(text: string, params?: readonly unknown[]): Promise<QueryResult<T>>;
  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
  table<T extends Row = Row>(tableName: string, options?: TableOptions): RowStore<T>;
  close(): Promise<void>;
  /** Returns true if the connection is alive and can execute queries. */
  healthCheck?(): Promise<boolean>;
}

/** A connection speaking to a MongoDB-style document store. */
export interface DocumentConnection {
  readonly dialect: 'mongo';
  readonly name: string;
  connect(): Promise<void>;
  ping(): Promise<void>;
  collection<T extends Row = Row>(collectionName: string, options?: TableOptions): RowStore<T>;
  close(): Promise<void>;
  /** Returns true if the connection is alive and can execute queries. */
  healthCheck?(): Promise<boolean>;
}

export type Connection = SqlConnection | DocumentConnection;

/**
 * Storage-level contract shared by SQL tables and MongoDB collections.
 * Repository builds CMDR utilities (pagination, validation, transactions) on top.
 */
export interface RowStore<T extends Row = Row> {
  readonly dialect: Dialect;
  readonly name: string;
  /** Register one or more plugins on this store. */
  use(...plugins: import('./plugins/core/plugin.js').DatabasePlugin<T>[]): void;
  findAll(options?: ListOptions): Promise<T[]>;
  findOne(where: Where): Promise<T | undefined>;
  findById(id: PrimaryKey): Promise<T | undefined>;
  count(where?: Where): Promise<number>;
  insert(data: Partial<T>): Promise<T>;
  insertMany(rows: Partial<T>[]): Promise<T[]>;
  update(where: Where, changes: Partial<T>): Promise<number>;
  updateById(id: PrimaryKey, changes: Partial<T>): Promise<T | undefined>;
  delete(where: Where): Promise<number>;
  deleteById(id: PrimaryKey): Promise<boolean>;
  /** Runs `work` inside a transaction; `store` is bound to the open transaction. */
  transaction<R>(work: (store: RowStore<T>) => Promise<R>): Promise<R>;
  /** Creates a fluent {@link Query} builder for chainable, readable queries. */
  query(): import('./query/query.js').Query<T>;
  /** Access registered scopes (set by the scopes plugin). */
  getScope?(name: string): import('./plugins/query/scopes.js').ScopeDefinition<T> | undefined;
  /**
   * Insert-or-update: if a row matching `matchOn` exists, update it with `changes`;
   * otherwise insert the full `data` row. Returns the final row.
   */
  upsert(data: Partial<T>, changes: Partial<T>, matchOn: string[]): Promise<T>;
  /** Get the plugin manager for this store. */
  pluginManager?(): import('./plugins/core/plugin.js').PluginManager<T>;
}

export interface PostgresConfig {
  driver: 'postgres';
  /** Connection string used when no `pool` is provided (e.g. `postgres://...`). */
  connectionString?: string;
  /** A `pg.Pool` (or compatible). When provided it wins over `connectionString`. */
  pool?: PgPoolLike;
  /** Options forwarded to a lazily-created `pg` Pool. */
  options?: Record<string, unknown>;
  /** Connect on first query instead of at bootstrap. Default `false`. */
  lazy?: boolean;
}

export interface MysqlConfig {
  driver: 'mysql';
  connectionString?: string;
  pool?: MysqlPoolLike;
  options?: Record<string, unknown>;
  lazy?: boolean;
}

export interface MongoConfig {
  driver: 'mongo';
  connectionString?: string;
  client?: MongoClientLike;
  dbName?: string;
  options?: Record<string, unknown>;
  lazy?: boolean;
}

export interface MemoryConfig {
  driver: 'memory';
  /** Seed data `tableName -> rows` inserted at connect time. */
  seed?: Record<string, Row[]>;
  /** Connect on first query instead of at bootstrap. Default `false`. */
  lazy?: boolean;
}

export type ConnectionConfig = PostgresConfig | MysqlConfig | MongoConfig | MemoryConfig;

export interface DatabaseModuleOptions {
  /** Named connection configurations. */
  connections: Record<string, ConnectionConfig>;
  /** Connection used when no name is provided. Default `"default"`. */
  default?: string;
  /** Bootstrap connect attempts. Default `1`. */
  retries?: number;
  /** Delay between connect attempts, milliseconds. Default `250`. */
  retryDelay?: number;
  /** Export the module providers globally. Default `false`. */
  global?: boolean;
  /** Called after each connection is opened or closed. */
  events?: ConnectionEvents;
  /** Logger called after every query with duration and optional error. */
  queryLogger?: QueryLogger;
}

export interface AsyncDatabaseModuleOptions {
  useFactory: (...args: any[]) => Promise<DatabaseModuleOptions> | DatabaseModuleOptions;
  inject?: import('@lumen/common').InjectionToken[];
  global?: boolean;
}

/** A callback invoked after every query execution. */
export interface QueryLogEntry {
  connectionName: string;
  sql?: string;
  duration: number;
  error?: unknown;
}
export type QueryLogger = (entry: QueryLogEntry) => void;

/** Callbacks for connection lifecycle events. */
export interface ConnectionEvents {
  onConnect?: (name: string) => void | Promise<void>;
  onDisconnect?: (name: string) => void | Promise<void>;
  onError?: (name: string, error: unknown) => void | Promise<void>;
}