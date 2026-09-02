# Plugins de dados (@lumen/db)

Todos os plugins desta pasta são importados do mesmo ponto de entrada:

```ts
import {
  softDelete, archive, cascade, defaults, trim, slug,
  optiLock, track, computed, tenant,
} from '@lumen/db';
```

Eles são anexados a um store com `store.use(plugin)`.

---

## softDelete

Soft delete: em vez de `DELETE`, define um timestamp `deletedAt`. As leituras excluem
automaticamente as linhas com soft delete.

```ts
const store = conn.table<User>('users', { timestamps: true });
store.use(softDelete({ column: 'deletedAt' }));

await store.deleteById(1); // define deletedAt em vez de DELETE
await store.findAll();     // filtra deletedAt IS NULL
```

**Opções**

| Opção | Padrão | Descrição |
| --- | --- | --- |
| `column` | `'deletedAt'` | Nome da coluna do timestamp de exclusão. |
| `value` | timestamp ISO | Valor definido ao "excluir" (`string` ou `() => string`). |

**Helpers**: `isSoftDeleted(row, column?)` e `restoreSoftDeleted(row, column?)`.

**Limitações**
- Depende do `SqlTable`/driver de memória honrar o payload `_softDelete` — a conversão `DELETE → UPDATE` acontece no store, não no plugin.
- As linhas nunca são removidas fisicamente; planeje jobs de arquivamento/limpeza para o crescimento dos dados.

---

## archive

Arquiva: intercepta exclusões e move as linhas para uma tabela de arquivo em vez de removê-las.

```ts
store.use(archive({ archiveTable: 'users_archive' }));
await store.deleteById(1); // movido para users_archive com archivedAt
```

**Opções**

| Opção | Padrão | Descrição |
| --- | --- | --- |
| `archiveTable` | `` `${tableName}_archive` `` | Nome da tabela de arquivo. |
| `archivedAtColumn` | `'archivedAt'` | Coluna do timestamp de arquivamento. |
| `reasonColumn` | `'archiveReason'` | Coluna do motivo do arquivamento. |
| `getReason` | — | `(payload) => motivo` para a razão do arquivamento. |

**Helpers**: `isArchived(row, column?)`.

**Limitações**
- Requer um executor de query cru no store (funciona com `SqlTable`).
- A movimentação real das linhas é feita pelo caminho de delete do store ao ler o payload `_archiveMove` — confirme se o seu driver suporta isso.

---

## cascade

Cascateia exclusões para stores relacionados.

```ts
const orders = conn.table<Order>('orders');
const orderItems = conn.table<OrderItem>('order_items');

orders.use(cascade({
  rules: [{ store: orderItems, foreignKey: 'orderId', localKey: 'id' }],
}));

await orders.deleteById(1); // exclui order_items WHERE orderId = 1
```

**Opções**

| Opção | Tipo | Descrição |
| --- | --- | --- |
| `rules` | `CascadeRule[]` | Cada regra: `store`, `foreignKey`, `localKey` opcional (padrão `'id'`). |

**Limitações**
- As exclusões em cascata rodam sequencialmente; considere transações se for preciso atomicidade.
- Regras de cascata cíclicas podem recuar indefinidamente — evite ciclos.

---

## defaults

Aplica valores padrão aos campos no insert quando estão `undefined`.

```ts
store.use(defaults({
  fields: [
    { field: 'status', value: 'active' },
    { field: 'uuid', value: () => crypto.randomUUID() },
  ],
}));
```

**Opções**

| Opção | Tipo | Descrição |
| --- | --- | --- |
| `fields` | `DefaultField[]` | Cada: `field` + `value` (`unknown` ou factory `() => unknown`). |

**Limitações**
- Só aplica quando o campo está `undefined` — `null` não é alterado.

---

## trim

Faz trim/limpeza de campos string nos writes.

```ts
// Limpa todos os campos string
store.use(trim());

// Normaliza espaços + minúsculas em campos específicos
store.use(trim({ fields: ['email', 'username'], mode: ['normalize', 'lower'] }));
```

**Opções**

| Opção | Padrão | Descrição |
| --- | --- | --- |
| `fields` | todos os campos string | Quais campos limpar. |
| `mode` | `'trim'` | `'trim' | 'trimStart' | 'trimEnd' | 'lower' | 'upper' | 'normalize'` (ou array, aplicado em ordem). |

