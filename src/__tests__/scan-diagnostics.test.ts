import { describe, it, expect, vi } from 'vitest'
import { runScan, scanBuffer } from '../scan.js'
import { computeCoverage } from '../coverage.js'
import type { ScannerAdapter, FileEntry } from '../types.js'

// A file the engine could not analyse must never read as a clean file: the result says what
// was not checked, on ScanResult.diagnostics, and the engine itself writes nothing to stderr.

describe('what could not be analysed is stated', () => {
  it('a JSX file that does not parse is reported, not passed as clean', async () => {
    const broken = `export function Broken() {
  return (
    <div onClick={() => go()}>
      <img src="a.png">
    </div>
  // missing closing paren and brace
`
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const r = await scanBuffer(broken, 'Broken.tsx')
      expect(r.diagnostics?.some((d) => d.startsWith('[eslint-jsx-a11y] Broken.tsx could not be parsed'))).toBe(true)
      // The engine reports through the result, never through the host's stderr.
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('a clean scan carries no analysis diagnostics', async () => {
    const r = await runScan({ files: [{ path: 'Ok.tsx', content: `export function Ok() { return (<main><h1>Hi</h1></main>) }` }] })
    expect((r.diagnostics ?? []).filter((d) => !d.startsWith('[routes]'))).toEqual([])
  })
})

describe('a scanner that failed outright is not credited in coverage', () => {
  const scanner = (name: string, criteria: string[]): ScannerAdapter => ({
    name,
    version: '1',
    fileTypes: ['tsx'],
    coveredCriteria: criteria,
    isAvailable: async () => true,
    scan: async () => [],
  })
  const files: FileEntry[] = [{ path: 'A.tsx', absolute_path: '/x/A.tsx', content: '', type: 'tsx' }]

  it('its criteria fall back to manual', () => {
    const cov = computeCoverage([scanner('ok', ['1.1.1']), scanner('broken', ['2.4.6'])], files, new Set(['broken']))
    expect(cov.criteria.find((c) => c.criterion === '1.1.1')?.status).toBe('auto')
    expect(cov.criteria.find((c) => c.criterion === '2.4.6')?.status).toBe('manual')
    expect(cov.auto_criteria).not.toContain('2.4.6')
  })
})
