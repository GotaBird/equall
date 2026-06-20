import { resolve } from 'node:path'
import { discoverFiles, fileTypeForPath, sanitizeVirtualPath } from './discover.js'
import { getAvailableScanners } from './scanners/index.js'
import { computeScanResult } from './scoring/score.js'
import { computeCoverage } from './coverage.js'
import { fingerprint } from './utils/fingerprint.js'
import type { ScanOptions, ScanResult, ScannerInfo, EquallIssue, WcagLevel, FileEntry } from './types.js'

// A single in-memory file: code provided directly instead of read from disk (T1.1).
export interface FileInput {
  path: string                       // Relative path (extension drives file-type detection)
  content: string                    // File content
}

export interface RunScanOptions {
  path?: string
  level?: WcagLevel
  include?: string[]
  exclude?: string[]
  disableScanners?: string[]
  // In-memory input (T1.1): when provided, scan these buffers instead of discovering
  // files on disk. Unblocks the MCP (T1.4) and diff-aware scanning (T1.2).
  files?: FileInput[]
}

// Build FileEntry[] from caller-supplied buffers, mirroring what discoverFiles
// produces on disk. Paths are untrusted input → sanitized against traversal/absolute.
function buildFileEntries(inputs: FileInput[], rootPath: string): FileEntry[] {
  return inputs.map((input) => {
    const relativePath = sanitizeVirtualPath(input.path)
    return {
      path: relativePath,
      absolute_path: resolve(rootPath, relativePath),
      content: input.content,
      type: fileTypeForPath(relativePath),
    }
  })
}

export async function runScan(options: RunScanOptions = {}): Promise<ScanResult> {
  const rootPath = resolve(options.path ?? process.cwd())
  const startTime = Date.now()

  const scanOptions: ScanOptions = {
    wcag_level: options.level ?? 'AA',
    include_patterns: options.include ?? [],
    exclude_patterns: options.exclude ?? [],
  }

  // 1. Get files — from in-memory buffers (T1.1) or by discovering them on disk.
  const inMemory = options.files != null
  const files = inMemory
    ? buildFileEntries(options.files!, rootPath)
    : await discoverFiles(rootPath, scanOptions)
  if (files.length === 0) {
    return computeScanResult([], 0, [], Date.now() - startTime, scanOptions.wcag_level)
  }

  // 2. Get available scanners (minus any the user disabled via CLI flag)
  const disabled = new Set(options.disableScanners ?? [])
  const scanners = (await getAvailableScanners()).filter(s => !disabled.has(s.name))
  if (scanners.length === 0) {
    console.warn('No scanners available. Install axe-core and jsdom for HTML scanning.')
    return computeScanResult([], files.length, [], Date.now() - startTime, scanOptions.wcag_level)
  }

  // 3. Run all scanners in parallel
  const scanContext = { root_path: rootPath, files, options: scanOptions, in_memory: inMemory }

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
  const allIssues: EquallIssue[] = []
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

  // 6. Apply equall-ignore comments
  const { active, ignored } = applyIgnoreComments(deduped, files)

  // 7. Merge coverage from all active scanners
  const criteriaCovered = [...new Set(scanners.flatMap(s => s.coveredCriteria))].sort()

  // Total WCAG 2.2 criteria per level (4.1.1 Parsing excluded — obsolete in 2.2)
  const WCAG_TOTAL: Record<string, number> = { A: 32, AA: 56, AAA: 86 }
  const criteriaTotal = WCAG_TOTAL[scanOptions.wcag_level] ?? 56

  // 8. Compute score (only active issues affect scoring)
  const durationMs = Date.now() - startTime
  const result = computeScanResult(active, files.length, scannersUsed, durationMs, scanOptions.wcag_level, criteriaCovered, criteriaTotal)

  // 9. Attach stable fingerprints — identity for diff-aware scanning (BUR-106).
  // Metadata only: does not affect scoring (computed above from `active`).
  const withFingerprint = (list: EquallIssue[]): EquallIssue[] =>
    list.map((issue) => ({ ...issue, fingerprint: fingerprint(issue) }))

  // Include ignored issues in output for transparency, update count
  result.issues = [...withFingerprint(active), ...withFingerprint(ignored)]
  result.summary.ignored_count = ignored.length

  // 10. Honest coverage (T1.3) — exercised criteria only, never "capable" as "tested".
  // Additive: does NOT touch criteria_covered (which feeds POUR scoring).
  result.coverage = computeCoverage(scanners, files)

  return result
}

// Scan a single in-memory file (T1.1). Thin wrapper over runScan's buffer path —
// the entry point the MCP (T1.4) and diff-aware scanning (T1.2) build on.
export function scanBuffer(
  content: string,
  filename: string,
  options: Omit<RunScanOptions, 'files' | 'path'> = {}
): Promise<ScanResult> {
  return runScan({ ...options, files: [{ path: filename, content }] })
}

// Apply equall-ignore comments to suppress known false positives.
// Issues with ignored: true are excluded from scoring but included in JSON output.
export function applyIgnoreComments(
  issues: EquallIssue[],
  files: FileEntry[]
): { active: EquallIssue[]; ignored: EquallIssue[] } {
  // Build a map of file contents for quick lookup
  const fileContentMap = new Map<string, string[]>()
  for (const file of files) {
    const lines = file.content.split('\n')
    fileContentMap.set(file.path, lines)
  }

  // Check which files have equall-ignore-file in the first 5 lines
  const ignoredFiles = new Set<string>()
  for (const [filePath, lines] of fileContentMap) {
    const header = lines.slice(0, 5)
    if (header.some(line => line.includes('equall-ignore-file'))) {
      ignoredFiles.add(filePath)
    }
  }

  const active: EquallIssue[] = []
  const ignored: EquallIssue[] = []

  for (const issue of issues) {
    // File-level ignore
    if (ignoredFiles.has(issue.file_path)) {
      ignored.push({ ...issue, ignored: true })
      continue
    }

    // Line-level ignore (only if issue has a line number)
    if (issue.line != null && issue.line > 1) {
      const lines = fileContentMap.get(issue.file_path)
      if (lines) {
        const prevLine = lines[issue.line - 2] ?? '' // -2 because lines are 0-indexed in array
        if (prevLine.includes('equall-ignore-next-line')) {
          // Check if a specific rule-id is specified
          // Strip comment closing tokens (-->, */, */}) before matching
          const stripped = prevLine.replace(/\s*(?:-->|\*\/\}?)\s*$/g, '')
          const match = stripped.match(/equall-ignore-next-line\s+([\w\-/.]+)/)
          if (match) {
            // Only ignore if rule-id matches
            if (match[1] === issue.scanner_rule_id) {
              ignored.push({ ...issue, ignored: true })
              continue
            }
          } else {
            // No rule-id = ignore all issues on that line
            ignored.push({ ...issue, ignored: true })
            continue
          }
        }
      }
    }

    active.push(issue)
  }

  return { active, ignored }
}

// Deduplicate issues from multiple scanners that flag the same problem.
// Two issues are considered duplicates if they target the same file, same WCAG criteria,
// and same location (line or HTML element).
export function deduplicateIssues(issues: EquallIssue[]): EquallIssue[] {
  const seen = new Set<string>()
  const result: EquallIssue[] = []

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
