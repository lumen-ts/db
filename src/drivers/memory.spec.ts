import { describe, expect, it } from 'vitest';
import { MemoryConnection } from './memory.js';
import type { RowStore } from '../types.js';

interface User {
  id: number;
  name: string;
  role: string;
  [key: string]: unknown;
}

function seeded(): { conn: MemoryConnection; users: RowStore<User> } {
  const conn = new MemoryConnection('test', {
    driver: 'memory',
    seed: {
      users: [
        { id: 1, name: 'ana', role: 'admin' },
        { id: 2, name: 'bob', role: 'editor' },
        { id: 3, name: 'carol', role: 'admin' },
      ],
    },
  });
  return { conn, users: conn.table<User>('users') };
}

describe('MemoryConnection + SqlTable', () => {
  it('lists seeded rows with filters and pagination', async () => {
    const { conn, users } = seeded();
    try {
      await expect(users.findAll()).resolves.toHaveLength(3);
      await expect(users.findAll({ where: { role: 'admin' }, orderBy: { name: 'desc' } })).resolves.toEqual([
        { id: 3, name: 'carol', role: 'admin' },
        { id: 1, name: 'ana', role: 'admin' },
      ]);
      await expect(users.findAll({ limit: 2, offset: 1 })).resolves.toEqual([
        { id: 2, name: 'bob', role: 'editor' },
        { id: 3, name: 'carol', role: 'admin' },
      ]);
    } finally {
      await conn.close();
    }
  });

  it('supports operators, LIKE, IN and BETWEEN via the query builder', async () => {
    const { conn, users } = seeded();
    try {
      await expect(users.findAll({ where: { name: { $like: 'c%' } } })).resolves.toEqual([{ id: 3, name: 'carol', role: 'admin' }]);
      await expect(users.findAll({ where: { role: { $in: ['editor'] } } })).resolves.toEqual([{ id: 2, name: 'bob', role: 'editor' }]);
      await expect(users.findAll({ where: { id: { $between: [2, 3] }, role: { $ne: 'admin' } } })).resolves.toEqual([{ id: 2, name: 'bob', role: 'editor' }]);
      await expect(users.count({ role: { $isNull: false } })).resolves.toBe(3);
    } finally {
      await conn.close();
    }
  });

  it('finds, counts, inserts and deletes', async () => {
    const { conn, users } = seeded();
    try {
      await expect(users.findById(1)).resolves.toEqual({ id: 1, name: 'ana', role: 'admin' });

      const inserted = await users.insert({ id: 4, name: 'dave', role: 'viewer' });
      expect(inserted).toEqual({ id: 4, name: 'dave', role: 'viewer' });
      await expect(users.count()).resolves.toBe(4);

      await expect(users.update({ name: 'bob' }, { role: 'admin' })).resolves.toBe(1);
      await expect(users.findById(2)).resolves.toEqual({ id: 2, name: 'bob', role: 'admin' });

      await expect(users.updateById(4, { name: 'DAVE' })).resolves.toEqual({ id: 4, name: 'DAVE', role: 'viewer' });

      await expect(users.deleteById(3)).resolves.toBe(true);
      await expect(users.deleteById(99)).resolves.toBe(false);
      await expect(users.count()).resolves.toBe(3);
    } finally {
      await conn.close();
    }
  });

  it('refuses unfiltered deletes', async () => {
    const { conn, users } = seeded();
    try {
      await expect(users.delete({})).rejects.toThrow(/filter is required/);
    } finally {
      await conn.close();
    }
  });

  it('insertMany batch inserts multiple rows at once', async () => {
    const { conn, users } = seeded();
    try {
      const inserted = await users.insertMany([
        { id: 10, name: 'eve', role: 'viewer' },
        { id: 11, name: 'frank', role: 'editor' },
        { id: 12, name: 'grace', role: 'admin' },
      ]);
      expect(inserted).toHaveLength(3);
      expect(inserted[0]).toMatchObject({ id: 10, name: 'eve' });
      expect(inserted[2]).toMatchObject({ id: 12, name: 'grace' });
      await expect(users.count()).resolves.toBe(6);
    } finally {
      await conn.close();
    }
  });

  it('insertMany with single row uses single insert path', async () => {
    const { conn, users } = seeded();
    try {
      const inserted = await users.insertMany([{ id: 20, name: 'hal', role: 'viewer' }]);
      expect(inserted).toHaveLength(1);
      expect(inserted[0]).toMatchObject({ id: 20, name: 'hal' });
    } finally {
      await conn.close();
    }
  });

  it('insertMany with empty array returns empty', async () => {
    const { conn, users } = seeded();
    try {
      const inserted = await users.insertMany([]);
      expect(inserted).toHaveLength(0);
    } finally {
      await conn.close();
    }
  });

  it('commits transactions atomically and rolls back on failure', async () => {
    const { conn, users } = seeded();
    try {
      await users.transaction(async (tx) => {
        await tx.insert({ id: 10, name: 'eve', role: 'viewer' });
        await tx.update({ id: 1 }, { role: 'viewer' });
      });
      await expect(users.findById(10)).resolves.toEqual({ id: 10, name: 'eve', role: 'viewer' });
      await expect(users.findById(1)).resolves.toMatchObject({ role: 'viewer' });

      await expect(
        users.transaction(async (tx) => {
          await tx.insert({ id: 11, name: 'frank', role: 'viewer' });
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      await expect(users.findById(11)).resolves.toBeUndefined();
      await expect(users.count()).resolves.toBe(4);
    } finally {
      await conn.close();
    }
  });

  it('rejects unsupported SQL', async () => {
    const { conn } = seeded();
    try {
      await expect(conn.query('SELECT * FROM users JOIN roles ON 1=1')).rejects.toThrow(/does not support/);
      await expect(conn.query('DROP TABLE users')).rejects.toThrow(/does not support/);
    } finally {
      await conn.close();
    }
  });

  it('upsert inserts when no match exists', async () => {
    const { conn, users } = seeded();
    try {
      const result = await users.upsert(
        { id: 10, name: 'eve', role: 'viewer' },
        { role: 'admin' },
        ['id'],
      );
      expect(result).toMatchObject({ id: 10, name: 'eve', role: 'viewer' });
      await expect(users.count()).resolves.toBe(4);
    } finally {
      await conn.close();
    }
  });

  it('upsert updates when a match exists', async () => {
    const { conn, users } = seeded();
    try {
      const result = await users.upsert(
        { id: 1, name: 'ana', role: 'admin' },
        { role: 'superadmin' as User['role'] },
        ['id'],
      );
      expect(result).toMatchObject({ id: 1, name: 'ana', role: 'superadmin' });
      await expect(users.count()).resolves.toBe(3);
    } finally {
      await conn.close();
    }
  });

  it('upsert with multiple match columns', async () => {
    const { conn, users } = seeded();
    try {
      // Match on name+role — 'ana' has role 'admin', not 'viewer', so no match
      const result = await users.upsert(
        { id: 50, name: 'ana', role: 'viewer' },
        { name: 'ANNA' },
        ['name', 'role'],
      );
      // No match on (name=ana, role=viewer) — inserts data row as-is
      expect(result).toMatchObject({ id: 50, name: 'ana', role: 'viewer' });

      // Now match on (name=ana, role=admin) — should update
      const updated = await users.upsert(
        { id: 1, name: 'ana', role: 'admin' },
        { name: 'ANNA' },
        ['name', 'role'],
      );
      expect(updated).toMatchObject({ name: 'ANNA', role: 'admin' });
    } finally {
      await conn.close();
    }
  });
});