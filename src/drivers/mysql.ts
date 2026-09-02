import { DatabaseException, toDatabaseException } from '../exceptions.js';
import { SqlTable } from '../stores/sql-table.js';
import type { QueryResult, Row, RowStore, SqlConnection, TableOptions, Transaction } from '../types.js';
import type { MysqlConfig } from '../types.js';

/** A mysql2-based connection in the promise flavour. */
export interface MysqlConnectionLike {
  query(text: string, params?: readonly unknown[]): Promise<[unknown, unknown]>;
  beginTransaction?(): Promise<void>;
  commit?(): Promise<void>;
  rollback?(): Promise<void>;
  release?(): void;
}

/** A mysql2 pool (promise flavour) — duck-typed so `mysql2` stays optional. */
export interface MysqlPoolLike {
  getConnection(): Promise<MysqlConnectionLike>;
  query?(text: string, params?: readonly unknown[]): Promise<[unknown, unknown]>;
  end?(): Promise<void>;
}

interface MysqlResultSetHeader {
  affectedRows?: number;
  insertId?: number;
}

function mapResult(result: unknown): QueryResult<Row> {
  if (Array.isArray(result)) {
    return { rows: result as Row[], rowCount: result.length };
  }
  const header = (result ?? {}) as MysqlResultSetHeader;
  const affectedRows = header.affectedRows ?? 0;
  return {
    rows: [],
    rowCount: affectedRows,
    affectedRows,
    ...(header.insertId !== undefined ? { insertId: header.insertId } : {}),
  };
}

const MYSQL_CONNECTION_STRING_RE = /^mysql(\/\/|:)/;

/**
 * MySQL/MariaDB connection backed by a `mysql2/promise` Pool. Pass a
 * `connectionString` and the driver is imported lazily, or pass your own pool.
 */
export class MysqlConnection implements SqlConnection {
  readonly dialect = 'mysql' as const;
  readonly name: string;
  private pool: MysqlPoolLike | null = null;
  private readonly lazy: boolean;
  private readonly connectionString: string | undefined;
  private readonly poolOptions: Record<string, unknown> | undefined;

  constructor(name: string, config: MysqlConfig) {
    this.name = name;
    this.lazy = config.lazy ?? false;
    this.connectionString = config.connectionString;
    this.poolOptions = config.options;
    this.pool = config.pool ?? null;
    if (!this.connectionString && !config.pool) {
      throw new DatabaseException(`MySQL connection "${name}" requires a connectionString or a pool`, 'DATABASE_CONFIG_ERROR', { name });
    }
  }

  private async ensurePool(): Promise<MysqlPoolLike> {
    if (this.pool) return this.pool;
    if (!this.connectionString) {
      throw new DatabaseException(`MySQL connection "${this.name}" has no pool or connection string`, 'DATABASE_CONFIG_ERROR');
    }
    try {
      const mod = await import('mysql2/promise');
      const createPool = (mod as unknown as { createPool: (opts: Record<string, unknown>) => MysqlPoolLike }).createPool;
      this.pool = createPool({ uri: this.connectionString, ...this.poolOptions });
      return this.pool;
    } catch (error) {
      throw new DatabaseException(
        `MySQL driver could not be loaded for "${this.name}". Install the optional "mysql2" dependency.`,
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
      await pool.query?.('SELECT 1');
    } catch (error) {
      throw toDatabaseException(error, 'DATABASE_CONNECT_ERROR', { name: this.name });
    }
  }

  async ping(): Promise<void> {
    const pool = await this.ensurePool();
    try {
      await pool.query?.('SELECT 1');
    } catch (error) {
      throw toDatabaseException(error, 'DATABASE_QUERY_ERROR', { name: this.name });
    }
  }

  async query<T extends Row = Row>(text: string, params: readonly unknown[] = []): Promise<QueryResult<T>> {
    const pool = await this.ensurePool();
    try {
      const [result] = (await pool.query!(text, params)) as [unknown, unknown];
      return mapResult(result) as unknown as QueryResult<T>;
    } catch (error) {
      throw toDatabaseException(error, 'DATABASE_QUERY_ERROR', { name: this.name, sql: text });
    }
  }

  async transaction<R>(work: (tx: Transaction) => Promise<R>): Promise<R> {
    const pool = await this.ensurePool();
    let client: MysqlConnectionLike;
    try {
      client = await pool.getConnection();
    } catch (error) {
      throw toDatabaseException(error, 'DATABASE_TRANSACTION_ERROR', { name: this.name });
    }
    try {
      await client.beginTransaction?.();
      const tx: Transaction = {
        name: `${this.name}:tx`,
        query: async <U extends Row = Row>(text: string, params?: readonly unknown[]) => {
          const [result] = (await client.query(text, params ?? [])) as [unknown, unknown];
          return mapResult(result) as QueryResult<U>;
        },
        commit: async () => {
          await client.commit?.();
        },
        rollback: async () => {
          await client.rollback?.();
        },
      };
      const result = await work(tx);
      await client.commit?.();
      return result;
    } catch (error) {
      await client.rollback?.().catch(() => undefined);
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