import { Inject, Injectable } from '@lumen/core';
import type { OnApplicationShutdown, OnModuleInit } from '@lumen/core';
import { initializeConnection } from './connect.js';
import { DatabaseException } from '../exceptions.js';
import { DB_OPTIONS } from './tokens.js';
import type { Connection, ConnectionConfig, DatabaseModuleOptions } from '../types.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Owns the lifecycle of every registered database connection.
 *
 * Connect is idempotent: the first `connect(name)` (from bootstrap, or from a
 * factory provider established earlier) opens the driver and caches it, and
 * later calls return the cached connection. Use it inside controllers/route
 * handlers at runtime:
 *
 * ```ts
 * const users = db.getConnection('app').table<User>('users');
 * ```
 */
@Injectable()
export class DatabaseManager implements OnModuleInit, OnApplicationShutdown {
  private readonly connections = new Map<string, Connection>();

  constructor(@Inject(DB_OPTIONS) private readonly options: DatabaseModuleOptions) {}

  /** Connection names declared in the module options. */
  get names(): string[] {
    return Object.keys(this.options.connections ?? {});
  }

  /** Connection used when no name is given. Default `"default"`. */
  get defaultName(): string {
    return this.options.default ?? 'default';
  }

  has(name: string): boolean {
    return this.connections.has(name);
  }

  /** Connected connection names (those actually opened). */
  connectedNames(): string[] {
    return [...this.connections.keys()];
  }

  getConnection<T extends Connection = Connection>(name: string = this.defaultName): T {
    const connection = this.connections.get(name);
    if (!connection) {
      throw new DatabaseException(
        `No database connection "${name}" is open. Check your DatabaseModule.forRoot() options.`,
        'DATABASE_CONNECTION_NOT_FOUND',
        { name },
      );
    }
    return connection as T;
  }

  async connect<T extends Connection = Connection>(name: string = this.defaultName): Promise<T> {
    const existing = this.connections.get(name);
    if (existing) return existing as T;
    const config = (this.options.connections ?? {})[name];
    if (!config) {
      throw new DatabaseException(`No database configuration found for "${name}"`, 'DATABASE_CONFIG_ERROR', { name });
    }
    const connection = await this.reconnect(name, config);
    this.connections.set(name, connection);
    await this.options.events?.onConnect?.(name);
    return connection as T;
  }

  async connectAll(): Promise<string[]> {
    for (const name of this.names) await this.connect(name);
    return this.names;
  }

  async close(name: string = this.defaultName): Promise<void> {
    const connection = this.connections.get(name);
    if (!connection) return;
    await connection.close();
    this.connections.delete(name);
    await this.options.events?.onDisconnect?.(name);
  }

  async closeAll(): Promise<void> {
    const names = [...this.connections.keys()];
    await Promise.all([...this.connections.values()].map((c) => c.close().catch(() => undefined)));
    this.connections.clear();
    for (const name of names) await this.options.events?.onDisconnect?.(name);
  }

  /** Checks the health of all open connections. Returns a map of name -> healthy. */
  async healthCheckAll(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    for (const [name, conn] of this.connections) {
      results.set(name, typeof conn.healthCheck === 'function' ? await conn.healthCheck() : true);
    }
    return results;
  }

  async onModuleInit(): Promise<void> {
    // Only connect non-lazy connections at bootstrap
    for (const name of this.names) {
      const config = (this.options.connections ?? {})[name];
      if (config && !('lazy' in config && config.lazy)) {
        await this.connect(name);
      }
    }
  }

  async onApplicationShutdown(_signal?: string): Promise<void> {
    await this.closeAll();
  }

  private async reconnect(name: string, config: ConnectionConfig): Promise<Connection> {
    const retries = Math.max(1, this.options.retries ?? 1);
    const delay = this.options.retryDelay ?? 250;
    let lastError: unknown;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await initializeConnection(name, config);
      } catch (error) {
        lastError = error;
        if (attempt < retries) await sleep(delay);
      }
    }
    await this.options.events?.onError?.(name, lastError);
    if (lastError instanceof DatabaseException) throw lastError;
    throw new DatabaseException(
      `Could not connect to database "${name}" after ${retries} attempt(s)`,
      'DATABASE_CONNECT_ERROR',
      { name },
      { cause: lastError },
    );
  }
}