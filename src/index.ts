// Public API — for programmatic usage
export { runScan } from './scan.js'
export type { RunScanOptions } from './scan.js'
export { computeScanResult } from './scoring/score.js'
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
