import { resolve } from 'node:path'
import { discoverFiles, fileTypeForPath, sanitizeVirtualPath } from './discover.js'
import { getAvailableScanners } from './scanners/index.js'
import { computeScanResult } from './scoring/score.js'
import { computeCoverage, honestTestedCriteria } from './coverage.js'
import { computeConformance } from './conformance/index.js'
import { computeConfidenceFlags } from './confidence/index.js'
import { getCriteriaForStandardLevel } from './wcag-catalog.js'
import { fingerprint } from './utils/fingerprint.js'
import { isDocumentUnit } from './utils/html-extract.js'
import { partitionPageLevelIssues, summarizeReclassified } from './rules/page-level.js'
import { mergeCrossEngineDuplicates } from './rules/equivalence.js'
import type { ScanOptions, ScanResult, ScannerInfo, EquallIssue, WcagLevel, WcagStandard, FileEntry } from './types.js'

// A single in-memory file: code provided directly instead of read from disk (T1.1).
export interface FileInput {
  path: string                       // Relative path (extension drives file-type detection)
  content: string                    // File content
}

export interface RunScanOptions {
  path?: string
  level?: WcagLevel
  standard?: WcagStandard             // WCAG version view — 'wcag22' (default) | 'wcag21'
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

// Always-attach the report fields on the empty-scan early returns, so EVERY ScanResult carries
// the shape the README's "Programmatic use" documents — coverage / criterion_conformance /
// standard / confidence_flags are present, never `undefined`. No scanners ran on these paths →
// coverage is all-manual and conformance all not_tested_manual; confidence still reads the files
// (advisories are independent of the engines).
function attachEmptyReport(result: ScanResult, files: FileEntry[], scanOptions: ScanOptions, diagnostics: string[]): ScanResult {
  const standard = scanOptions.standard ?? 'wcag22'
  const coverage = computeCoverage([], files)
  coverage.reclassified = []
  result.coverage = coverage
  result.criterion_conformance = computeConformance(scanOptions.wcag_level, standard, [], coverage)
  result.standard = standard
  result.confidence_flags = computeConfidenceFlags(files)
  result.diagnostics = diagnostics
  return result
}

export async function runScan(options: RunScanOptions = {}): Promise<ScanResult> {
  const rootPath = resolve(options.path ?? process.cwd())
  const startTime = Date.now()

  const scanOptions: ScanOptions = {
    wcag_level: options.level ?? 'AA',
    standard: options.standard ?? 'wcag22',
    include_patterns: options.include ?? [],
    exclude_patterns: options.exclude ?? [],
  }

  // Non-fatal warnings collected during the scan (no scanners available, a scanner threw).
  // Returned on ScanResult.diagnostics instead of written to stderr — the CLI prints them;
  // a library / MCP consumer can capture them.
  const diagnostics: string[] = []

  // 1. Get files — from in-memory buffers (T1.1) or by discovering them on disk.
  const inMemory = options.files != null
  const files = inMemory
    ? buildFileEntries(options.files!, rootPath)
    : await discoverFiles(rootPath, scanOptions)
  if (files.length === 0) {
    const result = computeScanResult([], 0, [], Date.now() - startTime, scanOptions.wcag_level)
    return attachEmptyReport(result, files, scanOptions, diagnostics)
  }

  // 2. Get available scanners (minus any the user disabled via CLI flag)
  const disabled = new Set(options.disableScanners ?? [])
  const scanners = (await getAvailableScanners()).filter(s => !disabled.has(s.name))
  if (scanners.length === 0) {
    diagnostics.push('No scanners available. Install axe-core and jsdom for HTML scanning.')
    const result = computeScanResult([], files.length, [], Date.now() - startTime, scanOptions.wcag_level)
    return attachEmptyReport(result, files, scanOptions, diagnostics)
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
      diagnostics.push(`[scanner] failed: ${err.slice(0, 120)}`)
    }
  }

  // 5. Merge cross-engine duplicates (rule-equivalence table, conservative 1:1 —
  // see rules/equivalence.ts), then deduplicate within engines (same file + same
  // rule + same line = one issue). Both run before fingerprinting, so surviving
  // issues keep the identity they would have had anyway.
  const deduped = deduplicateIssues(mergeCrossEngineDuplicates(allIssues))

