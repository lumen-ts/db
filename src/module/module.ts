import { forRoot } from '@lumen/core';
import type { DynamicModuleDescriptor, InjectionToken } from '@lumen/core';
import { DatabaseManager } from './manager.js';
import { DB_OPTIONS } from './tokens.js';
import type { AsyncDatabaseModuleOptions, DatabaseModuleOptions } from '../types.js';

/** Identity class backing the dynamic descriptors produced by `DatabaseModule.forRoot*`. */
export class DatabaseModule {
  /** Wires the configured connections into the DI graph as a {@link DatabaseManager}. */
  static forRoot(options: DatabaseModuleOptions = { connections: {} }): DynamicModuleDescriptor {
    return forRoot(DatabaseModule, {
      providers: [
        { provide: DB_OPTIONS, useValue: options },
        DatabaseManager,
      ],
      exports: [DatabaseManager as InjectionToken, DB_OPTIONS],
      global: options.global ?? false,
    });
  }

  /** Same as {@link forRoot}, but options come from an async factory. */
  static forRootAsync(options: AsyncDatabaseModuleOptions): DynamicModuleDescriptor {
    return forRoot(DatabaseModule, {
      providers: [
        { provide: DB_OPTIONS, useFactory: options.useFactory, inject: options.inject ?? [] },
        DatabaseManager,
      ],
      exports: [DatabaseManager as InjectionToken, DB_OPTIONS],
      global: options.global ?? false,
    });
  }
}