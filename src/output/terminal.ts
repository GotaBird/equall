import type { ScanResult, GladosIssue, Severity, PourPrinciple, WcagLevel } from '../types.js'

// WCAG 2.2 Level A criteria (30 total)
// Used to partition coverage and failures by level in the summary display
const WCAG_A_CRITERIA = new Set([
  '1.1.1', '1.2.1', '1.2.2', '1.2.3', '1.3.1', '1.3.2', '1.3.3', '1.4.1', '1.4.2',
  '2.1.1', '2.1.2', '2.1.4', '2.2.1', '2.2.2', '2.3.1',
  '2.4.1', '2.4.2', '2.4.3', '2.4.4', '2.5.1', '2.5.2', '2.5.3', '2.5.4',
  '3.1.1', '3.2.1', '3.2.2', '3.2.6', '3.3.1', '3.3.7',
  '4.1.2',
])
const WCAG_A_TOTAL = 30

// Best-practice rule explanations
const BP_HINTS: Record<string, string> = {
  'region': 'Landmarks help screen reader users navigate page sections',
  'landmark-main-is-top-level': 'Nested landmarks confuse assistive technology',
  'heading-order': 'Skipping heading levels makes content harder to navigate',
  'landmark-one-main': 'Pages should have exactly one main landmark',
  'landmark-unique': 'Duplicate landmarks make navigation ambiguous',
  'page-has-heading-one': 'Pages should start with a top-level heading',
  'landmark-complementary-is-top-level': 'Complementary landmarks should not be nested',
  'landmark-no-duplicate-banner': 'Multiple banner landmarks confuse screen readers',
  'landmark-no-duplicate-contentinfo': 'Multiple contentinfo landmarks confuse screen readers',
}

// ANSI color helpers (chalk-free fallback for minimal deps)
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const GREEN = '\x1b[32m'
const CYAN = '\x1b[36m'
const MAGENTA = '\x1b[35m'
const WHITE = '\x1b[37m'
const BG_RED = '\x1b[41m'
const BG_YELLOW = '\x1b[43m'
const BG_GREEN = '\x1b[42m'
const BG_CYAN = '\x1b[46m'

function scoreColor(score: number): string {
  if (score >= 80) return GREEN
  if (score >= 50) return YELLOW
  return RED
}

function scoreBg(score: number): string {
  if (score >= 80) return BG_GREEN
  if (score >= 50) return BG_YELLOW
  return BG_RED
}

function severityIcon(s: Severity): string {
  switch (s) {
    case 'critical': return `${RED}●${RESET}`
    case 'serious': return `${YELLOW}●${RESET}`
    case 'moderate': return `${CYAN}●${RESET}`
    case 'minor': return `${DIM}●${RESET}`
  }
}

function pourLabel(p: PourPrinciple): string {
  const labels: Record<PourPrinciple, string> = {
    perceivable: 'P',
    operable: 'O',
    understandable: 'U',
    robust: 'R',
  }
  return labels[p]
}

function conformanceBadge(level: string): string {
  switch (level) {
    case 'AAA': return `${BG_GREEN}${WHITE} AAA ${RESET}`
    case 'AA': return `${BG_GREEN}${WHITE} AA ${RESET}`
    case 'A': return `${BG_CYAN}${WHITE} A ${RESET}`
    case 'Partial A': return `${BG_YELLOW}${WHITE} ~A ${RESET}`
    case 'None': return `${BG_RED}${WHITE} — ${RESET}`
    default: return level
  }
}

function bar(value: number | null, width: number = 20): string {
  if (value === null) return `${DIM}${'░'.repeat(width)} n/a${RESET}`
  const filled = Math.round((value / 100) * width)
  const empty = width - filled
  const color = scoreColor(value)
  return `${color}${'█'.repeat(filled)}${DIM}${'░'.repeat(empty)}${RESET} ${color}${value}${RESET}`
}

export interface PrintOptions {
  showIgnored?: boolean
  verbose?: boolean
}

