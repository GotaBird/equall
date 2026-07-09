import type {
  EquallIssue,
  ConformanceLevel,
  Severity,
  WcagLevel,
  ScanSummary,
  ScannerInfo,
  ScanResult,
} from '../types.js'
import { ENGINE_VERSION } from '../engine-version.js'

// Severity weight for scoring — critical issues impact score more
const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 10,
  serious: 5,
  moderate: 2,
  minor: 1,
}

// Scoring-model version stamped on every ScanResult. Bump ONLY when the
// scoring formula or its input semantics change, so two outputs from different
// releases are comparable — model 2 replaces the capped/file-scaled model 1
// with rank-damped severity summing (see computeScore).
const SCORE_MODEL = 2

// Asymptotic decay rate, recalibrated for model 2 against a fixed dogfood
// corpus (minimizing score movement vs model 1 on repos where model 1 was
// not structurally wrong). Model 1 used 0.02 on a file-scaled penalty.
const SCORE_DECAY_K = 0.01

// WCAG level ordering, used to scope conformance to the requested target.
const LEVEL_RANK: Record<WcagLevel, number> = { A: 1, AA: 2, AAA: 3 }

// An issue is "beyond target" — advisory, not a conformance failure — when its
// WCAG level outranks the conformance target (e.g. a AAA criterion under an AA
// target). Such issues must not penalize the score or be framed as "must fix".
// Issues without a level (best-practice) are always in scope.
export function isBeyondTarget(issue: EquallIssue, targetLevel: WcagLevel): boolean {
  if (!issue.wcag_level) return false
  return LEVEL_RANK[issue.wcag_level] > LEVEL_RANK[targetLevel]
}

export function computeScanResult(
  issues: EquallIssue[],
  filesScanned: number,
  scannersUsed: ScannerInfo[],
  durationMs: number,
  targetLevel: WcagLevel = 'AA',
  criteriaCovered: string[] = [],
  criteriaTotal: number = 0,
  // The criteria genuinely EXERCISED on this scan (coverage `auto` set, minus
  // reclassified-on-fragment criteria) — see honestTestedCriteria in coverage.ts.
  // Distinct from `criteriaCovered` (the capable union, which still feeds the
  // stored `criteria_covered` field). Drives the honest `criteria_tested` set.
  // Defaults to [] so callers that don't have coverage
  // (early returns, unit tests) get an honest empty exercised set.
  exercised: string[] = []
): ScanResult {
  const summary = computeSummary(issues, filesScanned, exercised)
  const score = computeScore(issues, targetLevel)
  const conformanceLevel = computeConformanceLevel(issues, summary, targetLevel)

  return {
    score,
    conformance_level: conformanceLevel,
    issues,
    summary,
    scanners_used: scannersUsed,
    criteria_covered: criteriaCovered,
    criteria_total: criteriaTotal,
    scanned_at: new Date().toISOString(),
    duration_ms: durationMs,
    engine_version: ENGINE_VERSION,
    score_model: SCORE_MODEL,
  }
}

function computeSummary(issues: EquallIssue[], filesScanned: number, exercised: string[] = []): ScanSummary {
  const bySeverity: Record<Severity, number> = {
    critical: 0,
    serious: 0,
    moderate: 0,
    minor: 0,
  }
  const byScanner: Record<string, number> = {}
  const failedCriteriaSet = new Set<string>()

  for (const issue of issues) {
    bySeverity[issue.severity]++
    byScanner[issue.scanner] = (byScanner[issue.scanner] ?? 0) + 1
    for (const c of issue.wcag_criteria) {
      failedCriteriaSet.add(c)
    }
  }

  return {
    files_scanned: filesScanned,
    total_issues: issues.length,
    by_severity: bySeverity,
    by_scanner: byScanner,
    // criteria_tested is the genuinely EXERCISED set (coverage-derived),
    // NOT the issue-derived set (which equalled criteria_failed and made the verdict
    // coverage-blind). criteria_failed stays issue-derived — it IS the failure set.
    criteria_tested: [...exercised].sort(),
    criteria_failed: [...failedCriteriaSet].sort(),
    ignored_count: 0,
  }
}