  // 5b. Reclassify page-level rules on fragment units — engine-agnostic
  // post-filter, after dedup (honest counts) and before ignores (an equall-ignore on a
  // reclassified issue is a harmless no-op, ignored_count stays meaningful). Reclassified
  // issues leave `issues` entirely and surface in coverage.reclassified (step 10).
  const fragmentByPath = new Map(files.map((f) => [f.path, !isDocumentUnit(f.content, f.type)]))
  const { kept, reclassified } = partitionPageLevelIssues(
    deduped,
    (path) => fragmentByPath.get(path) ?? true // unknown path → conservative: fragment
  )

  // 6. Apply equall-ignore comments
  const { active, ignored } = applyIgnoreComments(kept, files)

  // 7. Merge coverage from all active scanners.
  // criteria_covered is the CAPABLE union — it still feeds POUR scoring in score.ts and
  // is stored as-is; never route honest coverage into the score.
  const criteriaCovered = [...new Set(scanners.flatMap(s => s.coveredCriteria))].sort()

  // Total criteria for the selected standard + level — derived from the catalog (single
  // source of truth); never hardcoded. 2.2: A=31/AA=55/AAA=86 · 2.1: A=30/AA=50/AAA=78.
  const criteriaTotal = getCriteriaForStandardLevel(scanOptions.standard ?? 'wcag22', scanOptions.wcag_level).length

  // 7b. Honest coverage (T1.3) — exercised criteria only, never "capable" as "tested".
  // Computed BEFORE scoring so the genuinely-exercised set feeds the honest
  // criteria_tested + POUR n/a gating. The reclassified summary is what honestTestedCriteria
  // subtracts (page-level rules that can't be verified on a fragment).
  const coverage = computeCoverage(scanners, files)
  coverage.reclassified = summarizeReclassified(reclassified)
  const exercised = honestTestedCriteria(coverage, coverage.reclassified)

  // 8. Compute score (only active issues affect scoring). `exercised` drives the honest
  // criteria_tested and the POUR n/a gating; `criteriaCovered` stays the stored capable union.
  const durationMs = Date.now() - startTime
  const result = computeScanResult(active, files.length, scannersUsed, durationMs, scanOptions.wcag_level, criteriaCovered, criteriaTotal, exercised)

  // 9. Attach stable fingerprints — identity for diff-aware scanning.
  // Metadata only: does not affect scoring (computed above from `active`).
  const withFingerprint = (list: EquallIssue[]): EquallIssue[] =>
    list.map((issue) => ({ ...issue, fingerprint: fingerprint(issue) }))

  // Include ignored issues in output for transparency, update count
  const activeFingerprinted = withFingerprint(active)
  result.issues = [...activeFingerprinted, ...withFingerprint(ignored)]
  result.summary.ignored_count = ignored.length

  // 10. Attach the honest coverage report computed above.
  // Always attached ([] when none) so the emitted JSON shape stays stable.
  result.coverage = coverage

  // 11. Per-criterion conformance — the audit report backbone. Pure derivation from
  // the fingerprinted active issues × coverage; `evidence` reuses the fingerprints attached
  // above. Same additive-attach pattern as coverage (absent on the early-return paths).
  // Pass ALL issues (active + ignored) so conformance can count accepted_exceptions per criterion;
  // it re-filters to active for the failing set, so the ignored ones never become failures.
  result.criterion_conformance = computeConformance(scanOptions.wcag_level, scanOptions.standard ?? 'wcag22', result.issues, coverage)

  // 12. Stamp the standard the conformance view was rendered against.
  result.standard = scanOptions.standard ?? 'wcag22'

  // 13. Alt-quality confidence flags — an ADVISORY over the raw file contents. Runs
  // after the score + verdicts and only reads `files`, so it cannot alter any of them. Always
  // attached ([] when none) for a stable JSON shape.
  result.confidence_flags = computeConfidenceFlags(files)

  // 14. Non-fatal scan warnings — returned on the result, never written to the host's stderr.
  result.diagnostics = diagnostics

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
