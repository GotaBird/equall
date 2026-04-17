import type { ScanResult, EquallIssue, Severity, WcagLevel } from '../types.js'
import { getCriteriaForLevel, getCriterion } from '../wcag-catalog.js'

// WCAG 2.2 Level A criteria (32 total, 4.1.1 Parsing excluded — obsolete in 2.2)
// Used to partition coverage and failures by level in the summary display
const WCAG_A_CRITERIA = new Set([
  '1.1.1', '1.2.1', '1.2.2', '1.2.3', '1.3.1', '1.3.2', '1.3.3', '1.4.1', '1.4.2',
  '2.1.1', '2.1.2', '2.1.4', '2.2.1', '2.2.2', '2.3.1',
  '2.4.1', '2.4.2', '2.4.3', '2.4.4', '2.5.1', '2.5.2', '2.5.3', '2.5.4', '2.5.6',
  '3.1.1', '3.2.1', '3.2.2', '3.2.6', '3.3.1', '3.3.2', '3.3.7',
  '4.1.2',
])
const WCAG_A_TOTAL = 32

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
// Use bright black (\x1b[90m) rather than the DIM attribute (\x1b[2m) —
// DIM renders inconsistently and near-invisible on many terminals
const GRAY = '\x1b[90m'
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
  // Distinct shapes + colors so scan-readers don't rely on color alone
  switch (s) {
    case 'critical': return `${RED}${BOLD}■${RESET}`
    case 'serious': return `${YELLOW}${BOLD}▲${RESET}`
    case 'moderate': return `${CYAN}●${RESET}`
    case 'minor': return `${GRAY}○${RESET}`
  }
}

function severityLabel(s: Severity): string {
  switch (s) {
    case 'critical': return `${RED}${BOLD}CRITICAL${RESET}`
    case 'serious': return `${YELLOW}${BOLD}SERIOUS${RESET}`
    case 'moderate': return `${CYAN}MODERATE${RESET}`
    case 'minor': return `${GRAY}MINOR${RESET}`
  }
}

// Plain-language resolver for WCAG criterion IDs (e.g. 1.1.1 → "Non-text Content")
function criterionName(id: string): string | null {
  const c = getCriterion(id)
  return c ? c.name : null
}

// Clean up scanner-emitted messages: strip trailing rule IDs in parens,
// inline "Learn more:" URLs, and collapse whitespace so the terminal line stays tidy.
function cleanMessage(message: string): string {
  let m = message
  // Drop "Learn more: https://..." fragments — we already render help_url below
  m = m.replace(/\s*Learn more:\s*https?:\/\/\S+/gi, '')
  // Drop trailing "(scanner-rule/id)" parenthetical — we render it separately
  m = m.replace(/\s*\([a-z0-9][a-z0-9\-\/]*\)\s*$/i, '')
  return m.trim()
}

// Axe's failureSummary is a multi-line blob like:
//   "Fix any of the following:\n  Element does not have an alt attribute\n  ..."
// We turn it into a clean bullet list indented under the issue.
function formatSuggestion(raw: string, indent: string): string[] {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length === 0) return []

  // Detect axe-style "Fix any of the following:" / "Fix all of the following:" headers
  const isHeader = (s: string) => /^(fix (any|all) of the following|and fix the following)/i.test(s)
  const out: string[] = []
  let mode: 'any' | 'all' | 'none' = 'none'

  for (const line of lines) {
    if (isHeader(line)) {
      mode = /fix any/i.test(line) ? 'any' : 'all'
      const label = mode === 'any' ? 'Do any one of these:' : 'Do all of these:'
      out.push(`${indent}${GREEN}How to fix${RESET} ${GRAY}(${label})${RESET}`)
    } else {
      out.push(`${indent}  ${GREEN}·${RESET} ${line}`)
    }
  }

  // If no header was recognised, render as a single-line coaching tip
  if (mode === 'none') {
    return [`${indent}${GREEN}→ ${lines.join(' ')}${RESET}`]
  }
  return out
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

// One-line plain-language explainer for the conformance badge.
// Shown right under the score so newcomers understand what "~A" or "AA" means.
function describeConformance(level: string): string {
  switch (level) {
    case 'AAA': return 'Meets WCAG AAA — the highest level of automated conformance.'
    case 'AA': return 'Meets WCAG AA — the standard most regulations require.'
    case 'A': return 'Meets WCAG A — the legal minimum. Aim for AA next.'
    case 'Partial A': return 'Not yet conformant. Some Level A criteria are failing (legal minimum).'
    case 'None': return 'Conformance level could not be determined from this scan.'
    default: return ''
  }
}

