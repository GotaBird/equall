import type { ScanResult, EquallIssue, Severity, WcagLevel, WcagStandard, ConformanceVerdict } from '../types.js'
import { getCriteriaForStandardLevel, getCriterion } from '../wcag-catalog.js'
import { isBeyondTarget } from '../scoring/score.js'
import { BOLD, GRAY, RESET, RED, YELLOW, GREEN, CYAN, WHITE, BG_RED, BG_YELLOW, BG_GREEN, setColorEnabled } from './color.js'

// WCAG version label for the selected standard. The Level-A partition set/total
// are derived per-scan from the catalog (standard-aware) inside printResult — never hardcoded.
function standardLabel(standard: WcagStandard): string {
  return standard === 'wcag21' ? 'WCAG 2.1' : 'WCAG 2.2'
}

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
  'landmark-no-duplicate-main': 'Multiple main landmarks confuse screen readers',
  'landmark-banner-is-top-level': 'Banner landmarks should not be nested',
  'landmark-contentinfo-is-top-level': 'Contentinfo landmarks should not be nested',
  'skip-link': 'Skip links let keyboard users jump past repeated content',
}


// Public docs page defining every verdict (what it asserts / does not) + the VPAT mapping.
// Printed under the Support Summary so a reader of "Supports (automated)" has a reference.
// NOTE: ships in the published CLI — keep in sync with the canonical public docs domain.
const VERDICT_DOCS_URL = 'https://equallscan.com/docs/verdicts'

// How to verify the reclassified page-level rules — the post-build "scan your dist/" recipe.
// Also ships in the published CLI; same canonical docs domain as VERDICT_DOCS_URL.
const POST_BUILD_DOCS_URL = 'https://equallscan.com/docs/verifying-page-level-rules'

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

// The honest verdict that replaces the old "Meets WCAG AA" badge + explainer.
// It states exactly what automation established — how many in-target (A/AA) criteria are
// failing, out of how many were genuinely verified, and how many were NOT evaluated — and
// never makes a pass/fail claim ("Meets"/"conformant"). A clean scan reads
// "0 A/AA failures among the N criteria automatically verified (M not evaluated)", never "None".
function formatVerifiedSubset(result: ScanResult, target: WcagLevel): { line: string; failing: number } {
  let verified: number
  let notEvaluated: number
  let f: number

  const entries = result.criterion_conformance
  if (entries && entries.length > 0) {
    // Derive from criterion_conformance — the same source as the Support Summary — so the
    // two lines agree by construction. criteria_tested is the raw exercised set and may
    // contain beyond-target criteria (e.g. AAA 3.1.5 under an AA target); counting it
    // against the level-scoped criteria_total overstated "verified" and understated
    // "not evaluated" by the same amount.
    f = entries.filter((e) => e.verdict === 'fail').length
    const passed = entries.filter((e) => e.verdict === 'pass_automated').length
    verified = f + passed
    notEvaluated = entries.length - verified
  } else {
    // Fallback (early-return scans without criterion_conformance): exercised count vs the
    // level-scoped total, and in-target failing criteria derived from the issues.
    verified = result.summary.criteria_tested.length
    notEvaluated = Math.max(0, result.criteria_total - verified)

    const failing = new Set<string>()
    for (const issue of result.issues) {
      if (issue.ignored || issue.review_only) continue
      if (isBeyondTarget(issue, target)) continue
      for (const c of issue.wcag_criteria) failing.add(c)
    }
    f = failing.size
  }

  const scope = target === 'A' ? 'Level A' : target === 'AAA' ? 'A/AA/AAA' : 'A/AA'
  const line = `${f} ${scope} failure${f === 1 ? '' : 's'} among the ${verified} criteri${verified === 1 ? 'on' : 'a'} automatically verified (${notEvaluated} not evaluated).`
  return { line, failing: f }
}

// Default caps on every list in the report (criteria, occurrences, affected files); `--all`
// lifts them all (`--verbose` still lifts the file lists, as before). Any cut is always
// announced with a notice naming `--all` — never a silent truncation.
const MAX_CRITERIA = 8
const MAX_OCCURRENCES = 2

