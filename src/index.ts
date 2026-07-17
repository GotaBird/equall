// Public API — for programmatic usage.
//
// The contract is the RESULT. `runScan`/`scanBuffer`/`runDiffScan` produce a `ScanResult`
// (or a diff result); `fingerprint` recomputes stable issue identity; `formatDiffGuardrail`
// renders the diff guardrail line. Internal producers (`computeScanResult`, `computeConformance`,
// `computeCoverage`, …) are intentionally NOT exported — consume the result, don't rebuild it.
// Everything needed to fully TYPE a `ScanResult` is exported below.
export { runScan, scanBuffer } from './scan.js'
export type { RunScanOptions, FileInput } from './scan.js'
export { runDiffScan, formatDiffGuardrail } from './diff-scan.js'
export type { DiffScanOptions, DiffScanResult } from './diff-scan.js'
export { fingerprint } from './utils/fingerprint.js'

export type {
  // The result and everything reachable from it
  ScanResult,
  ScanSummary,
  ScannerInfo,
  EquallIssue,
  Severity,
  WcagLevel,
  WcagStandard,
  PourPrinciple,
  ConformanceLevel,
  CoverageReport,
  CriterionCoverage,
  CoverageStatus,
  ReclassifiedRule,
  CriterionConformance,
  ConformanceVerdict,
  ConfidenceFlag,
  RouteInfo,
  RouteFramework,
  // Inputs / adapter contract
  ScanContext,
  ScanOptions,
  ScannerAdapter,
} from './types.js'
