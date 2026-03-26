import { resolve } from 'node:path'
import { discoverFiles } from './discover.js'
import { getAvailableScanners } from './scanners/index.js'
import { computeScanResult } from './scoring/score.js'
import type { ScanOptions, ScanResult, ScannerInfo, GladosIssue, WcagLevel } from './types.js'

export interface RunScanOptions {
  path?: string
  level?: WcagLevel
  include?: string[]
  exclude?: string[]
}

export async function runScan(options: RunScanOptions = {}): Promise<ScanResult> {
  const rootPath = resolve(options.path ?? process.cwd())
  const startTime = Date.now()

  const scanOptions: ScanOptions = {
    wcag_level: options.level ?? 'AA',
    include_patterns: options.include ?? [],
    exclude_patterns: options.exclude ?? [],
  }

  // 1. Discover files
  const files = await discoverFiles(rootPath, scanOptions)
  if (files.length === 0) {
    return computeScanResult([], 0, [], Date.now() - startTime, scanOptions.wcag_level)
  }

  // 2. Get available scanners
  const scanners = await getAvailableScanners()
  if (scanners.length === 0) {
    console.warn('No scanners available. Install axe-core and jsdom for HTML scanning.')
    return computeScanResult([], files.length, [], Date.now() - startTime, scanOptions.wcag_level)
  }

  // 3. Run all scanners in parallel
  const scanContext = { root_path: rootPath, files, options: scanOptions }

  const scannerResults = await Promise.allSettled(
    scanners.map(async (scanner) => {
      const issues = await scanner.scan(scanContext)
      return {
        scanner,
        issues,
      }
    })
  )

  // 4. Aggregate results
  const allIssues: GladosIssue[] = []
  const scannersUsed: ScannerInfo[] = []

  for (const result of scannerResults) {
    if (result.status === 'fulfilled') {
      const { scanner, issues } = result.value
      allIssues.push(...issues)
      scannersUsed.push({
        name: scanner.name,
        version: scanner.version,
        rules_count: 0, // Could be enhanced per scanner
        issues_found: issues.length,
      })
    } else {
      const err = result.reason instanceof Error ? result.reason.message : String(result.reason)
      console.warn(`  [scanner] Failed: ${err.slice(0, 120)}`)
    }
  }

  // 5. Deduplicate issues (same file + same rule + same line = one issue)
  const deduped = deduplicateIssues(allIssues)

  // 6. Merge coverage from all active scanners
  const criteriaCovered = [...new Set(scanners.flatMap(s => s.coveredCriteria))].sort()

  // Total WCAG 2.2 criteria per level
  const WCAG_TOTAL: Record<string, number> = { A: 30, AA: 57, AAA: 78 }
  const criteriaTotal = WCAG_TOTAL[scanOptions.wcag_level] ?? 57

  // 7. Compute score
  const durationMs = Date.now() - startTime
  return computeScanResult(deduped, files.length, scannersUsed, durationMs, scanOptions.wcag_level, criteriaCovered, criteriaTotal)
}

// Deduplicate issues from multiple scanners that flag the same problem.
// Two issues are considered duplicates if they target the same file, same WCAG criteria,
// and same location (line or HTML element).
function deduplicateIssues(issues: GladosIssue[]): GladosIssue[] {
  const seen = new Set<string>()
  const result: GladosIssue[] = []

  for (const issue of issues) {
    // Sort criteria so ["4.1.2", "2.4.4"] and ["2.4.4", "4.1.2"] produce the same key
    const sortedCriteria = [...issue.wcag_criteria].sort().join(',')

    // Location: prefer line+column (ESLint), fall back to scanner_rule_id (axe-core has no lines)
    const location = issue.line != null
      ? `L${issue.line}:${issue.column ?? 0}`
      : issue.html_snippet?.slice(0, 80) ?? 'no-loc'

    const key = `${issue.file_path}|${sortedCriteria}|${location}`

    if (!seen.has(key)) {
      seen.add(key)
      result.push(issue)
    }
  }

  return result
}