export interface PrintOptions {
  showIgnored?: boolean
  verbose?: boolean
  all?: boolean
  showManual?: boolean
  // ANSI colors on/off. Defaults to on; the CLI resolves it with shouldUseColor()
  // (--no-color, NO_COLOR, FORCE_COLOR, TTY detection).
  color?: boolean
  targetLevel?: WcagLevel
  standard?: WcagStandard
}

// Issues partitioned once for the whole report. `target` decides what is an in-scope
// violation vs. a beyond-target advisory (e.g. AAA reading-level under an AA target):
// advisory issues never count against conformance or the score.
interface ReportIssues {
  // Counted issues (not ignored, not review-only), by section
  wcag: EquallIssue[]
  advisory: EquallIssue[]
  bestPractice: EquallIssue[]
  // Reported but never counted
  reviewOnly: EquallIssue[]
  ignored: EquallIssue[]
}

function partitionIssues(result: ScanResult, target: WcagLevel): ReportIssues {
  const parts: ReportIssues = { wcag: [], advisory: [], bestPractice: [], reviewOnly: [], ignored: [] }
  for (const issue of result.issues) {
    if (issue.ignored) parts.ignored.push(issue)
    else if (issue.review_only) parts.reviewOnly.push(issue)
    else if (issue.wcag_criteria.length === 0) parts.bestPractice.push(issue)
    else if (isBeyondTarget(issue, target)) parts.advisory.push(issue)
    else parts.wcag.push(issue)
  }
  return parts
}

export function printResult(result: ScanResult, options: PrintOptions = {}): void {
  setColorEnabled(options.color ?? true)
  const target = options.targetLevel ?? 'AA'
  const standard = options.standard ?? 'wcag22'
  const parts = partitionIssues(result, target)

  console.log()
  console.log(`${BOLD}  ◆ EQUALL — Accessibility Score${RESET}`)
  console.log()

  printSummary(result, parts)
  printViolations(parts.wcag, target, options)
  printAdvisory(parts.advisory, target, options)
  printBestPractices(parts.bestPractice, options)
  printReviewOnly(parts.reviewOnly, options)
  printNotVerifiable(result, options)
  printConfidenceFlags(result)
  if (options.showIgnored) printIgnored(parts.ignored)
  if (options.showManual) printManualReview(result, standard, target)
  if (options.verbose) printScanners(result)

  console.log(`  ${GRAY}Completed in ${(result.duration_ms / 1000).toFixed(1)}s${RESET}`)
  console.log()

  // Headline at the END (moved 2026-07-08): in a terminal the bottom of the output is what
  // stays on screen when the scan finishes, so the report's takeaway is printed last — read
  // first without scrolling. The score (a trend indicator) sits just above the
  // Support Summary, whose bucket line is the final content line.
  const verdict = formatVerifiedSubset(result, target)
  console.log(`  ${scoreBg(result.score)}${BOLD}${WHITE}  ${result.score}  ${RESET}  ${GRAY}${standardLabel(standard)} · score is a trend indicator${RESET}`)
  console.log(`  ${verdict.failing > 0 ? RED : GRAY}${verdict.line}${RESET}`)
  console.log()
  printSupportSummary(result, target, options)
}

