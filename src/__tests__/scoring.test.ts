import { describe, it, expect } from 'vitest'
import { computeScanResult, isBeyondTarget } from '../scoring/score.js'
import { runScan } from '../scan.js'
import type { EquallIssue, WcagLevel } from '../types.js'

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

  it('fix-sensitivity: resolving one issue in a saturated criterion strictly raises the score', () => {
    // Model 1 capped per-criterion penalty at 15, so fixing 1 of 30 identical
    // failures moved nothing. Model 2 must credit every single fix.
    const thirty = Array.from({ length: 30 }, () => makeIssue({ severity: 'critical' }))
    const twentyNine = thirty.slice(0, 29)
    const five = thirty.slice(0, 5)
    const s30 = computeScanResult(thirty, 10, [], 100).score
    const s29 = computeScanResult(twentyNine, 10, [], 100).score
    const s5 = computeScanResult(five, 10, [], 100).score
    expect(s29).toBeGreaterThan(s30)
    expect(s5).toBeGreaterThan(s29)
  })

  it('severity-proportional fix credit: fixing a critical moves more than fixing a minor in the same criterion', () => {
    const group = [
      makeIssue({ severity: 'critical' }),
      makeIssue({ severity: 'critical' }),
      makeIssue({ severity: 'minor' }),
    ]
    const base = computeScanResult(group, 10, [], 100).score
    const minorFixed = computeScanResult(group.slice(0, 2), 10, [], 100).score
    const criticalFixed = computeScanResult(
      [makeIssue({ severity: 'critical' }), makeIssue({ severity: 'minor' })],
      10, [], 100
    ).score
    expect(minorFixed).toBeGreaterThan(base)
    expect(criticalFixed).toBeGreaterThan(minorFixed)
  })

  it('rank damping: repetition on one criterion penalizes less than the same issues spread across criteria', () => {
    const repeated = Array.from({ length: 5 }, () => makeIssue({ severity: 'serious' }))
    const spread = Array.from({ length: 5 }, (_, i) =>
      makeIssue({ severity: 'serious', wcag_criteria: [`1.${i + 1}.1`] })
    )
    const rep = computeScanResult(repeated, 10, [], 100).score
    const spr = computeScanResult(spread, 10, [], 100).score
    expect(rep).toBeGreaterThan(spr)
  })

  it('padding-resistance: the file count never moves the score (file-split / empty-file injection)', () => {
    // Model 1 divided the penalty by a log of filesScanned, so adding clean
    // files raised the score. Model 2's score is a function of the issue
    // multiset only — identical for 1, 5, 500 files.
    const issues = [makeIssue({ severity: 'serious' }), makeIssue({ severity: 'moderate', wcag_criteria: ['2.4.4'] })]
    const one = computeScanResult(issues, 1, [], 100).score
    const five = computeScanResult(issues, 5, [], 100).score
    const many = computeScanResult(issues, 500, [], 100).score
    expect(five).toBe(one)
    expect(many).toBe(one)
  })

  it('mono-file fairness: a single-file scan is not structurally penalized', () => {
    // The scanBuffer/MCP path scans one buffer: same issues, same score as
    // the identical issue set inside a large repo.
    const issues = [makeIssue({ severity: 'critical' })]
    const solo = computeScanResult(issues, 1, [], 100).score
    const inRepo = computeScanResult(issues, 100, [], 100).score
    expect(solo).toBe(inRepo)
  })

  it('unmapped best-practice rules damp per rule, not against each other', () => {
    const ruleA = Array.from({ length: 3 }, () =>
      makeIssue({ wcag_criteria: [], wcag_level: null as unknown as WcagLevel, scanner_rule_id: 'rule-a' })
    )
    const ruleB = [makeIssue({ wcag_criteria: [], wcag_level: null as unknown as WcagLevel, scanner_rule_id: 'rule-b' })]
    const together = computeScanResult([...ruleA, ...ruleB], 10, [], 100).score
    const aOnly = computeScanResult(ruleA, 10, [], 100).score
    // Adding a distinct rule's issue must penalize at full weight (rank 1 of
    // its own key), i.e. strictly lower the score below the rule-a-only score.
    expect(together).toBeLessThan(aOnly)
  })

  it('score never goes below 0', () => {
    const manyIssues = Array.from({ length: 50 }, (_, i) =>
      makeIssue({ severity: 'critical', wcag_criteria: [`${(i % 4) + 1}.1.${i + 1}`] })
    )
    const result = computeScanResult(manyIssues, 1, [], 100)
    expect(result.score).toBeGreaterThanOrEqual(0)
  })
})