export function printResult(result: ScanResult, options: PrintOptions = {}): void {
  const { score, conformance_level, pour_scores, summary, scanners_used, duration_ms } = result

  console.log()
  console.log(`${BOLD}  ◆ EQUALL — Accessibility Score${RESET}`)
  console.log()

  // Big score display
  const color = scoreColor(score)
  console.log(`  ${scoreBg(score)}${BOLD}${WHITE}  ${score}  ${RESET}  ${conformanceBadge(conformance_level)}  ${DIM}WCAG 2.2${RESET}`)
  console.log()

  // POUR breakdown
  console.log(`  ${BOLD}POUR Breakdown${RESET}`)
  console.log(`  ${MAGENTA}P${RESET} Perceivable    ${bar(pour_scores.perceivable)}`)
  console.log(`  ${MAGENTA}O${RESET} Operable       ${bar(pour_scores.operable)}`)
  console.log(`  ${MAGENTA}U${RESET} Understandable ${bar(pour_scores.understandable)}`)
  console.log(`  ${MAGENTA}R${RESET} Robust         ${bar(pour_scores.robust)}`)
  console.log()

  // Summary stats
  console.log(`  ${BOLD}Summary${RESET}`)
  const wcagIssuesCount = result.issues.filter(i => i.wcag_criteria.length > 0).length
  const bpIssuesCount = result.issues.length - wcagIssuesCount
  console.log(`  ${summary.files_scanned} files scanned  ·  ${wcagIssuesCount} WCAG violations · ${bpIssuesCount} best-practice issues`)
  console.log(`  ${RED}${summary.by_severity.critical} critical${RESET}  ${YELLOW}${summary.by_severity.serious} serious${RESET}  ${CYAN}${summary.by_severity.moderate} moderate${RESET}  ${DIM}${summary.by_severity.minor} minor${RESET}`)
  if (summary.ignored_count > 0) {
    console.log(`  ${DIM}${summary.ignored_count} issue${summary.ignored_count > 1 ? 's' : ''} ignored via equall-ignore${RESET}`)
  }

  // Coverage line(s)
  if (result.criteria_total > 0) {
    const covered = result.criteria_covered.length
    const total = result.criteria_total

    // Classify failed criteria by level from actual issues
    const failedASet = new Set<string>()
    const failedAllSet = new Set<string>()
    for (const issue of result.issues) {
      for (const c of issue.wcag_criteria) {
        failedAllSet.add(c)
        if (WCAG_A_CRITERIA.has(c)) failedASet.add(c)
      }
    }

    const isTargetAA = total > WCAG_A_TOTAL && total <= 57
    if (isTargetAA && failedASet.size > 0) {
      // Two lines: Level A progress + Level AA progress
      const coveredA = result.criteria_covered.filter(c => WCAG_A_CRITERIA.has(c)).length
      const pctA = Math.round((coveredA / WCAG_A_TOTAL) * 100)
      const pctAA = Math.round((covered / total) * 100)
      const pad = ' '.repeat(`  Score ${score}/100  ·  `.length)
      console.log(`  ${BOLD}Score ${score}/100${RESET}  ·  ${coveredA}/${WCAG_A_TOTAL} Level A criteria checked (${pctA}%)  ·  ${RED}${failedASet.size} failed${RESET}`)
      console.log(`${pad}${covered}/${total} Level AA criteria checked (${pctAA}%)  ·  ${RED}${failedAllSet.size} failed${RESET}`)
    } else {
      // Single line
      const levelLabel = total <= WCAG_A_TOTAL ? 'Level A' : `Level AA`
      const pct = Math.round((covered / total) * 100)
      console.log(`  ${BOLD}Score ${score}/100${RESET}  ·  ${covered}/${total} ${levelLabel} criteria checked (${pct}%)  ·  ${RED}${failedAllSet.size} failed${RESET}`)
    }
  }
  console.log()

  // Contextual coaching
  printCoaching(result)
  console.log()

  // Only display non-ignored issues in terminal output
  const visibleIssues = result.issues.filter(i => !i.ignored)
  const wcagIssues = visibleIssues.filter(i => i.wcag_criteria.length > 0)
  const bpIssues = visibleIssues.filter(i => i.wcag_criteria.length === 0)

  // Top issues (WCAG Violations)
  if (wcagIssues.length > 0) {
    console.log(`  ${BOLD}WCAG Violations${RESET}`)

    const grouped = groupByCriterion(wcagIssues)
    const sorted = [...grouped.entries()]
      .sort((a, b) => b[1].weight - a[1].weight)
      .slice(0, 8) // Show top 8

    for (const [criterion, group] of sorted) {
      const topSeverity = group.issues[0].severity
      console.log(`  ${severityIcon(topSeverity)} ${BOLD}${criterion}${RESET} ${DIM}— ${group.issues.length} issue${group.issues.length > 1 ? 's' : ''}${RESET}`)
      // Show first 2 occurrences with suggestion + help_url
      for (const issue of group.issues.slice(0, 2)) {
        const location = issue.line ? `:${issue.line}` : ''
        console.log(`    ${DIM}${issue.file_path}${location}${RESET}`)
        console.log(`    ${issue.message}`)
        if (issue.suggestion) {
          console.log(`    ${GREEN}→ ${issue.suggestion}${RESET}`)
        }
        if (issue.help_url) {
          console.log(`    ${DIM}↗ ${issue.help_url}${RESET}`)
        }
      }
      if (group.issues.length > 2) {
        console.log(`    ${DIM}... and ${group.issues.length - 2} more${RESET}`)
      }
      console.log()
    }
  }

  // Best Practices
  if (bpIssues.length > 0) {
    console.log(`  ${BOLD}Best Practices${RESET}`)

    const grouped = groupByCriterion(bpIssues)
    const sorted = [...grouped.entries()]
      .sort((a, b) => b[1].weight - a[1].weight)

    for (const [criterion, group] of sorted) {
      const topSeverity = group.issues[0].severity
      const hint = BP_HINTS[criterion]
      const hintSuffix = hint ? `  ${DIM}${hint}${RESET}` : ''
      console.log(`  ${severityIcon(topSeverity)} ${BOLD}${criterion}${RESET} ${DIM}— ${group.issues.length} issue${group.issues.length > 1 ? 's' : ''}${RESET}${hintSuffix}`)

      // Show affected files: all in verbose mode, first 2 otherwise
      const maxFiles = options.verbose ? group.issues.length : 2
      const seen = new Set<string>()
      const uniqueIssues: GladosIssue[] = []
      for (const issue of group.issues) {
        if (!seen.has(issue.file_path)) {
          seen.add(issue.file_path)
          uniqueIssues.push(issue)
        }
      }

      for (const issue of uniqueIssues.slice(0, maxFiles)) {
        const location = issue.line ? `:${issue.line}` : ''
        console.log(`    ${DIM}${issue.file_path}${location}${RESET}`)
      }
      if (!options.verbose && uniqueIssues.length > 2) {
        console.log(`    ${DIM}... and ${uniqueIssues.length - 2} more (use --verbose to see all)${RESET}`)
      }
    }
    console.log()
  }

  // Ignored issues (verbose only)
  if (options.showIgnored) {
    const ignoredIssues = result.issues.filter(i => i.ignored)
    if (ignoredIssues.length > 0) {
      console.log(`  ${BOLD}Ignored${RESET}`)
      for (const issue of ignoredIssues) {
        const location = issue.line ? `:${issue.line}` : ''
        console.log(`  ${DIM}⊘${RESET} ${DIM}${issue.file_path}${location}${RESET}  ${issue.scanner_rule_id}`)
      }
      console.log()
    }
  }

  // Scanners used
  console.log(`  ${DIM}Scanners: ${scanners_used.map((s) => `${s.name}@${s.version} (${s.issues_found} issues)`).join(', ')}${RESET}`)
  console.log(`  ${DIM}Completed in ${(duration_ms / 1000).toFixed(1)}s${RESET}`)
  console.log()
}

