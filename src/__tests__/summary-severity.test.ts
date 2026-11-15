import { describe, it, expect, vi } from 'vitest'
import { computeScanResult } from '../scoring/score.js'
import { scanBuffer } from '../scan.js'
import { printResult } from '../output/terminal.js'
import type { EquallIssue, ScanResult, Severity } from '../types.js'

// summary.by_severity covers the scored findings only: WCAG failures within the target.
// Best-practice findings (no WCAG criterion) and above-target findings stay in the issue
// list and in total_issues, by_scanner and criteria_failed, but are not counted by severity.

const ZERO: Record<Severity, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 }
const SEVERITIES: Severity[] = ['critical', 'serious', 'moderate', 'minor']

function makeIssue(overrides: Partial<EquallIssue> = {}): EquallIssue {
  return {
    scanner: 'test',
    scanner_rule_id: 'test-rule',
    wcag_criteria: ['1.1.1'],
    wcag_level: 'A',
    pour: 'perceivable',
    file_path: 'test.tsx',
    line: null,
    column: null,
    html_snippet: null,
    severity: 'moderate',
    message: 'test',
    help_url: null,
    suggestion: null,
    ...overrides,
  }
}

const bestPractice = (severity: Severity): EquallIssue =>
  makeIssue({ scanner_rule_id: `bp-${severity}`, wcag_criteria: [], wcag_level: null, pour: null, severity })

const aaa = (severity: Severity): EquallIssue =>
  makeIssue({ scanner_rule_id: `aaa-${severity}`, wcag_criteria: ['3.1.5'], wcag_level: 'AAA', pour: 'understandable', severity })

// The severity line the terminal prints, read back as numbers.
function terminalSeverityCounts(result: ScanResult, targetLevel: 'A' | 'AA' | 'AAA' = 'AA'): Record<Severity, number> {
  const lines: string[] = []
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.join(' '))
  })
  try {
    printResult(result, { color: false, targetLevel })
  } finally {
    spy.mockRestore()
  }
  const match = /(\d+) critical\s+\S (\d+) serious\s+\S (\d+) moderate\s+\S (\d+) minor/.exec(lines.join('\n'))
  if (!match) throw new Error('severity line not found in the terminal output')
  return { critical: Number(match[1]), serious: Number(match[2]), moderate: Number(match[3]), minor: Number(match[4]) }
}

describe('summary.by_severity counts scored findings only', () => {
  it('a best-practice-only result has zero in every severity bucket', () => {
    const issues = SEVERITIES.map(bestPractice)
    const result = computeScanResult(issues, 3, [], 100)
    expect(result.summary.by_severity).toEqual(ZERO)
    expect(result.summary.total_issues).toBe(4)
    expect(result.summary.by_scanner).toEqual({ test: 4 })
    expect(result.summary.criteria_failed).toEqual([])
  })

  it('an above-target finding is not counted; it still appears in total_issues and criteria_failed', () => {
    const result = computeScanResult([makeIssue({ severity: 'serious' }), aaa('critical')], 3, [], 100, 'AA')
    expect(result.summary.by_severity).toEqual({ ...ZERO, serious: 1 })
    expect(result.summary.total_issues).toBe(2)
    expect(result.summary.criteria_failed).toEqual(['1.1.1', '3.1.5'])
  })

  it('the same finding is counted once its level is within the target', () => {
    const result = computeScanResult([makeIssue({ severity: 'serious' }), aaa('critical')], 3, [], 100, 'AAA')
    expect(result.summary.by_severity).toEqual({ ...ZERO, serious: 1, critical: 1 })
  })

  it('a mixed result counts its WCAG findings only, at their own severity', () => {
    const issues = [
      makeIssue({ severity: 'critical' }),
      makeIssue({ severity: 'critical', wcag_criteria: ['2.4.4'], pour: 'operable' }),
      makeIssue({ severity: 'minor', wcag_criteria: ['1.4.3'], wcag_level: 'AA' }),
      ...SEVERITIES.map(bestPractice),
      aaa('serious'),
    ]
    const result = computeScanResult(issues, 3, [], 100, 'AA')
    expect(result.summary.by_severity).toEqual({ critical: 2, serious: 0, moderate: 0, minor: 1 })
    expect(result.summary.total_issues).toBe(issues.length)
  })

  it('the buckets sum to the number of scored findings, never more than total_issues', () => {
    const issues = [makeIssue(), makeIssue({ severity: 'minor' }), bestPractice('serious'), aaa('critical')]
    const { summary } = computeScanResult(issues, 3, [], 100, 'AA')
    const counted = SEVERITIES.reduce((sum, severity) => sum + summary.by_severity[severity], 0)
    expect(counted).toBe(2)
    expect(counted).toBeLessThanOrEqual(summary.total_issues)
  })
})

