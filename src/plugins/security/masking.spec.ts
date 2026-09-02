import { describe, it, expect } from 'vitest';
import { mask } from './masking.js';
import { MemoryConnection } from '../../drivers/memory.js';

describe('mask', () => {
  it('masks fields in findAll results', async () => {
    const conn = new MemoryConnection('default', {
      driver: 'memory',
      seed: { users: [{ id: 1, name: 'alice', email: 'alice@example.com', ssn: '123-45-6789' }] },
    });
    await conn.connect();
    const table = conn.table<{ id: number; name: string; email: string; ssn: string }>('users');

    table.use(mask({
      fields: [
        { field: 'email', mask: (v) => v.replace(/(.{2}).*(@.*)/, '$1***$2') },
        { field: 'ssn' }, // default mask
      ],
    }));

    const users = await table.findAll();
    expect(users[0]!.email).toBe('al***@example.com');
    expect(users[0]!.ssn).toBe('12*******89');
    expect(users[0]!.name).toBe('alice'); // not masked

    await conn.close();
  });

  it('masks fields in findById results', async () => {
    const conn = new MemoryConnection('default', {
      driver: 'memory',
      seed: { users: [{ id: 1, email: 'bob@test.com' }] },
    });
    await conn.connect();
    const table = conn.table<{ id: number; email: string }>('users');

    table.use(mask({
      fields: [{ field: 'email' }],
    }));

    const user = await table.findById(1);
    expect(user).toBeDefined();
    expect(user!.email).toBe('bo********om');

    await conn.close();
  });

  it('does not mask non-string values', async () => {
    const conn = new MemoryConnection('default', {
      driver: 'memory',
      seed: { users: [{ id: 1, email: null, age: 25 }] },
    });
    await conn.connect();
    const table = conn.table<{ id: number; email: string | null; age: number }>('users');

    table.use(mask({
      fields: ['email', 'age' as string],
    }));

    const user = await table.findById(1);
    expect(user).toBeDefined();
    expect(user!.email).toBeNull();
    expect(user!.age).toBe(25);

    await conn.close();
  });
});
