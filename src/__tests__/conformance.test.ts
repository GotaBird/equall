import { describe, it, expect, vi, afterEach } from 'vitest'
import { computeConformance, VERDICT_VPAT_MAP } from '../conformance/index.js'
import { runScan } from '../scan.js'
import { printResult } from '../output/terminal.js'
import { getCriteriaForLevel } from '../wcag-catalog.js'
import type { CoverageReport, EquallIssue, ConformanceVerdict } from '../types.js'

// BUR-160 — the per-criterion conformance module. Pure derivation from issues × coverage ×
// reclassified; one honest verdict per criterion of the target level.

function issue(over: Partial<EquallIssue> = {}): EquallIssue {
  return {
    scanner: 'axe-core',
    scanner_rule_id: 'image-alt',
    wcag_criteria: ['1.1.1'],
    wcag_level: 'A',
    pour: 'perceivable',
    file_path: 'index.html',
    line: null,
    column: null,
    html_snippet: null,
    severity: 'critical',
    message: 'x',
    help_url: null,
    suggestion: null,
    ...over,
  }
}

// A coverage report exercising all four terminal buckets:
//   1.1.1 auto (also failed below → fail wins) · 1.3.1 auto (clean) · 1.4.3 partial
//   2.4.1 auto but reclassified out (not verifiable) · 2.4.6 manual · 4.1.2 manual (also failed)
const coverage: CoverageReport = {
  criteria: [
    { criterion: '1.1.1', status: 'auto', scanners: ['axe-core'] },
    { criterion: '1.3.1', status: 'auto', scanners: ['axe-core'] },
    { criterion: '1.4.3', status: 'partial', scanners: ['axe-core'] },
    { criterion: '2.4.1', status: 'auto', scanners: ['axe-core'] },
    { criterion: '2.4.6', status: 'manual', scanners: [] },
    { criterion: '4.1.2', status: 'manual', scanners: [] },
  ],
  counts: { auto: 3, partial: 1, manual: 2 },
  auto_criteria: ['1.1.1', '1.3.1', '2.4.1'],
  reclassified: [
    { rule_id: 'bypass', scanner: 'axe-core', reason: 'Verify on the rendered page.', count: 1, files: ['a.astro'], wcag_criteria: ['2.4.1'] },
  ],
}

function conformance() {
  const issues = [
    issue({ wcag_criteria: ['1.1.1'], fingerprint: 'fp-111' }),
    issue({ wcag_criteria: ['4.1.2'], fingerprint: 'fp-412', scanner_rule_id: 'aria-valid' }),
    issue({ wcag_criteria: ['1.3.1'], ignored: true, fingerprint: 'fp-ignored' }), // must NOT fail 1.3.1
  ]
  const list = computeConformance('AA', 'wcag22', issues, coverage)
  const by = new Map(list.map((c) => [c.criterion, c]))
  return { list, by }
}

describe('computeConformance — the four verdicts', () => {
  it('fail: an active issue maps to the criterion, evidence = its fingerprints (fail wins over auto)', () => {
    const { by } = conformance()
    expect(by.get('1.1.1')?.verdict).toBe('fail')
    expect(by.get('1.1.1')?.evidence).toEqual(['fp-111'])
    expect(by.get('1.1.1')?.reason).toBeUndefined()
  })

  it('fail wins over an unexercised (manual) criterion too', () => {
    const { by } = conformance()
    // 4.1.2 is only "manual" in coverage, but it has a failing issue → fail, never not_tested.
    expect(by.get('4.1.2')?.verdict).toBe('fail')
    expect(by.get('4.1.2')?.evidence).toEqual(['fp-412'])
  })

  it('pass_automated: exercised auto with zero issues, no evidence/reason', () => {
    const { by } = conformance()
    const c = by.get('1.3.1')!
    expect(c.verdict).toBe('pass_automated')
    expect(c.evidence).toBeUndefined()
    expect(c.reason).toBeUndefined()
  })

  it('not_verifiable_on_this_scan: reclassified page-level rule, reason carried from the rule', () => {
    const { by } = conformance()
    const c = by.get('2.4.1')!
    expect(c.verdict).toBe('not_verifiable_on_this_scan')
    expect(c.reason).toBe('Verify on the rendered page.')
  })

  it('not_tested_assisted: coverage `partial` (e.g. contrast), reason attached', () => {
    const { by } = conformance()
    const c = by.get('1.4.3')!
    expect(c.verdict).toBe('not_tested_assisted')
    expect(c.reason).toBeTruthy()
  })

  it('not_tested_manual: coverage `manual` or absent from the coverage universe', () => {
    const { by } = conformance()
    expect(by.get('2.4.6')?.verdict).toBe('not_tested_manual')  // manual in coverage
    expect(by.get('1.2.1')?.verdict).toBe('not_tested_manual')  // absent entirely → default
  })

  it('an ignored issue never turns a criterion into fail', () => {
    const { by } = conformance()
    expect(by.get('1.3.1')?.verdict).toBe('pass_automated')
  })
})

