import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runScan, scanBuffer } from '../scan.js'
import { sanitizeVirtualPath, fileTypeForPath } from '../discover.js'
import type { ScanResult } from '../types.js'

// Strip the non-deterministic fields so two ScanResults can be compared structurally.
function stable(result: ScanResult): Omit<ScanResult, 'duration_ms' | 'scanned_at'> {
  const { duration_ms: _d, scanned_at: _s, ...rest } = result
  return rest
}

const HTML_WITH_VIOLATION = `<!DOCTYPE html>
<html lang="en">
  <head><title>Test</title></head>
  <body>
    <img src="logo.png">
    <a href="#"></a>
  </body>
</html>`

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'equall-mem-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Parity: buffer input must equal disk input on the same file (acceptance crit.)
// ---------------------------------------------------------------------------
describe('scanBuffer / runScan parity', () => {
  it('scanBuffer(html) equals runScan({path}) on the same file', async () => {
    await writeFile(join(tempDir, 'x.html'), HTML_WITH_VIOLATION, 'utf-8')

    const disk = await runScan({ path: tempDir })
    const buffer = await scanBuffer(HTML_WITH_VIOLATION, 'x.html')

    expect(stable(buffer)).toEqual(stable(disk))
  })
})

// ---------------------------------------------------------------------------
// Missing-alt is reported from a buffer — both engines
// ---------------------------------------------------------------------------
describe('scanBuffer reports violations', () => {
  it('reports a missing alt on an HTML buffer (axe-core)', async () => {
    const result = await scanBuffer(HTML_WITH_VIOLATION, 'page.html')

    const altIssue = result.issues.find((i) => i.wcag_criteria.includes('1.1.1'))
    expect(altIssue).toBeDefined()
    expect(altIssue?.scanner).toBe('axe-core')
  })

  it('reports a missing alt on a TSX buffer (eslint via lintText)', async () => {
    // No `return` keyword → axe's scannableFiles filter skips it, so this exercises
    // the eslint in-memory path (lintText) specifically — the false-negative trap.
    const tsx = 'export default () => <img src="logo.png" />\n'
    const result = await scanBuffer(tsx, 'Component.tsx')

    const altIssue = result.issues.find((i) => i.scanner_rule_id === 'jsx-a11y/alt-text')
    expect(altIssue).toBeDefined()
    expect(altIssue?.scanner).toBe('eslint-jsx-a11y')
  })
})

// ---------------------------------------------------------------------------
// Security: untrusted buffer paths must not escape the virtual root
// ---------------------------------------------------------------------------
describe('sanitizeVirtualPath', () => {
  it('keeps a plain relative path', () => {
    expect(sanitizeVirtualPath('src/App.tsx')).toBe('src/App.tsx')
    expect(sanitizeVirtualPath('./a/b.html')).toBe('a/b.html')
  })

  it('strips a leading slash so the path is never absolute', () => {
    expect(sanitizeVirtualPath('/etc/passwd')).toBe('etc/passwd')
  })

  it('strips a Windows drive prefix', () => {
    expect(sanitizeVirtualPath('C:\\Users\\x.html')).toBe('Users/x.html')
  })

  it('rejects path traversal that escapes the root', () => {
    expect(() => sanitizeVirtualPath('../secret.html')).toThrow(/traversal/)
    expect(() => sanitizeVirtualPath('a/../../secret.html')).toThrow(/traversal/)
  })

  it('rejects an empty path', () => {
    expect(() => sanitizeVirtualPath('   ')).toThrow()
  })
})

describe('runScan rejects unsafe buffer paths', () => {
  it('throws when a buffer path escapes the virtual root', async () => {
    await expect(
      runScan({ files: [{ path: '../../etc/passwd', content: '<img>' }] })
    ).rejects.toThrow(/traversal/)
  })
})

describe('fileTypeForPath', () => {
  it('classifies by extension', () => {
    expect(fileTypeForPath('a/b.html')).toBe('html')
    expect(fileTypeForPath('a/b.tsx')).toBe('tsx')
    expect(fileTypeForPath('a/b.astro')).toBe('astro')
    expect(fileTypeForPath('a/b.md')).toBe('other')
  })
})

describe('empty scan carries the documented report shape (R1a)', () => {
  it('attaches coverage / criterion_conformance / standard / confidence_flags even with nothing to scan', async () => {
    // The README "Programmatic use" section promises these fields on ScanResult; the early-return
    // paths must not omit them (or the docs lie).
    const result = await runScan({ files: [] })
    expect(result.coverage).toBeDefined()
    expect(result.coverage?.reclassified).toEqual([])
    expect(result.criterion_conformance?.length).toBeGreaterThan(0)
    expect(result.criterion_conformance?.every((c) => c.verdict === 'not_tested_manual')).toBe(true)
    expect(result.standard).toBe('wcag22')
    expect(result.confidence_flags).toEqual([])
  })
})
