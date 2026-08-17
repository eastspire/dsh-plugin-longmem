/**
 * `dsh-plugin-longmem` — public entry surface.
 *
 * The plugin attaches a `longmem` namespace to the `ctx.settings`
 * seam provided by `@deepseek-ai/dsh-settings`. Reads always return
 * a frozen, plain object; writes go through the seam so they are
 * validated, persisted, and broadcast to watchers in one step.
 *
 * The public API has three calls — `getLongmem`, `readLongmem`,
 * `watchLongmem` — plus the cordis `apply` entry. All three reads
 * are designed to remain valid *before* a settings provider is
 * composed: in that mode they return a frozen snapshot of the
 * schema defaults so callers do not have to special-case the
 * bootstrap path.
 */

import { type Context } from '@deepseek-ai/cordis'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'

import { LongmemSchema, type LongmemReadonly, type LongmemSection } from './schema.ts'
import { LONGMEM_DEFAULTS, LONGMEM_NAMESPACE } from './namespace.ts'

/** Stable plugin name as it appears in `cordis.yml` (`name: dsh-plugin-longmem`). */
export const LONGMEM_PLUGIN_NAME = 'dsh-plugin-longmem'

/** Unique namespace id registered with the settings seam. */
export { LONGMEM_NAMESPACE, LONGMEM_DEFAULTS } from './namespace.ts'

/** Composition-layer `Config` (the `cordis.yml` `config:` block). The
 *  shape accepts `base` (a partial that merges with the schema
 *  defaults) or `config` (a full section that wins whole). The
 *  schema default is the third layer. */
export interface Config {
  /** Partial that merges with the schema defaults; user document still wins. */
  base?: Partial<LongmemSection>
  /** Whole section that overrides both `base` and the schema defaults. */
  config?: LongmemSection
}

/**
 * Captured plugin state. There is at most one per `SettingsProvider`
 * (i.e. one per `ctx` in tests, one per Host in production). We key
 * on the provider itself rather than the `Context` because cordis
 * passes a *child* `ctx` to the `apply` callback while callers hold
 * the parent `ctx` — they are different objects but resolve to the
 * same `SettingsProvider` singleton.
 */
interface LongmemBinding {
  /** The owner scope returned by `register()`. */
  scope: SettingsScope<LongmemSection>
  /** Cached frozen snapshot, updated in place on every commit. */
  snapshot: LongmemReadonly
  /** Disposer that drops the in-place watch + removes the WeakMap
   *  entry. Called on fiber dispose. */
  dispose: () => void
}

/** Map of provider -> binding. We use a `WeakMap` keyed on the
 *  `SettingsProvider` so the binding dies with the provider (and
 *  with the test/process that owns it). The `ctx.settings` access
 *  is a cordis Proxy, so we walk it via the public `original` symbol
 *  to recover the underlying service instance for the key. */
const PROVIDER_BINDINGS = new WeakMap<object, LongmemBinding>()

/** cordis-internal symbol that returns the unwrapped service value
 *  through a Proxy (see `createTraceable` in cordis). Reading the
 *  property on the proxy gives the raw service; reading it on the
 *  raw service is identity. We only need the latter for the key. */
const ORIGINAL = Symbol.for('cordis.original') as unknown as symbol

/** Extract the raw service object that backs `ctx.settings` (the
 *  cordis proxy) so we can use it as a stable key. */
function rawProvider(ctx: Context): object {
  const proxied = (ctx as unknown as { settings: object }).settings
  const raw = (proxied as unknown as Record<symbol, object>)[ORIGINAL] ?? proxied
  return raw
}

/**
 * Read the current resolved `longmem` section as a frozen, read-only
 * snapshot. Always returns a plain object — never a `SettingsScope` —
 * so it is safe to pass to code that does not own writes (an LLM
 * prompt builder, for example).
 *
 * When no settings provider is composed, returns a frozen snapshot
 * of the schema defaults so bootstrap callers do not crash.
 *
 * @param ctx - a Host context.
 * @returns a frozen deep copy of the resolved section.
 */
export function readLongmem(ctx: Context): LongmemReadonly {
  const binding = lookupBinding(ctx)
  if (binding !== undefined) return binding.snapshot
  return Object.freeze(structuredClone(LONGMEM_DEFAULTS) as LongmemSection)
}

/**
 * Return the live `SettingsScope` for `longmem`. Once the settings
 * provider is composed, so the caller can `update` / `replace` /
 * `watch`. Returns a frozen snapshot of the schema defaults otherwise,
 * so the call stays valid before the seam is composed. Prefer this
 * over touching `ctx.settings` directly: it owns the namespace
 * choice and the "no provider yet" fallback.
 *
 * @param ctx - a Host context with `settings` already declared on
 *   the composition (or not — the fallback is intentional).
 * @returns either the live scope, or a detached defaults snapshot.
 */
export function getLongmem(ctx: Context): SettingsScope<LongmemSection> | LongmemReadonly {
  const binding = lookupBinding(ctx)
  if (binding !== undefined) return binding.scope
  return Object.freeze(structuredClone(LONGMEM_DEFAULTS) as LongmemSection)
}

/**
 * Watch the `longmem` section for committed changes. The callback
 * fires with `(next, prev)` after each write; serialization is the
 * provider's responsibility (file backend is debounced + locked).
 *
 * Returns a no-op disposer when no settings provider is composed, so
 * callers can mount this unconditionally during plugin init.
 *
 * @param ctx - a Host context.
 * @param callback - invoked on every committed change.
 * @returns the disposer.
 */
