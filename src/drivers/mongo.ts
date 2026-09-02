import { DatabaseException, toDatabaseException } from '../exceptions.js';
import { MongoTable } from '../stores/mongo-table.js';
import type { DocumentConnection, MongoConfig, Row, RowStore, TableOptions } from '../types.js';

/** A MongoDB cursor (duck-typed). */
export interface MongoCursorLike {
  toArray?(): Promise<Row[]>;
}

/** A MongoDB collection (duck-typed so `mongodb` stays optional). */
export interface MongoCollectionLike {
  find?(filter: object, options?: object): MongoCursorLike | Row[];
  findOne?(filter: object, options?: object): Promise<Row | null>;
  countDocuments?(filter?: object, options?: object): Promise<number>;
  insertOne?(doc: Row, options?: object): Promise<{ insertedId?: unknown; acknowledged?: boolean }>;
  insertMany?(docs: Row[], options?: object): Promise<{ insertedCount?: number; acknowledged?: boolean }>;
  updateOne?(filter: object, update: object, options?: object): Promise<{ modifiedCount?: number; matchedCount?: number; acknowledged?: boolean }>;
  updateMany?(filter: object, update: object, options?: object): Promise<{ modifiedCount?: number; matchedCount?: number; acknowledged?: boolean }>;
  deleteOne?(filter: object, options?: object): Promise<{ deletedCount?: number; acknowledged?: boolean }>;
  deleteMany?(filter: object, options?: object): Promise<{ deletedCount?: number; acknowledged?: boolean }>;
  findOneAndUpdate?(filter: object, update: object, options?: object): Promise<Row | null>;
}

/** A MongoDB database (duck-typed). */
export interface MongoDbLike {
  collection(name: string): MongoCollectionLike;
  runCommand?(command: object): Promise<unknown>;
}

/** A MongoDB session for multi-document transactions (duck-typed). */
export interface MongoSessionLike {
  startTransaction?(): void;
  commitTransaction?(): Promise<void>;
  abortTransaction?(): Promise<void>;
  endSession?(): void | Promise<void>;
}

/** A MongoDB client (compatible with the official `mongodb` driver). */
export interface MongoClientLike {
  connect?(): Promise<unknown>;
  db?(name?: string): MongoDbLike;
  collection?(name: string): MongoCollectionLike;
  startSession?(): Promise<MongoSessionLike> | MongoSessionLike;
  close?(): Promise<void>;
}

/**
 * MongoDB connection backed by the official `mongodb` client. Pass a
 * `connectionString` and the driver is imported lazily, or pass `client` directly.
 */
export class MongoConnection implements DocumentConnection {
  readonly dialect = 'mongo' as const;
  readonly name: string;
  private client: MongoClientLike | null = null;
  private readonly lazy: boolean;
  private readonly dbName: string;
  private readonly connectionString: string | undefined;
  private readonly clientOptions: Record<string, unknown> | undefined;

  constructor(name: string, config: MongoConfig) {
    this.name = name;
    this.lazy = config.lazy ?? false;
    this.dbName = config.dbName ?? 'lumen';
    this.connectionString = config.connectionString;
    this.clientOptions = config.options;
    this.client = config.client ?? null;
    if (!this.connectionString && !config.client) {
      throw new DatabaseException(`Mongo connection "${name}" requires a connectionString or a client`, 'DATABASE_CONFIG_ERROR', { name });
    }
  }

  private async ensureClient(): Promise<MongoClientLike> {
    if (this.client) return this.client;
    if (!this.connectionString) {
      throw new DatabaseException(`Mongo connection "${this.name}" has no client or connection string`, 'DATABASE_CONFIG_ERROR');
    }
    try {
      const mod = await import('mongodb');
      const MongoClientCtor = (mod as unknown as { MongoClient: new (uri: string, options?: Record<string, unknown>) => MongoClientLike }).MongoClient;
      this.client = new MongoClientCtor(this.connectionString, this.clientOptions);
      return this.client;
    } catch (error) {
      throw new DatabaseException(
        `Mongo driver could not be loaded for "${this.name}". Install the optional "mongodb" dependency.`,
        'DATABASE_CONFIG_ERROR',
        { name: this.name },
        { cause: error },
      );
    }
  }

  db(): MongoDbLike {
    const client = this.client;
    if (!client) throw new DatabaseException(`Mongo connection "${this.name}" is not connected`, 'DATABASE_CONNECT_ERROR', { name: this.name });
    if (client.db) return client.db(this.dbName);
    const collection = client.collection;
    if (!collection) {
      throw new DatabaseException(`Mongo client for "${this.name}" has no db()/collection() accessor`, 'DATABASE_CONFIG_ERROR', { name: this.name });
    }
    return { collection };
  }

  async connect(): Promise<void> {
    if (this.lazy) return;
    const client = await this.ensureClient();
    try {
      if (client.connect) await client.connect();
    } catch (error) {
      throw toDatabaseException(error, 'DATABASE_CONNECT_ERROR', { name: this.name });
    }
  }

  async ping(): Promise<void> {
    const db = this.db();
    try {
      if (!db.runCommand) {
        throw new DatabaseException('Mongo client has no runCommand; cannot ping', 'DATABASE_UNSUPPORTED_OPERATION', { name: this.name });
      }
      await db.runCommand({ ping: 1 });
    } catch (error) {
      if (error instanceof DatabaseException) throw error;
      throw toDatabaseException(error, 'DATABASE_QUERY_ERROR', { name: this.name });
    }
  }

  collection<T extends Row = Row>(collectionName: string, options?: TableOptions): RowStore<T> {
    return new MongoTable<T>(this, collectionName, options);
  }

  /** Runs `work` inside a MongoDB session transaction; `session` is passed to bound collections. */
  async runInSession<R>(work: (session: import('./mongo.js').MongoSessionLike) => Promise<R>): Promise<R> {
    const client = await this.ensureClient();
    if (!client.startSession) {
      throw new DatabaseException('Mongo client has no startSession; transactions unsupported', 'DATABASE_UNSUPPORTED_OPERATION', { name: this.name });
    }
    const session = await client.startSession();
    try {
      session.startTransaction?.();
      const result = await work(session);
      await session.commitTransaction?.();
      return result;
    } catch (error) {
      await session.abortTransaction?.().catch(() => undefined);
      if (error instanceof DatabaseException) throw error;
      throw toDatabaseException(error, 'DATABASE_TRANSACTION_ERROR', { name: this.name });
    } finally {
      await session.endSession?.();
    }
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
      await this.client?.close?.();
    } finally {
      this.client = null;
    }
  }
}