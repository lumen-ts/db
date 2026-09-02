import { describe, it, expect } from 'vitest';
import { PluginManager, type DatabasePlugin, type HookContext } from './plugin.js';

describe('PluginManager', () => {
  it('registers and executes hooks', async () => {
    const manager = new PluginManager();
    const calls: string[] = [];

    const plugin: DatabasePlugin = {
      name: 'test',
      hooks: {
        'before:insert': async (ctx, payload) => {
          calls.push('before:insert');
          payload.data = { ...Object(payload.data), extra: true };
        },
        'after:insert': async (ctx, payload) => {
          calls.push('after:insert');
        },
      },
    };

    manager.register(plugin);

    const payload = { data: { name: 'test' } };
    await manager.executeHooks('before:insert', { tableName: 'users', event: 'before:insert' }, payload);
    await manager.executeHooks('after:insert', { tableName: 'users', event: 'after:insert' }, payload);

    expect(calls).toEqual(['before:insert', 'after:insert']);
    expect(payload.data).toEqual({ name: 'test', extra: true });
  });

  it('unregisters plugins', async () => {
    const manager = new PluginManager();
    const calls: string[] = [];

    manager.register({
      name: 'test',
      hooks: {
        'before:insert': async () => { calls.push('test'); },
      },
    });

    manager.register({
      name: 'other',
      hooks: {
        'before:insert': async () => { calls.push('other'); },
      },
    });

    await manager.executeHooks('before:insert', { tableName: 'users', event: 'before:insert' }, {});
    expect(calls).toEqual(['test', 'other']);

    manager.unregister('test');
    calls.length = 0;
    await manager.executeHooks('before:insert', { tableName: 'users', event: 'before:insert' }, {});
    expect(calls).toEqual(['other']);
  });

  it('throws on duplicate plugin registration', () => {
    const manager = new PluginManager();
    manager.register({ name: 'test', hooks: {} });
    expect(() => manager.register({ name: 'test', hooks: {} })).toThrow('already registered');
  });

  it('supports abort in hooks', async () => {
    const manager = new PluginManager();
    manager.register({
      name: 'blocker',
      hooks: {
        'before:insert': async (ctx) => {
          ctx.abort('Not allowed');
        },
      },
    });

    await expect(
      manager.executeHooks('before:insert', { tableName: 'users', event: 'before:insert' }, {}),
    ).rejects.toThrow('Not allowed');
  });

  it('executes init and destroy lifecycle', async () => {
    const manager = new PluginManager();
    const lifecycle: string[] = [];

    manager.register({
      name: 'lifecycle',
      hooks: {},
      init: async () => { lifecycle.push('init'); },
      destroy: async () => { lifecycle.push('destroy'); },
    });

    await manager.initAll({ name: 'users', dialect: 'memory' });
    expect(lifecycle).toEqual(['init']);

    await manager.destroyAll();
    expect(lifecycle).toEqual(['init', 'destroy']);
  });

  it('hasPlugins returns true when plugins registered', () => {
    const manager = new PluginManager();
    expect(manager.hasPlugins).toBe(false);
    manager.register({ name: 'test', hooks: {} });
    expect(manager.hasPlugins).toBe(true);
  });
});