function printSummary(result: ScanResult, parts: ReportIssues): void {
  const { summary } = result
  // Every count here is over COUNTED issues only — the ones the score and the verdict
  // are computed from. Ignored and review-only issues are announced on their own lines, so
  // the summary never announces more violations than the report lists.
  // Beyond-target criteria (advisory) don't penalize the score and aren't counted among
  // conformance violations.
  const advisoryCount = parts.advisory.length

  console.log(`  ${BOLD}Summary${RESET}`)
  const wcagIssuesCount = parts.wcag.length
  const bpIssuesCount = parts.bestPractice.length
  const advisorySuffix = advisoryCount > 0 ? `  ·  ${GRAY}${advisoryCount} AAA advisory${RESET}` : ''
  // Page-level rules reclassified on fragment scans — surfaced even in a skim.
  const reclassifiedCount = (result.coverage?.reclassified ?? []).reduce((n, r) => n + r.count, 0)
  const reclassifiedSuffix = reclassifiedCount > 0 ? `  ·  ${GRAY}${reclassifiedCount} page-level (needs rendered page)${RESET}` : ''
  console.log(`  ${summary.files_scanned} ${plural(summary.files_scanned, 'file')} scanned  ·  ${BOLD}${wcagIssuesCount}${RESET} WCAG ${plural(wcagIssuesCount, 'violation')}  ·  ${GRAY}${bpIssuesCount} best-practice ${plural(bpIssuesCount, 'recommendation')}${RESET}${advisorySuffix}${reclassifiedSuffix}`)

  // Severity breakdown over conformance-scope issues only (advisory AAA excluded),
  // with a one-line legend so "critical/serious/moderate/minor" isn't just a color soup
  const sevCounts: Record<Severity, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 }
  for (const i of [...parts.wcag, ...parts.bestPractice]) sevCounts[i.severity]++
  console.log(
    `  ${severityIcon('critical')} ${RED}${sevCounts.critical} critical${RESET}   ` +
    `${severityIcon('serious')} ${YELLOW}${sevCounts.serious} serious${RESET}   ` +
    `${severityIcon('moderate')} ${CYAN}${sevCounts.moderate} moderate${RESET}   ` +
    `${severityIcon('minor')} ${GRAY}${sevCounts.minor} minor${RESET}`
  )
  console.log(`  ${GRAY}critical/serious = fix before shipping · moderate/minor = fix in next iteration${RESET}`)
  // File-based route inventory — one quiet line, only when routes were found (the
  // zero-route and not-attempted cases are already carried by the [routes] diagnostics).
  const routes = result.routes ?? []
  if (routes.length > 0) {
    const byFramework = new Map<string, number>()
    for (const route of routes) byFramework.set(route.framework, (byFramework.get(route.framework) ?? 0) + 1)
    const breakdown = [...byFramework.entries()].map(([framework, count]) => `${framework} ${count}`).join(' · ')
    console.log(`  ${GRAY}${routes.length} ${plural(routes.length, 'route')} detected · ${breakdown}${RESET}`)
  }
  if (parts.reviewOnly.length > 0) {
    console.log(`  ${GRAY}${parts.reviewOnly.length} ${plural(parts.reviewOnly.length, 'finding')} to review — static analysis can't confirm ${plural(parts.reviewOnly.length, 'it', 'them')}, not counted${RESET}`)
  }
  if (summary.ignored_count > 0) {
    console.log(`  ${GRAY}${summary.ignored_count} ${plural(summary.ignored_count, 'issue')} suppressed via equall-ignore${RESET}`)
  }

  console.log()
}

// WCAG Violations — automated failures at the target level; these count against conformance.
function printViolations(issues: EquallIssue[], target: WcagLevel, options: PrintOptions): void {
  if (issues.length === 0) return
  console.log(`  ${BOLD}WCAG Violations${RESET} ${GRAY}— automated failures at your ${target} target, fix these first${RESET}`)
  console.log()

  const sorted = sortedGroups(issues)
  // Top MAX_CRITERIA by default; the remainder is announced below, never dropped silently.
  const shown = options.all ? sorted : sorted.slice(0, MAX_CRITERIA)
  const hidden = sorted.slice(shown.length)

  for (const [criterion, group] of shown) {
    const topSeverity = group.issues[0].severity
    // Header: severity icon · criterion ID · plain-language name · level · issue count
    console.log(
      `  ${severityIcon(topSeverity)} ${severityLabel(topSeverity)}  ` +
      `${BOLD}WCAG ${criterion}${RESET}${criterionSuffix(criterion, group)}  ` +
      `${GRAY}(${group.issues.length} ${plural(group.issues.length, 'occurrence')})${RESET}`
    )
    printOccurrences(group.issues, options, (issue) => {
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
    })
    console.log()
  }

  // Criteria beyond the top MAX_CRITERIA: name what was cut (with its critical/serious
  // counts) so a serious criterion ranked lower is never hidden without a trace.
  if (hidden.length > 0) {
    const hiddenIssues = hidden.flatMap(([, group]) => group.issues)
    const critical = hiddenIssues.filter(i => i.severity === 'critical').length
    const serious = hiddenIssues.filter(i => i.severity === 'serious').length
    const severe = [
      critical > 0 ? `${critical} critical` : '',
      serious > 0 ? `${serious} serious` : '',
    ].filter(Boolean).join(', ')
    console.log(
      `  ${GRAY}↳ ${hidden.length} more WCAG ${plural(hidden.length, 'criterion', 'criteria')} not shown ` +
      `(${hiddenIssues.length} ${plural(hiddenIssues.length, 'occurrence')}${severe ? `, incl. ${severe}` : ''}) · run with --all to list every criterion${RESET}`
    )
    console.log()
  }
}