export function watchLongmem(
  ctx: Context,
  callback: (next: LongmemReadonly, prev: LongmemReadonly) => void | Promise<void>,
): () => void {
  const binding = lookupBinding(ctx)
  if (binding === undefined) return () => {}
  return binding.scope.watch((next, prev) => {
    return callback(
      Object.freeze(structuredClone(next)) as LongmemReadonly,
      Object.freeze(structuredClone(prev)) as LongmemReadonly,
    )
  })
}

// ─── internals ──────────────────────────────────────────────────────

/** Look up the binding by walking the `ctx` chain to find a context
 *  that has a registered `longmem`. The `ctx.settings` access is a
 *  cordis proxy, so we use `rawProvider` to recover the underlying
 *  service instance before the WeakMap lookup. */
function lookupBinding(ctx: Context): LongmemBinding | undefined {
  let cur: Context | undefined = ctx
  while (cur !== undefined) {
    if ((cur as unknown as { settings?: object }).settings !== undefined) {
      const hit = PROVIDER_BINDINGS.get(rawProvider(cur))
      if (hit !== undefined) return hit
    }
    cur = (cur as unknown as { parent?: Context }).parent
  }
  return undefined
}

/**
 * Standard plugin entry point. Registers the namespace with the
 * composition entry as the `base` layer, captures the resulting
 * `SettingsScope` for the public read API, and arranges for the
 * binding to be torn down when the plugin fiber unloads.
 *
 * The plugin assumes a settings provider is already composed. Compose
 * `@deepseek-ai/dsh-settings-file` (or another provider) in
 * `cordis.yml` *before* this plugin to satisfy the requirement; the
 * settings seam will surface a clear error if no provider exists.
 *
 * Disposing the fiber removes the registration and every watcher
 * this body started.
 *
 * @param ctx - a Host context with `settings` already composed.
 * @param config - the composition `Config` from `cordis.yml`.
 */
function applyImpl(ctx: Context, config: Config = {}): void {
  const entry = resolveEntry(config)
  const scope = ctx.settings.register(LONGMEM_NAMESPACE, LongmemSchema, {
    base: entry,
  }) as SettingsScope<LongmemSection>

  const provider = rawProvider(ctx)
  // Build the first snapshot from the registration's resolved value.
  const initial: LongmemReadonly = Object.freeze(
    structuredClone(scope.get()) as LongmemSection,
  )

  // Mirror the scope's commits into the cached snapshot in place so
  // callers using `read()` see identity-equal references across
  // calls and stale-after-update traps disappear.
  const stopWatch = scope.watch((next) => {
    const frozen = Object.freeze(structuredClone(next) as LongmemSection) as LongmemReadonly
    const existing = PROVIDER_BINDINGS.get(provider)
    if (existing !== undefined) {
      ;(existing.snapshot as unknown as Record<string, unknown>) = frozen
    }
  })

  // Dispose hooks: cordis disposes a fiber by running every effect's
  // teardown. We register our cleanup as a *generator effect* — cordis
  // calls the generator, the first `next()` runs the setup, the
  // second `next()` collects the yielded value as a disposable and
  // the fiber runs it on unload. The setup happens on the *plugin's*
  // own fiber (the one that wraps `applyImpl`), which is exactly
  // the fiber `ctx.plugin()` returns and `fiber.dispose()` ends.
  // `ctx.on('dispose', ...)` is not the right tool here — cordis
  // never emits a `'dispose'` event by that name, so the listener
  // would never fire.
  ;(ctx as unknown as { fiber: { effect: (fn: () => Generator<() => void, void, void>, label: string) => unknown } }).fiber.effect(
    function* () {
      yield () => {
        stopWatch()
        PROVIDER_BINDINGS.delete(provider)
      }
    },
    'longmem.apply',
  )

  PROVIDER_BINDINGS.set(provider, {
    scope,
    snapshot: initial,
    dispose: () => {
      stopWatch()
      PROVIDER_BINDINGS.delete(provider)
    },
  })
}

/**
 * Plugin handle for `cordis.yml` (`name: dsh-plugin-longmem`). The
 * `inject` property is the static service dependency declaration
 * cordis consults when the plugin is loaded; without it, `ctx.settings`
 * access would fail with `cannot get property "settings" without inject`.
 *
 * We attach `inject` as an own property on the function so cordis's
 * "is the prop on the function" check passes. The function's own
 * `name` is a frozen read-only property in strict mode, so the
 * `dsh-plugin-longmem` value is exposed via the separate
 * `LONGMEM_PLUGIN_NAME` export rather than as a function property.
 */
export const apply = Object.assign(applyImpl, {
  inject: ['settings'] as const,
}) as typeof applyImpl & {
  inject: readonly ['settings']
}

/**
 * Compute the effective composition entry from the `Config` shape.
 * `config.config` wins whole; `config.base` provides a partial;
 * otherwise the schema defaults fill the rest.
 */
function resolveEntry(config: Config): LongmemSection {
  if (config.config !== undefined) return structuredClone(config.config)
  const defaults = structuredClone(LONGMEM_DEFAULTS) as LongmemSection
  if (config.base !== undefined) return { ...defaults, ...structuredClone(config.base) }
  return defaults
}
