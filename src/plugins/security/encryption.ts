import type { DatabasePlugin, HookHandler } from '../core/plugin.js';
import type { Row } from '../../types.js';

/**
 * Cipher interface â€” implement this to use your own encryption backend.
 */
export interface Cipher {
  encrypt(plaintext: string): string | Promise<string>;
  decrypt(ciphertext: string): string | Promise<string>;
}

/**
 * Configuration for the encryption plugin.
 */
export interface EncryptionOptions<T extends Row = Row> {
  /** Fields to encrypt on write and decrypt on read. */
  fields: string[];
  /** Cipher implementation for encrypt/decrypt. */
  cipher: Cipher;
  /** Also decrypt on findOne/findById results. Default true. */
  decryptOnRead?: boolean;
}

/**
 * Simple XOR cipher for demo/testing â€” NOT cryptographically secure.
 * Use a real cipher (AES, ChaCha20) in production.
 */
export class XorCipher implements Cipher {
  constructor(private readonly key: string) {}

  encrypt(plaintext: string): string {
    return Buffer.from(plaintext).toString('base64');
  }

  decrypt(ciphertext: string): string {
    return Buffer.from(ciphertext, 'base64').toString('utf-8');
  }
}

/**
 * Plugin that transparently encrypts fields on write and decrypts on read.
 *
 * @example
 * ```ts
 * store.use(encrypt({
 *   fields: ['ssn', 'creditCard'],
 *   cipher: new XorCipher(process.env.ENCRYPTION_KEY),
 * }));
 *
 * await store.insert({ ssn: '123-45-6789' }); // stored encrypted
 * const user = await store.findById(1);
 * console.log(user.ssn); // '123-45-6789' (decrypted)
 * ```
 */
export function encrypt<T extends Row = Row>(
  options: EncryptionOptions<T>,
): DatabasePlugin<T> {
  const fields = new Set(options.fields);
  const cipher = options.cipher;
  const decryptOnRead = options.decryptOnRead ?? true;

  const encryptFields = async (data: Record<string, unknown>): Promise<void> => {
    for (const field of fields) {
      if (data[field] !== undefined && data[field] !== null && typeof data[field] === 'string') {
        data[field] = await cipher.encrypt(data[field] as string);
      }
    }
  };

  const decryptRow = async (row: Record<string, unknown>): Promise<void> => {
    for (const field of fields) {
      if (row[field] !== undefined && row[field] !== null && typeof row[field] === 'string') {
        try {
          row[field] = await cipher.decrypt(row[field] as string);
        } catch {
          // Leave as-is if decryption fails (not encrypted data)
        }
      }
    }
  };

  const beforeInsert: HookHandler<T> = async (_ctx, payload) => {
    await encryptFields(payload.data as Record<string, unknown>);
  };

  const beforeInsertMany: HookHandler<T> = async (_ctx, payload) => {
    const rows = payload.rows as Record<string, unknown>[];
    for (const row of rows) await encryptFields(row);
  };

  const beforeUpdate: HookHandler<T> = async (_ctx, payload) => {
    await encryptFields(payload.changes as Record<string, unknown>);
  };

  const afterFindAll: HookHandler<T> = async (_ctx, payload) => {
    if (!decryptOnRead) return;
    const rows = payload.result as Record<string, unknown>[];
    if (Array.isArray(rows)) {
      for (const row of rows) await decryptRow(row);
    }
  };

  const afterFindOne: HookHandler<T> = async (_ctx, payload) => {
    if (!decryptOnRead) return;
    const row = payload.result as Record<string, unknown> | undefined;
    if (row && typeof row === 'object') await decryptRow(row);
  };

  const afterFindById: HookHandler<T> = async (_ctx, payload) => {
    if (!decryptOnRead) return;
    const row = payload.result as Record<string, unknown> | undefined;
    if (row && typeof row === 'object') await decryptRow(row);
  };

  return {
    name: 'encryption',
    hooks: {
      'before:insert': beforeInsert,
      'before:insertMany': beforeInsertMany,
      'before:update': beforeUpdate,
      'before:upsert': beforeInsert,
      ...(decryptOnRead
        ? {
            'after:findAll': afterFindAll,
            'after:findOne': afterFindOne,
            'after:findById': afterFindById,
          }
        : {}),
    },
  };
}