// Advisory — WCAG criteria beyond the conformance target (e.g. AAA reading-level
// under an AA target). Shown for awareness; they do NOT count against conformance
// or the score, and are never framed as "must fix".
function printAdvisory(issues: EquallIssue[], target: WcagLevel, options: PrintOptions): void {
  if (issues.length === 0) return
  console.log(`  ${BOLD}Advisory${RESET} ${GRAY}— beyond your ${target} target (WCAG AAA), advisory only${RESET}`)
  console.log()

  for (const [criterion, group] of sortedGroups(issues)) {
    console.log(
      `  ${GRAY}◇${RESET} ${BOLD}WCAG ${criterion}${RESET}${criterionSuffix(criterion, group)}  ` +
      `${GRAY}(${group.issues.length} ${plural(group.issues.length, 'occurrence')})${RESET}`
    )
    printOccurrences(group.issues, options, (issue) => {
      const location = issue.line ? `:${issue.line}` : ''
      console.log(`    ${GRAY}↳${RESET} ${CYAN}${issue.file_path}${location}${RESET}`)
      console.log(`      ${GRAY}${cleanMessage(issue.message)}${RESET}`)
      if (issue.help_url) {
        console.log(`      ${GRAY}Learn more: ${issue.help_url}${RESET}`)
      }
    })
    console.log()
  }
}

// Best Practices — recommendations, NOT WCAG violations. Kept visually quieter.
function printBestPractices(issues: EquallIssue[], options: PrintOptions): void {
  if (issues.length === 0) return
  console.log(`  ${BOLD}Best-Practice Recommendations${RESET} ${GRAY}— not WCAG failures, but improve usability${RESET}`)
  console.log()

  for (const [ruleId, group] of sortedGroups(issues)) {
    const topSeverity = group.issues[0].severity
    const hint = BP_HINTS[ruleId] ?? 'See the rule documentation for context.'
    console.log(
      `  ${severityIcon(topSeverity)} ${BOLD}${ruleId}${RESET}  ` +
      `${GRAY}${group.issues.length} ${plural(group.issues.length, 'occurrence')}${RESET}`
    )
    console.log(`      ${hint}`)

    // Affected files, one line per file (deduped by path)
    const seen = new Set<string>()
    const byFile = group.issues.filter(issue => !seen.has(issue.file_path) && seen.add(issue.file_path))
    printFileList(byFile.map(issue => `${issue.file_path}${issue.line ? `:${issue.line}` : ''}`), options)
    console.log()
  }
}

