# @lumen/db

Camada de **persistência** do Lumen: conexões multi-dialeto (Postgres, MySQL, MongoDB, memória), uma API de store (RowStore) unificada, o typed `Repository`, um **query builder** fluente e um rico sistema de **plugins** por store.

```ts
import { DatabaseModule, DatabaseManager, getConnectionToken, Repository, createRepository, Query } from '@lumen/db';
```

---

## DatabaseModule

Registra as conexões no grafo de DI como um `DatabaseManager`.

```ts
DatabaseModule.forRoot({
  connections: {
    default: { driver: 'postgres', connectionString: process.env.DATABASE_URL },
    cache:    { driver: 'memory', seed: { sessions: [] } },
  },
  default: 'default',
  retries: 3,
  retryDelay: 250,
  // global: true,        // exporta providers para todos os módulos
  // queryLogger: (e) => console.log(e.connectionName, e.duration),
  // events: { onConnect: (n) => console.log('connected', n) },
});
```

- **`forRoot(options)`** / **`forRootAsync({ useFactory, inject? })`** — sincrono ou assíncrono.
- `DatabaseModuleOptions`: `connections` (obrigatório), `default`, `retries`, `retryDelay`, `global`, `events` (`onConnect`/`onDisconnect`/`onError`), `queryLogger`.
- Inclua o módulo em `imports` do módulo raiz.

---

## DatabaseManager

Acesso às conexões nomeadas por nome (padrão `"default"`).

```ts
const db = await app.get(DatabaseManager);
const conn = db.connection('default');      // Connection (SQL ou Mongo)
const store = conn.table<User>('users');    // RowStore<User> para SQL
// ou conn.collection<User>('users') para Mongo
```

Tokens úteis: `DB_OPTIONS` (opções montadas), `getConnectionToken(name)` (token por conexão).

---

## Drivers / Conexões

Configuração por `driver`: `postgres`, `mysql`, `mongo`, `memory`.

| Driver | Config | Observações |
| --- | --- | --- |
| `postgres` | `connectionString` **ou** `pool` (pg.Pool) | Parametriza SQL; `options`, `lazy`. |
| `mysql` | `connectionString` **ou** `pool` | Parametriza SQL. |
| `mongo` | `connectionString` **ou** `client`, `dbName` | Document store. |
| `memory` | `seed` (dados iniciais por tabela) | Requerido para testes/sem infra. |

`lazy: true` conecta no primeiro uso em vez do bootstrap. A interface `Connection` pode ser `SqlConnection` (com `query(text, params)`, `transaction`, `table`) ou `DocumentConnection` (`collection`).

`TableOptions`: `idColumn` (default `"id"`), `autoId` (gera UUID), `timestamps` (`createdAt`/`updatedAt`).

---

## RowStore

Contrato de armazenamento comum a tabelas SQL e coleções Mongo. Métodos: `findAll/ findOne/ findById`, `count`, `insert/ insertMany`, `update/ updateById`, `delete/ deleteById`, `upsert`, `transaction`, `query()`, `getScope()`, `use(...plugins)`.

`upsert(data, changes, matchOn)` — atualiza se existir match por `matchOn`, senão insere.

---

## Repository

Abstração tipada sobre um `RowStore` com **validação de schema** (opcional) e **paginação**.

```ts
const repo = createRepository<User>(store, { schema });
// ou: new Repository(store, { schema })

await repo.findById('1');
await repo.paged({ page: 1, limit: 20 }, { active: true });
await repo.transaction(async (txRepo) => { /* operações */ });
```

- Implementa `RowStore<T>` (mesmo contrato do store).
- `schema` (`RepositorySchema<T>`): além de `.parse`, pode expor `.partial()` para validar updates parciais.
- **`paged(params, where?)`** — retorna `Paginated<T>` (semântica do `@lumen/common`).
- `query()` e `use(...plugins)` delegam ao store subjacente.

`createRepository(store, options?)` é o helper de criação.

---

## Query builder

Fluent e encadeado sobre qualquer `RowStore`.

```ts
const results = await store.table<User>('users')
  .query()
  .select('id', 'name')
  .where({ role: 'admin', age: { $gte: 18 } })
  .and('active', true)
  .or({ role: 'moderator' })
  .orderBy('name', 'asc')
  .limit(10)
  .offset(5)
  .exec();

const admin = await store.table('users').query().where({ role: 'admin' }).first();
const total = await store.table('users').query().where({ role: 'admin' }).count();
const page  = await store.table('users').query().orderBy('name').toPaged({ page: 1, limit: 20 });
```

Métodos de construção: `where`, `and`, `or`, `select`, `orderBy`, `limit`, `offset`, `applyScope`.
Métodos de execução: `exec`, `first`, `count`, `exists`, `distinct`, `ids`, `pluck`, `toMap`, `groupBy`, `toPaged`.

---

## Operadores de `where`

Um filtro `Where` aceita valores simples (igualdade) ou operadores:

| Operador | Descrição |
| --- | --- |
| `$eq` / `$ne` | igual / diferente |
| `$gt` / `$gte` / `$lt` / `$lte` | comparações |
| `$in` / `$nin` | em / não em lista |
| `$like` | padrão com `%` (parametrizado) |
| `$isNull` | `true` → `IS NULL` |
| `$between` | intervalo `[min, max]` |
| `$not` | nega o operador interno |

Ex.: `{ age: { $gte: 18 }, role: { $in: ['admin', 'mod'] } }`.

---

## Plugins

O `db` é extensível por **plugins por store** via `store.use(...)`. Em `@lumen/db` cada plugin é uma factory de estilo funcional que enriquece o store (soft delete, tenant, audit, cache, etc.).

Catálogo (22 plugins em 4 categorias — ver READMEs de cada categoria em `src/plugins/`):

- **Data**: `softDelete`, `archive`, `cascade`, `defaults`, `trim`, `slug`, `optiLock`, `track`, `computed`, `tenant`
- **Security**: `encrypt`, `mask`, `validate`
- **Observability**: `audit`, `events`, `cache`, `rateLimit`, `requestId`, `socket`
- **Query**: `scopes`, `search`, `cursor`

`PluginManager` gerencia a aplicação dos plugins; `DatabasePlugin`/`HookEvent`/`HookContext` são os tipos base.

> Documentação detalhada em `src/plugins/{data,security,observability,query}/README.md`.

---

## Exceções

`DatabaseException` (com `DatabaseErrorCodes`/`DatabaseErrorCode`) para erros de persistência.

---

## Dependências

- `@lumen/core` (módulos, DI, schema) e `@lumen/common` (erros, paginação).
