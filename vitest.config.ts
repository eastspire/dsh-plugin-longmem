import { defineConfig } from 'vitest/config'

// Minimal vitest config for dsh-plugin-longmem.
//
// - node environment: no DOM, no JSDOM — the plugin is a Context
//   extension, not a UI.
// - globals: false: tests import describe / expect / it from
//   vitest explicitly. Mirrors the upstream @deepseek-ai/dsh-settings
//   test style and keeps tree-shaking honest.
// - The default include glob picks up tests ending in .spec.ts.
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.spec.ts'],
  },
})
