import type { ScanResult, EquallIssue, Severity, WcagLevel, WcagStandard, ConformanceVerdict } from '../types.js'
import { getCriteriaForStandardLevel, getCriterion } from '../wcag-catalog.js'
import { isBeyondTarget } from '../scoring/score.js'

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
const WHITE = '\x1b[37m'
const BG_RED = '\x1b[41m'
const BG_YELLOW = '\x1b[43m'
const BG_GREEN = '\x1b[42m'
const BG_CYAN = '\x1b[46m'

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
      if (issue.ignored) continue
      if (isBeyondTarget(issue, target)) continue
      for (const c of issue.wcag_criteria) failing.add(c)
    }
    f = failing.size
  }

  const scope = target === 'A' ? 'Level A' : target === 'AAA' ? 'A/AA/AAA' : 'A/AA'
  const line = `${f} ${scope} failure${f === 1 ? '' : 's'} among the ${verified} criteri${verified === 1 ? 'on' : 'a'} automatically verified (${notEvaluated} not evaluated).`
  return { line, failing: f }
}

export interface PrintOptions {
  showIgnored?: boolean
  verbose?: boolean
  showManual?: boolean
  targetLevel?: WcagLevel
  standard?: WcagStandard
}

export function printResult(result: ScanResult, options: PrintOptions = {}): void {
  const { score, summary, scanners_used, duration_ms } = result

  console.log()
  console.log(`${BOLD}  ◆ EQUALL — Accessibility Score${RESET}`)
  console.log()

  // Target drives what counts as an in-scope violation vs. beyond-target advisory.
  const target = options.targetLevel ?? 'AA'

  // Standard view — drives the "WCAG 2.1/2.2" labels (derived from the catalog).
  const standard = options.standard ?? 'wcag22'

  // Beyond-target criteria (e.g. AAA reading-level under an AA target) are advisory:
  // they don't penalize the score and aren't counted among conformance violations.
  const isAdvisory = (i: EquallIssue) => i.wcag_criteria.length > 0 && isBeyondTarget(i, target)
  const advisoryCount = result.issues.filter(isAdvisory).length

  // Summary stats
  console.log(`  ${BOLD}Summary${RESET}`)
  const wcagIssuesCount = result.issues.filter(i => i.wcag_criteria.length > 0 && !isAdvisory(i)).length
  const bpIssuesCount = result.issues.filter(i => i.wcag_criteria.length === 0).length
  const advisorySuffix = advisoryCount > 0 ? `  ·  ${GRAY}${advisoryCount} AAA advisory${RESET}` : ''
  // Page-level rules reclassified on fragment scans — surfaced even in a skim.
  const reclassified = result.coverage?.reclassified ?? []
  const reclassifiedCount = reclassified.reduce((n, r) => n + r.count, 0)
  const reclassifiedSuffix = reclassifiedCount > 0 ? `  ·  ${GRAY}${reclassifiedCount} page-level (needs rendered page)${RESET}` : ''
  console.log(`  ${summary.files_scanned} file${summary.files_scanned === 1 ? '' : 's'} scanned  ·  ${BOLD}${wcagIssuesCount}${RESET} WCAG violation${wcagIssuesCount === 1 ? '' : 's'}  ·  ${GRAY}${bpIssuesCount} best-practice recommendation${bpIssuesCount === 1 ? '' : 's'}${RESET}${advisorySuffix}${reclassifiedSuffix}`)

  // Severity breakdown over conformance-scope issues only (advisory AAA excluded),
  // with a one-line legend so "critical/serious/moderate/minor" isn't just a color soup
  const sevCounts: Record<Severity, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 }
  for (const i of result.issues) {
    if (isAdvisory(i)) continue
    sevCounts[i.severity]++
  }
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
    console.log(`  ${GRAY}${routes.length} route${routes.length === 1 ? '' : 's'} detected · ${breakdown}${RESET}`)
  }
  if (summary.ignored_count > 0) {
    console.log(`  ${GRAY}${summary.ignored_count} issue${summary.ignored_count > 1 ? 's' : ''} suppressed via equall-ignore${RESET}`)
  }

  console.log()

  // Only display non-ignored issues in terminal output
  const visibleIssues = result.issues.filter(i => !i.ignored)
  // WCAG issues at or below the target level are conformance failures; those
  // above it (e.g. AAA reading-level under an AA target) are advisory only.
  const wcagIssues = visibleIssues.filter(i => i.wcag_criteria.length > 0 && !isBeyondTarget(i, target))
  const advisoryIssues = visibleIssues.filter(i => i.wcag_criteria.length > 0 && isBeyondTarget(i, target))
  const bpIssues = visibleIssues.filter(i => i.wcag_criteria.length === 0)

  // Top issues (WCAG Violations) — these count against conformance
  if (wcagIssues.length > 0) {
    console.log(`  ${BOLD}WCAG Violations${RESET} ${GRAY}— automated failures at your ${target} target, fix these first${RESET}`)
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

  // Advisory — WCAG criteria beyond the conformance target (e.g. AAA reading-level
  // under an AA target). Shown for awareness; they do NOT count against conformance
  // or the score, and are never framed as "must fix".
  if (advisoryIssues.length > 0) {
    console.log(`  ${BOLD}Advisory${RESET} ${GRAY}— beyond your ${target} target (WCAG AAA), advisory only${RESET}`)
    console.log()

    const grouped = groupByCriterion(advisoryIssues)
    const sorted = [...grouped.entries()].sort((a, b) => b[1].weight - a[1].weight)

    for (const [criterion, group] of sorted) {
      const name = criterionName(criterion)
      const levelSuffix = group.issues[0].wcag_level ? ` ${GRAY}Level ${group.issues[0].wcag_level}${RESET}` : ''
      const nameSuffix = name ? ` ${BOLD}${name}${RESET}` : ''
      const count = group.issues.length
      console.log(
        `  ${GRAY}◇${RESET} ${BOLD}WCAG ${criterion}${RESET}${nameSuffix}${levelSuffix}  ` +
        `${GRAY}(${count} occurrence${count > 1 ? 's' : ''})${RESET}`
      )

      const seen = new Set<string>()
      const uniqueIssues: EquallIssue[] = []
      for (const issue of group.issues) {
        const key = `${issue.file_path}:${issue.line ?? ''}:${issue.message}`
        if (!seen.has(key)) { seen.add(key); uniqueIssues.push(issue) }
      }
      for (const issue of uniqueIssues.slice(0, 2)) {
        const location = issue.line ? `:${issue.line}` : ''
        console.log(`    ${GRAY}↳${RESET} ${CYAN}${issue.file_path}${location}${RESET}`)
        console.log(`      ${GRAY}${cleanMessage(issue.message)}${RESET}`)
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

  // Page-level rules reclassified on fragment scans. Rendered UNCONDITIONALLY
  // (never behind --show-manual): honest coverage means the removed findings stay named.
  if (reclassified.length > 0) {
    console.log(`  ${BOLD}Not verifiable on this scan${RESET} ${GRAY}— ${reclassified.length} page-level rule${reclassified.length > 1 ? 's' : ''} on fragment files${RESET}`)
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
        `${GRAY}${entry.count} occurrence${entry.count > 1 ? 's' : ''}${RESET}${wcagSuffix}`
      )
      const hint = BP_HINTS[entry.rule_id]
      if (hint) console.log(`      ${GRAY}${hint}${RESET}`)

      const maxFiles = options.verbose ? entry.files.length : 2
      for (const file of entry.files.slice(0, maxFiles)) {
        console.log(`      ${GRAY}↳${RESET} ${CYAN}${file}${RESET}`)
      }
      if (!options.verbose && entry.files.length > 2) {
        console.log(`      ${GRAY}↳ and ${entry.files.length - 2} more file${entry.files.length - 2 > 1 ? 's' : ''} (run with --verbose to list all)${RESET}`)
      }
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
  const confidenceFlags = result.confidence_flags ?? []
  if (confidenceFlags.length > 0) {
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
    const allForLevel = getCriteriaForStandardLevel(standard, level)
    const coveredSet = new Set(result.coverage?.auto_criteria ?? result.criteria_covered)
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

  // Scanners used — transparency about what ran. Verbose-only, to keep the default output tight.
  if (options.verbose) {
    const scannerLine = scanners_used
      .map((s) => `${s.name} ${GRAY}v${s.version}${RESET} ${GRAY}(${s.issues_found})${RESET}`)
      .join(`${GRAY} · ${RESET}`)
    console.log(`  ${GRAY}Scanners:${RESET} ${scannerLine}`)
    // Readability disclaimer — English-calibrated Flesch-Kincaid; non-English docs are skipped.
    if (scanners_used.some(s => s.name === 'readability')) {
      console.log(`  ${GRAY}Note: readability uses Flesch-Kincaid on English text only. Non-English files are skipped. Grades are indicative — disable with --no-readability.${RESET}`)
    }
  }

  console.log(`  ${GRAY}Completed in ${(duration_ms / 1000).toFixed(1)}s${RESET}`)
  console.log()

  // Headline at the END (moved 2026-07-08): in a terminal the bottom of the output is what
  // stays on screen when the scan finishes, so the report's takeaway is printed last — read
  // first without scrolling. The score (a trend indicator) sits just above the
  // Support Summary, whose bucket line is the final content line.
  const verdict = formatVerifiedSubset(result, target)
  console.log(`  ${scoreBg(score)}${BOLD}${WHITE}  ${score}  ${RESET}  ${GRAY}${standardLabel(standard)} · score is a trend indicator${RESET}`)
  console.log(`  ${verdict.failing > 0 ? RED : GRAY}${verdict.line}${RESET}`)
  console.log()
  printSupportSummary(result, target, options)
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
