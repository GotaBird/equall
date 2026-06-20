// Public API — for programmatic usage
export { runScan, scanBuffer } from './scan.js'
export type { RunScanOptions, FileInput } from './scan.js'
export { runDiffScan, formatDiffGuardrail } from './diff-scan.js'
export type { DiffScanOptions, DiffScanResult } from './diff-scan.js'
export { computeCoverage, formatNoFailureVerdict } from './coverage.js'
export type { CoverageReport, CriterionCoverage, CoverageStatus } from './types.js'
export { computeScanResult } from './scoring/score.js'
export { fingerprint } from './utils/fingerprint.js'
export type {
  EquallIssue,
  ScanResult,
  PourScores,
  ConformanceLevel,
  ScannerAdapter,
  ScanContext,
  ScanOptions,
  Severity,
  WcagLevel,
  PourPrinciple,
} from './types.js'
