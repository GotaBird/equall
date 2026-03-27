import { defineConfig } from 'tsup'

const esmShims = [
  `import { createRequire as __createRequire } from 'module';`,
  `import { fileURLToPath as __fileURLToPath } from 'url';`,
  `import { dirname as __dirname2 } from 'path';`,
  `const require = __createRequire(import.meta.url);`,
  `const __filename = __fileURLToPath(import.meta.url);`,
  `const __dirname = __dirname2(__filename);`,
].join(' ')

export default defineConfig({
  entry: ['src/cli.ts', 'src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  noExternal: [/^(?!(jsdom|eslint|@eslint|eslint-plugin-jsx-a11y|@typescript-eslint|esquery|espree))/],
  platform: 'node',
  banner: { js: esmShims },
  esbuildOptions(options) {
    options.external = [...(options.external ?? []), 'jiti', 'jiti/package.json']
  },
})
