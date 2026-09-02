import { describe, it, expect } from 'vitest';
import { audit, type AuditEvent } from './audit.js';
import { MemoryConnection } from '../../drivers/memory.js';

describe('audit', () => {
  it('stamps createdBy and updatedBy on insert', async () => {
    const conn = new MemoryConnection('default', { driver: 'memory' });
    await conn.connect();
    const table = conn.table<{ id: number; name: string; createdBy?: string; updatedBy?: string }>('users');

    table.use(audit({ getActor: () => 'alice' }));
    await table.insert({ id: 1, name: 'bob' });

    const row = await table.findById(1);
    expect(row).toBeDefined();
    expect(row!.createdBy).toBe('alice');
    expect(row!.updatedBy).toBe('alice');

    await conn.close();
  });

  it('stamps updatedBy on update', async () => {
    const conn = new MemoryConnection('default', {
      driver: 'memory',
      seed: { users: [{ id: 1, name: 'bob' }] },
    });
    await conn.connect();
    const table = conn.table<{ id: number; name: string; updatedBy?: string }>('users');

    table.use(audit({ getActor: () => 'charlie' }));
    await table.updateById(1, { name: 'new bob' });

    const row = await table.findById(1);
    expect(row).toBeDefined();
    expect(row!.updatedBy).toBe('charlie');

    await conn.close();
  });

  it('calls onAudit callback', async () => {
    const conn = new MemoryConnection('default', { driver: 'memory' });
    await conn.connect();
    const table = conn.table<{ id: number; name: string }>('users');
    const events: AuditEvent[] = [];

    table.use(audit({
      getActor: () => 'admin',
      onAudit: (e) => events.push(e),
    }));

    await table.insert({ id: 1, name: 'bob' });
    await table.updateById(1, { name: 'new bob' });
    await table.deleteById(1);

    expect(events).toHaveLength(3);
    expect(events[0]!.operation).toBe('insert');
    expect(events[1]!.operation).toBe('update');
    expect(events[2]!.operation).toBe('delete');

    await conn.close();
  });
});