function bar(value: number | null, width: number = 20): string {
  if (value === null) return `${GRAY}${'░'.repeat(width)} n/a${RESET}`
  const filled = Math.round((value / 100) * width)
  const empty = width - filled
  const color = scoreColor(value)
  return `${color}${'█'.repeat(filled)}${GRAY}${'░'.repeat(empty)}${RESET} ${color}${value}${RESET}`
}

export interface PrintOptions {
  showIgnored?: boolean
  verbose?: boolean
  showManual?: boolean
  targetLevel?: WcagLevel
}

export function printResult(result: ScanResult, options: PrintOptions = {}): void {
  const { score, conformance_level, pour_scores, summary, scanners_used, duration_ms } = result

  console.log()
  console.log(`${BOLD}  ◆ EQUALL — Accessibility Score${RESET}`)
  console.log()

  // Big score display with plain-language conformance explainer
  const conformanceExplainer = describeConformance(conformance_level)
  console.log(`  ${scoreBg(score)}${BOLD}${WHITE}  ${score}  ${RESET}  ${conformanceBadge(conformance_level)}  ${GRAY}WCAG 2.2${RESET}`)
  console.log(`  ${GRAY}${conformanceExplainer}${RESET}`)
  console.log()

  // Summary stats
  console.log(`  ${BOLD}Summary${RESET}`)
  const wcagIssuesCount = result.issues.filter(i => i.wcag_criteria.length > 0).length
  const bpIssuesCount = result.issues.length - wcagIssuesCount
  console.log(`  ${summary.files_scanned} file${summary.files_scanned === 1 ? '' : 's'} scanned  ·  ${BOLD}${wcagIssuesCount}${RESET} WCAG violation${wcagIssuesCount === 1 ? '' : 's'}  ·  ${GRAY}${bpIssuesCount} best-practice recommendation${bpIssuesCount === 1 ? '' : 's'}${RESET}`)

  // Severity breakdown with a one-line legend so "critical/serious/moderate/minor" isn't just a color soup
  console.log(
    `  ${severityIcon('critical')} ${RED}${summary.by_severity.critical} critical${RESET}   ` +
    `${severityIcon('serious')} ${YELLOW}${summary.by_severity.serious} serious${RESET}   ` +
    `${severityIcon('moderate')} ${CYAN}${summary.by_severity.moderate} moderate${RESET}   ` +
    `${severityIcon('minor')} ${GRAY}${summary.by_severity.minor} minor${RESET}`
  )
  console.log(`  ${GRAY}critical/serious = fix before shipping · moderate/minor = fix in next iteration${RESET}`)
  if (summary.ignored_count > 0) {
    console.log(`  ${GRAY}${summary.ignored_count} issue${summary.ignored_count > 1 ? 's' : ''} suppressed via equall-ignore${RESET}`)
  }

  // Coverage line(s) — "X/Y criteria checked" makes coverage transparent.
  // Score is already shown in the header, so we don't repeat it here.
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
      console.log(`  ${BOLD}Coverage${RESET}  Level A   ${coveredA}/${WCAG_A_TOTAL} checked (${pctA}%)  ·  ${RED}${failedASet.size} failing${RESET}`)
      console.log(`            Level AA  ${covered}/${total} checked (${pctAA}%)  ·  ${RED}${failedAllSet.size} failing${RESET}`)
    } else {
      // Single line
      const levelLabel = total <= WCAG_A_TOTAL ? 'Level A' : 'Level AA'
      const pct = Math.round((covered / total) * 100)
      console.log(`  ${BOLD}Coverage${RESET}  ${levelLabel}  ${covered}/${total} checked (${pct}%)  ·  ${RED}${failedAllSet.size} failing${RESET}`)
    }
  }
  console.log()

  // POUR breakdown
  console.log(`  ${BOLD}POUR Breakdown${RESET}`)
  console.log(`  ${MAGENTA}P${RESET} Perceivable    ${bar(pour_scores.perceivable)}`)
  console.log(`  ${MAGENTA}O${RESET} Operable       ${bar(pour_scores.operable)}`)
  console.log(`  ${MAGENTA}U${RESET} Understandable ${bar(pour_scores.understandable)}`)
  console.log(`  ${MAGENTA}R${RESET} Robust         ${bar(pour_scores.robust)}`)
  console.log()

  // Contextual coaching
  printCoaching(result)
  console.log()

  // Only display non-ignored issues in terminal output
  const visibleIssues = result.issues.filter(i => !i.ignored)
  const wcagIssues = visibleIssues.filter(i => i.wcag_criteria.length > 0)
  const bpIssues = visibleIssues.filter(i => i.wcag_criteria.length === 0)

  // Top issues (WCAG Violations) — these count against conformance
  if (wcagIssues.length > 0) {
    console.log(`  ${BOLD}WCAG Violations${RESET} ${GRAY}— must fix to reach conformance${RESET}`)
    console.log()

    const grouped = groupByCriterion(wcagIssues)
    const sorted = [...grouped.entries()]
      .sort((a, b) => b[1].weight - a[1].weight)
      .slice(0, 8) // Show top 8

    for (const [criterion, group] of sorted) {
      const topSeverity = group.issues[0].severity
      const name = criterionName(criterion)
      const levelSuffix = group.issues[0].wcag_level ? ` ${GRAY}Level ${group.issues[0].wcag_level}${RESET}` : ''
      const nameSuffix = name ? ` ${BOLD}${name}${RESET}` : ''
      const count = group.issues.length
      // Header: severity icon · criterion ID · plain-language name · level · issue count
      console.log(
        `  ${severityIcon(topSeverity)} ${severityLabel(topSeverity)}  ` +
        `${BOLD}WCAG ${criterion}${RESET}${nameSuffix}${levelSuffix}  ` +
        `${GRAY}(${count} occurrence${count > 1 ? 's' : ''})${RESET}`
      )

      // Collapse duplicate file+line entries so the same issue isn't repeated.
      // Show first 2 unique occurrences with suggestion + help_url.
      const seen = new Set<string>()
      const uniqueIssues: EquallIssue[] = []
      for (const issue of group.issues) {
        const key = `${issue.file_path}:${issue.line ?? ''}:${issue.message}`
        if (!seen.has(key)) {
          seen.add(key)
          uniqueIssues.push(issue)
        }
      }

      for (const issue of uniqueIssues.slice(0, 2)) {
        const location = issue.line ? `:${issue.line}` : ''
        const col = issue.column ? `:${issue.column}` : ''
        console.log(`    ${GRAY}↳${RESET} ${CYAN}${issue.file_path}${location}${col}${RESET}`)
        console.log(`      ${cleanMessage(issue.message)}`)
        if (issue.suggestion) {
          for (const line of formatSuggestion(issue.suggestion, '      ')) {
            console.log(line)
          }
        }
        if (issue.help_url) {
          console.log(`      ${GRAY}Learn more: ${issue.help_url}${RESET}`)
        }
      }
      if (uniqueIssues.length > 2) {
        console.log(`    ${GRAY}↳ and ${uniqueIssues.length - 2} more occurrence${uniqueIssues.length - 2 > 1 ? 's' : ''} of the same issue${RESET}`)
      }
      console.log()
    }
  }

  // Best Practices — recommendations, NOT WCAG violations. Kept visually quieter.
  if (bpIssues.length > 0) {
    console.log(`  ${BOLD}Best-Practice Recommendations${RESET} ${GRAY}— not WCAG failures, but improve usability${RESET}`)
    console.log()

    const grouped = groupByCriterion(bpIssues)
    const sorted = [...grouped.entries()]
      .sort((a, b) => b[1].weight - a[1].weight)

    for (const [criterion, group] of sorted) {
      const topSeverity = group.issues[0].severity
      const hint = BP_HINTS[criterion] ?? 'See the rule documentation for context.'
      const count = group.issues.length
      console.log(
        `  ${severityIcon(topSeverity)} ${BOLD}${criterion}${RESET}  ` +
        `${GRAY}${count} occurrence${count > 1 ? 's' : ''}${RESET}`
      )
      console.log(`      ${hint}`)

      // Show affected files: all in verbose mode, first 2 otherwise
      const maxFiles = options.verbose ? group.issues.length : 2
      const seen = new Set<string>()
      const uniqueIssues: EquallIssue[] = []
      for (const issue of group.issues) {
        if (!seen.has(issue.file_path)) {
          seen.add(issue.file_path)
          uniqueIssues.push(issue)
        }
      }

      for (const issue of uniqueIssues.slice(0, maxFiles)) {
        const location = issue.line ? `:${issue.line}` : ''
        console.log(`      ${GRAY}↳${RESET} ${CYAN}${issue.file_path}${location}${RESET}`)
      }
      if (!options.verbose && uniqueIssues.length > 2) {
        console.log(`      ${GRAY}↳ and ${uniqueIssues.length - 2} more file${uniqueIssues.length - 2 > 1 ? 's' : ''} (run with --verbose to list all)${RESET}`)
      }
      console.log()
    }
  }

  // Ignored issues (verbose only)
  if (options.showIgnored) {
    const ignoredIssues = result.issues.filter(i => i.ignored)
    if (ignoredIssues.length > 0) {
      console.log(`  ${BOLD}Ignored${RESET}`)
      for (const issue of ignoredIssues) {
        const location = issue.line ? `:${issue.line}` : ''
        console.log(`  ${GRAY}⊘${RESET} ${GRAY}${issue.file_path}${location}${RESET}  ${issue.scanner_rule_id}`)
      }
      console.log()
    }
  }

  // Manual review criteria
  if (options.showManual) {
    const level = options.targetLevel ?? 'AA'
    const allForLevel = getCriteriaForLevel(level)
    const coveredSet = new Set(result.criteria_covered)
    const untested = allForLevel.filter(c => !coveredSet.has(c.id))

    if (untested.length > 0) {
      console.log(`  ${BOLD}Needs manual review${RESET} ${GRAY}— ${untested.length} criteria automation can't verify${RESET}`)
      for (const c of untested) {
        const principle = c.pour.charAt(0).toUpperCase() + c.pour.slice(1)
        console.log(`  ${GRAY}${c.id}${RESET}  ${c.name} ${GRAY}— ${principle}${RESET}`)
      }
      console.log()
    }
  }

  // Scanners used — transparency about what ran
  const scannerLine = scanners_used
    .map((s) => `${s.name} ${GRAY}v${s.version}${RESET} ${GRAY}(${s.issues_found})${RESET}`)
    .join(`${GRAY} · ${RESET}`)
  console.log(`  ${GRAY}Scanners:${RESET} ${scannerLine}`)

  // Readability disclaimer — the scanner uses English-calibrated Flesch-Kincaid,
  // so non-English documents are skipped and the grade is approximate.
  if (scanners_used.some(s => s.name === 'readability')) {
    console.log(`  ${GRAY}Note: readability uses Flesch-Kincaid on English text only. Non-English files are skipped. Grades are indicative — disable with --no-readability.${RESET}`)
  }

  console.log(`  ${GRAY}Completed in ${(duration_ms / 1000).toFixed(1)}s${RESET}`)
  console.log()
}