// Review-only findings — reported with their fingerprint, never counted (see EquallIssue
// review_only). Grouped by rule like best practices and kept quiet: GRAY, never a failure.
function printReviewOnly(issues: EquallIssue[], options: PrintOptions): void {
  if (issues.length === 0) return
  console.log(`  ${BOLD}To review${RESET} ${GRAY}— ${issues.length} ${plural(issues.length, 'finding')} static analysis can't confirm on component source · not counted${RESET}`)
  console.log()
  const byRule = new Map<string, EquallIssue[]>()
  for (const issue of issues) byRule.set(issue.scanner_rule_id, [...(byRule.get(issue.scanner_rule_id) ?? []), issue])
  for (const [ruleId, group] of [...byRule.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
    const criteria = group[0].wcag_criteria
    const wcag = criteria.length > 0 ? `  ${GRAY}WCAG ${criteria.join(', ')}${RESET}` : ''
    console.log(
      `  ${GRAY}○${RESET} ${BOLD}${ruleId}${RESET}  ` +
      `${GRAY}${group.length} ${plural(group.length, 'occurrence')}${RESET}${wcag}`
    )
    const reason = group[0].review_reason
    if (reason) console.log(`      ${GRAY}${reason}${RESET}`)
    const seen = new Set<string>()
    const byFile = group.filter(issue => !seen.has(issue.file_path) && seen.add(issue.file_path))
    printFileList(byFile.map(issue => issue.file_path), options)
    console.log()
  }
}

// Page-level rules reclassified on fragment scans. Rendered UNCONDITIONALLY
// (never behind --show-manual): honest coverage means the removed findings stay named.
function printNotVerifiable(result: ScanResult, options: PrintOptions): void {
  const reclassified = result.coverage?.reclassified ?? []
  if (reclassified.length === 0) return
  console.log(`  ${BOLD}Not verifiable on this scan${RESET} ${GRAY}— ${reclassified.length} page-level ${plural(reclassified.length, 'rule')} on fragment files${RESET}`)
  console.log()

  for (const entry of reclassified) {
    // WCAG-mapped page-level rules (e.g. bypass 2.4.1) show their criterion; the
    // best-practice ones reuse the BP_HINTS explanation.
    const wcagSuffix = entry.wcag_criteria.length > 0
      ? `  ${GRAY}WCAG ${entry.wcag_criteria.map((c) => {
          const name = criterionName(c)
          return name ? `${c} ${name}` : c
        }).join(', ')}${RESET}`
      : ''
    console.log(
      `  ${GRAY}○${RESET} ${BOLD}${entry.rule_id}${RESET}  ` +
      `${GRAY}${entry.count} ${plural(entry.count, 'occurrence')}${RESET}${wcagSuffix}`
    )
    const hint = BP_HINTS[entry.rule_id]
    if (hint) console.log(`      ${GRAY}${hint}${RESET}`)
    printFileList(entry.files, options)
    console.log()
  }

  console.log(`  ${GRAY}These rules apply to the composed page, not a single component or partial.${RESET}`)
  console.log(`  ${GRAY}Verify on the built output:${RESET}  npx equall scan <build-dir>  ${GRAY}(e.g. astro build && npx equall scan dist/)${RESET}`)
  console.log(`  ${GRAY}Guide: ${POST_BUILD_DOCS_URL}${RESET}`)
  console.log()
}

// Alt-quality confidence flags — an ADVISORY, never a WCAG failure. Rendered
// unconditionally like "Not verifiable": a present-but-useless alt passes the automated check
// but is likely junk to a screen-reader user, so it's surfaced for human review. GRAY, never RED.
function printConfidenceFlags(result: ScanResult): void {
  const confidenceFlags = result.confidence_flags ?? []
  if (confidenceFlags.length === 0) return
  console.log(`  ${BOLD}Low-confidence alt text${RESET} ${GRAY}— ${confidenceFlags.length} present but suspect · a review suggestion, not a WCAG violation${RESET}`)
  console.log()
  for (const flag of confidenceFlags) {
    const loc = flag.line != null ? `:${flag.line}` : ''
    const shown = flag.value.length > 80 ? `${flag.value.slice(0, 77)}…` : flag.value
    console.log(`  ${GRAY}○${RESET} ${CYAN}${flag.file_path}${loc}${RESET}  ${GRAY}alt="${shown}" — ${flag.reason}${RESET}`)
  }
  console.log(`  ${GRAY}Automation can't tell if an alt is meaningful — check these actually describe the image.${RESET}`)
  console.log()
}

// Ignored issues (--show-ignored)
function printIgnored(ignored: EquallIssue[]): void {
  if (ignored.length === 0) return
  console.log(`  ${BOLD}Ignored${RESET}`)
  for (const issue of ignored) {
    const location = issue.line ? `:${issue.line}` : ''
    console.log(`  ${GRAY}⊘${RESET} ${GRAY}${issue.file_path}${location}${RESET}  ${issue.scanner_rule_id}`)
  }
  console.log()
}

// Manual review criteria (--show-manual)
function printManualReview(result: ScanResult, standard: WcagStandard, target: WcagLevel): void {
  const allForLevel = getCriteriaForStandardLevel(standard, target)
  const coveredSet = new Set(result.coverage?.auto_criteria ?? result.criteria_covered)
  const untested = allForLevel.filter(c => !coveredSet.has(c.id))
  if (untested.length === 0) return

  console.log(`  ${BOLD}Needs manual review${RESET} ${GRAY}— ${untested.length} criteria automation can't verify${RESET}`)
  for (const c of untested) {
    const principle = c.pour.charAt(0).toUpperCase() + c.pour.slice(1)
    console.log(`  ${GRAY}${c.id}${RESET}  ${c.name} ${GRAY}— ${principle}${RESET}`)
  }
  console.log()
}

// Scanners used — transparency about what ran. Verbose-only, to keep the default output tight.
function printScanners(result: ScanResult): void {
  const scannerLine = result.scanners_used
    .map((s) => `${s.name} ${GRAY}v${s.version}${RESET} ${GRAY}(${s.issues_found})${RESET}`)
    .join(`${GRAY} · ${RESET}`)
  console.log(`  ${GRAY}Scanners:${RESET} ${scannerLine}`)
  // Readability disclaimer — English-calibrated Flesch-Kincaid; non-English docs are skipped.
  if (result.scanners_used.some(s => s.name === 'readability')) {
    console.log(`  ${GRAY}Note: readability uses Flesch-Kincaid on English text only. Non-English files are skipped. Grades are indicative — disable with --no-readability.${RESET}`)
  }
}

// Report headline. Printed at the END of the output (moved 2026-07-08): in a
// terminal the bottom of the scan is what stays on screen when it finishes, so the report's
// takeaway — the per-criterion Support Summary — is read first, without scrolling. Three
// VPAT-anchored buckets (Supports (automated) / Does not support / Not evaluated); `--verbose`
// prints the full per-criterion table ABOVE the buckets (so the bucket line stays the final,
// read-first line) and splits "Not evaluated" into its three reasons. Absent on early-return
// scans (no `criterion_conformance`), like `coverage`. The engine states an automated BASIS,
// never a pass/fail claim: the banned words (Meets/conformant/compliant/conformance) must
// never appear here — verdict.test.ts gates it.
function printSupportSummary(result: ScanResult, target: WcagLevel, options: PrintOptions): void {
  const entries = result.criterion_conformance
  if (!entries || entries.length === 0) return

  let supports = 0
  let fails = 0
  let notEvaluated = 0
  for (const e of entries) {
    if (e.verdict === 'fail') fails++
    else if (e.verdict === 'pass_automated') supports++
    else notEvaluated++
  }

  // --verbose: the full per-criterion table FIRST, so the bucket summary below stays the
  // final (read-first) line. "Not evaluated" splits into its three honest reasons.
  if (options.verbose) {
    const label: Record<ConformanceVerdict, string> = {
      fail: `${RED}Does not support${RESET}`,
      pass_automated: `${GREEN}Supports (automated)${RESET}`,
      not_verifiable_on_this_scan: `${GRAY}Not evaluated — rendered check${RESET}`,
      not_tested_assisted: `${GRAY}Not evaluated — assisted${RESET}`,
      not_tested_manual: `${GRAY}Not evaluated — manual${RESET}`,
    }
    const mark: Record<ConformanceVerdict, string> = {
      fail: `${RED}✕${RESET}`,
      pass_automated: `${GREEN}✓${RESET}`,
      not_verifiable_on_this_scan: `${GRAY}○${RESET}`,
      not_tested_assisted: `${GRAY}○${RESET}`,
      not_tested_manual: `${GRAY}○${RESET}`,
    }
    console.log(`  ${BOLD}Per-criterion${RESET} ${GRAY}— ${standardLabel(result.standard ?? 'wcag22')}, ${target} target${RESET}`)
    for (const e of entries) {
      console.log(`  ${mark[e.verdict]} ${GRAY}${e.criterion}${RESET}  ${e.name}  ${label[e.verdict]}`)
    }
    console.log()
  }

  // The headline bucket line — the last, read-first takeaway.
  console.log(`  ${BOLD}${standardLabel(result.standard ?? 'wcag22')} Support Summary${RESET} ${GRAY}— ${target} target · automated basis only${RESET}`)
  console.log(
    `  ${GREEN}✓ Supports (automated) ${supports}${RESET}   ` +
    `${RED}✕ Does not support ${fails}${RESET}   ` +
    `${GRAY}○ Not evaluated ${notEvaluated}${RESET}`
  )
  if (!options.verbose) {
    console.log(`  ${GRAY}Automated verdicts only — a full statement needs manual + assistive-tech testing. Run --verbose for the per-criterion table.${RESET}`)
  }
  // Authoritative reference for what each verdict asserts (and does not) + the VPAT mapping.
  console.log(`  ${GRAY}What each verdict means → ${VERDICT_DOCS_URL}${RESET}`)
  console.log()
}

// `${n} ${plural(n, 'file')}` → "1 file" / "3 files" (and "0 files").
function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return n === 1 ? singular : pluralForm
}

