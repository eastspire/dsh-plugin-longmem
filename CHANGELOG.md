# Changelog

All notable changes to `dsh-plugin-longmem` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-17

### Added

- Initial public release.
- `dsh-plugin-longmem` Cordis plugin that attaches a structured
  `longmem` user-config section to a running DSH profile.
- Schemastery schema covering `language`, `theme`, `defaultModel`,
  `customPrompts[]`, `apiKeyAliases{}`, and free-form `notes{}` — every
  field has a default so a missing section still resolves to a complete
  value.
- `readLongmem(ctx)` helper that returns a frozen snapshot of the
  resolved section for use inside other plugins.
- `getLongmem(ctx)` returning a live `SettingsScope<LongmemSection>` for
  in-process mutations, plus `watchLongmem(ctx, cb)` for change
  subscription and `apply(ctx, partial)` for partial merges (debounced
  writes + revision conflict detection are inherited from the composed
  settings provider).
- `composition: 'base' | 'config'` config switch — `base` lets the user
  document override field-by-field; `config` wins whole, useful for CI
  agents and embedded profiles.
- Vitest test suite covering schema defaults, base layering, and
  revision-mismatch rejection.
- ESLint flat config + Prettier formatting.
- Bilingual `README.md` / `README.zh.md` with install, wiring, schema
  reference, and helper API sections.
- `cordis.overlay.yml` partial for teams that want the schema + a base
  in a single drop-in.

[0.1.0]: https://github.com/eastspire/dsh-plugin-longmem/releases/tag/v0.1.0
