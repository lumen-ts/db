# Plugins de query (@lumen/db)

Todos os plugins desta pasta são importados do mesmo ponto de entrada:

```ts
import { scopes, search, cursor } from '@lumen/db';
```

Eles são anexados a um store com `store.use(plugin)`.

---

## scopes

Registra presets de query nomeados e reutilizáveis em um store, que podem ser compostos.

```ts
const store = conn.table<User>('users', { timestamps: true });
store.use(scopes({
  active: (q) => q.where({ deletedAt: null, status: 'active' }),
  admins: (q) => q.where({ role: 'admin' }),
  recent: (q) => q.orderBy('createdAt', 'desc').limit(10),
}));

const activeAdmins = await store.query()
  .applyScope('active')
  .applyScope('admins')
  .exec();
```

**Opções**

| Opção | Tipo | Descrição |
| --- | --- | --- |
| `scopeDefinitions` | `Record<string, ScopeDefinition<T>>` | Presets nomeados `(query) => query`. |

**Interações**
- Compõe com `softDelete`/`tenant` — os filtros de scope são combinados com os filtros de plugin na mesma query.

**Limitações**
- Requer que o store implemente `registerScope` (via a interface `ScopeableStore`); caso contrário, os scopes não têm efeito.

---

## search

Adiciona busca de texto simples: divide os termos e aplica padrões `LIKE` nos campos configurados.

```ts
store.use(search({ fields: ['name', 'email', 'bio'] }));

const results = await store.findAll({ search: 'alice admin' });
// WHERE (name LIKE '%alice%' AND name LIKE '%admin%')
//    OR (email LIKE '%alice%' AND email LIKE '%admin%')
//    OR (bio   LIKE '%alice%' AND bio   LIKE '%admin%')
```

**Opções**

| Opção | Padrão | Descrição |
| --- | --- | --- |
| `fields` | — (obrigatório) | Campos a pesquisar. |
| `minTermLength` | `2` | Comprimento mínimo do termo (termos menores são ignorados). |
| `useLike` | `true` | Se deve usar padrões `LIKE`. |

**Helper**: `buildSearchWhere(query, fields, minTermLength?)` retorna uma cláusula `Where` — utilizável
standalone, sem o plugin.

**Interações**
- Combine com `tenant`/`softDelete` para manter os resultados da busca no escopo do tenant atual e fora das linhas excluídas.

**Limitações**
- `useLike` está declarado, mas a cláusula WHERE gerada usa os operadores `$like` independentemente — confirme se o seu driver interpreta `$like`.
- Scans com `LIKE` não são amigáveis a índices em escala; considere um índice de busca real para grandes volumes.

---

## cursor

Paginação por cursor: cursors opacos codificados em base64 para páginas estáveis de anterior/próxima.

```ts
store.use(cursor());

// Primeira página
const page1 = await store.findAll({ limit: 10, orderBy: { id: 'asc' } });
const next = encodeCursor(page1[page1.length - 1]); // base64 de { id }

// Próxima página
const page2 = await store.findAll({
  where: cursorWhere(next, 'forward', 'id'),
  limit: 10,
  orderBy: { id: 'asc' },
});
```

**Opções**

| Opção | Padrão | Descrição |
| --- | --- | --- |
| `cursorColumn` | `'id'` | Coluna usada no cursor. |
| `maxPageSize` | `100` | Tamanho máximo da página. |

**Helpers** (todos exportados standalone):
- `encodeCursor(row, column?)` — codifica um cursor em base64 a partir de uma linha.
- `decodeCursor(cursor, column?)` — decodifica um cursor.
- `cursorWhere(cursor, direction?, column?)` — monta `{ column: { $gt | $lt: value } }` para direção forward/backward.

**Limitações**
- O plugin em si não registra hooks; a paginação é feita com os helpers exportados (`encodeCursor`/`cursorWhere`) nas suas queries.
- É necessária uma ordenação estável (ex.: `ORDER BY id`) para paginação correta por cursor.
- Os cursors não são assinados — trate-os como opacos, mas não como à prova de adulteração para paginação sensível.
