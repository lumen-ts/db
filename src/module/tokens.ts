/** Injection token carrying the resolved `DatabaseModuleOptions`. */
export const DB_OPTIONS = Symbol.for('lumen:database:options');

/** Builds an injection token naming a single connection. */
export function getConnectionToken(name: string): string {
  return `${DB_OPTIONS.description}:${name}`;
}