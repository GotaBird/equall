// Public API — for programmatic usage
export { runScan, scanBuffer } from './scan.js'
export type { RunScanOptions, FileInput } from './scan.js'
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
