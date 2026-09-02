# Plugins de observabilidade (@lumen/db)

Todos os plugins desta pasta são importados do mesmo ponto de entrada:

```ts
import { audit, events, cache, rateLimit, requestId, socket } from '@lumen/db';
```

Eles são anexados a um store com `store.use(plugin)`.

---

## audit

Marca colunas de auditoria (`createdBy`/`updatedBy`, motivo) nos writes e opcionalmente registra as operações.

```ts
store.use(audit({
  getActor: () => getCurrentUser()?.id,
  onAudit: (e) => console.log(`[${e.operation}] ${e.tableName} by ${e.actor}`),
}));
```

**Opções**

| Opção | Padrão | Descrição |
| --- | --- | --- |
| `actorColumn` | `'updatedBy'` | Coluna do ator da alteração. |
| `creatorColumn` | `'createdBy'` | Coluna do ator da criação. |
| `reasonColumn` | `'auditReason'` | Coluna do motivo da alteração. |
| `getActor` | — | Resolve o ator atual. |
| `trackReads` | `false` | Também registra `findAll`/`findOne`/`findById`. |
| `onAudit` | — | Logger/handler customizado para cada `AuditEvent`. |

Um `AuditEvent` traz `operation`, `tableName`, `actor`, `rowId`, `before`/`after`, `timestamp`.

**Interações**
- Combine com `track` para um histórico completo de mudanças por campo, ou com `tenant` para escopar quem alterou o quê.

**Limitações**
- `trackReads` está documentado, mas os hooks de leitura só são ligados quando a opção é definida; verifique o suporte do driver a eventos de leitura.
- As colunas de ator só são marcadas quando `getActor()` retorna um valor.

---

## events

Emite um evento para cada operação do store — útil para logging, monitoramento e debug.

```ts
store.use(events({
  onEvent: (event) => console.log(`[${event.event}] ${event.tableName} (${event.duration}ms)`),
  onError: (event) => logger.error(`Store error: ${event.event}`, event.error),
  events: ['before:insert', 'after:insert'], // filtro; padrão: todos
}));
```

**Opções**

| Opção | Padrão | Descrição |
| --- | --- | --- |
| `onEvent` | — | Chamado para cada operação correspondente. |
| `onError` | — | Chamado para eventos de erro. |
| `events` | todos | Filtro de `HookEvent[]`. |

`StoreEvent` inclui `event`, `tableName`, `duration`, `data`, `result`, `error`.

**Interações**
- É o hook de observabilidade mais barato; use-o para alimentar um logger/coletor de métricas antes de ativar `audit`.

**Limitações**
- Os eventos de erro dependem do driver reportar erros através do payload do hook (`_error`).

---

## cache

Cacheia resultados de queries com TTL e invalidação automática nos writes.

```ts
store.use(cache({
  defaultTtl: 30_000, // 30s
  maxSize: 500,
  invalidateOn: ['insert', 'update', 'delete'],
}));
```

**Opções**

| Opção | Padrão | Descrição |
| --- | --- | --- |
| `defaultTtl` | `60000` | TTL em ms. |
| `maxSize` | `1000` | Máx. de entradas (despeja a mais antiga). |
| `keyGenerator` | embutida | `(table, event, args) => key` customizada. |
| `invalidateOn` | todos os writes | Quais operações de write invalidam o cache. |

**Interações**
- Combine com `encrypt`/`mask` e `tenant` — mas note que os resultados em cache são chaveados incluindo o `where`; o isolamento por tenant depende do seu `getKey`/gerador de chave.

**Limitações**
- O cache é **em memória**, um por instância de store (não é compartilhado entre processos/instâncias).
- Transformações de `mask`/`computed` e o contexto de tenant precisam ser consistentes com o que é cacheado.

---

## rateLimit

Impõe limitação de taxa em memória nas operações de write.

```ts
store.use(rateLimit({
  max: 10,
  windowMs: 60_000,
  getKey: () => getCurrentUser()?.id ?? 'anonymous',
}));
```

**Opções**

| Opção | Padrão | Descrição |
| --- | --- | --- |
| `max` | `100` | Máx. de operações por janela por chave. |
| `windowMs` | `60000` | Duração da janela em ms. |
| `getKey` | `'global'` | Extrai a chave de limitação. |
| `onExceeded` | lança erro | Handler customizado (`(key, remaining) => void \| never`). |

**Limitações**
- Aplica-se a **writes apenas** e é **em memória** (por processo). Para limitação distribuída entre instâncias, prefira o store com Redis do `@lumen/rate` (`createRedisRateLimitStore`).
- Reinicia quando o processo reinicia.

---

## requestId

Marca um id de requisição em todos os writes para rastreabilidade.

```ts
import { randomUUID } from 'crypto';

store.use(requestId({ getRequestId: () => randomUUID() }));
await store.insert({ name: 'alice' }); // row.requestId = '...'
```

**Opções**

| Opção | Padrão | Descrição |
| --- | --- | --- |
| `column` | `'requestId'` | Coluna a marcar. |
| `getRequestId` | — (obrigatório) | Retorna o id da requisição atual. |

**Interações**
- Complementa o `audit` (`getActor`) — juntos registram quem/quando/qual requisição.

**Limitações**
- Requer um `getRequestId`; nada é marcado quando ele retorna `undefined`.

---

## socket

Transmite alterações do banco via WebSocket para clientes conectados.

```ts
import { SocketServer } from '@lumen/socket';

const socketServer = new SocketServer({ port: 3001 });
const table = conn.table<User>('users');

table.use(socket({
  server: socketServer,
  roomPrefix: 'db',
}));
```

**Opções**

| Opção | Padrão | Descrição |
| --- | --- | --- |
| `server` | — (obrigatório) | Objeto com `broadcast(event, data, { room? })`. |
| `roomPrefix` | `''` | Prefixo do nome da sala (room = `prefix:tabela` ou tabela). |
| `events` | todos os CRUD | Quais eventos transmitir. |
| `transform` | — | Transforma o payload antes de transmitir. |

Os clientes recebem eventos como `db:users:insert` / `db:users:update` / `db:users:delete`.

**Interações**
- O duck-type de `server` é compatível com o `SocketServer` do `@lumen/socket`.

**Limitações**
- Transmite apenas operações `after:*` de CRUD.
- Os formatos de payload variam por operação (`data` em insert/upsert, `{ where, changes }` em update, `{ id, where }` em delete).
