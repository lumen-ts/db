import { DatabaseException } from '../exceptions.js';
import { MongoConnection } from '../drivers/mongo.js';
import { MysqlConnection } from '../drivers/mysql.js';
import { PostgresConnection } from '../drivers/postgres.js';
import { MemoryConnection } from '../drivers/memory.js';
import type { Connection, ConnectionConfig } from '../types.js';

/**
 * Creates a connection for a driver config and connects to it. Used by the
 * {@link DatabaseManager} at bootstrap and by `connect()`/`connectAll()`.
 */
export async function initializeConnection(name: string, config: ConnectionConfig): Promise<Connection> {
  let connection: Connection;
  switch (config.driver) {
    case 'postgres':
      connection = new PostgresConnection(name, config);
      break;
    case 'mysql':
      connection = new MysqlConnection(name, config);
      break;
    case 'mongo':
      connection = new MongoConnection(name, config);
      break;
    case 'memory':
      connection = new MemoryConnection(name, config);
      break;
    default:
      throw new DatabaseException(
        `Unknown database driver for "${name}": ${(config as { driver?: string }).driver ?? '(missing)'}`,
        'DATABASE_CONFIG_ERROR',
        { name },
      );
  }
  await connection.connect();
  return connection;
}