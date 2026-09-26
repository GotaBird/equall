import { describe, it, expect } from 'vitest'
import { runScan, scanBuffer } from '../scan.js'

// Fields for consumers that track issues across scans: what a scanner could not check
// (`unchecked`), and which findings a merged issue absorbed (`merged_fingerprints`). Neither
// may let the absence of a finding be read as a fix.

describe('unchecked: files a scanner could not check', () => {
  it('lists a JSX file that does not parse, for that scanner only', async () => {
    const r = await scanBuffer(`export function Broken() {\n  return (\n    <div>\n      <img src="a.png">\n`, 'Broken.tsx')
    expect(r.unchecked).toContainEqual({ scanner: 'eslint-jsx-a11y', file_path: 'Broken.tsx', reason: 'parse_error' })
    expect(r.unchecked?.every((u) => u.file_path === 'Broken.tsx')).toBe(true)
  })

  it('lists a page readability skips for its language', async () => {
    const page = `<!doctype html><html lang="fr"><head><title>t</title></head><body><main><p>${'Une phrase en français. '.repeat(20)}</p></main></body></html>`
    const r = await scanBuffer(page, 'fr.html')
    expect(r.unchecked).toContainEqual({ scanner: 'readability', file_path: 'fr.html', reason: 'language_skipped' })
  })

  it('is empty on a clean scan, and always present', async () => {
    const r = await runScan({ files: [{ path: 'Ok.tsx', content: `export function Ok() { return (<main><h1>Hi</h1></main>) }` }] })
    expect(r.unchecked).toEqual([])
  })
})

describe('merged_fingerprints: what a merged issue absorbed', () => {
  const nav = `export function Nav() { return (<nav><img src="logo.png" /></nav>) }`

  it('carries the fingerprint the absorbed axe finding has when not merged', async () => {
    const merged = await scanBuffer(nav, 'Nav.tsx')
    const unmerged = await scanBuffer(nav, 'Nav.tsx', { keepOccurrences: true })

    const survivor = merged.issues.find((i) => i.scanners?.length === 2)
    const twin = unmerged.issues.find((i) => i.scanner === 'axe-core' && i.scanner_rule_id === 'image-alt')
    expect(survivor?.scanner).toBe('eslint-jsx-a11y')
    expect(twin?.fingerprint).toBeTruthy()
    expect(survivor?.merged_fingerprints).toEqual([twin?.fingerprint])
    // The survivor's own identity is unchanged by the merge.
    expect(survivor?.fingerprint).toBe(unmerged.issues.find((i) => i.scanner === 'eslint-jsx-a11y')?.fingerprint)
  })

  it('is absent on issues that were not merged', async () => {
    const r = await scanBuffer(`<!doctype html><html lang="en"><head><title>t</title></head><body><main><img src="a.png"></main></body></html>`, 'index.html')
    expect(r.issues.every((i) => i.merged_fingerprints === undefined)).toBe(true)
  })
})
