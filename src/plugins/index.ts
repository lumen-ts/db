// Core
export { PluginManager, type DatabasePlugin, type HookEvent, type HookContext, type HookHandler, type RowStoreLike } from './core/index.js';

// Data
export { softDelete, isSoftDeleted, restoreSoftDeleted, type SoftDeleteOptions } from './data/index.js';
export { archive, isArchived, type ArchivalOptions } from './data/index.js';
export { cascade, type CascadeRule } from './data/index.js';
export { defaults, type DefaultField } from './data/index.js';
export { trim, type TrimMode, type TrimOptions } from './data/index.js';
export { slug, slugify, type SlugOptions } from './data/index.js';
export { optiLock, OptimisticLockError, type OptimisticLockOptions } from './data/index.js';
export { track, type ChangeTrackingOptions, type ChangeRecord, type FieldChange } from './data/index.js';
export { computed, type ComputedField } from './data/index.js';
export { tenant, type MultiTenancyOptions } from './data/index.js';

// Security
export { encrypt, XorCipher, type Cipher, type EncryptionOptions } from './security/index.js';
export { mask, type MaskingOptions, type FieldMask, type MaskFunction } from './security/index.js';
export { validate, type ValidationRule, type ValidationOptions } from './security/index.js';

// Observability
export { audit, type AuditOptions, type AuditEvent } from './observability/index.js';
export { events, type StoreEvent, type StoreEventListener } from './observability/index.js';
export { cache, type CachePluginOptions } from './observability/index.js';
export { rateLimit, type RateLimitOptions } from './observability/index.js';
export { requestId, type RequestIdOptions } from './observability/index.js';
export { socket, type SocketPluginOptions } from './observability/index.js';

// Query
export { scopes, type ScopeDefinition } from './query/index.js';
export { buildSearchWhere, type SearchOptions } from './query/index.js';
export { encodeCursor, decodeCursor, cursorWhere, type CursorOptions } from './query/index.js';
