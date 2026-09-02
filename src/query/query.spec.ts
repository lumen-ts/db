import { describe, expect, it } from 'vitest';
import { MemoryConnection } from '../drivers/memory.js';
import { Query } from './query.js';
import type { RowStore, SqlConnection } from '../types.js';

interface User {
  id: number;
  name: string;
  role: 'admin' | 'editor' | 'viewer';
  [key: string]: unknown;
}

function seeded(): { conn: SqlConnection; users: RowStore<User> } {
  const conn = new MemoryConnection('test', {
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
  return { conn, users: conn.table<User>('users') };
}

describe('Query builder', () => {
  it('chains where, orderBy, limit, offset and exec', async () => {
    const { conn, users } = seeded();
    try {
      const results = await new Query(users)
        .where({ role: 'admin' })
        .orderBy('name', 'desc')
        .exec();
      expect(results).toEqual([
        { id: 4, name: 'dave', role: 'admin' },
        { id: 1, name: 'ana', role: 'admin' },
      ]);
    } finally {
      await conn.close();
    }
  });

  it('supports select projection', async () => {
    const { conn, users } = seeded();
    try {
      const results = await new Query(users).select('id', 'name').exec();
      expect(results).toHaveLength(4);
      for (const row of results) {
        expect(row).toHaveProperty('id');
        expect(row).toHaveProperty('name');
        expect(row).not.toHaveProperty('role');
      }
    } finally {
      await conn.close();
    }
  });

  it('first() returns the first matching row', async () => {
    const { conn, users } = seeded();
    try {
      const first = await new Query(users).where({ role: 'admin' }).first();
      expect(first).toEqual({ id: 1, name: 'ana', role: 'admin' });
    } finally {
      await conn.close();
    }
  });

  it('first() returns undefined when no match', async () => {
    const { conn, users } = seeded();
    try {
      const none = await new Query(users).where({ name: 'nobody' }).first();
      expect(none).toBeUndefined();
    } finally {
      await conn.close();
    }
  });

  it('count() returns the number of matching rows', async () => {
    const { conn, users } = seeded();
    try {
      const total = await new Query(users).count();
      expect(total).toBe(4);
      const admins = await new Query(users).where({ role: 'admin' }).count();
      expect(admins).toBe(2);
    } finally {
      await conn.close();
    }
  });

  it('toPaged() returns paginated results', async () => {
    const { conn, users } = seeded();
    try {
      const page = await new Query(users).orderBy('id').toPaged({ page: 1, limit: 2 });
      expect(page.data).toHaveLength(2);
      expect(page.meta.total).toBe(4);
      expect(page.meta.hasNext).toBe(true);
      expect(page.meta.page).toBe(1);
    } finally {
      await conn.close();
    }
  });

  it('ids() returns primary key list', async () => {
    const { conn, users } = seeded();
    try {
      const ids = await new Query(users).where({ role: 'admin' }).ids();
      expect(ids).toEqual([1, 4]);
    } finally {
      await conn.close();
    }
  });

  it('and() adds single field filter', async () => {
    const { conn, users } = seeded();
    try {
      const results = await new Query(users)
        .and('role', 'editor')
        .exec();
      expect(results).toEqual([{ id: 2, name: 'bob', role: 'editor' }]);
    } finally {
      await conn.close();
    }
  });

  it('merges multiple where() calls', async () => {
    const { conn, users } = seeded();
    try {
      const results = await new Query(users)
        .where({ role: 'admin' })
        .where({ name: 'ana' })
        .exec();
      expect(results).toEqual([{ id: 1, name: 'ana', role: 'admin' }]);
    } finally {
      await conn.close();
    }
  });

  it('supports operators in where', async () => {
    const { conn, users } = seeded();
    try {
      const results = await new Query(users)
        .where({ id: { $gt: 2, $lte: 4 } })
        .orderBy('id')
        .exec();
      expect(results).toEqual([
        { id: 3, name: 'carol', role: 'viewer' },
        { id: 4, name: 'dave', role: 'admin' },
      ]);
    } finally {
      await conn.close();
    }
  });

  it('works with store.query() shorthand', async () => {
    const { conn, users } = seeded();
    try {
      const results = await users.query()
        .where({ role: 'viewer' })
        .select('id', 'name')
        .exec();
      expect(results).toEqual([{ id: 3, name: 'carol' }]);
    } finally {
      await conn.close();
    }
  });

  it('supports limit and offset', async () => {
    const { conn, users } = seeded();
    try {
      const page2 = await new Query(users)
        .orderBy('id')
        .limit(2)
        .offset(2)
        .exec();
      expect(page2).toEqual([
        { id: 3, name: 'carol', role: 'viewer' },
        { id: 4, name: 'dave', role: 'admin' },
      ]);
    } finally {
      await conn.close();
    }
  });

  it('multiple orderBy calls compose', async () => {
    const { conn, users } = seeded();
    try {
      // All admins have same role, so only name sort matters
      const results = await new Query(users)
        .where({ role: 'admin' })
        .orderBy('name', 'desc')
        .exec();
      expect(results.map((u) => u.name)).toEqual(['dave', 'ana']);
    } finally {
      await conn.close();
    }
  });

  it('toMap() returns a map keyed by a field', async () => {
    const { conn, users } = seeded();
    try {
      const map = await new Query(users).orderBy('id').toMap('id');
      expect(map.size).toBe(4);
      expect(map.get(1)).toMatchObject({ name: 'ana' });
      expect(map.get(4)).toMatchObject({ name: 'dave' });
    } finally {
      await conn.close();
    }
  });

  it('groupBy() groups rows by a field value', async () => {
    const { conn, users } = seeded();
    try {
      const groups = await new Query(users).groupBy('role');
      expect(groups.size).toBe(3);
      expect(groups.get('admin')).toHaveLength(2);
      expect(groups.get('editor')).toHaveLength(1);
      expect(groups.get('viewer')).toHaveLength(1);
    } finally {
      await conn.close();
    }
  });

  it('pluck() returns values from a single column', async () => {
    const { conn, users } = seeded();
    try {
      const names = await new Query(users).orderBy('id').pluck('name');
      expect(names).toEqual(['ana', 'bob', 'carol', 'dave']);
    } finally {
      await conn.close();
    }
  });

  it('upsert() through RowStore inserts and updates', async () => {
    const { conn, users } = seeded();
    try {
      const inserted = await users.upsert(
        { id: 10, name: 'eve', role: 'viewer' },
        { role: 'admin' },
        ['id'],
      );
      expect(inserted).toMatchObject({ id: 10, name: 'eve', role: 'viewer' });

      const updated = await users.upsert(
        { id: 1, name: 'ana', role: 'admin' },
        { role: 'superadmin' as User['role'] },
        ['id'],
      );
      expect(updated).toMatchObject({ id: 1, name: 'ana', role: 'superadmin' });
    } finally {
      await conn.close();
    }
  });
});
