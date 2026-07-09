import type { EquallIssue, ReclassifiedRule } from '../types.js'

// Context-aware rule reclassification — the seed of the suppression layer
// future engines will share. A *page-level* rule judges the composed page (landmarks,
// skip link, document title, <html lang>), not any single element. On a FRAGMENT scan
// (a component/partial whose page structure lives in the layout that composes it at
// render time), such a finding is statically unverifiable: reporting it as a violation
// asserts something the scan cannot see. These rules are therefore reclassified out of
// violations and surfaced in the honest-coverage report instead. On DOCUMENT scans the
// rules stay fully active — this list never applies there.
//
// Classification principle (audited against axe-core 4.11.1 rule metadata):
// - RECLASSIFY absence/context-triggered rules — they fire because surrounding page
//   structure is missing, and that structure lives outside the scanned file.
// - RECLASSIFY document-element rules (<html>, <title>) — a fragment cannot carry them.
//   wrapFragment provides no lang/title, so these fire on a fragment and are reclassified here
//   as "not verifiable on this scan" rather than a masked pass — honest about the layout gap.
// - KEEP element-triggered rules — a bad element inside the fragment is real evidence.
//   Audited and deliberately excluded: heading-order (axe passes the first heading
//   unconditionally, so a fragment starting at <h3> does not false-positive; internal
//   skips are real), meta-viewport / meta-viewport-large / meta-refresh,
//   aria-hidden-body, accesskeys, tabindex, frame-* (all fire on a concrete element
//   present in the fragment).

export interface ContextualRule {
  rule_id: string
  wcag_criteria: string[] // [] = best-practice (no conformance impact)
  reason: string
}

export const PAGE_LEVEL_REASON =
  "Page-level rule — not verifiable on a per-file static scan of a fragment. Verify on the composed page: run 'equall scan' on your build output (e.g. dist/). Guide: https://equallscan.com/docs/verifying-page-level-rules"

const rule = (rule_id: string, wcag_criteria: string[] = []): ContextualRule => ({
  rule_id,
  wcag_criteria,
  reason: PAGE_LEVEL_REASON,
})

export const PAGE_LEVEL_RULES: ContextualRule[] = [
  // Absence/context-triggered — the actual fragment noise (region alone is typically
  // the majority of reported issues on fragment-heavy codebases).
  rule('region'),
  rule('landmark-one-main'),
  rule('page-has-heading-one'),
  rule('bypass', ['2.4.1']), // WCAG Level A — reclassifying it moves criteria_failed too
  rule('skip-link'), // the skip target anchor usually lives in another file
  rule('landmark-no-duplicate-banner'),
  rule('landmark-no-duplicate-contentinfo'),
  rule('landmark-no-duplicate-main'),
  rule('landmark-unique'), // role+name uniqueness is page-scoped
  rule('landmark-main-is-top-level'), // "top-level" is relative to the composed page
  rule('landmark-banner-is-top-level'),
  rule('landmark-complementary-is-top-level'),
  rule('landmark-contentinfo-is-top-level'),
  // Document-element rules — a fragment cannot carry <html>/<title> itself.
  rule('document-title', ['2.4.2']),
  rule('html-has-lang', ['3.1.1']),
  rule('html-lang-valid', ['3.1.1']),
  rule('html-xml-lang-mismatch', ['3.1.1']),
]

export const PAGE_LEVEL_RULE_IDS = new Set(PAGE_LEVEL_RULES.map((r) => r.rule_id))

// Split issues into kept violations and page-level findings on fragment files.
// Engine-agnostic: keyed on scanner_rule_id + the caller's per-file fragment flag,
// never on scanner internals. Issues on document files always pass through.
export function partitionPageLevelIssues(
  issues: EquallIssue[],
  isFragment: (filePath: string) => boolean
): { kept: EquallIssue[]; reclassified: EquallIssue[] } {
  const kept: EquallIssue[] = []
  const reclassified: EquallIssue[] = []
  for (const issue of issues) {
    if (PAGE_LEVEL_RULE_IDS.has(issue.scanner_rule_id) && isFragment(issue.file_path)) {
      reclassified.push(issue)
    } else {
      kept.push(issue)
    }
  }
  return { kept, reclassified }
}

// Collapse reclassified issues into the coverage surface — one entry per rule that
// actually fired (count > 0), never the whole catalog. Honest coverage: named and
// counted, so nothing is silently dropped.
export function summarizeReclassified(reclassified: EquallIssue[]): ReclassifiedRule[] {
  const byRule = new Map<string, ReclassifiedRule>()
  for (const issue of reclassified) {
    let entry = byRule.get(issue.scanner_rule_id)
    if (!entry) {
      entry = {
        rule_id: issue.scanner_rule_id,
        scanner: issue.scanner,
        reason: PAGE_LEVEL_REASON,
        count: 0,
        files: [],
        wcag_criteria: issue.wcag_criteria,
      }
      byRule.set(issue.scanner_rule_id, entry)
    }
    entry.count++
    if (!entry.files.includes(issue.file_path)) entry.files.push(issue.file_path)
  }
  return [...byRule.values()].sort((a, b) => b.count - a.count)
}
