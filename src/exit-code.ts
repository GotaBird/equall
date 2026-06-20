import type { ScanResult } from './types.js'

/**
 * Exit-code policy for `scan`, extracted as a pure function so it is unit-testable
 * (asserting `process.exit` directly is impractical).
 *
 * A scan that ran successfully exits `0` — the score gate is opt-in via
 * `--min-score`, so interactive runs never look like a failure.
 *   0 — scan completed (default), or score is at/above the threshold
 *   1 — `minScore` was given and the score is strictly below it
 *
 * Process-level errors (thrown during the scan) exit `2` from the CLI's catch
 * handler and never reach this function.
 */
export function computeExitCode(result: Pick<ScanResult, 'score'>, minScore: number | null): number {
  if (minScore !== null && result.score < minScore) return 1
  return 0
}
