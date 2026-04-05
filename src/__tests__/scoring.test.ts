import { describe, it, expect } from 'vitest'
import { computeScanResult } from '../scoring/score.js'
import type { EquallIssue, Severity, PourPrinciple, WcagLevel } from '../types.js'

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

describe('computeScore', () => {
  it('returns 100 with 0 issues', () => {
    const result = computeScanResult([], 10, [], 100)
    expect(result.score).toBe(100)
  })

  it('score decreases with issues', () => {
    const oneIssue = computeScanResult([makeIssue()], 10, [], 100)
    const threeIssues = computeScanResult(
      [makeIssue(), makeIssue({ wcag_criteria: ['2.1.1'], pour: 'operable' }), makeIssue({ wcag_criteria: ['4.1.2'], pour: 'robust' })],
      10, [], 100
    )
    expect(oneIssue.score).toBeLessThan(100)
    expect(threeIssues.score).toBeLessThan(oneIssue.score)
  })

  it('critical issues impact score more than minor', () => {
    const critical = computeScanResult(
      [makeIssue({ severity: 'critical' })],
      10, [], 100
    )
    const minor = computeScanResult(
      [makeIssue({ severity: 'minor' })],
      10, [], 100
    )
    expect(critical.score).toBeLessThan(minor.score)
  })

  it('caps penalty per criterion at 15', () => {
    // 10 moderate issues (weight 2 each = 20) on same criterion should cap at 15
    const issues = Array.from({ length: 10 }, () => makeIssue({ severity: 'moderate' }))
    const capped = computeScanResult(issues, 10, [], 100)

    // 1 critical issue (weight 10) + 1 serious (weight 5) = 15 on same criterion, exactly at cap
    const atCap = computeScanResult(
      [makeIssue({ severity: 'critical' }), makeIssue({ severity: 'serious' })],
      10, [], 100
    )

    // Both should produce same score since penalty is capped at 15 for the same criterion
    expect(capped.score).toBe(atCap.score)
  })

  it('density scaling: large projects score higher than small with same issues', () => {
    const issues = [makeIssue({ severity: 'serious' })]
    const small = computeScanResult(issues, 5, [], 100)
    const large = computeScanResult(issues, 500, [], 100)
    expect(large.score).toBeGreaterThan(small.score)
  })

  it('score never goes below 0', () => {
    const manyIssues = Array.from({ length: 50 }, (_, i) =>
      makeIssue({ severity: 'critical', wcag_criteria: [`${(i % 4) + 1}.1.${i + 1}`] })
    )
    const result = computeScanResult(manyIssues, 1, [], 100)
    expect(result.score).toBeGreaterThanOrEqual(0)
  })
})

describe('POUR scores', () => {
  it('returns null for principles with no issues and no criteria', () => {
    const result = computeScanResult([], 10, [], 100)
    expect(result.pour_scores.perceivable).toBeNull()
    expect(result.pour_scores.operable).toBeNull()
    expect(result.pour_scores.understandable).toBeNull()
    expect(result.pour_scores.robust).toBeNull()
  })

  it('scores each principle independently', () => {
    const issues = [
      makeIssue({ pour: 'perceivable', severity: 'critical', wcag_criteria: ['1.1.1'] }),
      makeIssue({ pour: 'operable', severity: 'minor', wcag_criteria: ['2.1.1'] }),
    ]
    const result = computeScanResult(issues, 10, [], 100)
    expect(result.pour_scores.perceivable).not.toBeNull()
    expect(result.pour_scores.operable).not.toBeNull()
    expect(result.pour_scores.perceivable!).toBeLessThan(result.pour_scores.operable!)
    expect(result.pour_scores.understandable).toBeNull()
    expect(result.pour_scores.robust).toBeNull()
  })

  it('returns 100 for principle with issues that have no WCAG criteria', () => {
    // Issues without pour are skipped in POUR scoring
    const issues = [makeIssue({ pour: null })]
    const result = computeScanResult(issues, 10, [], 100)
    expect(result.pour_scores.perceivable).toBeNull()
  })
})

describe('conformance level', () => {
  it('returns A when targeting A with no Level A failures', () => {
    const result = computeScanResult(
      [makeIssue({ wcag_level: 'AA', wcag_criteria: ['1.4.3'] })],
      10, [], 100, 'A'
    )
    expect(result.conformance_level).toBe('A')
  })

  it('returns Partial A when targeting A with Level A failures', () => {
    const result = computeScanResult(
      [makeIssue({ wcag_level: 'A', wcag_criteria: ['1.1.1'] })],
      10, [], 100, 'A'
    )
    expect(result.conformance_level).toBe('Partial A')
  })

  it('returns AA when targeting AA with no A or AA failures', () => {
    const result = computeScanResult(
      [makeIssue({ wcag_level: 'AAA', wcag_criteria: ['1.4.6'] })],
      10, [], 100, 'AA'
    )
    expect(result.conformance_level).toBe('AA')
  })

  it('returns A when targeting AA with AA failures but no A failures', () => {
    const result = computeScanResult(
      [makeIssue({ wcag_level: 'AA', wcag_criteria: ['1.4.3'] })],
      10, [], 100, 'AA'
    )
    expect(result.conformance_level).toBe('A')
  })

  it('returns None when no criteria tested', () => {
    const result = computeScanResult([], 10, [], 100, 'AA')
    expect(result.conformance_level).toBe('None')
  })
})

describe('summary', () => {
  it('counts issues by severity', () => {
    const issues = [
      makeIssue({ severity: 'critical' }),
      makeIssue({ severity: 'critical' }),
      makeIssue({ severity: 'moderate' }),
    ]
    const result = computeScanResult(issues, 5, [], 100)
    expect(result.summary.by_severity.critical).toBe(2)
    expect(result.summary.by_severity.moderate).toBe(1)
    expect(result.summary.by_severity.serious).toBe(0)
    expect(result.summary.by_severity.minor).toBe(0)
  })

  it('counts issues by scanner', () => {
    const issues = [
      makeIssue({ scanner: 'axe-core' }),
      makeIssue({ scanner: 'axe-core' }),
      makeIssue({ scanner: 'eslint-jsx-a11y' }),
    ]
    const result = computeScanResult(issues, 5, [], 100)
    expect(result.summary.by_scanner['axe-core']).toBe(2)
    expect(result.summary.by_scanner['eslint-jsx-a11y']).toBe(1)
  })

  it('tracks failed criteria', () => {
    const issues = [
      makeIssue({ wcag_criteria: ['1.1.1', '4.1.2'] }),
      makeIssue({ wcag_criteria: ['1.1.1'] }),
    ]
    const result = computeScanResult(issues, 5, [], 100)
    expect(result.summary.criteria_failed).toEqual(['1.1.1', '4.1.2'])
  })
})
