/**
 * `dsh-plugin-longmem` — durable per-user long-term memory.
 *
 * Registers a `longmem` namespace on the user-settings seam
 * (`ctx.settings`) so the user document — `~/.dsh/settings.yaml` when
 * `@deepseek-ai/dsh-settings-file` is composed — carries a structured
 * section the agent and any other DSH plugin can read.
 *
 * What this plugin owns and what it deliberately does not:
 *
 * - **Owns**: the schema, the namespace, and a small read API
 *   (`getLongmem`, `readLongmem`, `watchLongmem`). Writes go through
 *   the standard `SettingsScope.update` / `replace`, so other tools
 *   (a future settings UI, an external editor hot-reloading the YAML)
 *   all reach the same place.
 * - **Does not own**: the storage backend. Compose
 *   `@deepseek-ai/dsh-settings-file` (or any other provider); this
 *   plugin attaches once `ctx.settings` is available.
 * - **Does not own**: the agent's prompt assembly. Other plugins or the
 *   Web client read the resolved value and decide what to do with it.
 *
 * Wiring it into a profile (excerpt of `cordis.yml`):
 *
 * ```yaml
 * - id: settings
 *   name: '@deepseek-ai/dsh-settings-file'
 * - id: longmem
 *   name: dsh-plugin-longmem
 *   config:
 *     # Composition `base` layer — overridden by the user document layer.
 *     language: en
 *     theme: dark
 *     defaultModel: deepseek-v4-pro
 * ```
 *
 * @module dsh-plugin-longmem
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  type SettingsScope,
} from '@deepseek-ai/dsh-settings'
import { LongmemSchema, type LongmemSection } from './schema.ts'
import { LONGMEM_DEFAULTS, LONGMEM_NAMESPACE } from './namespace.ts'

/** Stable plugin name as it appears in `cordis.yml` (`name: dsh-plugin-longmem`). */
export const name = 'dsh-plugin-longmem'

/** Soft dependency on the settings seam. Plugin attaches once a provider is composed. */
export const inject = ['settings'] as const

/**
 * Composition-layer `Config` (the `cordis.yml` `config:` block). The
 * host passes this as the second argument to {@link apply}; we forward
 * it to the settings seam as the `base` layer so the user document
 * overrides it.
 */
export interface Config {
  /**
   * Composition `base` layer — values that resolve below the user
   * document. Anything not overridden by the user document inherits
   * from this; anything not declared here inherits from the schema
   * defaults. The same shape as the resolved value.
   */
  base?: Partial<LongmemSection>
  /**
   * Fully-formed composition entry. When present, this entire object
   * is the `base` layer; `base` is ignored. Useful when a profile
   * author wants to set every field explicitly.
   */
  config?: LongmemSection
}

/**
 * Re-export of the schema and namespace for callers that want to
 * integrate with this plugin without going through the settings seam
 * (e.g. a CLI that reads the YAML directly and validates against
 * the schema).
 */
export { LongmemSchema, LONGMEM_DEFAULTS, LONGMEM_NAMESPACE }
export type { LongmemSection, CustomPrompt } from './schema.ts'

/** Frozen, read-only view of the resolved longmem section. */
export type LongmemReadonly = Readonly<LongmemSection>

/** Per-Context active binding: the live scope + a way to read a frozen snapshot. */
interface LongmemBinding {
  scope: SettingsScope<LongmemSection>
  read: () => LongmemReadonly
}

/**
 * Per-Context binding map. Keyed by the `Context` that the host
 * hands to {@link apply}; cleared automatically when the fiber
 * unloads (the WeakMap entry vanishes with the context).
 */
const BINDINGS = new WeakMap<Context, LongmemBinding>()

/**
 * Read the current resolved `longmem` section.
 *
 * Returns the live `SettingsScope` when a settings provider is
 * composed, so the caller can `update` / `replace` / `watch`. Returns
 * a frozen snapshot of the schema defaults otherwise, so the call
 * stays valid before the seam is composed. Prefer this over touching
 * `ctx.settings` directly: it owns the namespace choice and the
 * "no provider yet" fallback.
 *
 * @param ctx - a Host context with `settings` already declared on the
 *   composition (or not — the fallback is intentional).
 * @returns either the live scope, or a detached defaults snapshot.
 */
export function getLongmem(ctx: Context): SettingsScope<LongmemSection> | LongmemReadonly {
  const binding = BINDINGS.get(ctx)
  if (binding !== undefined) return binding.scope
  // No settings provider composed yet — return the schema defaults
  // as a frozen snapshot. Writes are not supported in this mode
  // (composing `dsh-settings-file` is what enables writes), but
  // reads remain valid.
  return Object.freeze(structuredClone(LONGMEM_DEFAULTS) as LongmemSection)
}

/**
 * Read the current resolved `longmem` section as a frozen, read-only
 * snapshot. Always returns a plain object — never a `SettingsScope` —
 * so it is safe to pass to code that does not own writes (an LLM
 * prompt builder, for example).
 *
 * @param ctx - a Host context.
 * @returns a frozen deep copy of the resolved section.
 */
export function readLongmem(ctx: Context): LongmemReadonly {
  const binding = BINDINGS.get(ctx)
  if (binding !== undefined) return binding.read()
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
  const binding = BINDINGS.get(ctx)
  if (binding === undefined) return () => {}
  return binding.scope.watch((next, prev) => {
    return callback(Object.freeze(structuredClone(next)), Object.freeze(structuredClone(prev)))
  })
}

/**
 * Standard plugin entry point. Registers the namespace with the
 * composition entry as the `base` layer, captures the resulting
 * `SettingsScope` for the public read API, and arranges for the
 * binding to be torn down when the plugin fiber unloads.
 *
 * Disposing the fiber removes the registration and every watcher
 * this body started.
 *
 * @param ctx - a Host context. `settings` is resolved through
 *   `ctx.inject`; this plugin waits for the provider to be composed
 *   and then attaches.
 * @param config - the composition `Config` from `cordis.yml`.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const entry = resolveEntry(config)

  // Soft-inject on `settings`. The body runs once a provider is
  // composed; disposing the fiber disposes everything we register.
  ctx.inject(['settings'], (settingsCtx) => {
    const scope = settingsCtx.settings.register(LONGMEM_NAMESPACE, LongmemSchema, {
      base: entry,
    }) as SettingsScope<LongmemSection>

    const binding: LongmemBinding = {
      scope,
      read: () => Object.freeze(structuredClone(scope.get())),
    }
    BINDINGS.set(ctx, binding)
  })
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
