import { describe, it, expect } from 'vitest';
import { softDelete, isSoftDeleted, restoreSoftDeleted } from './soft-delete.js';
import { MemoryConnection } from '../../drivers/memory.js';

describe('softDelete', () => {
  it('marks rows as deleted instead of removing them', async () => {
    const conn = new MemoryConnection('default', {
      driver: 'memory',
      seed: { users: [{ id: 1, name: 'alice' }, { id: 2, name: 'bob' }] },
    });
    await conn.connect();
    const table = conn.table<{ id: number; name: string; deletedAt: string | null }>('users');

    const plugin = softDelete<{ id: number; name: string; deletedAt: string | null }>();
    table.use(plugin);

    // Soft delete a row
    await table.deleteById(1);

    // Row should still exist with deletedAt set
    const row = await table.findById(1);
    expect(row).toBeDefined();
    expect(row!.deletedAt).toBeTruthy();

    // findAll should exclude soft-deleted rows
    const all = await table.findAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe(2);

    // count should exclude soft-deleted rows
    const count = await table.count();
    expect(count).toBe(1);

    await conn.close();
  });

  it('findOne excludes soft-deleted rows', async () => {
    const conn = new MemoryConnection('default', {
      driver: 'memory',
      seed: { users: [{ id: 1, name: 'alice', deletedAt: '2024-01-01T00:00:00.000Z' }] },
    });
    await conn.connect();
    const table = conn.table<{ id: number; name: string; deletedAt: string | null }>('users');

    const plugin = softDelete<{ id: number; name: string; deletedAt: string | null }>();
    table.use(plugin);

    // findOne should not find soft-deleted rows
    const row = await table.findOne({ name: 'alice' });
    expect(row).toBeUndefined();

    await conn.close();
  });

  it('uses custom column name', async () => {
    const conn = new MemoryConnection('default', {
      driver: 'memory',
      seed: { users: [{ id: 1, name: 'alice' }] },
    });
    await conn.connect();
    const table = conn.table<{ id: number; name: string; isDeleted: string | null }>('users');

    const plugin = softDelete<{ id: number; name: string; isDeleted: string | null }>({
      column: 'isDeleted',
    });
    table.use(plugin);

    await table.deleteById(1);

    const row = await table.findById(1);
    expect(row).toBeDefined();
    expect(row!.isDeleted).toBeTruthy();

    await conn.close();
  });

  it('isSoftDeleted helper works', () => {
    const row = { id: 1, deletedAt: '2024-01-01T00:00:00.000Z' };
    expect(isSoftDeleted(row)).toBe(true);
    expect(isSoftDeleted({ id: 2, deletedAt: null })).toBe(false);
  });

  it('restoreSoftDeleted helper works', () => {
    const row = { id: 1, deletedAt: '2024-01-01T00:00:00.000Z' };
    const restored = restoreSoftDeleted(row);
    expect(restored.deletedAt).toBeNull();
  });
});
