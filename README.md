# `dsh-plugin-longmem`

> A DSH (DeepSeek Harness) plugin that gives the agent a durable, per-user
> **long-term memory** section, persisted through the official
> [`@deepseek-ai/dsh-settings`](https://www.npmjs.com/package/@deepseek-ai/dsh-settings)
> seam with schema validation, hot-reload, and revision conflict detection.

[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![node: >=22.18](https://img.shields.io/badge/node-%3E%3D22.18-brightgreen.svg)](https://nodejs.org)
[![type: ESM](https://img.shields.io/badge/type-ESM-blue.svg)](https://nodejs.org/api/esm.html)

---

## Why this plugin exists

The agent needs to remember things across sessions: a user's preferred
language, their standing system-prompt slots, friendly names for their
API keys, free-form notes about how they like the agent to behave. Stuffing
that into `CLAUDE.md` or a profile string is brittle — it cannot be
edited at runtime, cannot be watched for changes, and is not type-checked
against a schema.

`dsh-plugin-longmem` is the **smallest possible answer**: a structured
user-config section with a Schemastery schema, persisted by whichever
`@deepseek-ai/dsh-settings` provider you compose (`file` is the canonical
choice), readable everywhere in your plugin via a tiny `readLongmem(ctx)`
call. The agent gets a frozen, read-only view; the user gets a yaml
file they can edit; the seam handles locking, debounced writes, and
revision mismatch detection for free.

This is **not** a vector store, embedding index, or RAG pipeline. It is
the _config_ layer the rest of your long-term-memory stack should be
built on top of.

---

## Install

```bash
pnpm add dsh-plugin-longmem
```

`@deepseek-ai/cordis`, `@deepseek-ai/dsh-settings`, and
`@deepseek-ai/schemastery` are **peer dependencies**; install them too
if your project does not already have them.

---

## Wire it into `cordis.yml`

The plugin is a _secondary_ plugin: it depends on a settings provider
being composed first. Drop the entry into your profile's `plugins:` list
**after** the settings provider.

### Minimum viable

```yaml
plugins:
  - id: settings
    name: '@deepseek-ai/dsh-settings-file' # composes ctx.settings
  - id: longmem
    name: dsh-plugin-longmem # attaches the longmem section
```

### Composition `base` (recommended for teams)

`base` provides a partial that the user document can still override:

```yaml
plugins:
  - id: settings
    name: '@deepseek-ai/dsh-settings-file'
  - id: longmem
    name: dsh-plugin-longmem
    config:
      base:
        language: en
        theme: dark
        defaultModel: deepseek-v4-pro
```

### Self-contained profile (no user document)

`config` is a full section that wins whole, useful for CI agents and
embedded profiles:

```yaml
plugins:
  - id: settings
    name: '@deepseek-ai/dsh-settings-file'
  - id: longmem
    name: dsh-plugin-longmem
    config:
      config:
        language: en
        theme: dark
        defaultModel: deepseek-v4-pro
        customPrompts:
          - name: persona
            content: "You are a careful assistant. Answer in the user's language."
        apiKeyAliases:
          deepseek: DEEPSEEK_API_KEY
        notes:
          preferredChannel: cli
          reasoningDepth: standard
```

### Layering rule

The schema is the floor; `base` is a partial on top of it; the user
document is on top of `base`; `config` (when given) wins whole:

```
config  >  user document  >  base  >  schema defaults
```

---

## What the schema looks like

The `longmem` section is a strict, validated object. Every field has
a default so an absent section still resolves to a complete value.

| Field           | Type                                                   | Default                         | Notes                                                                         |
| --------------- | ------------------------------------------------------ | ------------------------------- | ----------------------------------------------------------------------------- |
| `language`      | `'en' \| 'zh' \| 'ja' \| 'ko' \| 'fr' \| 'de' \| 'es'` | `'en'`                          | UI language for Web client                                                    |
| `theme`         | `'light' \| 'dark' \| 'system'`                        | `'system'`                      | `'system'` follows OS                                                         |
| `defaultModel`  | `string`                                               | `''`                            | Provider-agnostic LLM id                                                      |
| `customPrompts` | `Array<{ name, content }>`                             | three seed slots, empty content | Standing system-prompt slots                                                  |
| `apiKeyAliases` | `Record<string, string>`                               | `{}`                            | Friendly alias → credential ref id (the seam stores the _real_ key elsewhere) |
| `notes`         | `Record<string, unknown>`                              | `{}`                            | Free-form JSON-shaped bucket for things we have not given a field yet         |

The user document (e.g. `~/.dsh/settings.yaml`) might look like:

```yaml
longmem:
  language: zh
  theme: dark
  defaultModel: deepseek-v4-pro
  customPrompts:
    - name: persona
      content: |
        You are a careful, methodical assistant. Always cite the
        source of any external fact.
    - name: domain-rules
      content: 'Prefer official DeepSeek API for inference.'
  apiKeyAliases:
    work: DEEPSEEK_API_KEY_WORK
  notes:
    timezone: Asia/Shanghai
    preferredEditor: neovim
```

---

## Public API

The plugin exports three read functions and one cordis entry, all from
the package root:

```ts
import {
  readLongmem, // (ctx) => frozen LongmemReadonly snapshot
  getLongmem, // (ctx) => live SettingsScope (or frozen defaults)
  watchLongmem, // (ctx, cb) => disposer
  apply, // cordis plugin entry, used by `cordis.yml`
  LONGMEM_NAMESPACE,
  LONGMEM_DEFAULTS,
} from 'dsh-plugin-longmem'
```

### `readLongmem(ctx): LongmemReadonly`

Read the current resolved section. Always returns a frozen plain
object — never a `SettingsScope` — so it is safe to pass to a code path
that does not own writes (an LLM prompt builder, for example).

```ts
const section = readLongmem(ctx)
console.log(section.language) // 'zh'
console.log(section.customPrompts) // [ { name, content }, ... ]
console.log(section.apiKeyAliases) // { work: 'DEEPSEEK_API_KEY_WORK' }
```

When the settings provider is not yet composed, returns a frozen
snapshot of the schema defaults — the call stays valid during boot.

### `getLongmem(ctx): SettingsScope<LongmemSection> | LongmemReadonly`

Return the live `SettingsScope` (so the caller can `update` / `replace`
/ `watch`) when the settings seam is composed, or a frozen defaults
snapshot otherwise. Prefer this over touching `ctx.settings` directly:
it owns the namespace choice and the bootstrap-path fallback.

```ts
const scope = getLongmem(ctx) as SettingsScope<LongmemSection>
scope.update({ language: 'ja', theme: 'light' })
// -> next readLongmem(ctx) returns { language: 'ja', theme: 'light', ... }
```

### `watchLongmem(ctx, cb): () => void`

Watch the section for committed changes. `cb` is invoked with
`(next, prev)` after each successful write; serialization is the
provider's responsibility (the file backend is debounced and locked).

```ts
const stop = watchLongmem(ctx, (next, prev) => {
  console.log(`language: ${prev.language} -> ${next.language}`)
})

// later, on plugin teardown:
stop()
```

Returns a no-op disposer when the settings seam is not yet composed,
so callers can mount this unconditionally during plugin init.

### `apply` (the cordis entry)

`apply` is what `cordis.yml` references by `name: dsh-plugin-longmem`.
You do not call it directly; the cordis runtime does. It depends on
`ctx.settings` being available — the `inject: ['settings']` declaration
on the function makes cordis enforce that ordering.

---

## Identity-stable reads

`readLongmem(ctx)` returns the **same frozen reference** on repeat
calls until a write happens. After a write, the in-place cache is
replaced with a new frozen object; subsequent reads see that new
reference. So:

```ts
const a = readLongmem(ctx)
const b = readLongmem(ctx)
a === b // true
getLongmem(ctx).update({ language: 'fr' })
const c = readLongmem(ctx)
a === c // false
c.language // 'fr'
```

This means it is safe to memoize reads in hot paths and to use
`Object.is` (or `toBe`) in tests.

---

## Disposal

The plugin registers its `SettingsScope` and watches on the cordis
_plugin fiber_ (the one `ctx.plugin(apply, ...)` returns). When the
fiber unloads — typically when the host shuts down or a profile is
reloaded — both are torn down. Reads after disposal fall back to a
frozen snapshot of the schema defaults, so a stale `readLongmem(ctx)`
call during shutdown cannot crash the host.

---

## Environment

- **Node** `>=22.18` (cordis 4 needs the WeakRef / FinalizationRegistry
  guarantees).
- **TypeScript** `>=5.6` (uses the modern `verbatimModuleSyntax` /
  `allowImportingTsExtensions` setup).
- **cordis** `^4.0.1` and **dsh-settings** `^0.1.0` are peer
  dependencies; check your lockfile.

---

## Build & test

```bash
pnpm install
pnpm test          # vitest run, 11 tests
pnpm typecheck     # tsc --noEmit on tsconfig.json
pnpm build         # tsdown -> lib/
```

---

## License

[MIT](./LICENSE) — see `LICENSE` for the full text.
