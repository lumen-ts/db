import type { Row } from '../../types.js';

/**
 * Lifecycle events that plugins can hook into.
 */
export type HookEvent =
  | 'before:findAll'
  | 'after:findAll'
  | 'before:findOne'
  | 'after:findOne'
  | 'before:findById'
  | 'after:findById'
  | 'before:count'
  | 'after:count'
  | 'before:insert'
  | 'after:insert'
  | 'before:insertMany'
  | 'after:insertMany'
  | 'before:update'
  | 'after:update'
  | 'before:updateById'
  | 'after:updateById'
  | 'before:delete'
  | 'after:delete'
  | 'before:deleteById'
  | 'after:deleteById'
  | 'before:upsert'
  | 'after:upsert';

/**
 * Context passed to hook handlers.
 */
export interface HookContext<T extends Row = Row> {
  /** The table/collection name */
  tableName: string;
  /** The operation being performed */
  event: HookEvent;
  /** Abort the operation — throw to prevent it */
  abort(message?: string): never;
}

/**
 * Hook handler function signature.
 */
export type HookHandler<T extends Row = Row> = (
  ctx: HookContext<T>,
  payload: Record<string, unknown>,
) => void | Promise<void>;

/**
 * A plugin that can hook into RowStore operations.
 */
export interface DatabasePlugin<T extends Row = Row> {
  /** Unique name for this plugin */
  name: string;
  /** Register hook handlers */
  hooks: Partial<Record<HookEvent, HookHandler<T>>>;
  /** Optional initialization */
  init?(store: RowStoreLike<T>): void | Promise<void>;
  /** Optional cleanup */
  destroy?(): void | Promise<void>;
}

/**
 * Minimal interface the plugin system needs from the store.
 */
export interface RowStoreLike<T extends Row = Row> {
  readonly name: string;
  readonly dialect: string;
}

/**
 * Plugin manager that manages and executes hooks.
 */
export class PluginManager<T extends Row = Row> {
  private readonly plugins = new Map<string, DatabasePlugin<T>>();
  private readonly hookIndex = new Map<HookEvent, Array<{ plugin: string; handler: HookHandler<T> }>>();

  /** Register a plugin. */
  register(plugin: DatabasePlugin<T>): void {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`);
    }
    this.plugins.set(plugin.name, plugin);
    for (const [event, handler] of Object.entries(plugin.hooks)) {
      if (!handler) continue;
      const list = this.hookIndex.get(event as HookEvent) ?? [];
      list.push({ plugin: plugin.name, handler });
      this.hookIndex.set(event as HookEvent, list);
    }
  }

  /** Unregister a plugin. */
  unregister(name: string): boolean {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;
    this.plugins.delete(name);
    for (const [event, list] of this.hookIndex) {
      this.hookIndex.set(
        event,
        list.filter((e) => e.plugin !== name),
      );
    }
    return true;
  }

  /** Execute all hooks for an event. */
  async executeHooks(
    event: HookEvent,
    ctx: Omit<HookContext<T>, 'abort'>,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const handlers = this.hookIndex.get(event) ?? [];
    for (const { handler } of handlers) {
      await handler({ ...ctx, abort: (msg) => { throw new Error(msg ?? 'Operation aborted by plugin'); } }, payload);
    }
  }

  /** Check if any plugins are registered. */
  get hasPlugins(): boolean {
    return this.plugins.size > 0;
  }

  /** Initialize all plugins. */
  async initAll(store: RowStoreLike<T>): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.init) await plugin.init(store);
    }
  }

  /** Destroy all plugins. */
  async destroyAll(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.destroy) await plugin.destroy();
    }
  }

  /** Iterate over registered plugins (for propagation to child stores). */
  *pluginEntries(): IterableIterator<DatabasePlugin<T>> {
    return this.plugins.values();
  }
}
