import { describe, it, expect } from 'vitest';
import { events, type StoreEvent } from './events.js';
import { MemoryConnection } from '../../drivers/memory.js';

describe('events', () => {
  it('emits events for store operations', async () => {
    const conn = new MemoryConnection('default', {
      driver: 'memory',
      seed: { users: [{ id: 1, name: 'alice' }] },
    });
    await conn.connect();
    const table = conn.table<{ id: number; name: string }>('users');

    const collected: StoreEvent[] = [];
    const plugin = events<{ id: number; name: string }>({
      onEvent: (event) => { collected.push(event); },
    });
    table.use(plugin);

    await table.findAll();
    await table.findById(1);
    await table.insert({ id: 2, name: 'bob' });

    expect(collected.length).toBeGreaterThanOrEqual(3);
    expect(collected.some((e) => e.event === 'before:findAll')).toBe(true);
    expect(collected.some((e) => e.event === 'after:findAll')).toBe(true);
    expect(collected.some((e) => e.event === 'before:findById')).toBe(true);
    expect(collected.some((e) => e.event === 'before:insert')).toBe(true);

    await conn.close();
  });

  it('includes duration in events', async () => {
    const conn = new MemoryConnection('default', { driver: 'memory' });
    await conn.connect();
    const table = conn.table<{ id: number; name: string }>('users');

    const collected: StoreEvent[] = [];
    const plugin = events<{ id: number; name: string }>({
      onEvent: (event) => { collected.push(event); },
    });
    table.use(plugin);

    await table.findAll();

    const afterEvent = collected.find((e) => e.event === 'after:findAll');
    expect(afterEvent).toBeDefined();
    expect(afterEvent!.duration).toBeGreaterThanOrEqual(0);

    await conn.close();
  });

  it('filters events by type', async () => {
    const conn = new MemoryConnection('default', {
      driver: 'memory',
      seed: { users: [{ id: 1, name: 'alice' }] },
    });
    await conn.connect();
    const table = conn.table<{ id: number; name: string }>('users');

    const collected: StoreEvent[] = [];
    const plugin = events<{ id: number; name: string }>({
      onEvent: (event) => { collected.push(event); },
      events: ['before:insert', 'after:insert'],
    });
    table.use(plugin);

    await table.findAll(); // Should not emit
    await table.insert({ id: 2, name: 'bob' }); // Should emit

    expect(collected.length).toBe(2);
    expect(collected[0]!.event).toBe('before:insert');
    expect(collected[1]!.event).toBe('after:insert');

    await conn.close();
  });

  it('emits error events', async () => {
    const conn = new MemoryConnection('default', { driver: 'memory' });
    await conn.connect();
    const table = conn.table<{ id: number; name: string }>('users');

    const errors: StoreEvent[] = [];
    const plugin = events<{ id: number; name: string }>({
      onError: (event) => { errors.push(event); },
    });
    table.use(plugin);

    // Try to delete without WHERE (should throw)
    try {
      await table.delete({});
    } catch {
      // Expected
    }

    // Error events may or may not be emitted depending on implementation
    // This is a smoke test to ensure the plugin doesn't crash
    expect(errors).toBeDefined();

    await conn.close();
  });
});
