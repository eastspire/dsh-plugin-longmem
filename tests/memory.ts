/**
 * In-memory settings provider fixture for the dsh-plugin-longmem
 * test suite. Mirrors the same shape the `@deepseek-ai/dsh-settings`
 * upstream tests use, so the seam contract under test is the real
 * one — not a parallel implementation.
 *
 * Why we ship our own instead of importing the upstream fixture:
 * the upstream `MemorySettings` lives in `tests/memory.ts` of an
 * internal harness repo, which is not a published package. A 50-line
 * subclass of the abstract `SettingsProvider` is cheaper to maintain
 * than a workspace dance.
 */

import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'

export interface MemorySettingsOptions {
  doc?: Record<string, unknown>
  writable?: boolean
  persistDelayMs?: number
}

export class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown>
  persisted: Array<{ ns: SettingsNamespace; section: Record<string, unknown> }> = []
  writableFlag: boolean
  persistDelayMs: number

  constructor(
    ctx: ConstructorParameters<typeof SettingsProvider>[0],
    options: MemorySettingsOptions = {},
  ) {
    super(ctx)
    this.doc = structuredClone(options.doc ?? {})
    this.writableFlag = options.writable ?? true
    this.persistDelayMs = options.persistDelayMs ?? 0
  }

  get writable(): boolean {
    return this.writableFlag
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected async persist(
    ns: SettingsNamespace,
    section: Record<string, unknown>,
  ): Promise<void> {
    if (this.persistDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.persistDelayMs))
    }
    this.persisted.push({ ns, section: structuredClone(section) })
    this.doc[ns] = structuredClone(section)
  }

  /** Simulate an external storage change reaching the provider. */
  pushExternal(doc: Record<string, unknown>): void {
    this.doc = structuredClone(doc)
    this.publish(structuredClone(doc))
  }
}

/**
 * Boot a `Context` with `MemorySettings` composed as the `settings`
 * service. Returns the live `Context` and the provider so tests can
 * exercise the full lifecycle (register, push external, watch).
 */
export async function bootWithMemory(
  options: MemorySettingsOptions = {},
): Promise<{ ctx: Awaited<ReturnType<typeof bootContext>>; provider: MemorySettings }> {
  const ctx = await bootContext(options)
  return { ctx, provider: ctx.get('settings') as MemorySettings }
}

async function bootContext(options: MemorySettingsOptions) {
  // Imported lazily so the fixture file is test-only and does not
  // pull cordis at module load time (some test runners snapshot
  // modules).
  const { Context } = await import('@deepseek-ai/cordis')
  const ctx = new Context()
  const fiber = ctx.plugin(MemorySettings, options)
  await fiber
  return ctx
}
