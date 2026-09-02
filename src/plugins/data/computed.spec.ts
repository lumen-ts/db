import { describe, it, expect } from 'vitest';
import { computed } from './computed.js';
import { MemoryConnection } from '../../drivers/memory.js';

describe('computed', () => {
  it('adds computed fields to results', async () => {
    const conn = new MemoryConnection('default', {
      driver: 'memory',
      seed: {
        users: [
          { id: 1, firstName: 'Alice', lastName: 'Smith', age: 25 },
          { id: 2, firstName: 'Bob', lastName: 'Jones', age: 15 },
        ],
      },
    });
    await conn.connect();
    const table = conn.table<{ id: number; firstName: string; lastName: string; age: number }>('users');

    table.use(computed({
      fields: [
        { name: 'fullName', compute: (row) => `${row.firstName} ${row.lastName}` },
        { name: 'isAdult', compute: (row) => (row.age as number) >= 18 },
      ],
    }));

    const users = await table.findAll();
    expect(users[0]!.fullName).toBe('Alice Smith');
    expect(users[0]!.isAdult).toBe(true);
    expect(users[1]!.fullName).toBe('Bob Jones');
    expect(users[1]!.isAdult).toBe(false);

    await conn.close();
  });

  it('adds computed fields to findById', async () => {
    const conn = new MemoryConnection('default', {
      driver: 'memory',
      seed: { users: [{ id: 1, firstName: 'Alice', lastName: 'Smith' }] },
    });
    await conn.connect();
    const table = conn.table<{ id: number; firstName: string; lastName: string }>('users');

    table.use(computed({
      fields: [
        { name: 'fullName', compute: (row) => `${row.firstName} ${row.lastName}` },
      ],
    }));

    const user = await table.findById(1);
    expect(user).toBeDefined();
    expect(user!.fullName).toBe('Alice Smith');

    await conn.close();
  });

  it('adds computed fields to insert results', async () => {
    const conn = new MemoryConnection('default', { driver: 'memory' });
    await conn.connect();
    const table = conn.table<{ id: number; firstName: string; lastName: string }>('users');

    table.use(computed({
      fields: [
        { name: 'fullName', compute: (row) => `${row.firstName} ${row.lastName}` },
      ],
    }));

    const user = await table.insert({ id: 1, firstName: 'Alice', lastName: 'Smith' });
    expect(user.fullName).toBe('Alice Smith');

    await conn.close();
  });
});
