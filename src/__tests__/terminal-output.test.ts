import { describe, it, expect, vi } from 'vitest'
import { printResult } from '../output/terminal.js'
import { scanBuffer } from '../scan.js'
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

// The best-practice section prints, once per rule, what the rule means and where to read
// more: the explanation the scanner attached to the rule (the text the JSON carries as
// `suggestion`) or the short built-in hint, then the rule's `help_url`.
describe('best-practice section: explanation and link', () => {
  const bestPractice = (over: Partial<EquallIssue>): EquallIssue => ({
    ...issue('x', 'minor', 'src/a.tsx'),
    wcag_criteria: [],
    wcag_level: null,
    pour: null,
    ...over,
  })
  const section = (out: string) => out.slice(out.indexOf('Best-Practice Recommendations'))
  const withIssues = (issues: EquallIssue[]): ScanResult => ({ ...fixture(), issues })

  const EXPLANATION =
    'This role repeats the implicit role of the element, so it adds nothing and can have unintended ' +
    'effects when the element changes later. Remove it, unless the list markers are removed.'

  it('prints the rule explanation from the scanner, wrapped, then the link', () => {
    const out = section(render(withIssues([
      bestPractice({
        scanner: 'eslint-jsx-a11y',
        scanner_rule_id: 'jsx-a11y/no-redundant-roles',
        suggestion: EXPLANATION,
        help_url: 'https://example.test/redundant-roles',
      }),
    ])))
    const lines = out.split('\n')
    const start = lines.findIndex((l) => l.includes('This role repeats'))
    const link = lines.findIndex((l) => l.includes('Learn more: https://example.test/redundant-roles'))
    const file = lines.findIndex((l) => l.includes('↳ src/a.tsx'))
    // Explanation, then link, then the affected files.
    expect(start).toBeGreaterThan(0)
    expect(link).toBeGreaterThan(start)
    expect(file).toBeGreaterThan(link)
    // The whole text is there, on indented lines of readable width.
    const explanation = lines.slice(start, link)
    expect(explanation.length).toBeGreaterThan(1)
    expect(explanation.map((l) => l.trim()).join(' ')).toBe(EXPLANATION)
    for (const l of explanation) {
      expect(l.startsWith('      ')).toBe(true)
      expect(l.length).toBeLessThanOrEqual(6 + 88)
    }
    // The explanation replaces the short hint; it is not printed twice.
    expect(out).not.toContain('unnecessary, remove it')
  })

  it('an axe-core rule keeps its hint (its suggestion is a per-element summary) and gains the link', () => {
    const out = section(render(withIssues([
      bestPractice({
        scanner_rule_id: 'heading-order',
        suggestion: 'Fix any of the following:\n  Heading order invalid',
        help_url: 'https://example.test/heading-order',
      }),
    ])))
    expect(out).toContain('Skipping heading levels makes content harder to navigate')
    expect(out).not.toContain('Heading order invalid')
    expect(out).toContain('Learn more: https://example.test/heading-order')
  })

  it('an axe-core rule with no hint prints its failure summary instead of a bare pointer', () => {
    const out = section(render(withIssues([
      bestPractice({
        scanner_rule_id: 'tabindex',
        suggestion: 'Fix any of the following:\n  Element has a tabindex greater than 0',
        help_url: 'https://example.test/tabindex',
      }),
    ])))
    expect(out).toContain('· Element has a tabindex greater than 0')
    expect(out).not.toContain('See the rule documentation for context.')
    expect(out).toContain('Learn more: https://example.test/tabindex')
  })

  it('a rule with neither explanation, hint nor link prints the pointer and no empty link line', () => {
    const out = section(render(withIssues([bestPractice({ scanner_rule_id: 'custom-rule' })])))
    expect(out).toContain('See the rule documentation for context.')
    expect(out).not.toContain('Learn more:')
  })

  it('prints the explanation and the link once per rule, whatever the number of files, and keeps the --all cut', () => {
    const many = Array.from({ length: 5 }, (_, n) => bestPractice({
      scanner: 'eslint-jsx-a11y',
      scanner_rule_id: 'jsx-a11y/no-redundant-roles',
      file_path: `src/c-${n + 1}.tsx`,
      suggestion: 'Short explanation.',
      help_url: 'https://example.test/redundant-roles',
    }))
    const def = section(render(withIssues(many)))
    expect(def.match(/Short explanation\./g)).toHaveLength(1)
    expect(def.match(/Learn more:/g)).toHaveLength(1)
    expect(def).toContain('↳ and 3 more files · run with --all to list them')
    const all = section(render(withIssues(many), true))
    for (let n = 1; n <= 5; n++) expect(all).toContain(`src/c-${n}.tsx`)
    expect(all.match(/Learn more:/g)).toHaveLength(1)
  })

  it('emits no ANSI escape with colors off', () => {
    const lines: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { lines.push(a.join(' ')) })
    try {
      printResult(withIssues([
        bestPractice({ scanner: 'eslint-jsx-a11y', suggestion: EXPLANATION, help_url: 'https://example.test/x' }),
        bestPractice({ scanner_rule_id: 'tabindex', suggestion: 'Fix any of the following:\n  Element has a tabindex greater than 0' }),
      ]), { color: false })
    } finally {
      spy.mockRestore()
    }
    const out = lines.join('\n')
    expect(out).toContain('Learn more: https://example.test/x')
    expect(out).not.toMatch(ANSI)
  })

  it('real pipeline: <button role="button"> prints the explanation and the W3C link', async () => {
    const out = section(render(await scanBuffer(
      `export function C() {\n  return (\n    <div>\n      <button role="button" type="button">Go</button>\n    </div>\n  )\n}\n`,
      'C.jsx'
    )))
    expect(out).toContain('jsx-a11y/no-redundant-roles')
    expect(out).toContain("This role repeats the element's implicit role")
    expect(out).toContain('Learn more: https://www.w3.org/TR/html-aria/#avoid-specifying-redundant-roles')
  }, 30000)
})