describe('computeConformance — completeness & shape', () => {
  it('emits exactly one entry per criterion of the target level (buckets sum to the total)', () => {
    const { list } = conformance()
    expect(list.length).toBe(getCriteriaForLevel('AA').length)
    const sum = list.filter((c) => c.verdict === 'fail').length
      + list.filter((c) => c.verdict === 'pass_automated').length
      + list.filter((c) => c.verdict.startsWith('not_')).length
    expect(sum).toBe(list.length)
  })

  it('every entry carries criterion, level and a non-empty catalog name', () => {
    const { list } = conformance()
    for (const c of list) {
      expect(c.criterion).toBeTruthy()
      expect(c.level).toMatch(/^A|AA|AAA$/)
      expect(c.name.length).toBeGreaterThan(0)
    }
  })

  it('scopes to the target level — AAA criteria never appear under an AA target', () => {
    const { by } = conformance()
    expect(by.has('1.4.6')).toBe(false) // 1.4.6 is AAA
  })

  it('VERDICT_VPAT_MAP covers every verdict and never emits a bare "Supports"', () => {
    const verdicts: ConformanceVerdict[] = ['fail', 'pass_automated', 'not_verifiable_on_this_scan', 'not_tested_assisted', 'not_tested_manual']
    for (const v of verdicts) expect(VERDICT_VPAT_MAP[v]).toBeTruthy()
    expect(VERDICT_VPAT_MAP.pass_automated).not.toBe('Supports')
    expect(VERDICT_VPAT_MAP.pass_automated).toMatch(/automated/i)
  })
})

// ---------------------------------------------------------------------------
// Terminal — the Support Summary leads, the score follows, no banned words
// ---------------------------------------------------------------------------
const BANNED = /meets|conformant|compliant|conformance/i

function render(result: Awaited<ReturnType<typeof runScan>>, verbose = false): string {
  const logs: string[] = []
  const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    logs.push(a.map(String).join(' '))
  })
  try {
    printResult(result, { targetLevel: 'AA', verbose })
  } finally {
    spy.mockRestore()
  }
  return logs.join('\n').replace(/\x1b\[[0-9;]*m/g, '')
}

describe('Support Summary (terminal, BUR-160)', () => {
  afterEach(() => vi.restoreAllMocks())

  const html = `<!DOCTYPE html>
<html lang="en"><head><title>T</title></head>
<body><main><h1>Hi</h1><img src="a.png"><a href="#"></a></main></body></html>`

  it('trails: the Support Summary is the final block, after the score, with no banned words', async () => {
    const result = await runScan({ files: [{ path: 'index.html', content: html }] })
    const out = render(result)

    expect(out).toContain('WCAG 2.2 Support Summary')
    expect(out).toMatch(/Supports \(automated\)/)
    expect(out).toContain('Does not support')
    expect(out).toContain('Not evaluated')
    expect(out).not.toMatch(BANNED)
    // Moved to the END (read-first in a terminal): the score trend indicator prints first,
    // then the Support Summary as the final block, in the last portion of the output.
    expect(out.indexOf('score is a trend indicator')).toBeLessThan(out.indexOf('WCAG 2.2 Support Summary'))
    expect(out.indexOf('WCAG 2.2 Support Summary')).toBeGreaterThan(out.length * 0.6)
  })

  it('--verbose expands the full per-criterion table and splits "Not evaluated"', async () => {
    const result = await runScan({ files: [{ path: 'index.html', content: html }] })
    const out = render(result, true)

    expect(out).toContain('Non-text Content')                 // a per-criterion row
    expect(out).toMatch(/Not evaluated — (rendered check|assisted|manual)/)
    expect(out).not.toMatch(BANNED)
  })
})
