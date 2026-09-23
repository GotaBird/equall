import { describe, it, expect, vi } from 'vitest'
import { printResult } from '../output/terminal.js'
import type { EquallIssue, ScanResult, Severity } from '../types.js'

// Terminal truncation: the default output caps WCAG Violations at 8 criteria and
// 2 occurrences per criterion; `--all` lifts both. Any cut must be announced with a
// notice naming `--all` — never a silent truncation.

const ANSI = /\x1b\[[0-9;]*m/g

function issue(criterion: string, severity: Severity, file: string): EquallIssue {
  return {
    scanner: 'axe-core',
    scanner_rule_id: `rule-${criterion}`,
    wcag_criteria: [criterion],
    wcag_level: 'A',
    pour: 'perceivable',
    file_path: file,
    line: 1,
    column: null,
    html_snippet: null,
    severity,
    message: `Violation of ${criterion}`,
    help_url: null,
    suggestion: null,
  }
}

// 1.1.1 carries 12 critical occurrences; eight more criteria carry one critical each,
// and 2.4.2 carries one serious — ranked 10th, below the default top-8 cut.
const CRITICAL_ONE_EACH = ['1.3.1', '2.1.1', '2.4.4', '3.1.1', '4.1.2', '1.2.1', '2.2.1', '2.4.1']

function fixture(): ScanResult {
  const issues: EquallIssue[] = [
    ...Array.from({ length: 12 }, (_, n) => issue('1.1.1', 'critical', `src/page-${n + 1}.html`)),
    ...CRITICAL_ONE_EACH.map(c => issue(c, 'critical', `src/${c}.html`)),
    issue('2.4.2', 'serious', 'src/serious.html'),
  ]
  return {
    score: 42,
    conformance_level: 'None',
    issues,
    summary: {
      files_scanned: 21,
      total_issues: issues.length,
      by_severity: { critical: 20, serious: 1, moderate: 0, minor: 0 },
      by_scanner: { 'axe-core': issues.length },
      criteria_tested: [],
      criteria_failed: [],
      ignored_count: 0,
    },
    scanners_used: [],
    criteria_covered: [],
    criteria_total: 55,
    scanned_at: '2026-01-01T00:00:00.000Z',
    duration_ms: 0,
  }
}

function render(result: ScanResult, all?: boolean): string {
  const lines: string[] = []
  const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { lines.push(a.join(' ')) })
  try {
    printResult(result, { all })
  } finally {
    spy.mockRestore()
  }
  return lines.join('\n').replace(ANSI, '')
}

describe('terminal truncation (--all)', () => {
  it('default: shows 2 of 12 occurrences and announces the cut with --all', () => {
    const out = render(fixture())
    expect(out).toContain('WCAG 1.1.1')
    expect(out).toContain('(12 occurrences)')
    expect(out).toContain('src/page-1.html')
    expect(out).toContain('src/page-2.html')
    expect(out).not.toContain('src/page-3.html')
    expect(out).toContain('↳ and 10 more occurrences of the same issue · run with --all to list them')
  })

  it('default: criteria past the top 8 are announced, with their serious count', () => {
    const out = render(fixture())
    // 2.4.2 (serious) ranks below the cut — named by count, never dropped silently.
    expect(out).not.toContain('WCAG 2.4.2')
    expect(out).toContain('↳ 2 more WCAG criteria not shown (2 occurrences, incl. 1 critical, 1 serious) · run with --all to list every criterion')
  })

  it('--all: lists every occurrence and every criterion, with no truncation notice', () => {
    const out = render(fixture(), true)
    for (let n = 1; n <= 12; n++) expect(out).toContain(`src/page-${n}.html`)
    expect(out).toContain('WCAG 2.4.2')
    expect(out).toContain('src/serious.html')
    for (const c of CRITICAL_ONE_EACH) expect(out).toContain(`WCAG ${c}`)
    expect(out).not.toContain('run with --all')
  })

  it('--all also lifts the best-practice file list, and the cut names --all (not --verbose)', () => {
    const result = fixture()
    for (let n = 1; n <= 5; n++) {
      result.issues.push({ ...issue('x', 'moderate', `src/bp-${n}.html`), scanner_rule_id: 'region', wcag_criteria: [], wcag_level: null })
    }
    const def = render(result)
    expect(def).toContain('↳ and 3 more files · run with --all to list them')
    expect(def).not.toContain('--verbose to list all')
    const all = render(result, true)
    for (let n = 1; n <= 5; n++) expect(all).toContain(`src/bp-${n}.html`)
    expect(all).not.toContain('more files')
  })

  it('never mutates the result — the --json payload is unaffected by --all', () => {
    const result = fixture()
    const before = JSON.stringify(result)
    render(result, true)
    render(result)
    expect(JSON.stringify(result)).toBe(before)
  })
})
