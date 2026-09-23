import { describe, it, expect, vi } from 'vitest'
import { printResult, type PrintOptions } from '../output/terminal.js'
import type { EquallIssue, ScanResult, Severity, WcagLevel } from '../types.js'

// Byte-level guard on the rendered terminal report: every section, every flag
// combination, ANSI codes included. A refactor of printResult must leave these
// snapshots untouched; a deliberate output change updates them in the same commit.

function issue(
  criterion: string | null,
  severity: Severity,
  file: string,
  over: Partial<EquallIssue> = {},
): EquallIssue {
  return {
    scanner: 'axe-core',
    scanner_rule_id: criterion ? `rule-${criterion}` : 'region',
    wcag_criteria: criterion ? [criterion] : [],
    wcag_level: criterion ? 'A' : null,
    pour: criterion ? 'perceivable' : null,
    file_path: file,
    line: 3,
    column: 5,
    html_snippet: null,
    severity,
    message: `Violation of ${criterion ?? 'best practice'} (rule-x) Learn more: https://example.test/x`,
    help_url: 'https://example.test/help',
    suggestion: null,
    ...over,
  }
}

function richFixture(): ScanResult {
  const issues: EquallIssue[] = [
    // One criterion with more occurrences than the default cap, incl. a duplicate occurrence.
    ...Array.from({ length: 4 }, (_, n) => issue('1.1.1', 'critical', `src/img-${n + 1}.tsx`, {
      suggestion: 'Fix any of the following:\n  Element does not have an alt attribute\n  aria-label attribute does not exist or is empty',
    })),
    issue('1.1.1', 'critical', 'src/img-1.tsx', {
      suggestion: 'Fix any of the following:\n  Element does not have an alt attribute',
    }),
    // More criteria than the default top 8, with a serious one ranked below the cut.
    ...['1.3.1', '2.1.1', '2.4.4', '3.1.1', '4.1.2', '1.2.1', '2.2.1', '2.4.1'].map(c =>
      issue(c, 'critical', `src/${c}.tsx`, { suggestion: 'Add a label to the control' }),
    ),
    issue('2.4.2', 'serious', 'src/title.tsx', { line: null, column: null }),
    issue('3.3.2', 'moderate', 'src/form.tsx'),
    // Advisory: AAA criterion under an AA target.
    ...Array.from({ length: 3 }, (_, n) => issue('3.1.5', 'minor', `content/page-${n + 1}.md`, {
      scanner: 'readability', scanner_rule_id: 'reading-level', wcag_level: 'AAA' as WcagLevel,
    })),
    // Best practices: one known hint with more files than the cap, one unknown rule.
    ...Array.from({ length: 4 }, (_, n) => issue(null, 'moderate', `src/layout-${n + 1}.tsx`)),
    issue(null, 'minor', 'src/misc.tsx', { scanner_rule_id: 'custom-rule' }),
    // Ignored issue (shown only with --show-ignored).
    issue('1.4.1', 'serious', 'src/ignored.tsx', { ignored: true, scanner_rule_id: 'link-in-text-block' }),
  ]
  return {
    score: 57.31,
    conformance_level: 'None',
    issues,
    summary: {
      files_scanned: 24,
      total_issues: issues.length,
      by_severity: { critical: 13, serious: 2, moderate: 5, minor: 4 },
      by_scanner: { 'axe-core': issues.length - 3, readability: 3 },
      criteria_tested: ['1.1.1', '1.3.1', '2.1.1', '2.4.2', '4.1.2'],
      criteria_failed: ['1.1.1', '1.3.1'],
      ignored_count: 1,
    },
    scanners_used: [
      { name: 'axe-core', version: '4.10.0', rules_count: 90, issues_found: 20 },
      { name: 'readability', version: '1.0.0', rules_count: 1, issues_found: 3 },
    ],
    criteria_covered: ['1.1.1', '1.3.1', '2.1.1', '2.4.2', '4.1.2'],
    criteria_total: 55,
    coverage: {
      criteria: [],
      counts: { auto: 5, partial: 1, manual: 2 },
      auto_criteria: ['1.1.1', '1.3.1', '2.1.1', '2.4.2', '4.1.2'],
      reclassified: [
        { rule_id: 'region', scanner: 'axe-core', reason: 'page-level', count: 5, wcag_criteria: [],
          files: ['src/a.tsx', 'src/b.tsx', 'src/c.tsx', 'src/d.tsx', 'src/e.tsx'] },
        { rule_id: 'bypass', scanner: 'axe-core', reason: 'page-level', count: 1, wcag_criteria: ['2.4.1'],
          files: ['src/page.tsx'] },
      ],
    },
    criterion_conformance: [
      { criterion: '1.1.1', level: 'A', name: 'Non-text Content', verdict: 'fail', evidence: ['abc'] },
      { criterion: '1.3.1', level: 'A', name: 'Info and Relationships', verdict: 'pass_automated' },
      { criterion: '1.4.3', level: 'AA', name: 'Contrast (Minimum)', verdict: 'not_tested_assisted', reason: 'contrast' },
      { criterion: '2.4.1', level: 'A', name: 'Bypass Blocks', verdict: 'not_verifiable_on_this_scan', reason: 'page' },
      { criterion: '2.1.2', level: 'A', name: 'No Keyboard Trap', verdict: 'not_tested_manual', reason: 'manual' },
    ],
    standard: 'wcag22',
    confidence_flags: [
      { criterion: '1.1.1', signal: 'filename_as_alt', value: 'DSC00423.jpg', file_path: 'src/gallery.tsx',
        line: 12, reason: 'looks like a filename', confidence: 'low' },
      { criterion: '1.1.1', signal: 'generic', value: 'x'.repeat(90), file_path: 'src/hero.tsx',
        reason: 'generic placeholder', confidence: 'low' },
    ],
    routes: [
      { pattern: '/', file: 'app/page.tsx', framework: 'next-app', dynamic: false },
      { pattern: '/blog/[slug]', file: 'app/blog/[slug]/page.tsx', framework: 'next-app', dynamic: true },
      { pattern: '/legal', file: 'public/legal.html', framework: 'html', dynamic: false },
    ],
    scanned_at: '2026-01-01T00:00:00.000Z',
    duration_ms: 1234,
  }
}

function render(result: ScanResult, options: PrintOptions): string {
  const lines: string[] = []
  const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { lines.push(a.join(' ')) })
  try {
    printResult(result, options)
  } finally {
    spy.mockRestore()
  }
  return lines.join('\n')
}

const FLAG_SETS: Record<string, PrintOptions> = {
  default: {},
  all: { all: true },
  verbose: { verbose: true },
  'show-manual': { showManual: true },
  'show-ignored': { showIgnored: true },
  'everything + wcag21 + A target': { all: true, verbose: true, showManual: true, showIgnored: true, standard: 'wcag21', targetLevel: 'A' },
}

describe('terminal report snapshot', () => {
  for (const [name, options] of Object.entries(FLAG_SETS)) {
    it(`renders byte-identically: ${name}`, () => {
      expect(render(richFixture(), options)).toMatchSnapshot()
    })
  }

  it('renders byte-identically: clean scan (no issues, no conformance)', () => {
    const clean = richFixture()
    clean.issues = []
    clean.coverage = { ...clean.coverage!, reclassified: [] }
    clean.confidence_flags = []
    clean.criterion_conformance = undefined
    clean.routes = []
    clean.summary = { ...clean.summary, ignored_count: 0 }
    expect(render(clean, {})).toMatchSnapshot()
  })
})
