import { describe, it, expect } from 'vitest';
import { scopes } from './scopes.js';
import { MemoryConnection } from '../../drivers/memory.js';

describe('scopes', () => {
  it('attaches scopes to the store', async () => {
    const conn = new MemoryConnection('default', {
      driver: 'memory',
      seed: {
        users: [
          { id: 1, name: 'alice', role: 'admin', status: 'active' },
          { id: 2, name: 'bob', role: 'user', status: 'active' },
          { id: 3, name: 'charlie', role: 'admin', status: 'inactive' },
        ],
      },
    });
    await conn.connect();
    const table = conn.table<{ id: number; name: string; role: string; status: string }>('users');

    const plugin = scopes<{ id: number; name: string; role: string; status: string }>({
      active: (q) => q.where({ status: 'active' }),
      admins: (q) => q.where({ role: 'admin' }),
    });
    table.use(plugin);

    // Verify scopes are attached
    expect(table.getScope('active')).toBeDefined();
    expect(table.getScope('admins')).toBeDefined();
    expect(table.getScope('nonexistent')).toBeUndefined();

    await conn.close();
  });

  it('scopes can be used in query builder', async () => {
    const conn = new MemoryConnection('default', {
      driver: 'memory',
      seed: {
        users: [
          { id: 1, name: 'alice', role: 'admin', status: 'active' },
          { id: 2, name: 'bob', role: 'user', status: 'active' },
          { id: 3, name: 'charlie', role: 'admin', status: 'inactive' },
        ],
      },
    });
    await conn.connect();
    const table = conn.table<{ id: number; name: string; role: string; status: string }>('users');

    const plugin = scopes<{ id: number; name: string; role: string; status: string }>({
      active: (q) => q.where({ status: 'active' }),
      admins: (q) => q.where({ role: 'admin' }),
    });
    table.use(plugin);

    // Use scope in query
    const activeAdmins = await table.query()
      .applyScope('active')
      .applyScope('admins')
      .exec();

    expect(activeAdmins).toHaveLength(1);
    expect(activeAdmins[0]!.name).toBe('alice');

    await conn.close();
  });

  it('scopes compose together', async () => {
    const conn = new MemoryConnection('default', {
      driver: 'memory',
      seed: {
        users: [
          { id: 1, name: 'alice', role: 'admin', status: 'active' },
          { id: 2, name: 'bob', role: 'user', status: 'active' },
          { id: 3, name: 'charlie', role: 'admin', status: 'inactive' },
          { id: 4, name: 'diana', role: 'user', status: 'inactive' },
        ],
      },
    });
    await conn.connect();
    const table = conn.table<{ id: number; name: string; role: string; status: string }>('users');

    const plugin = scopes<{ id: number; name: string; role: string; status: string }>({
      active: (q) => q.where({ status: 'active' }),
      admins: (q) => q.where({ role: 'admin' }),
      users: (q) => q.where({ role: 'user' }),
    });
    table.use(plugin);

    // Active users (not admins)
    const activeUsers = await table.query()
      .applyScope('active')
      .applyScope('users')
      .exec();

    expect(activeUsers).toHaveLength(1);
    expect(activeUsers[0]!.name).toBe('bob');

    // All admins
    const allAdmins = await table.query()
      .applyScope('admins')
      .exec();

    expect(allAdmins).toHaveLength(2);

    await conn.close();
  });
});
