/**
 * Namespace and defaults for the long-term-memory user-config section.
 *
 * The `longmem` namespace persists through the official user-settings seam
 * (`@deepseek-ai/dsh-settings`) so that any compatible provider — file,
 * sqlite, future backends — carries the same structured value. The user
 * document sits at `$DSH_HOME/settings.yaml` by default when
 * `@deepseek-ai/dsh-settings-file` is composed.
 *
 * @module dsh-plugin-longmem/namespace
 */

import { settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'

/**
 * The settings namespace this plugin owns.
 *
 * `^[a-z][a-z0-9-]*$` — matches the `SettingsNamespace` brand enforced by
 * `settingsNamespace()`.
 */
export const LONGMEM_NAMESPACE: SettingsNamespace = settingsNamespace('longmem')

/**
 * UI-language identifiers accepted at the schema boundary. We intentionally
 * keep this list small: anything the agent renders needs a corresponding
 * locale in the Web client, so widening this list is a coordinated change.
 */
export const SUPPORTED_LANGUAGES = ['en', 'zh', 'ja', 'ko', 'fr', 'de', 'es'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

/** UI themes the user can pick. `system` follows the OS preference. */
export const SUPPORTED_THEMES = ['light', 'dark', 'system'] as const
export type SupportedTheme = (typeof SUPPORTED_THEMES)[number]

/**
 * Reserved alias for a user-defined prompt slot. The agent reads these as
 * standing context, not as one-shot messages. The user can declare any
 * number of named slots through the schema; the names here are just
 * the first three to seed a sane default.
 */
export const PROMPT_SLOT_NAMES = ['persona', 'house-style', 'domain-rules'] as const

/**
 * Default schema-defaults for the long-term-memory section. These values
 * are what the user sees when their document has no `longmem:` key — the
 * composition `base` layer in cordis.yml wins over them, and the user
 * document wins over the `base`.
 *
 * Keep this object JSON-compatible: it travels through the document on
 * save and reload, and the settings provider rejects anything that isn't.
 */
export const LONGMEM_DEFAULTS = {
  language: 'en' as SupportedLanguage,
  theme: 'system' as SupportedTheme,
  /** Default LLM model identifier the user prefers. Provider-agnostic. */
  defaultModel: '',
  /**
   * Custom system-prompt slots the agent should always carry in context.
   * Each entry is `{ name, content }`; the agent reads them by `name`.
   * Empty by default; users add their own.
   */
  customPrompts: [] as ReadonlyArray<{ readonly name: string; readonly content: string }>,
  /**
   * User-defined API key aliases. Maps a friendly alias the user types
   * (e.g. `work`, `personal`) to a credential-reference id the
   * credentials service resolves. The values are *references*, never the
   * raw keys — secrets live in the credentials document.
   */
  apiKeyAliases: {} as Record<string, string>,
  /**
   * Anything else the user wants to remember that doesn't fit the
   * structured keys. Kept as free-form JSON-compatible data; the agent
   * can read this and decide what to do with it.
   */
  notes: {} as Record<string, unknown>,
} as const