describe('scoring gaming (integration, real pipeline)', () => {
  const BAD_PAGE = (extraImgs: number) => `<!DOCTYPE html>
<html lang="en">
  <head><title>Fixture</title></head>
  <body>
    <main>
      <h1>Fixture page</h1>
      <img src="hero.jpg">
      ${Array.from({ length: extraImgs }, (_, i) => `<img src="p${i}.jpg" alt="ok ${i}">`).join('\n      ')}
    </main>
  </body>
</html>`

  // A component that provably yields zero issues — verified by the clean-case
  // assertion below before the padding comparisons rely on it.
  const CLEAN_PAD = (i: number) => `export function Pad${i}() {
  return (
    <div>
      <p>Static content block ${i}.</p>
    </div>
  )
}
`

  it('the clean padding fixture really is inert (guards the padding tests)', async () => {
    const clean = await runScan({ files: [{ path: 'Pad0.tsx', content: CLEAN_PAD(0) }] })
    expect(clean.issues.filter(i => !i.ignored)).toHaveLength(0)
  }, 30000)

  it('identical-element padding: adding clean elements to a failing page never raises the score', async () => {
    const bare = await runScan({ files: [{ path: 'page.html', content: BAD_PAGE(0) }] })
    const padded = await runScan({ files: [{ path: 'page.html', content: BAD_PAGE(20) }] })
    expect(bare.score).toBeLessThan(100)
    expect(padded.score).toBeLessThanOrEqual(bare.score)
  }, 30000)

  it('empty-file injection: adding clean files to a failing scan never raises the score', async () => {
    const bad = { path: 'page.html', content: BAD_PAGE(0) }
    const bare = await runScan({ files: [bad] })
    const padded = await runScan({
      files: [bad, ...Array.from({ length: 20 }, (_, i) => ({ path: `Pad${i}.tsx`, content: CLEAN_PAD(i) }))],
    })
    expect(bare.score).toBeLessThan(100)
    expect(padded.score).toBe(bare.score)
  }, 60000)
})

describe('conformance level', () => {
  it('returns A when targeting A with no Level A failures', () => {
    // criteria_tested is now the exercised set: a non-empty exercised set
    // means criteria WERE evaluated, so 0 Level A failures → 'A' (not 'None').
    const result = computeScanResult(
      [makeIssue({ wcag_level: 'AA', wcag_criteria: ['1.4.3'] })],
      10, [], 100, 'A', [], 0, ['1.1.1']
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
      10, [], 100, 'AA', [], 0, ['1.1.1']
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

describe('beyond-target (AAA) exclusion from conformance', () => {
  it('isBeyondTarget: AAA is beyond AA but not beyond AAA', () => {
    const aaa = makeIssue({ wcag_level: 'AAA', wcag_criteria: ['3.1.5'] })
    expect(isBeyondTarget(aaa, 'AA')).toBe(true)
    expect(isBeyondTarget(aaa, 'A')).toBe(true)
    expect(isBeyondTarget(aaa, 'AAA')).toBe(false)
  })

  it('isBeyondTarget: an issue without a level is always in scope', () => {
    const bp = makeIssue({ wcag_level: null as unknown as WcagLevel, wcag_criteria: [] })
    expect(isBeyondTarget(bp, 'A')).toBe(false)
  })

  it('a AAA reading-level issue does not penalize the score at an AA target', () => {
    const aaaOnly = computeScanResult(
      [makeIssue({ wcag_level: 'AAA', wcag_criteria: ['3.1.5'], pour: 'understandable', severity: 'critical' })],
      4, [], 100, 'AA'
    )
    expect(aaaOnly.score).toBe(100)
  })

  it('the same AAA issue DOES penalize when the target is AAA', () => {
    const atAAA = computeScanResult(
      [makeIssue({ wcag_level: 'AAA', wcag_criteria: ['3.1.5'], pour: 'understandable', severity: 'critical' })],
      4, [], 100, 'AAA'
    )
    expect(atAAA.score).toBeLessThan(100)
  })

  it('AAA criteria do not lower the score beside real Level A failures (AA target)', () => {
    const aIssue = makeIssue({ wcag_level: 'A', wcag_criteria: ['2.4.4'], pour: 'operable', severity: 'serious' })
    const aOnly = computeScanResult([aIssue], 4, [], 100, 'AA')
    const aPlusAaa = computeScanResult(
      [aIssue, makeIssue({ wcag_level: 'AAA', wcag_criteria: ['3.1.5'], pour: 'understandable', severity: 'critical' })],
      4, [], 100, 'AA'
    )
    expect(aPlusAaa.score).toBe(aOnly.score)
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
