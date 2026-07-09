// eslint-plugin-jsx-a11y ships no type declarations. The scanner only needs the
// plugin object to hand to ESLint's flat config, so a minimal module declaration
// is enough to keep `tsc --noEmit` clean (tsup bundling is unaffected either way).
declare module 'eslint-plugin-jsx-a11y' {
  import type { ESLint } from 'eslint'
  const plugin: ESLint.Plugin
  export default plugin
}
