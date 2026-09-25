import { describe, it, expect } from 'vitest'
import { AxeScanner } from '../scanners/axe-scanner.js'
import { EslintJsxA11yScanner } from '../scanners/eslint-jsx-a11y-scanner.js'
import { ErrorIdentificationScanner } from '../scanners/error-identification-scanner.js'
import { ReadabilityScanner } from '../scanners/readability-scanner.js'
import type { FileType, ScanContext, ScannerAdapter } from '../types.js'

// Coverage credits a scanner by its declared `fileTypes`. A scanner that reads a different,
// hardcoded list would make the coverage report claim criteria it never tested (or hide ones
// it did). Every scanner must read exactly what it declares.

// Every type a scanner could read ('other' is never scannable).
type ScannableType = Exclude<FileType, 'other'>
const ALL_TYPES: ScannableType[] = ['html', 'jsx', 'tsx', 'vue', 'svelte', 'astro']

// Markup that every engine would flag if it read the file: an image without alt, an input
// marked invalid with no error message, and enough English prose for the readability grade.
const CONTENT: Record<ScannableType, string> = {
  html: '<!doctype html><html lang="en"><body><img src="a.png"><input aria-invalid="true"></body></html>',
  jsx: 'export function C() { return (<div><img src="a.png" /><input aria-invalid="true" /></div>) }',
  tsx: 'export function C() { return (<div><img src="a.png" /><input aria-invalid="true" /></div>) }',
  vue: '<template><div><img src="a.png"><input aria-invalid="true"></div></template>',
  svelte: '<div><img src="a.png"><input aria-invalid="true"></div>',
  astro: '---\n---\n<div><img src="a.png"><input aria-invalid="true"></div>',
}

function context(type: ScannableType): ScanContext {
  return {
    root_path: '/virtual',
    files: [{ path: `f.${type}`, absolute_path: `/virtual/f.${type}`, content: CONTENT[type], type }],
    options: { wcag_level: 'AA', include_patterns: [], exclude_patterns: [] },
    in_memory: true,
    diagnostics: [],
  }
}

const scanners: ScannerAdapter[] = [
  new AxeScanner(),
  new EslintJsxA11yScanner(),
  new ErrorIdentificationScanner(),
  new ReadabilityScanner(),
]

describe('scanners read exactly their declared file types', () => {
  for (const scanner of scanners) {
    const undeclared = ALL_TYPES.filter((t) => !scanner.fileTypes.includes(t))
    for (const type of undeclared) {
      it(`${scanner.name} ignores .${type} (not declared)`, async () => {
        const ctx = context(type)
        expect(await scanner.scan(ctx)).toEqual([])
        expect(ctx.diagnostics).toEqual([])
      })
    }
  }
})