function printCoaching(result: ScanResult): void {
  const { summary, criteria_covered, criteria_total } = result

  // Classify failed criteria by level
  const levelAFailed: string[] = []
  const levelAAFailed: string[] = []
  for (const issue of result.issues) {
    if (issue.wcag_criteria.length === 0) continue
    if (issue.wcag_level === 'A') {
      for (const c of issue.wcag_criteria) {
        if (!levelAFailed.includes(c)) levelAFailed.push(c)
      }
    } else if (issue.wcag_level === 'AA') {
      for (const c of issue.wcag_criteria) {
        if (!levelAAFailed.includes(c)) levelAAFailed.push(c)
      }
    }
  }

  const remaining = criteria_total - criteria_covered.length

  if (levelAFailed.length > 0) {
    // Level A failures
    const list = levelAFailed.sort().join(', ')
    console.log(`  ${YELLOW}ⓘ${RESET} You're failing ${BOLD}${levelAFailed.length} Level A${RESET} criteria (${list}).`)
    console.log(`    Level A is the legal minimum — it means all users can access your core content. Fix these first.`)
  } else if (levelAAFailed.length > 0) {
    // Level A passes, Level AA fails
    console.log(`  ${GREEN}ⓘ${RESET} ${BOLD}Level A passed!${RESET} You're now failing ${BOLD}${levelAAFailed.length} Level AA${RESET} criteria.`)
    console.log(`    Level AA is the recommended standard — it covers usability for assistive tech users (contrast, resize, focus visible).`)
  } else {
    // All pass
    console.log(`  ${GREEN}ⓘ${RESET} ${BOLD}All automated checks pass!${RESET} ${remaining} criteria still require manual testing or browser-based scanning.`)
  }

  if (remaining > 0) {
    console.log(`    ${DIM}${remaining} criteria can't be tested automatically — they need manual review or a real browser.${RESET}`)
  }
}

interface CriterionGroup {
  issues: GladosIssue[]
  weight: number
}

function groupByCriterion(issues: GladosIssue[]): Map<string, CriterionGroup> {
  const map = new Map<string, CriterionGroup>()
  const severityWeight: Record<Severity, number> = {
    critical: 100,
    serious: 50,
    moderate: 10,
    minor: 1,
  }

  for (const issue of issues) {
    const keys = issue.wcag_criteria.length > 0
      ? issue.wcag_criteria
      : [issue.scanner_rule_id]

    for (const key of keys) {
      if (!map.has(key)) {
        map.set(key, { issues: [], weight: 0 })
      }
      const group = map.get(key)!
      group.issues.push(issue)
      group.weight += severityWeight[issue.severity]
    }
  }

  // Sort issues within each group by severity
  for (const group of map.values()) {
    group.issues.sort((a, b) => severityWeight[b.severity] - severityWeight[a.severity])
  }

  return map
}

// JSON output for --json flag or piping to dashboard
export function printJson(result: ScanResult): void {
  console.log(JSON.stringify(result, null, 2))
}
