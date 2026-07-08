import { describe, it, expect } from 'vitest'
import { runScan } from '../scan.js'
import { computeConformance } from '../conformance/index.js'
import { getCriteriaForStandardLevel } from '../wcag-catalog.js'
import type { CoverageReport, EquallIssue } from '../types.js'

// `--standard wcag22 | wcag21` is a conformance VIEW filter. The 2.1 view is the
// public-sector legal bar (WAD / EN 301 549). It must never change the score.

const emptyCoverage: CoverageReport = {
  criteria: [],
  counts: { auto: 0, partial: 0, manual: 0 },
  auto_criteria: [],
  reclassified: [],
}

describe('computeConformance — standard filter', () => {
  it('wcag21 includes 4.1.1 as a fixed automated pass with the erratum reason', () => {
    const c411 = computeConformance('AA', 'wcag21', [], emptyCoverage).find((c) => c.criterion === '4.1.1')
    expect(c411?.verdict).toBe('pass_automated')
    expect(c411?.reason).toMatch(/obsolete/i)
  })

  it('wcag22 excludes 4.1.1; wcag21 excludes the 2.2-only criteria (e.g. 2.5.8)', () => {
    const l22 = computeConformance('AA', 'wcag22', [], emptyCoverage)
    const l21 = computeConformance('AA', 'wcag21', [], emptyCoverage)
    expect(l22.some((c) => c.criterion === '4.1.1')).toBe(false)
    expect(l22.some((c) => c.criterion === '2.5.8')).toBe(true)
    expect(l21.some((c) => c.criterion === '2.5.8')).toBe(false)
  })

  it('the table always sums to the standard+level criteria total (55 / 50 at AA)', () => {
    expect(computeConformance('AA', 'wcag22', [], emptyCoverage).length).toBe(getCriteriaForStandardLevel('wcag22', 'AA').length)
    expect(computeConformance('AA', 'wcag21', [], emptyCoverage).length).toBe(getCriteriaForStandardLevel('wcag21', 'AA').length)
  })

  it('a 2.2-only criterion that fails is excluded from the 2.1 table (still an issue elsewhere)', () => {
    const issue: EquallIssue = {
      scanner: 'axe-core', scanner_rule_id: 'target-size', wcag_criteria: ['2.5.8'], wcag_level: 'AA',
      pour: 'operable', file_path: 'a.html', line: null, column: null, html_snippet: null,
      severity: 'serious', message: 'm', help_url: null, suggestion: null, fingerprint: 'fp1',
    }
    const l21 = computeConformance('AA', 'wcag21', [issue], emptyCoverage)
    expect(l21.some((c) => c.criterion === '2.5.8')).toBe(false)
  })
})

describe('runScan — standard is a view filter, never a score change', () => {
  const html = `<!DOCTYPE html>
<html lang="en"><head><title>T</title></head>
<body><main><h1>Hi</h1><img src="a.png"><a href="#"></a></main></body></html>`

  it('score is identical across standards; criteria_total and standard differ', async () => {
    const r22 = await runScan({ files: [{ path: 'i.html', content: html }], standard: 'wcag22' })
    const r21 = await runScan({ files: [{ path: 'i.html', content: html }], standard: 'wcag21' })

    expect(r21.score).toBe(r22.score) // the score never changes with --standard
    expect(r22.standard).toBe('wcag22')
    expect(r21.standard).toBe('wcag21')
    expect(r22.criteria_total).toBe(55)
    expect(r21.criteria_total).toBe(50)
    expect(r22.criterion_conformance?.length).toBe(55)
    expect(r21.criterion_conformance?.length).toBe(50)
  })

  it('defaults to wcag22 when no standard is given', async () => {
    const r = await runScan({ files: [{ path: 'i.html', content: html }] })
    expect(r.standard).toBe('wcag22')
  })
})
