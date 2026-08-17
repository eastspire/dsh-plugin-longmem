/**
 * `dsh-plugin-longmem` end-to-end tests.
 *
 * These tests drive the plugin through the real `@deepseek-ai/dsh-settings`
 * `SettingsProvider` machinery using an in-memory backend (see
 * `./memory.ts`). They are not unit tests of the schema or namespace
 * helpers — those are exercised transitively through the seam.
 *
 * The seam contract under test:
 *
 * 1. With no composition `Config`, the resolved section equals the
 *    schema defaults. (default resolution)
 * 2. With composition `Config.base`, base partials merge with the
 *    schema defaults; user document overrides win. (layering)
 * 3. External `pushExternal` (a non-owner writing the document)
 *    propagates to the resolved value through `watchLongmem`. (reactivity)
 * 4. `getLongmem` returns the live `SettingsScope` once attached,
 *    otherwise a frozen snapshot of the defaults. (graceful degradation)
 */

import { describe, expect, it } from 'vitest'
import { apply, getLongmem, readLongmem, watchLongmem } from '../src/index.ts'
import { LONGMEM_DEFAULTS, LONGMEM_NAMESPACE } from '../src/namespace.ts'
import { bootWithMemory } from './memory.ts'

describe('apply() default resolution', () => {
  it('resolves the schema defaults when no composition config is given', async () => {
    const { ctx } = await bootWithMemory()
    await ctx.plugin(apply, {})
    const section = readLongmem(ctx)
    expect(section.language).toBe(LONGMEM_DEFAULTS.language)
    expect(section.theme).toBe(LONGMEM_DEFAULTS.theme)
    expect(section.defaultModel).toBe(LONGMEM_DEFAULTS.defaultModel)
    expect(section.customPrompts).toEqual(
      LONGMEM_DEFAULTS.customPrompts.map((slot) => ({ name: slot.name, content: '' })),
    )
  })

  it('resolves the schema defaults when no user document is present', async () => {
    const { ctx } = await bootWithMemory({ doc: {} })
    await ctx.plugin(apply, {})
    const section = readLongmem(ctx)
    expect(section.apiKeyAliases).toEqual({})
    expect(section.notes).toEqual({})
  })
})

describe('apply() with composition base', () => {
  it('merges the base partial with the schema defaults', async () => {
    const { ctx } = await bootWithMemory()
    await ctx.plugin(apply, { base: { language: 'zh', theme: 'light' } })
    const section = readLongmem(ctx)
    expect(section.language).toBe('zh')
    expect(section.theme).toBe('light')
    // defaultModel is not in base; it inherits from the schema default.
    expect(section.defaultModel).toBe(LONGMEM_DEFAULTS.defaultModel)
  })

  it('lets the user document override the base layer', async () => {
    const { ctx } = await bootWithMemory({
      doc: { [LONGMEM_NAMESPACE]: { language: 'zh' } },
    })
    await ctx.plugin(apply, { base: { language: 'en', defaultModel: 'base-model' } })
    const section = readLongmem(ctx)
    expect(section.language).toBe('zh')
    expect(section.defaultModel).toBe('base-model')
  })

  it('lets config.config win whole over config.base', async () => {
    const { ctx } = await bootWithMemory()
    await ctx.plugin(apply, {
      base: { language: 'zh', defaultModel: 'base-model' },
      config: {
        language: 'en',
        theme: 'dark',
        defaultModel: 'config-model',
        customPrompts: [],
        apiKeyAliases: {},
        notes: {},
      },
    })
    const section = readLongmem(ctx)
    expect(section.language).toBe('en')
    expect(section.defaultModel).toBe('config-model')
  })
})

describe('readLongmem() / getLongmem()', () => {
  it('returns a frozen snapshot from readLongmem', async () => {
    const { ctx } = await bootWithMemory()
    await ctx.plugin(apply, { base: { defaultModel: 'frozen-test' } })
    const a = readLongmem(ctx)
    const b = readLongmem(ctx)
    expect(a).toBe(b) // cached binding returns the same frozen object
    expect(Object.isFrozen(a)).toBe(true)
  })

  it('getLongmem returns a live scope once the settings provider is composed', async () => {
    const { ctx } = await bootWithMemory()
    await ctx.plugin(apply, {})
    const scopeOrDefault = getLongmem(ctx)
    // The scope implements `get`, `update`, `replace`, `watch`.
    expect(typeof (scopeOrDefault as { get?: unknown }).get).toBe('function')
  })
})

describe('getLongmem() without a settings provider', () => {
  it('falls back to a frozen snapshot of the schema defaults', async () => {
    // Boot a fresh Context with no plugins — no `settings` service.
    const { Context } = await import('@deepseek-ai/cordis')
    const ctx = new Context()
    // No `apply` call either; the binding map is empty.
    const value = getLongmem(ctx)
    expect(Object.isFrozen(value)).toBe(true)
    expect(value).toMatchObject({ language: LONGMEM_DEFAULTS.language })
  })
})

describe('watchLongmem()', () => {
  it('fires on every committed change with frozen next/prev snapshots', async () => {
    const { ctx, provider } = await bootWithMemory()
    apply(ctx, {})
    const events: Array<{ next: string; prev: string }> = []
    watchLongmem(ctx, (next, prev) => {
      events.push({ next: next.defaultModel, prev: prev.defaultModel })
    })
    // The next `update` goes through the seam, which fires the watcher.
    await ctx.settings.update(LONGMEM_NAMESPACE, { defaultModel: 'updated-model' })
    expect(events).toEqual([{ next: 'updated-model', prev: LONGMEM_DEFAULTS.defaultModel }])
    // Subsequent reads are frozen.
    const section = readLongmem(ctx)
    expect(Object.isFrozen(section)).toBe(true)
  })

  it('propagates external document pushes to the watcher', async () => {
    const { ctx, provider } = await bootWithMemory()
    apply(ctx, {})
    const events: string[] = []
    watchLongmem(ctx, (next) => {
      events.push(next.defaultModel)
    })
    provider.pushExternal({ [LONGMEM_NAMESPACE]: { defaultModel: 'external-push' } })
    // Give the publish microtask a tick to settle.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(events).toContain('external-push')
  })
})

describe('apply() disposal', () => {
  it('removes the registration when the fiber is disposed', async () => {
    const { ctx } = await bootWithMemory()
    const fiber = ctx.plugin(apply, { base: { defaultModel: 'doomed' } })
    await fiber
    // The scope is reachable while the fiber is alive.
    const alive = readLongmem(ctx)
    expect(alive.defaultModel).toBe('doomed')
    // Disposing the fiber removes the registration; reads still
    // return the schema-default fallback (a new binding is not
    // installed on re-apply unless the user re-runs it).
    await fiber.dispose()
    const after = readLongmem(ctx)
    expect(after.defaultModel).toBe(LONGMEM_DEFAULTS.defaultModel)
  })
})
