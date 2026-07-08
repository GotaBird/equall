import type {
  CoverageReport,
  CoverageStatus,
  ConformanceVerdict,
  CriterionConformance,
  EquallIssue,
  WcagLevel,
  WcagStandard,
} from '../types.js'
import { getCriteriaForStandardLevel } from '../wcag-catalog.js'
import { honestTestedCriteria } from '../coverage.js'
import { PAGE_LEVEL_REASON } from '../rules/page-level.js'

// Documented bridge from the engine's honest, scan-scoped verdicts to the ITI VPAT/ACR
// vocabulary. The engine is the EVIDENCE layer — it never emits a bare "Supports" (that
// requires manual + assistive-technology testing). E3-A4 + human attestation apply these
// terms when building the accessibility statement / ACR. Keep in sync with the docs.
// `not_applicable` is intentionally absent: applicability is a human judgement (Phase B).
export const VERDICT_VPAT_MAP: Record<ConformanceVerdict, string> = {
  fail: 'Does Not Support / Partially Supports',
  pass_automated: 'Supports (automated basis — pending manual confirmation)',
  not_verifiable_on_this_scan: 'Not Evaluated (verify on rendered / built output)',
  not_tested_assisted: 'Not Evaluated (assisted / partial)',
  not_tested_manual: 'Not Evaluated (manual)',
}

const REASON_ASSISTED =
  'Partially testable by static analysis — confirm with a rendered/assisted check (e.g. contrast in context).'
const REASON_MANUAL =
  'No automated coverage on this scan — verify manually (keyboard, screen reader, human review).'
// 4.1.1 Parsing (WCAG 2.1 only, obsolete) — fixed pass under the wcag21 view (BUR-161).
const REASON_PARSING_OBSOLETE =
  'Obsolete per W3C erratum — satisfied by modern HTML parsers (removed in WCAG 2.2).'

// Pure derivation (BUR-160): one honest verdict per WCAG success criterion of the target
// level, from data the engine already produced — issues × coverage × reclassified. No
// scanning, no state, deterministic. Iterating the catalog for the level guarantees every
// target criterion is emitted exactly once, so the verdict buckets always sum to the level's
// criteria total (no criterion silently missing). `fail` is never diluted by an unexercised
// sub-check. See ConformanceVerdict for the vocabulary and VERDICT_VPAT_MAP for the VPAT bridge.
export function computeConformance(
  targetLevel: WcagLevel,
  standard: WcagStandard,
  issues: EquallIssue[],
  coverage: CoverageReport
): CriterionConformance[] {
  const active = issues.filter((i) => !i.ignored)

  // Criterion → failing-issue fingerprints (fail evidence). One issue can map to several
  // criteria, so it becomes evidence for each. Fingerprints are populated by runScan before
  // this runs; an issue missing one just contributes no evidence entry (verdict stays `fail`).
  const evidenceByCriterion = new Map<string, string[]>()
  const failed = new Set<string>()
  for (const issue of active) {
    for (const c of issue.wcag_criteria) {
      failed.add(c)
      if (issue.fingerprint) {
        const list = evidenceByCriterion.get(c) ?? []
        list.push(issue.fingerprint)
        evidenceByCriterion.set(c, list)
      }
    }
  }

  // Genuinely exercised this scan = coverage `auto` minus criteria reclassified out on a
  // fragment (single source of truth, shared with summary.criteria_tested — BUR-159).
  const reclassified = coverage.reclassified ?? []
  const exercised = new Set(honestTestedCriteria(coverage, reclassified))

  // Criterion → why it is not verifiable on this scan (page-level rule on a fragment).
  const reclassifiedReason = new Map<string, string>()
  for (const rule of reclassified) {
    for (const c of rule.wcag_criteria) {
      if (!reclassifiedReason.has(c)) reclassifiedReason.set(c, rule.reason || PAGE_LEVEL_REASON)
    }
  }

  // Criterion → capable coverage status. Absent from the map = no scanner is capable of it.
  const statusByCriterion = new Map<string, CoverageStatus>()
  for (const c of coverage.criteria) statusByCriterion.set(c.criterion, c.status)

  return getCriteriaForStandardLevel(standard, targetLevel).map((crit): CriterionConformance => {
    const id = crit.id
    const base = { criterion: id, level: crit.level, name: crit.name }

    // Priority cascade.
    if (failed.has(id)) {
      const evidence = evidenceByCriterion.get(id)
      return evidence?.length
        ? { ...base, verdict: 'fail', evidence }
        : { ...base, verdict: 'fail' }
    }
    // 4.1.1 Parsing appears only under the wcag21 view; no scanner maps to it (obsolete), so
    // fix it as an automated pass with the documented erratum reason, not "not tested".
    if (id === '4.1.1') {
      return { ...base, verdict: 'pass_automated', reason: REASON_PARSING_OBSOLETE }
    }
    if (exercised.has(id)) {
      return { ...base, verdict: 'pass_automated' }
    }
    if (reclassifiedReason.has(id)) {
      return { ...base, verdict: 'not_verifiable_on_this_scan', reason: reclassifiedReason.get(id) }
    }
    if (statusByCriterion.get(id) === 'partial') {
      return { ...base, verdict: 'not_tested_assisted', reason: REASON_ASSISTED }
    }
    return { ...base, verdict: 'not_tested_manual', reason: REASON_MANUAL }
  })
}
