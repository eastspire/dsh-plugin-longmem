/**
 * Schemastery schema for the `longmem` user-settings section.
 *
 * Schemastery is DSH's schema DSL: the same schema validates writes through
 * the settings seam (`ctx.settings.register`) and describes the field
 * tree to configuration UIs through the schema's `meta`.
 *
 * Every field defaults to what `LONGMEM_DEFAULTS` carries so an absent
 * section still resolves to a complete, sane object. The `notes` bucket
 * is `z.dict(z.unknown())` so the user can park anything JSON-shaped
 * they want remembered without us growing new fields for every idea.
 *
 * @module dsh-plugin-longmem/schema
 */

import z from '@deepseek-ai/schemastery'
import {
  LONGMEM_DEFAULTS,
  PROMPT_SLOT_NAMES,
  SUPPORTED_LANGUAGES,
  SUPPORTED_THEMES,
} from './namespace.ts'

/** One standing system-prompt slot the user defines for the agent. */
export interface CustomPrompt {
  /** Stable slot name; used as the lookup key in the agent's context. */
  readonly name: string
  /** The prompt text. Treated as opaque — the agent does not parse it. */
  readonly content: string
}

const PROMPT_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/

/** Schema for one custom-prompt slot. Exported so callers can build typed sub-schemas. */
export const CustomPromptSchema = z.object({
  name: z.string().pattern(PROMPT_NAME_PATTERN),
  content: z.string(),
})

/** Resolved shape of the `longmem` section after schema validation. */
/** Read-only snapshot view of a `LongmemSection`. All nested objects
 *  are also deep-readonly, mirroring the frozen state the seam gives
 *  back from `settings.get()`. */
export type LongmemReadonly = {
  readonly [K in keyof LongmemSection]: LongmemSection[K] extends Array<infer U>
    ? ReadonlyArray<U>
    : LongmemSection[K] extends object
    ? Readonly<LongmemSection[K]>
    : LongmemSection[K]
}

export interface LongmemSection {
  language: (typeof SUPPORTED_LANGUAGES)[number]
  theme: (typeof SUPPORTED_THEMES)[number]
  defaultModel: string
  customPrompts: CustomPrompt[]
  apiKeyAliases: Record<string, string>
  notes: Record<string, unknown>
}

/**
 * The complete `longmem` section schema.
 *
 * Defaults mirror `LONGMEM_DEFAULTS` field-for-field so the resolved
 * value at registration time equals the documented defaults before
 * any user document or composition `base` is layered in.
 */
export const LongmemSchema = z
  .object({
    language: z
      .union(SUPPORTED_LANGUAGES as unknown as readonly string[])
      .default(LONGMEM_DEFAULTS.language),
    theme: z
      .union(SUPPORTED_THEMES as unknown as readonly string[])
      .default(LONGMEM_DEFAULTS.theme),
    defaultModel: z.string().default(LONGMEM_DEFAULTS.defaultModel),
    customPrompts: z
      .array(CustomPromptSchema)
      .default(
        PROMPT_SLOT_NAMES.map((name) => ({ name, content: '' })),
      ),
    apiKeyAliases: z
      .dict(z.string())
      .default({ ...LONGMEM_DEFAULTS.apiKeyAliases }),
    notes: z
      .dict(z.any())
      .default({ ...LONGMEM_DEFAULTS.notes }),
  })
  .description(
    "dsh-plugin-longmem: durable per-user long-term memory section. " +
      "Persisted by the user-settings seam, read by the agent at request time.",
  ) as z<unknown, LongmemSection>
