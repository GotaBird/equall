import type {
  EquallIssue,
  PourScores,
  PourPrinciple,
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

// Maximum penalty per criterion to avoid one rule destroying the score
const MAX_PENALTY_PER_CRITERION = 15

// Scoring-model version stamped on every ScanResult. Bump ONLY when the
// scoring formula or its input semantics change, so two outputs from different
// releases are comparable — model 1 is the first stamped baseline.
const SCORE_MODEL = 1

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
  // stored `criteria_covered` field). Drives honest `criteria_tested` and the
  // POUR n/a gating. Defaults to [] so callers that don't have coverage
  // (early returns, unit tests) get an honest empty exercised set.
  exercised: string[] = []
): ScanResult {
  const summary = computeSummary(issues, filesScanned, exercised)
  const score = computeScore(issues, filesScanned, targetLevel)
  const pourScores = computePourScores(issues, filesScanned, exercised, targetLevel)
  const conformanceLevel = computeConformanceLevel(issues, summary, targetLevel)

  return {
    score,
    conformance_level: conformanceLevel,
    pour_scores: pourScores,
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

function computeScore(issues: EquallIssue[], filesScanned: number, targetLevel: WcagLevel): number {
  // Beyond-target criteria (e.g. AAA under an AA target) are advisory, not
  // conformance failures — they must not drag the conformance score down.
  const scoped = issues.filter(issue => !isBeyondTarget(issue, targetLevel))
  if (scoped.length === 0) return 100

  // Group issues by WCAG criterion and compute penalty per criterion
  const penaltyByCriterion = new Map<string, number>()

  for (const issue of scoped) {
    const weight = SEVERITY_WEIGHT[issue.severity]
    for (const criterion of issue.wcag_criteria) {
      const current = penaltyByCriterion.get(criterion) ?? 0
      penaltyByCriterion.set(criterion, Math.min(current + weight, MAX_PENALTY_PER_CRITERION))
    }
    // Issues without WCAG mapping still penalize
    if (issue.wcag_criteria.length === 0) {
      const key = `_${issue.scanner}:${issue.scanner_rule_id}`
      const current = penaltyByCriterion.get(key) ?? 0
      penaltyByCriterion.set(key, Math.min(current + weight, MAX_PENALTY_PER_CRITERION))
    }
  }

  const totalRawPenalty = [...penaltyByCriterion.values()].reduce((a, b) => a + b, 0)
  
  // Density-based scaling: scales down penalty for large projects
  const scaleFactor = 1 / (1 + Math.log10(Math.max(1, filesScanned)))
  const scaledPenalty = totalRawPenalty * scaleFactor

  // Asymptotic curve: k = 0.02 makes score drop fast but never touch 0
  const k = 0.02
  const score = 100 * Math.exp(-k * scaledPenalty)

  return Math.max(0, Math.round(score))
}

function computePourScores(issues: EquallIssue[], filesScanned: number, exercised: string[] = [], targetLevel: WcagLevel = 'AA'): PourScores {
  const pourIssues: Record<PourPrinciple, EquallIssue[]> = {
    perceivable: [],
    operable: [],
    understandable: [],
    robust: [],
  }

  // Map EXERCISED criteria to POUR principles (first digit: 1=P, 2=O, 3=U, 4=R).
  // Gate on the genuinely-exercised set, not the capable union — a principle
  // with no exercised criteria and no issues must read n/a (null), never a green 100.
  const POUR_BY_PREFIX: Record<string, PourPrinciple> = { '1': 'perceivable', '2': 'operable', '3': 'understandable', '4': 'robust' }
  const pourExercised: Record<PourPrinciple, boolean> = {
    perceivable: false,
    operable: false,
    understandable: false,
    robust: false,
  }
  for (const c of exercised) {
    const principle = POUR_BY_PREFIX[c[0]]
    if (principle) pourExercised[principle] = true
  }

  for (const issue of issues) {
    if (!issue.pour) continue
    // Keep POUR scores consistent with the global score: beyond-target
    // (advisory) criteria do not count against the principle.
    if (isBeyondTarget(issue, targetLevel)) continue
    pourIssues[issue.pour].push(issue)
  }

  const scaleFactor = 1 / (1 + Math.log10(Math.max(1, filesScanned)))
  const k = 0.02

  // Score per POUR: Same formula as global score but isolated to the principle
  function pourScore(principle: PourPrinciple): number | null {
    const principleIssues = pourIssues[principle]

    if (!pourExercised[principle] && principleIssues.length === 0) return null
    if (principleIssues.length === 0) return 100

    const penaltyByCriterion = new Map<string, number>()

    for (const issue of principleIssues) {
      const weight = SEVERITY_WEIGHT[issue.severity]
      for (const criterion of issue.wcag_criteria) {
        const current = penaltyByCriterion.get(criterion) ?? 0
        penaltyByCriterion.set(criterion, Math.min(current + weight, MAX_PENALTY_PER_CRITERION))
      }
      if (issue.wcag_criteria.length === 0) {
        const key = `_${issue.scanner}:${issue.scanner_rule_id}`
        const current = penaltyByCriterion.get(key) ?? 0
        penaltyByCriterion.set(key, Math.min(current + weight, MAX_PENALTY_PER_CRITERION))
      }
    }

    const totalRawPenalty = [...penaltyByCriterion.values()].reduce((a, b) => a + b, 0)
    const scaledPenalty = totalRawPenalty * scaleFactor

    return Math.max(0, Math.round(100 * Math.exp(-k * scaledPenalty)))
  }

  return {
    perceivable: pourScore('perceivable'),
    operable: pourScore('operable'),
    understandable: pourScore('understandable'),
    robust: pourScore('robust'),
  }
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
