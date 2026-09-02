import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zodSchema } from '@lumen/zod';
import { MemoryConnection } from './drivers/memory.js';
import { createRepository } from './repository.js';
import type { RowStore } from './types.js';

interface User {
  id: number;
  name: string;
  role: 'admin' | 'editor' | 'viewer';
  [key: string]: unknown;
}

const userSchema = zodSchema<User>(
  z.object({
    id: z.number(),
    name: z.string().min(2),
    role: z.enum(['admin', 'editor', 'viewer']),
  }),
);

function setup(): { conn: MemoryConnection; store: RowStore<User> } {
  const conn = new MemoryConnection('repo', {
    driver: 'memory',
    seed: {
      users: [
        { id: 1, name: 'ana', role: 'admin' },
        { id: 2, name: 'bob', role: 'editor' },
        { id: 3, name: 'carol', role: 'viewer' },
        { id: 4, name: 'dave', role: 'admin' },
      ],
    },
  });
  return { conn, store: conn.table<User>('users') };
}

describe('Repository', () => {
  it('pages the underlying store with @lumen/common pagination', async () => {
    const { conn, store } = setup();
    try {
      const repo = createRepository<User>(store, { schema: userSchema });
      const first = await repo.paged({ page: 1, limit: 2, sortBy: 'id' });
      expect(first.meta).toMatchObject({ page: 1, limit: 2, total: 4, offset: 0, hasNext: true });
      expect(first.data.map((u) => u.name)).toEqual(['ana', 'bob']);

      const second = await repo.paged({ page: 2, limit: 2, sortBy: 'id' });
      expect(second.data.map((u) => u.name)).toEqual(['carol', 'dave']);
      expect(second.meta.hasNext).toBe(false);
    } finally {
      await conn.close();
    }
  });

  it('rejects invalid writes and strips unknown fields on partial updates', async () => {
    const { conn, store } = setup();
    try {
      const repo = createRepository<User>(store, { schema: userSchema });
      await expect(repo.insert({ id: 5, name: 'x', role: 'admin' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await expect(repo.updateById(1, { role: 'bogus' as User['role'] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

      await repo.updateById(1, { role: 'viewer', extra: 'unknown' });
      const row = await repo.findById(1);
      expect(row).toMatchObject({ id: 1, name: 'ana', role: 'viewer' });
      expect(row?.extra).toBeUndefined();
    } finally {
      await conn.close();
    }
  });

  it('parses stored rows back through the schema', async () => {
    const { conn, store } = setup();
    try {
      const repo = createRepository<User>(store, { schema: userSchema });
      await expect(repo.findOne({ name: 'bob' })).resolves.toEqual({ id: 2, name: 'bob', role: 'editor' });
    } finally {
      await conn.close();
    }
  });

  it('exposes transactions that re-bind both store and schema', async () => {
    const { conn, store } = setup();
    try {
      const repo = createRepository<User>(store, { schema: userSchema });
      await repo.transaction(async (tx) => {
        await tx.insert({ id: 9, name: 'erin', role: 'viewer' });
      });
      await expect(store.findById(9)).resolves.toEqual({ id: 9, name: 'erin', role: 'viewer' });
    } finally {
      await conn.close();
    }
  });
});