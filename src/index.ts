export { DatabaseModule } from './module/module.js';
export { DatabaseManager } from './module/manager.js';
export { DB_OPTIONS, getConnectionToken } from './module/tokens.js';
export { initializeConnection } from './module/connect.js';

export { DatabaseException, DatabaseErrorCodes } from './exceptions.js';
export type { DatabaseErrorCode } from './exceptions.js';

export { Repository, createRepository } from './repository.js';
export type { RepositorySchema } from './repository.js';

export * from './query/operators.js';
export { Query } from './query/query.js';

export {
  PluginManager,
  softDelete,
  isSoftDeleted,
  restoreSoftDeleted,
  scopes,
  events,
  cache,
  audit,
  optiLock,
  OptimisticLockError,
  encrypt,
  XorCipher,
  archive,
  isArchived,
  tenant,
  mask,
  track,
  computed,
  socket,
} from './plugins/index.js';
export type {
  DatabasePlugin,
  HookEvent,
  HookContext,
  HookHandler,
  RowStoreLike,
  SoftDeleteOptions,
  ScopeDefinition,
  StoreEvent,
  StoreEventListener,
  CachePluginOptions,
  AuditOptions,
  AuditEvent,
  OptimisticLockOptions,
  Cipher,
  EncryptionOptions,
  ArchivalOptions,
  MultiTenancyOptions,
  MaskingOptions,
  FieldMask,
  MaskFunction,
  ChangeTrackingOptions,
  ChangeRecord,
  FieldChange,
  ComputedField,
  SocketPluginOptions,
} from './plugins/index.js';

export {
  MemoryConnection,
  PostgresConnection,
  MysqlConnection,
  MongoConnection,
} from './drivers/index.js';
export type {
  PgClientLike,
  PgPoolLike,
  MysqlConnectionLike,
  MysqlPoolLike,
  MongoClientLike,
  MongoCollectionLike,
  MongoDbLike,
  MongoSessionLike,
} from './drivers/index.js';

export type {
  SqlDialect,
  Dialect,
  Row,
  PrimaryKey,
  Where,
  WhereOperators,
  ListOptions,
  QueryResult,
  Transaction,
  TableOptions,
  SqlConnection,
  DocumentConnection,
  Connection,
  RowStore,
  ConnectionConfig,
  PostgresConfig,
  MysqlConfig,
  MongoConfig,
  MemoryConfig,
  DatabaseModuleOptions,
  AsyncDatabaseModuleOptions,
} from './types.js';