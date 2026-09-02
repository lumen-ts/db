# Plugins de segurança (@lumen/db)

Todos os plugins desta pasta são importados do mesmo ponto de entrada:

```ts
import { encrypt, mask, validate } from '@lumen/db';
```

Eles são anexados a um store com `store.use(plugin)`.

---

## encrypt

Criptografa campos de forma transparente no write e descriptografa no read.

```ts
store.use(encrypt({
  fields: ['ssn', 'creditCard'],
  cipher: new XorCipher(process.env.ENCRYPTION_KEY),
}));

await store.insert({ ssn: '123-45-6789' }); // armazenado criptografado
const user = await store.findById(1);
console.log(user.ssn); // '123-45-6789' (descriptografado)
```

**Opções**

| Opção | Padrão | Descrição |
| --- | --- | --- |
| `fields` | — (obrigatório) | Campos a criptografar no write / descriptografar no read. |
| `cipher` | — (obrigatório) | Implementação de `Cipher` (`encrypt`/`decrypt`). |
| `decryptOnRead` | `true` | Também descriptografa resultados de `findOne`/`findById`. |

**Nota de segurança**

`XorCipher` é **apenas base64 e NÃO é criptograficamente seguro** — para demos/testes. Use uma
cifra real (AES-GCM, ChaCha20 etc.) em produção, implementando `Cipher`.

**Limitações**
- Apenas valores `string` são criptografados; números/objetos/booleanos passam sem alteração.
- Falhas de descriptografia na leitura deixam o valor como está (tolera linhas não criptografadas).
- Campos criptografados não são pesquisáveis com `LIKE`/índices.

---

## mask

Mascara campos sensíveis nos resultados das queries. Os dados são armazenados sem máscara, mas retornados mascarados aos consumidores.

```ts
store.use(mask({
  fields: [
    { field: 'email', mask: (v) => v.replace(/(.{2}).*(@.*)/, '$1***$2') },
    { field: 'ssn' },       // máscara padrão
    { field: 'creditCard' },
  ],
}));
```

**Opções**

| Opção | Tipo | Descrição |
| --- | --- | --- |
| `fields` | `Array<FieldMask \| string>` | Cada entrada é um nome de campo (máscara padrão) ou `{ field, mask? }`. |

A máscara padrão mantém os 2 primeiros e os 2 últimos caracteres com `****` entre eles
(ex.: `1234567890` → `12********90`; valores curtos viram `****`).

**Interações**
- Aplicado nas leituras sobre as linhas retornadas; combine com `encrypt` para descriptografar primeiro e depois mascarar.

**Limitações**
- Apenas valores `string` são mascarados.
- Afeta apenas resultados — os dados armazenados ficam intactos (como esperado).

---

## validate

Valida dados antes dos writes usando regras configuráveis.

```ts
store.use(validate({
  rules: [
    { field: 'email', validate: (v) => (typeof v === 'string' && v.includes('@')) || 'Invalid email' },
    { field: 'name',  validate: (v) => (typeof v === 'string' && v.length >= 2) || 'Name too short' },
  ],
}));
```

**Opções**

| Opção | Padrão | Descrição |
| --- | --- | --- |
| `rules` | — | Regras aplicadas em insert e update. |
| `onCreate` | — | Regras aplicadas no insert (além de `rules`). |
| `onUpdate` | — | Regras aplicadas no update, validando apenas campos alterados (além de `rules`). |

A função `validate(value, row)` de cada regra retorna `true` se válido, ou uma mensagem de erro.
Regras que falham lançam `Error: Validation failed: <campo>: <mensagem>, ...`.

**Interações**
- Roda nos hooks `before:*`, portanto compõe antes de `encrypt`/`slug`/`defaults` no mesmo payload.

**Limitações**
- É um validador leve e agnóstico de RDBMS; para esquemas ricos/tipados prefira a validação de schema do `@lumen/zod`.