// The severity breakdown and its "fix before shipping" legend cover the scored findings
// only. A best practice never weighs on the score, so it is never counted there: it is
// listed in its own section.
describe('severity breakdown excludes best practices', () => {
  const SEVERITY_LINE = (c: number, s: number, m: number, n: number) =>
    new RegExp(`${c} critical\\s+\\S ${s} serious\\s+\\S ${m} moderate\\s+\\S ${n} minor`)

  it('real pipeline: a page whose only finding is a best practice prints zero in every severity count', async () => {
    // h1 → h3 skips a heading level: axe `heading-order`, a best practice with no WCAG criterion.
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
    const out = render(await scanBuffer(page, 'index.html'))
    expect(out).toContain('0 WCAG violations  ·  1 best-practice recommendation')
    expect(out).toMatch(SEVERITY_LINE(0, 0, 0, 0))
    // Still reported, under its own section, after the summary.
    const section = out.indexOf('Best-Practice Recommendations')
    expect(section).toBeGreaterThan(out.indexOf('fix before shipping'))
    expect(out.slice(section)).toContain('heading-order')
  }, 30000)

  it('beside WCAG findings, a serious best practice is not counted as serious', () => {
    const result = fixture()
    result.issues = [
      issue('1.1.1', 'critical', 'src/a.html'),
      issue('2.4.4', 'minor', 'src/b.html'),
      { ...issue('x', 'serious', 'src/c.html'), scanner_rule_id: 'region', wcag_criteria: [], wcag_level: null },
    ]
    const out = render(result)
    expect(out).toContain('2 WCAG violations  ·  1 best-practice recommendation')
    expect(out).toMatch(SEVERITY_LINE(1, 0, 0, 1))
    expect(out.slice(out.indexOf('Best-Practice Recommendations'))).toContain('region')
  })
})

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