// Scoring model 2 — rank-damped severity summing. The penalty is a function of
// the (deduplicated, non-ignored) issue multiset ONLY: no file count, no
// per-criterion cap, no opportunity denominator. Model 1's file scaling let the
// score rise by adding clean files (and structurally punished single-buffer
// scans), and its 15-point cap froze the score while fixes landed inside a
// saturated criterion. Model 2 guarantees instead:
//   fix-sensitivity  — resolving ANY single issue strictly raises the score
//                      (each issue contributes w/rank > 0);
//   padding-resistance — adding files/elements/engines that surface no issue
//                      cannot move the score (nothing else is an input);
//   mono-file fairness — a single-buffer scan and the same issues inside a
//                      repo produce the identical score.
// Within a criterion, weights are sorted descending and damped by rank
// (w₁/1 + w₂/2 + w₃/3 + …): the 30th identical failure weighs little, but
// every fix is credited at its OWN severity — a minor fix inside a
// critical-dominated criterion moves the score by its minor weight, not the
// group's maximum.
function computeScore(issues: EquallIssue[], targetLevel: WcagLevel): number {
  // Beyond-target criteria (e.g. AAA under an AA target) are advisory, not
  // conformance failures — they must not drag the conformance score down.
  const scoped = issues.filter(issue => !isBeyondTarget(issue, targetLevel))
  if (scoped.length === 0) return 100

  // Group issue weights by WCAG criterion (unmapped issues still penalize,
  // keyed per rule so distinct best-practice rules don't damp each other).
  const weightsByCriterion = new Map<string, number[]>()
  for (const issue of scoped) {
    const weight = SEVERITY_WEIGHT[issue.severity]
    const keys = issue.wcag_criteria.length > 0
      ? issue.wcag_criteria
      : [`_${issue.scanner}:${issue.scanner_rule_id}`]
    for (const key of keys) {
      const weights = weightsByCriterion.get(key) ?? []
      weights.push(weight)
      weightsByCriterion.set(key, weights)
    }
  }

  // Rank-damped sum per criterion: heaviest failures first, each divided by
  // its rank — repetition saturates smoothly with no hard cap.
  let totalPenalty = 0
  for (const weights of weightsByCriterion.values()) {
    weights.sort((a, b) => b - a)
    for (let i = 0; i < weights.length; i++) {
      totalPenalty += weights[i] / (i + 1)
    }
  }

  // Asymptotic curve: drops fast at first, never touches 0.
  const score = 100 * Math.exp(-SCORE_DECAY_K * totalPenalty)

  // Two-decimal precision: small fixes inside heavily damped criteria move
  // the score by fractions of a point — integer rounding would absorb them
  // and break fix-sensitivity.
  return Math.max(0, Math.round(score * 100) / 100)
}

function computeConformanceLevel(
  issues: EquallIssue[],
  summary: ScanSummary,
  targetLevel: WcagLevel
): ConformanceLevel {
  // Group failed criteria by level
  const failedByLevel: Record<WcagLevel, Set<string>> = {
    A: new Set(),
    AA: new Set(),
    AAA: new Set(),
  }

  for (const issue of issues) {
    if (!issue.wcag_level) continue
    for (const c of issue.wcag_criteria) {
      failedByLevel[issue.wcag_level].add(c)
    }
  }

  const hasA = failedByLevel.A.size > 0
  const hasAA = failedByLevel.AA.size > 0
  const hasAAA = failedByLevel.AAA.size > 0

  if (targetLevel === 'A') {
    if (!hasA) return summary.criteria_tested.length > 0 ? 'A' : 'None'
    return 'Partial A'
  }

  if (targetLevel === 'AA') {
    if (!hasA && !hasAA) return summary.criteria_tested.length > 0 ? 'AA' : 'None'
    if (!hasA) return 'A'
    return 'Partial A'
  }

  if (targetLevel === 'AAA') {
    if (!hasA && !hasAA && !hasAAA) return summary.criteria_tested.length > 0 ? 'AAA' : 'None'
    if (!hasA && !hasAA) return 'AA'
    if (!hasA) return 'A'
    return 'Partial A'
  }

  return 'None'
}
