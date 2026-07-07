import type {
  ScannerAdapter,
  FileEntry,
  CoverageReport,
  CriterionCoverage,
  CoverageStatus,
  ReclassifiedRule,
} from './types.js'

// Honest coverage (T1.3): classify every criterion the active scanners are CAPABLE of
// by whether it was genuinely exercised on THIS scan's files.
//
// - `auto`    a scanner that received eligible files exercised it (and it isn't partial)
// - `partial` a scanner exercised it but only partially statically (e.g. contrast disabled)
// - `manual`  capable, but no scanner with eligible files covered it here → verify another way
//
// The rule that fixes the dishonesty: a scanner counts only if the scan actually contained
// files of one of its `fileTypes`. "Capable" is never reported as "tested".
export function computeCoverage(scanners: ScannerAdapter[], files: FileEntry[]): CoverageReport {
  const presentTypes = new Set(files.map((f) => f.type))
  const ran = scanners.filter((s) => s.fileTypes.some((t) => presentTypes.has(t)))

  // Criteria only partially testable, declared by the scanners that actually ran.
  const partialSet = new Set(ran.flatMap((s) => s.partialCriteria ?? []))

  // criterion → names of ran scanners that cover it
  const exercisedBy = new Map<string, string[]>()
  for (const s of ran) {
    for (const c of s.coveredCriteria) {
      const list = exercisedBy.get(c) ?? []
      list.push(s.name)
      exercisedBy.set(c, list)
    }
  }

  // Universe = what ALL active scanners are capable of (so capable-but-not-run shows as manual).
  const universe = [...new Set(scanners.flatMap((s) => s.coveredCriteria))].sort()

  const criteria: CriterionCoverage[] = universe.map((criterion) => {
    const coverers = exercisedBy.get(criterion) ?? []
    let status: CoverageStatus
    if (coverers.length === 0) status = 'manual'
    else if (partialSet.has(criterion)) status = 'partial'
    else status = 'auto'
    return { criterion, status, scanners: coverers }
  })

  const counts: Record<CoverageStatus, number> = { auto: 0, partial: 0, manual: 0 }
  for (const c of criteria) counts[c.status]++

  return {
    criteria,
    counts,
    auto_criteria: criteria.filter((c) => c.status === 'auto').map((c) => c.criterion),
  }
}

// BUR-159: the honest "criteria_tested" set — the criteria genuinely EXERCISED on this
// scan, the source of truth for the verdict and the POUR n/a gating. It starts from the
// coverage `auto` set (a scanner with eligible files actually exercised the criterion,
// not merely capable of it) and REMOVES any criterion reclassified out of violations on
// a fragment scan: a page-level rule (e.g. html-has-lang → 3.1.1, bypass → 2.4.1,
// document-title → 2.4.2) cannot be verified on a fragment, so it must not be reported as
// tested. Conservative by design — it under-claims rather than over-claims coverage.
export function honestTestedCriteria(
  coverage: CoverageReport,
  reclassified: ReclassifiedRule[]
): string[] {
  const removed = new Set(reclassified.flatMap((r) => r.wcag_criteria))
  return coverage.auto_criteria.filter((c) => !removed.has(c))
}

// The anti-"done" verdict (T1.3): the lines shown when static analysis found nothing to fix.
// It must NEVER claim the code is clean/done — only that automated checks found no failures,
// and always point at what automation cannot see. Returns plain lines (no ANSI).
export function formatNoFailureVerdict(coverage: CoverageReport | undefined): string[] {
  const lines = ['No automated failures found — automation is not the whole picture.']
  if (coverage) {
    const { auto, partial, manual } = coverage.counts
    lines.push(`${auto} criteria auto-tested · ${partial} partial · ${manual} need manual review.`)
  }
  lines.push('Automated tools catch ~30–40% of a11y issues. Run the rendered check and manual review (keyboard, screen reader, contrast in context) before calling it done.')
  return lines
}
