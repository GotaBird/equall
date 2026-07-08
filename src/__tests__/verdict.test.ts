import { describe, it, expect, vi, afterEach } from 'vitest'
import { computeScanResult } from '../scoring/score.js'
import { printResult } from '../output/terminal.js'
import type { EquallIssue, WcagLevel } from '../types.js'

// BUR-159 — the honest verdict must never claim conformance, and the terminal output
// must contain none of the banned words on ANY path. These tests exercise the real
// printResult() rendering (the output path the grep-gate cares about), not internals.

function makeIssue(overrides: Partial<EquallIssue> = {}): EquallIssue {
  return {
    scanner: 'axe-core',
    scanner_rule_id: 'image-alt',
    wcag_criteria: ['1.1.1'],
    wcag_level: 'A',
    pour: 'perceivable',
    file_path: 'index.html',
    line: null,
    column: null,
    html_snippet: '<img src="a.png">',
    severity: 'critical',
    message: 'Images must have alternative text',
    help_url: null,
    suggestion: null,
    ...overrides,
  }
}

// Capture what printResult writes to stdout, with ANSI stripped so assertions read plainly.
function render(issues: EquallIssue[], exercised: string[], target: WcagLevel = 'AA'): string {
  const result = computeScanResult(issues, 5, [], 100, target, exercised, 55, exercised)
  const logs: string[] = []
  const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    logs.push(a.map(String).join(' '))
  })
  try {
    printResult(result, { targetLevel: target })
  } finally {
    spy.mockRestore()
  }
  return logs.join('\n').replace(/\x1b\[[0-9;]*m/g, '')
}

const BANNED = /meets|conformant|compliant|conformance/i

describe('honest verdict (BUR-159)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('a clean scan states the verified subset, never "None" or "Meets"', () => {
    const out = render([], ['1.1.1', '2.4.4', '1.3.1'])
    expect(out).toContain('0 A/AA failures among the 3 criteria automatically verified')
    expect(out).not.toMatch(BANNED)
    expect(out).not.toMatch(/\bNone\b/)
  })

  it('an AAA-only advisory never prints "Meets WCAG AA"', () => {
    // A single beyond-target (AAA) issue at an AA target: not a failure.
    const aaa = makeIssue({ wcag_level: 'AAA', wcag_criteria: ['3.1.5'], pour: 'understandable', scanner_rule_id: 'reading-level' })
    const out = render([aaa], ['1.1.1', '3.1.1', '2.4.4'])
    expect(out).toContain('0 A/AA failures among the 3 criteria automatically verified')
    expect(out).not.toMatch(BANNED)
  })

  it('a partial-coverage scan with a Level A failure reports the failure count honestly', () => {
    const out = render([makeIssue()], ['1.1.1', '2.4.4', '1.3.1', '3.1.1'])
    expect(out).toContain('1 A/AA failure among the 4 criteria automatically verified')
    expect(out).not.toMatch(BANNED)
  })

  it('grep gate: no banned word appears on the advisory + violations output path', () => {
    // Mixed scan: a real A failure AND a beyond-target AAA advisory — exercises both
    // the "WCAG Violations" and "Advisory" section headers in one render.
    const out = render(
      [makeIssue(), makeIssue({ wcag_level: 'AAA', wcag_criteria: ['3.1.5'], pour: 'understandable', scanner_rule_id: 'reading-level' })],
      ['1.1.1', '2.4.4', '3.1.1']
    )
    expect(out).not.toMatch(BANNED)
  })

  it('the not-evaluated count equals criteria_total minus verified', () => {
    // 3 verified out of 55 (AA total, WCAG 2.2) → 52 not evaluated.
    const out = render([], ['1.1.1', '2.4.4', '1.3.1'])
    expect(out).toContain('(52 not evaluated)')
  })
})
