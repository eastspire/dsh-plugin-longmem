import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/schema.ts', 'src/namespace.ts'],
  outDir: 'lib',
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node22',
  external: [
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-settings',
    '@deepseek-ai/schemastery',
  ],
})