**Interações**
- Combine com `slug`/`softDelete` — a ordem importa: faça trim antes do slug para gerar slugs a partir de entrada limpa.

---

## slug

Gera slugs de URL automaticamente a partir de um campo de origem.

```ts
store.use(slug({ sourceField: 'title', slugField: 'slug' }));
await store.insert({ title: 'Hello World!' });
// row.slug = 'hello-world'
```

**Opções**

| Opção | Padrão | Descrição |
| --- | --- | --- |
| `sourceField` | — (obrigatório) | Campo de origem para slugificar. |
| `slugField` | `'slug'` | Campo de destino. |
| `unique` | `false` | Garante unicidade (depende do driver). |

**Helpers**: `slugify(value)` (exportada standalone).

**Limitações**
- Não sobrescreve um slug explícito já presente no insert.
- `unique` depende da implementação do driver.

---

## optiLock

Lock otimista usando uma coluna de versão. Os updates incluem `version = currentVersion` e
a incrementam; uma modificação concorrente lança erro de conflito.

```ts
store.use(optiLock());
const user = await store.findById(1); // version: 3
await store.updateById(1, { name: 'new name' });
// UPDATE ... SET version = $x WHERE id = $1 AND version = 3
```

**Opções**

| Opção | Padrão | Descrição |
| --- | --- | --- |
| `versionColumn` | `'version'` | Nome da coluna de versão. |
| `initialVersion` | `1` | Versão definida em linhas novas. |

**Erros**: lança `OptimisticLockError` (um `DatabaseException`) em conflito.

**Interações**
- Combina bem com `tenant` — o filtro de tenant limita o write à linha do tenant atual.

**Limitações**
- Requer suporte do driver ao operador de alteração `{ $increment: true }`.
- Não atua em deletes (a exclusão não é protegida por versão).

---

## track

Change tracking: captura valores antes/depois por campo em updates e upserts.

```ts
store.use(track({
  onChange: (record) => {
    for (const c of record.changes) console.log(`${c.field}: ${c.before} → ${c.after}`);
  },
}));
```

**Opções**

| Opção | Padrão | Descrição |
| --- | --- | --- |
| `onChange` | — | Chamado com um `ChangeRecord` em update/upsert. |
| `ignoreFields` | `['updatedAt']` | Campos excluídos da detecção de mudança. |

**Limitações**
- Os valores `before` vêm do payload em andamento; a comparação de objetos usa `JSON.stringify` e pode reportar campos de objeto incorretamente.

---

## computed

Adiciona campos virtuais/computados aos resultados das queries, calculados em memória após o fetch.

```ts
store.use(computed({
  fields: [
    { name: 'fullName', compute: (row) => `${row.firstName} ${row.lastName}` },
    { name: 'isAdult', compute: (row) => (row.age as number) >= 18 },
  ],
}));
```

**Opções**

| Opção | Tipo | Descrição |
| --- | --- | --- |
| `fields` | `ComputedField[]` | Cada: `name` + `compute(row) => unknown`. |

**Interações**
- Aplicado apenas em leituras; combine com `mask`/`encrypt` para transformar valores antes/depois da lógica computada (a ordem importa).

**Limitações**
- Campos computados não são persistidos e não podem ser usados em `WHERE`.

---

## tenant

Multi-tenancy por linha: adiciona o id do tenant a todo `WHERE` e o marca nos inserts.

```ts
store.use(tenant({ getTenant: () => getCurrentUser()?.tenantId }));
await store.findAll();                 // WHERE tenantId = $1
await store.insert({ name: 'alice' }); // marcado com tenantId
```

**Opções**

| Opção | Padrão | Descrição |
| --- | --- | --- |
| `tenantColumn` | `'tenantId'` | Coluna do identificador do tenant. |
| `getTenant` | — (obrigatório) | Resolve o tenant atual. |
| `strict` | `true` | Lança erro quando nenhum tenant é resolvido. |

**Interações**
- Aplica-se a leituras e writes; combina bem com `softDelete` e `optiLock`.
- Com `strict: true`, qualquer query fora de um contexto de tenant lança erro — tenha isso em mente para queries de sistema/admin.

**Limitações**
- A filtragem do `deleteById` depende da cadeia de hooks de delete para escopar por tenant.
