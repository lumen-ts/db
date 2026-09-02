import { DatabaseException, toDatabaseException } from '../exceptions.js';
import { SqlTable } from '../stores/sql-table.js';
import type { QueryResult, Row, RowStore, SqlConnection, TableOptions, Transaction } from '../types.js';
import type { PostgresConfig } from '../types.js';

/** Minimal pg query result surface. */
export interface PgQueryResult {
  rows: Row[];
  rowCount?: number | null;
  command?: string;
}

/** A pg Client (or pool client) — duck-typed so `pg` stays optional. */
export interface PgClientLike {
  query(text: string, params?: readonly unknown[]): Promise<PgQueryResult>;
  release?(error?: unknown): void;
  end?(): Promise<void>;
}

/** A pg Pool — duck-typed so `pg` stays optional. */
export interface PgPoolLike {
  connect(): Promise<PgClientLike>;
  query(text: string, params?: readonly unknown[]): Promise<PgQueryResult>;
  end?(): Promise<void>;
}

const PG_CONNECTION_STRING_RE = /^postgres(ql)?:\/\//;

/**
 * Postgres connection backed by a `pg` Pool. Pass a `connectionString` and the
 * driver is imported lazily, or pass your own Pool (`pg.Pool`) directly.
 */
export class PostgresConnection implements SqlConnection {
  readonly dialect = 'postgres' as const;
  readonly name: string;
  private pool: PgPoolLike | null = null;
  private readonly lazy: boolean;
  private readonly connectionString: string | undefined;
  private readonly poolOptions: Record<string, unknown> | undefined;

  constructor(name: string, config: PostgresConfig) {
    this.name = name;
    this.lazy = config.lazy ?? false;
    this.connectionString = config.connectionString;
    this.poolOptions = config.options;
    this.pool = config.pool ?? null;
    if (!this.connectionString && !config.pool) {
      throw new DatabaseException(`Postgres connection "${name}" requires a connectionString or a pool`, 'DATABASE_CONFIG_ERROR', { name });
    }
    if (this.connectionString !== undefined && !PG_CONNECTION_STRING_RE.test(this.connectionString)) {
      throw new DatabaseException(`Postgres connection "${name}" has an invalid connection string`, 'DATABASE_CONFIG_ERROR', { name });
    }
  }

  private async ensurePool(): Promise<PgPoolLike> {
    if (this.pool) return this.pool;
    if (!this.connectionString) {
      throw new DatabaseException(`Postgres connection "${this.name}" has no pool or connection string`, 'DATABASE_CONFIG_ERROR');
    }
    try {
      const mod = await import('pg');
      const PoolCtor = (mod as unknown as { Pool: new (opts: Record<string, unknown>) => PgPoolLike }).Pool;
      this.pool = new PoolCtor({ connectionString: this.connectionString, ...this.poolOptions });
      return this.pool;
    } catch (error) {
      throw new DatabaseException(
        `Postgres driver could not be loaded for "${this.name}". Install the optional "pg" dependency.`,
        'DATABASE_CONFIG_ERROR',
        { name: this.name },
        { cause: error },
      );
    }
  }

  async connect(): Promise<void> {
    if (this.lazy) return;
    const pool = await this.ensurePool();
    try {
      await pool.query('SELECT 1');
    } catch (error) {
      throw toDatabaseException(error, 'DATABASE_CONNECT_ERROR', { name: this.name });
    }
  }

  async ping(): Promise<void> {
    const pool = await this.ensurePool();
    try {
      await pool.query('SELECT 1');
    } catch (error) {
      throw toDatabaseException(error, 'DATABASE_QUERY_ERROR', { name: this.name });
    }
  }

  async query<T extends Row = Row>(text: string, params: readonly unknown[] = []): Promise<QueryResult<T>> {
    const pool = await this.ensurePool();
    try {
      const result = await pool.query(text, params);
      return {
        rows: result.rows as T[],
        rowCount: result.rowCount ?? result.rows.length,
      };
    } catch (error) {
      throw toDatabaseException(error, 'DATABASE_QUERY_ERROR', { name: this.name, sql: text });
    }
  }

  async transaction<R>(work: (tx: Transaction) => Promise<R>): Promise<R> {
    const pool = await this.ensurePool();
    let client: PgClientLike | null = null;
    try {
      client = await pool.connect();
    } catch (error) {
      throw toDatabaseException(error, 'DATABASE_TRANSACTION_ERROR', { name: this.name });
    }
    try {
      await client.query('BEGIN');
      const tx: Transaction = {
        name: `${this.name}:tx`,
        query: async <U extends Row = Row>(text: string, params?: readonly unknown[]) => {
          const result = await client!.query(text, params ?? []);
          return { rows: result.rows as U[], rowCount: result.rowCount ?? result.rows.length };
        },
        commit: async () => {
          await client!.query('COMMIT');
        },
        rollback: async () => {
          await client!.query('ROLLBACK');
        },
      };
      const result = await work(tx);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof DatabaseException) throw error;
      throw toDatabaseException(error, 'DATABASE_TRANSACTION_ERROR', { name: this.name });
    } finally {
      client.release?.();
    }
  }

  table<T extends Row = Row>(tableName: string, options?: TableOptions): RowStore<T> {
    return new SqlTable<T>(this, tableName, options);
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.ping();
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    try {
      await this.pool?.end?.();
    } finally {
      this.pool = null;
    }
  }
}