// Groups sorted by severity weight, heaviest first.
function sortedGroups(issues: EquallIssue[]): [string, CriterionGroup][] {
  return [...groupByCriterion(issues).entries()].sort((a, b) => b[1].weight - a[1].weight)
}

// " <name> Level <X>" after a criterion ID, each part only when known.
function criterionSuffix(criterion: string, group: CriterionGroup): string {
  const name = criterionName(criterion)
  const level = group.issues[0].wcag_level
  return `${name ? ` ${BOLD}${name}${RESET}` : ''}${level ? ` ${GRAY}Level ${level}${RESET}` : ''}`
}

// Collapse issues sharing file + line + message — the same occurrence reported twice.
function uniqueOccurrences(issues: EquallIssue[]): EquallIssue[] {
  const seen = new Set<string>()
  const unique: EquallIssue[] = []
  for (const issue of issues) {
    const key = `${issue.file_path}:${issue.line ?? ''}:${issue.message}`
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(issue)
    }
  }
  return unique
}

// A criterion's unique occurrences: the first MAX_OCCURRENCES (all with --all), then a
// notice naming --all whenever some were cut.
function printOccurrences(issues: EquallIssue[], options: PrintOptions, render: (issue: EquallIssue) => void): void {
  const unique = uniqueOccurrences(issues)
  const shown = options.all ? unique : unique.slice(0, MAX_OCCURRENCES)
  shown.forEach(render)
  const hidden = unique.length - shown.length
  if (hidden > 0) {
    console.log(`    ${GRAY}↳ and ${hidden} more ${plural(hidden, 'occurrence')} of the same issue · run with --all to list them${RESET}`)
  }
}

// Affected files of a best-practice / page-level rule: the first MAX_OCCURRENCES (all with
// --all or --verbose), then a notice naming --all whenever some were cut.
function printFileList(files: string[], options: PrintOptions): void {
  const shown = options.all || options.verbose ? files : files.slice(0, MAX_OCCURRENCES)
  for (const file of shown) {
    console.log(`      ${GRAY}↳${RESET} ${CYAN}${file}${RESET}`)
  }
  const hidden = files.length - shown.length
  if (hidden > 0) {
    console.log(`      ${GRAY}↳ and ${hidden} more ${plural(hidden, 'file')} · run with --all to list them${RESET}`)
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