function printCoaching(result: ScanResult): void {
  const { criteria_covered, criteria_total } = result

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

  // Format a list of criterion IDs with their plain-language names (max 3, then "+N more")
  const formatCriteria = (ids: string[], max = 3): string => {
    const sorted = [...ids].sort()
    const shown = sorted.slice(0, max).map(id => {
      const name = criterionName(id)
      return name ? `${id} ${GRAY}${name}${RESET}` : id
    })
    const extra = sorted.length - max
    return extra > 0 ? `${shown.join(', ')}, ${GRAY}+${extra} more${RESET}` : shown.join(', ')
  }

  if (levelAFailed.length > 0) {
    // Level A failures — most urgent
    console.log(`  ${RED}${BOLD}▲ Action needed${RESET}  You're failing ${BOLD}${levelAFailed.length} Level A criteri${levelAFailed.length > 1 ? 'a' : 'on'}${RESET}.`)
    console.log(`    Level A is the legal minimum — without it, some users literally cannot use your product.`)
    console.log(`    ${GRAY}Failing:${RESET} ${formatCriteria(levelAFailed)}`)
    console.log(`    ${GREEN}Next step:${RESET} scroll to ${BOLD}WCAG Violations${RESET} below and fix the critical/serious items first.`)
  } else if (levelAAFailed.length > 0) {
    // Level A passes, Level AA fails
    console.log(`  ${GREEN}✓${RESET} ${BOLD}Level A passed.${RESET} Now working toward ${BOLD}AA${RESET} — ${levelAAFailed.length} criteri${levelAAFailed.length > 1 ? 'a' : 'on'} still failing.`)
    console.log(`    Level AA is what most regulations (EAA, Section 508, RGAA) require in practice.`)
    console.log(`    ${GRAY}Failing:${RESET} ${formatCriteria(levelAAFailed)}`)
  } else {
    // All pass
    console.log(`  ${GREEN}${BOLD}✓ All automated checks pass.${RESET} Nothing to fix in code right now.`)
    console.log(`    Automated tools catch ~30–40% of a11y issues. The rest needs human review (keyboard, screen reader, contrast in context).`)
  }

  if (remaining > 0) {
    console.log(`    ${GRAY}${remaining} criteria still need manual testing — automation can't verify them.${RESET}`)
  }
}

interface CriterionGroup {
  issues: EquallIssue[]
  weight: number
}

function groupByCriterion(issues: EquallIssue[]): Map<string, CriterionGroup> {
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
