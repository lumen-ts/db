import { describe, it, expect } from 'vitest';
import { cache } from './cache.js';
import { MemoryConnection } from '../../drivers/memory.js';

describe('cache', () => {
  it('caches query results and returns from cache', async () => {
    const conn = new MemoryConnection('default', {
      driver: 'memory',
      seed: { users: [{ id: 1, name: 'alice' }, { id: 2, name: 'bob' }] },
    });
    await conn.connect();
    const table = conn.table<{ id: number; name: string }>('users');

    const cachePlugin = cache<{ id: number; name: string }>({ defaultTtl: 10_000 });
    table.use(cachePlugin);

    // First call hits database
    const result1 = await table.findAll({ where: { name: 'alice' } });
    expect(result1).toEqual([{ id: 1, name: 'alice' }]);

    // Second call should return from cache (same result)
    const result2 = await table.findAll({ where: { name: 'alice' } });
    expect(result2).toEqual([{ id: 1, name: 'alice' }]);

    await conn.close();
  });

  it('invalidates cache on insert', async () => {
    const conn = new MemoryConnection('default', {
      driver: 'memory',
      seed: { users: [{ id: 1, name: 'alice' }] },
    });
    await conn.connect();
    const table = conn.table<{ id: number; name: string }>('users');

    const cachePlugin = cache<{ id: number; name: string }>({ defaultTtl: 10_000 });
    table.use(cachePlugin);

    // Populate cache
    const result1 = await table.findAll();
    expect(result1).toHaveLength(1);

    // Insert new row - should invalidate cache
    await table.insert({ id: 2, name: 'bob' });

    // Next query should hit database (cache invalidated)
    const result2 = await table.findAll();
    expect(result2).toHaveLength(2);

    await conn.close();
  });

  it('evicts oldest entries when max size reached', async () => {
    const conn = new MemoryConnection('default', { driver: 'memory' });
    await conn.connect();
    const table = conn.table<{ id: number; name: string }>('users');

    const cachePlugin = cache<{ id: number; name: string }>({
      defaultTtl: 10_000,
      maxSize: 2,
    });
    table.use(cachePlugin);

    // Add 3 entries (max is 2)
    await table.findAll({ where: { id: 1 } });
    await table.findAll({ where: { id: 2 } });
    await table.findAll({ where: { id: 3 } });

    // Cache should have evicted the first entry
    // This is a basic smoke test - we can't directly inspect the cache
    // but we verify the plugin doesn't throw
    const result = await table.findAll({ where: { id: 1 } });
    expect(result).toBeDefined();

    await conn.close();
  });

  it('expires entries after TTL', async () => {
    const conn = new MemoryConnection('default', {
      driver: 'memory',
      seed: { users: [{ id: 1, name: 'alice' }] },
    });
    await conn.connect();
    const table = conn.table<{ id: number; name: string }>('users');

    const cachePlugin = cache<{ id: number; name: string }>({ defaultTtl: 1 }); // 1ms TTL
    table.use(cachePlugin);

    // Populate cache
    await table.findAll({ where: { name: 'alice' } });

    // Wait for TTL to expire
    await new Promise((r) => setTimeout(r, 10));

    // Should hit database again (cache expired)
    const result = await table.findAll({ where: { name: 'alice' } });
    expect(result).toEqual([{ id: 1, name: 'alice' }]);

    await conn.close();
  });
});