describe('the terminal and the JSON agree on the severity breakdown', () => {
  it('on a built result with every kind of finding, at each target level', () => {
    const issues = [
      makeIssue({ severity: 'critical' }),
      makeIssue({ severity: 'moderate', wcag_criteria: ['1.4.3'], wcag_level: 'AA' }),
      bestPractice('serious'),
      aaa('minor'),
    ]
    for (const target of ['A', 'AA', 'AAA'] as const) {
      const result = computeScanResult(issues, 3, [], 100, target)
      expect(terminalSeverityCounts(result, target)).toEqual(result.summary.by_severity)
    }
  })

  it('real pipeline: a page with a WCAG failure and a best practice', async () => {
    // An image with no alt (axe `image-alt`, WCAG 1.1.1) and a skipped heading level
    // (axe `heading-order`, a best practice with no WCAG criterion).
    const page = `<!DOCTYPE html>
<html lang="en">
  <head><title>Fixture</title></head>
  <body>
    <main>
      <h1>Fixture page</h1>
      <img src="photo.png">
      <h3>Details</h3>
    </main>
  </body>
</html>`
    const result = await scanBuffer(page, 'index.html')
    const rules = result.issues.map(issue => issue.scanner_rule_id)
    expect(rules).toContain('image-alt')
    expect(rules).toContain('heading-order')
    const counted = result.issues.filter(issue => !issue.ignored && !issue.review_only)
    const scored = counted.filter(issue => issue.wcag_criteria.length > 0)
    expect(scored.length).toBeLessThan(counted.length)
    expect(SEVERITIES.reduce((sum, severity) => sum + result.summary.by_severity[severity], 0)).toBe(scored.length)
    expect(result.summary.total_issues).toBe(counted.length)
    expect(terminalSeverityCounts(result)).toEqual(result.summary.by_severity)
  }, 30000)

  it('real pipeline: ignored and review-only findings are counted nowhere in the summary', async () => {
    // One file with every kind: counted WCAG failures, an ignored one (equall-ignore) and
    // findings static analysis cannot confirm (spread props, a link whose content is a
    // component or an expression), reported as review-only.
    const component = `export function Card(props: any) {
  return (
    <div>
      <img src="a.png" {...props} />
      {/* equall-ignore-next-line */}
      <img src="b.png" />
      <img src="c.png" />
      <button {...props}></button>
      <Link href="/x"><Icon /></Link>
      <a href="/y">{props.label}</a>
    </div>
  )
}`
    const result = await scanBuffer(component, 'Card.tsx')
    const ignored = result.issues.filter(issue => issue.ignored)
    const reviewOnly = result.issues.filter(issue => issue.review_only && !issue.ignored)
    const counted = result.issues.filter(issue => !issue.ignored && !issue.review_only)
    expect(ignored.length).toBeGreaterThan(0)
    expect(reviewOnly.length).toBeGreaterThan(0)
    expect(counted.length).toBeGreaterThan(0)

    const expected = { ...ZERO }
    for (const issue of counted) {
      if (issue.wcag_criteria.length > 0 && issue.wcag_level !== 'AAA') expected[issue.severity]++
    }
    expect(result.summary.by_severity).toEqual(expected)
    expect(result.summary.total_issues).toBe(counted.length)
    expect(result.summary.ignored_count).toBe(ignored.length)
    expect(terminalSeverityCounts(result)).toEqual(result.summary.by_severity)
  }, 30000)

  it('real pipeline: a page whose only finding is a best practice has zero in every bucket', async () => {
    const page = `<!DOCTYPE html>
<html lang="en">
  <head><title>Fixture</title></head>
  <body>
    <main>
      <h1>Fixture page</h1>
      <p>Intro</p>
      <h3>Details</h3>
    </main>
  </body>
</html>`
    const result = await scanBuffer(page, 'index.html')
    expect(result.issues.map(issue => issue.scanner_rule_id)).toEqual(['heading-order'])
    expect(result.summary.by_severity).toEqual(ZERO)
    expect(result.summary.total_issues).toBe(1)
    expect(terminalSeverityCounts(result)).toEqual(ZERO)
  }, 30000)
})
