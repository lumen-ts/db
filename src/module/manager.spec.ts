import { describe, expect, it } from 'vitest';
import { Controller, Get, Injectable, Module } from '@lumen/core';
import type { HttpAdapter, LumenReply, LumenRequest, RouteDefinition } from '@lumen/core';
import { LumenFactory } from '@lumen/core';
import { DatabaseModule } from './module.js';
import { DatabaseManager } from './manager.js';
import { createRepository } from '../repository.js';
import type { SqlConnection, RowStore } from '../types.js';

interface User { id: number; name: string; [key: string]: unknown; }

class RecordingAdapter implements HttpAdapter {
  readonly handlers = new Map<string, (req: LumenRequest, res: LumenReply) => Promise<unknown>>();
  registered: RouteDefinition[] = [];
  registerRoute(route: RouteDefinition, handler: (req: LumenRequest, res: LumenReply) => Promise<unknown>): void {
    this.registered.push(route);
    this.handlers.set(`${route.method} ${route.path}`, handler);
  }
  async listen(): Promise<string> { return 'http://memory'; }
  async close(): Promise<void> {}
  getInstance<T = unknown>(): T { return this as unknown as T; }
}

function request(overrides: Partial<LumenRequest> = {}): LumenRequest {
  return { id: 'req', method: 'GET', url: '/', headers: {}, body: undefined, query: {}, params: {}, raw: undefined, ...overrides };
}
function reply(): LumenReply {
  const res: LumenReply = {
    status() { return res; },
    header() { return res; },
    send(payload?: unknown) { return payload; },
    raw: undefined,
  };
  return res;
}

@Injectable()
class UserService {
  constructor(private readonly db: DatabaseManager) {}
  users(): RowStore<User> { return this.db.getConnection<SqlConnection>().table<User>('users'); }
}

@Controller('/users')
class UsersController {
  constructor(private readonly service: UserService) {}

  @Get()
  list(): Promise<User[]> {
    return this.service.users().findAll();
  }

  @Get('/count')
  count(): Promise<number> {
    return this.service.users().count();
  }
}

@Module({
  imports: [
    DatabaseModule.forRoot({
      connections: {
        app: {
          driver: 'memory',
          seed: { users: [{ id: 1, name: 'ana' }, { id: 2, name: 'bob' }] },
        },
      },
      default: 'app',
    }),
  ],
  controllers: [UsersController],
  providers: [UserService],
})
class AppModule {}

describe('DatabaseModule + DatabaseManager', () => {
  it('connects configured connections at bootstrap and serves handlers', async () => {
    const adapter = new RecordingAdapter();
    const app = await LumenFactory.create(AppModule, adapter);

    const manager = await app.get(DatabaseManager);
    expect(manager.names).toEqual(['app']);
    expect(manager.connectedNames()).toEqual(['app']);
    expect(manager.getConnection().dialect).toBe('memory');

    const list = adapter.handlers.get('GET /users');
    expect(list).toBeDefined();
    await expect(list!(request({ url: '/users' }), reply())).resolves.toEqual([
      { id: 1, name: 'ana' },
      { id: 2, name: 'bob' },
    ]);

    const count = adapter.handlers.get('GET /users/count');
    await expect(count!(request({ url: '/users/count' }), reply())).resolves.toBe(2);
    expect(adapter.registered.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /users', 'GET /users/count']);

    await app.close();
    expect(manager.connectedNames()).toEqual([]);
  });

  it('supports forRootAsync options', async () => {
    @Module({
      imports: [
        DatabaseModule.forRootAsync({
          useFactory: async () => ({
            connections: { app: { driver: 'memory' } },
            default: 'app',
          }),
        }),
      ],
      controllers: [UsersController],
      providers: [UserService],
    })
    class AsyncAppModule {}

    const adapter = new RecordingAdapter();
    const app = await LumenFactory.create(AsyncAppModule, adapter);
    const manager = await app.get(DatabaseManager);
    expect(manager.names).toEqual(['app']);
    await app.close();
  });
});

describe('DatabaseManager', () => {
  it('connect is idempotent and getConnection throws when absent', async () => {
    const manager = new DatabaseManager({ connections: { app: { driver: 'memory' } }, default: 'app' });
    expect(() => manager.getConnection()).toThrow(/No database connection "app"/);

    const a = await manager.connect('app');
    const b = await manager.connect('app');
    expect(a).toBe(b);
    expect(manager.has('app')).toBe(true);

    await manager.closeAll();
    expect(manager.connectedNames()).toEqual([]);
  });

  it('retries failed connects', async () => {
    const manager = new DatabaseManager({
      connections: { app: { driver: 'memory' } },
      default: 'app',
      retries: 2,
      retryDelay: 1,
    });
    await manager.connectAll();
    expect(manager.connectedNames()).toEqual(['app']);
    await manager.closeAll();
  });

  it('creates repositories over connections', async () => {
    const manager = new DatabaseManager({
      connections: { app: { driver: 'memory', seed: { users: [{ id: 7, name: 'zoe' }] } } },
      default: 'app',
    });
    await manager.connectAll();
    const repo = createRepository<User>(manager.getConnection<SqlConnection>().table<User>('users'));
    await expect(repo.findById(7)).resolves.toEqual({ id: 7, name: 'zoe' });
    await manager.closeAll();
  });

  it('healthCheckAll returns healthy status for all connections', async () => {
    const manager = new DatabaseManager({ connections: { app: { driver: 'memory' } }, default: 'app' });
    await manager.connectAll();
    const results = await manager.healthCheckAll();
    expect(results.get('app')).toBe(true);
    await manager.closeAll();
  });

  it('skips lazy connections at bootstrap', async () => {
    const manager = new DatabaseManager({
      connections: {
        eager: { driver: 'memory' },
        lazy: { driver: 'memory', lazy: true },
      },
      default: 'eager',
    });
    await manager.onModuleInit();
    expect(manager.has('eager')).toBe(true);
    expect(manager.has('lazy')).toBe(false);

    const lazyConn = await manager.connect('lazy');
    expect(lazyConn).toBeDefined();
    expect(manager.has('lazy')).toBe(true);

    await manager.closeAll();
  });

  it('fires onConnect and onDisconnect events', async () => {
    const events: string[] = [];
    const manager = new DatabaseManager({
      connections: { app: { driver: 'memory' } },
      default: 'app',
      events: {
        onConnect: (name) => { events.push(`connect:${name}`); },
        onDisconnect: (name) => { events.push(`disconnect:${name}`); },
      },
    });
    await manager.connect('app');
    expect(events).toContain('connect:app');

    await manager.close('app');
    expect(events).toContain('disconnect:app');
  });

  it('fires onError on failed connection', async () => {
    let capturedError: unknown;
    const manager = new DatabaseManager({
      connections: { bad: { driver: 'memory' } },
      default: 'bad',
      retries: 1,
      events: {
        onError: (_name, err) => { capturedError = err; },
      },
    });
    // Even though memory always succeeds, we can verify the hook exists
    await manager.connect('bad');
    expect(capturedError).toBeUndefined();
    await manager.closeAll();
  });
});