import { describe, it, expect } from 'vitest'
import { computeCoverage, formatNoFailureVerdict, honestTestedCriteria } from '../coverage.js'
import { formatDiffGuardrail } from '../diff-scan.js'
import type { DiffScanResult } from '../diff-scan.js'
import { runScan } from '../scan.js'
import type { ScannerAdapter, FileEntry, FileType, CoverageReport, ReclassifiedRule } from '../types.js'

function scanner(over: Partial<ScannerAdapter> & { name: string; fileTypes: FileType[]; coveredCriteria: string[] }): ScannerAdapter {
  return {
    version: '0',
    scan: async () => [],
    isAvailable: async () => true,
    ...over,
  }
}

function file(path: string, type: FileType): FileEntry {
  return { path, absolute_path: `/r/${path}`, content: '', type }
}

const AXE = scanner({
  name: 'axe-core',
  fileTypes: ['html', 'jsx', 'tsx', 'vue'],
  coveredCriteria: ['1.1.1', '1.4.3'],
  partialCriteria: ['1.4.3'],
})
const ESLINT = scanner({
  name: 'eslint-jsx-a11y',
  fileTypes: ['jsx', 'tsx'],
  coveredCriteria: ['2.4.6'],
})

function statusOf(report: ReturnType<typeof computeCoverage>, criterion: string): string | undefined {
  return report.criteria.find((c) => c.criterion === criterion)?.status
}

// ---------------------------------------------------------------------------
// computeCoverage — capable is never reported as tested
// ---------------------------------------------------------------------------
describe('computeCoverage', () => {
  it('marks a scanner with no eligible files as manual (does not inflate auto)', () => {
    // HTML-only scan: axe runs, eslint does not.
    const report = computeCoverage([AXE, ESLINT], [file('page.html', 'html')])

    expect(statusOf(report, '1.1.1')).toBe('auto')   // axe ran on html
    expect(statusOf(report, '2.4.6')).toBe('manual')  // eslint-only, no jsx/tsx present
    expect(report.auto_criteria).not.toContain('2.4.6')
  })

  it('marks contrast (1.4.3) as partial, never auto', () => {
    const report = computeCoverage([AXE, ESLINT], [file('page.html', 'html')])

    expect(statusOf(report, '1.4.3')).toBe('partial')
    expect(report.auto_criteria).not.toContain('1.4.3')
  })

  it('counts an eslint criterion as auto once a TSX file is present', () => {
    const report = computeCoverage([AXE, ESLINT], [file('App.tsx', 'tsx')])

    expect(statusOf(report, '2.4.6')).toBe('auto')
  })

  it('marks everything manual when no eligible files are present', () => {
    const report = computeCoverage([AXE, ESLINT], [file('readme.md', 'other')])

    expect(report.counts.auto).toBe(0)
    expect(report.counts.partial).toBe(0)
    expect(report.criteria.every((c) => c.status === 'manual')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// honestTestedCriteria — the coverage-derived criteria_tested set (BUR-159)
// ---------------------------------------------------------------------------
describe('honestTestedCriteria', () => {
  const coverage: CoverageReport = {
    criteria: [],
    counts: { auto: 0, partial: 0, manual: 0 },
    auto_criteria: ['1.1.1', '2.4.1', '2.4.2', '3.1.1', '4.1.2'],
  }

  it('returns the auto set unchanged when nothing was reclassified', () => {
    expect(honestTestedCriteria(coverage, [])).toEqual(['1.1.1', '2.4.1', '2.4.2', '3.1.1', '4.1.2'])
  })

  it('subtracts criteria of page-level rules reclassified on a fragment', () => {
    const reclassified: ReclassifiedRule[] = [
      { rule_id: 'bypass', scanner: 'axe-core', reason: 'page-level', count: 1, files: ['a.astro'], wcag_criteria: ['2.4.1'] },
      { rule_id: 'html-has-lang', scanner: 'axe-core', reason: 'page-level', count: 1, files: ['a.astro'], wcag_criteria: ['3.1.1'] },
    ]
    // 2.4.1 and 3.1.1 could not be verified on the fragment → not "tested".
    expect(honestTestedCriteria(coverage, reclassified)).toEqual(['1.1.1', '2.4.2', '4.1.2'])
  })

  it('ignores reclassified best-practice rules with no WCAG criteria', () => {
    const reclassified: ReclassifiedRule[] = [
      { rule_id: 'region', scanner: 'axe-core', reason: 'page-level', count: 1, files: ['a.astro'], wcag_criteria: [] },
    ]
    expect(honestTestedCriteria(coverage, reclassified)).toEqual(coverage.auto_criteria)
  })
})

// ---------------------------------------------------------------------------
// Anti-"done" verdicts never claim clean/done
// ---------------------------------------------------------------------------
describe('formatNoFailureVerdict', () => {
  it('never claims the code is clean or done', () => {
    const lines = formatNoFailureVerdict({ criteria: [], counts: { auto: 5, partial: 1, manual: 9 }, auto_criteria: [] })
    const text = lines.join('\n')

    expect(text).not.toMatch(/all (automated )?checks pass/i)
    expect(text).not.toMatch(/nothing to fix/i)
    expect(text).not.toMatch(/\bclean\b/i)
    expect(text).toMatch(/manual|rendered/i)
    expect(text).toContain('5 criteria auto-tested')
  })
})

describe('formatDiffGuardrail', () => {
  it('always names legacy + not-testable and points at the rendered check, even at zero new', () => {
    const result = {
      summary: { new_count: 0, legacy_count: 3, not_testable_count: 2 },
    } as DiffScanResult

    const line = formatDiffGuardrail(result)
    expect(line).toBe('0 new · 3 legacy · 2 not statically testable → run the rendered check')
    expect(line).not.toMatch(/\bclean\b|\bdone\b/i)
  })
})

// ---------------------------------------------------------------------------
// Integration — runScan attaches honest coverage
// ---------------------------------------------------------------------------
describe('runScan honest coverage (integration)', () => {
  it('attaches a coverage report with contrast partial and eslint criteria manual on an HTML-only scan', async () => {
    const html = `<!DOCTYPE html>
<html lang="en"><head><title>T</title></head>
<body><main><h1>Hi</h1><img src="a.png" alt="A"></main></body></html>`

    const result = await runScan({ files: [{ path: 'index.html', content: html }] })

    expect(result.coverage).toBeDefined()
    const cov = result.coverage!
    expect(cov.criteria.find((c) => c.criterion === '1.4.3')?.status).toBe('partial')
    // 2.4.6 is covered only by eslint-jsx-a11y, which got no JSX/TSX files here.
    expect(cov.criteria.find((c) => c.criterion === '2.4.6')?.status).toBe('manual')
    expect(cov.counts.auto).toBeGreaterThan(0)
  })
})
