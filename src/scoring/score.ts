import type {
  GladosIssue,
  PourScores,
  PourPrinciple,
  ConformanceLevel,
  Severity,
  WcagLevel,
  ScanSummary,
  ScannerInfo,
  ScanResult,
} from '../types.js'

// Severity weight for scoring — critical issues impact score more
const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 10,
  serious: 5,
  moderate: 2,
  minor: 1,
}

// Maximum penalty per criterion to avoid one rule destroying the score
const MAX_PENALTY_PER_CRITERION = 15

export function computeScanResult(
  issues: GladosIssue[],
  filesScanned: number,
  scannersUsed: ScannerInfo[],
  durationMs: number,
  targetLevel: WcagLevel = 'AA',
  criteriaCovered: string[] = [],
  criteriaTotal: number = 0
): ScanResult {
  const summary = computeSummary(issues, filesScanned)
  const score = computeScore(issues, filesScanned)
  const pourScores = computePourScores(issues, filesScanned)
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
  }
}

function computeSummary(issues: GladosIssue[], filesScanned: number): ScanSummary {
  const bySeverity: Record<Severity, number> = {
    critical: 0,
    serious: 0,
    moderate: 0,
    minor: 0,
  }
  const byScanner: Record<string, number> = {}
  const criteriaSet = new Set<string>()
  const failedCriteriaSet = new Set<string>()

  for (const issue of issues) {
    bySeverity[issue.severity]++
    byScanner[issue.scanner] = (byScanner[issue.scanner] ?? 0) + 1
    for (const c of issue.wcag_criteria) {
      criteriaSet.add(c)
      failedCriteriaSet.add(c)
    }
  }

  return {
    files_scanned: filesScanned,
    total_issues: issues.length,
    by_severity: bySeverity,
    by_scanner: byScanner,
    criteria_tested: [...criteriaSet].sort(),
    criteria_failed: [...failedCriteriaSet].sort(),
  }
}

function computeScore(issues: GladosIssue[], filesScanned: number): number {
  if (issues.length === 0) return 100

  // Group issues by WCAG criterion and compute penalty per criterion
  const penaltyByCriterion = new Map<string, number>()

  for (const issue of issues) {
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

function computePourScores(issues: GladosIssue[], filesScanned: number): PourScores {
  const pourIssues: Record<PourPrinciple, GladosIssue[]> = {
    perceivable: [],
    operable: [],
    understandable: [],
    robust: [],
  }
  const pourCriteria: Record<PourPrinciple, Set<string>> = {
    perceivable: new Set(),
    operable: new Set(),
    understandable: new Set(),
    robust: new Set(),
  }

  for (const issue of issues) {
    if (!issue.pour) continue
    pourIssues[issue.pour].push(issue)
    for (const c of issue.wcag_criteria) {
      pourCriteria[issue.pour].add(c)
    }
  }

  const scaleFactor = 1 / (1 + Math.log10(Math.max(1, filesScanned)))
  const k = 0.02

  // Score per POUR: Same formula as global score but isolated to the principle
  function pourScore(principle: PourPrinciple): number | null {
    const principleIssues = pourIssues[principle]
    const criteriaCount = pourCriteria[principle].size

    if (criteriaCount === 0 && principleIssues.length === 0) return null
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
  issues: GladosIssue[],
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
