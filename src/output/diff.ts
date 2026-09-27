import type { EquallIssue, Severity } from '../types.js'
import type { DiffScanResult } from '../diff-scan.js'
import { formatDiffGuardrail } from '../diff-scan.js'
import { gatingIssues } from '../ci/diff-gate.js'
import { BOLD, GRAY, RESET, RED, YELLOW, GREEN, setColorEnabled } from './color.js'
import { cleanMessage } from './terminal.js'

export interface PrintDiffOptions {
  base: string                  // the ref as given or detected (e.g. origin/main)
  failOn: Severity | null       // gate threshold; null = report only
  color?: boolean
}

const location = (i: EquallIssue) => (i.line != null ? `${i.file_path}:${i.line}` : i.file_path)
const criteria = (i: EquallIssue) => (i.wcag_criteria.length > 0 ? `  ${GRAY}WCAG ${i.wcag_criteria.join(', ')}${RESET}` : '')

function printIssue(i: EquallIssue, marker: string): void {
  console.log(`  ${marker} ${BOLD}${i.severity}${RESET}  ${location(i)}  ${i.scanner_rule_id}${criteria(i)}`)
  console.log(`      ${GRAY}${cleanMessage(i.message)}${RESET}`)
}

// The diff-mode report: what this change introduced, what it left untouched, and whether the
// gate passes. It never says clean or done: legacy debt and untestable files are always named.
export function printDiffResult(result: DiffScanResult, options: PrintDiffOptions): void {
  setColorEnabled(options.color ?? true)
  const gating = new Set(gatingIssues(result, options.failOn))

  console.log()
  console.log(`${BOLD}  ◆ EQUALL — Changes since ${options.base}${RESET} ${GRAY}(merge-base ${result.merge_base.slice(0, 7)})${RESET}`)
  console.log()
  console.log(`  ${formatDiffGuardrail(result)}`)
  console.log()

  if (result.new_issues.length > 0) {
    console.log(`  ${BOLD}Introduced by this change${RESET}`)
    for (const i of result.new_issues) printIssue(i, gating.has(i) ? `${RED}✖${RESET}` : `${YELLOW}▲${RESET}`)
    console.log()
  }

  const uncounted = [...result.new_review_only, ...result.new_advisory]
  if (uncounted.length > 0) {
    console.log(`  ${BOLD}Also introduced, not counted${RESET} ${GRAY}— review-only or advisory${RESET}`)
    for (const i of uncounted) printIssue(i, `${GRAY}○${RESET}`)
    console.log()
  }

  if (result.legacy_issues.length > 0) {
    console.log(`  ${GRAY}${result.legacy_issues.length} finding(s) in the changed files already existed before this change — not blocking.${RESET}`)
  }
  if (result.not_testable.length > 0) {
    // CSS, scripts and config can still affect accessibility (contrast, focus, behaviour):
    // name how many, with a few examples, and point to the rendered check. The full list is
    // on `not_testable` in --json.
    const n = result.not_testable.length
    const shown = result.not_testable.slice(0, 3).join(', ')
    const more = n > 3 ? `, and ${n - 3} more (full list in --json)` : ''
    console.log(`  ${GRAY}${n} changed file(s) not statically testable: ${shown}${more}${RESET}`)
  }
  if (result.excluded.length > 0) {
    console.log(`  ${GRAY}Skipped like a full scan (tests, stories, builds): ${result.excluded.length} file(s)${RESET}`)
  }
  if (result.legacy_issues.length + result.not_testable.length + result.excluded.length > 0) console.log()

  if (!options.failOn) {
    console.log(`  ${GRAY}Report only — add --fail-on <severity> to gate the change.${RESET}`)
  } else if (gating.size > 0) {
    console.log(`  ${RED}${BOLD}✖ Check fails${RESET} — ${gating.size} new violation(s) at ${options.failOn} or above.`)
  } else {
    console.log(`  ${GREEN}✓ Check passes${RESET} — no new violation at ${options.failOn} or above. ${GRAY}The rendered page still needs its own check.${RESET}`)
  }
  console.log()
}
