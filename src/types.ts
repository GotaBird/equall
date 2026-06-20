// Unified issue format — all scanners normalize to this
export interface EquallIssue {
  // Source scanner
  scanner: string                    // 'axe-core' | 'eslint-jsx-a11y' | 'html-validate' | ...
  scanner_rule_id: string            // Original rule ID from the scanner

  // WCAG mapping
  wcag_criteria: string[]            // ['1.1.1', '4.1.2'] — can map to multiple criteria
  wcag_level: WcagLevel | null       // 'A' | 'AA' | 'AAA' | null if unknown
  pour: PourPrinciple | null         // 'perceivable' | 'operable' | 'understandable' | 'robust'

  // Location
  file_path: string
  line: number | null
  column: number | null
  html_snippet: string | null        // The offending HTML element

  // Content
  severity: Severity
  message: string
  help_url: string | null            // Link to documentation

  // Fix
  suggestion: string | null          // How to fix it

  // Suppression
  ignored?: boolean                  // true if suppressed by equall-ignore comment

  // Stable identity (BUR-106) — survives reformatting; see utils/fingerprint.ts.
  // Populated by runScan() after dedup; absent on raw scanner output.
  // Hash of file_path + scanner_rule_id + sorted criteria + normalized html_snippet.
  fingerprint?: string
}

export type WcagLevel = 'A' | 'AA' | 'AAA'
export type PourPrinciple = 'perceivable' | 'operable' | 'understandable' | 'robust'
export type Severity = 'critical' | 'serious' | 'moderate' | 'minor'

// Scanner adapter interface — every scanner implements this
export interface ScannerAdapter {
  name: string
  version: string
  fileTypes: FileType[]                // File types this scanner consumes — drives honest
                                       // coverage: a scanner only counts if the scan had files
                                       // of one of these types (T1.3)
  coveredCriteria: string[]            // WCAG criteria this scanner is capable of testing
  partialCriteria?: string[]           // Criteria it only partially tests statically (e.g.
                                       // contrast disabled) → reported `partial`, never `auto`
  scan(context: ScanContext): Promise<EquallIssue[]>
  isAvailable(): Promise<boolean>     // Can this scanner run? (e.g., are deps installed?)
}

// Honest coverage (T1.3) — a criterion's real, exercised status on THIS scan.
// `auto`: genuinely tested (a scanner that received eligible files exercised it).
// `partial`: nominally covered but statically incomplete (e.g. contrast) → needs the rendered check.
// `manual`: a scanner is capable of it but received no eligible files here → verify another way.
export type CoverageStatus = 'auto' | 'partial' | 'manual'

export interface CriterionCoverage {
  criterion: string
  status: CoverageStatus
  scanners: string[]                   // scanners that exercised it (empty for `manual`)
}

export interface CoverageReport {
  criteria: CriterionCoverage[]
  counts: Record<CoverageStatus, number>
  auto_criteria: string[]              // criteria with status `auto` — the genuinely-checked set
}

// What we pass to each scanner
export interface ScanContext {
  root_path: string                   // Absolute path to the project root
  files: FileEntry[]                  // Files to scan
  options: ScanOptions
  in_memory?: boolean                 // true when files come from buffers (T1.1) and
                                      // do not exist on disk — scanners that read the
                                      // filesystem (eslint) must use their in-memory path
}

export interface FileEntry {
  path: string                        // Relative path from root
  absolute_path: string               // Absolute path
  content: string                     // File content
  type: FileType
}

export type FileType = 'html' | 'jsx' | 'tsx' | 'vue' | 'svelte' | 'astro' | 'other'

export interface ScanOptions {
  wcag_level: WcagLevel               // Target conformance level
  include_patterns: string[]          // Glob patterns to include
  exclude_patterns: string[]          // Glob patterns to exclude
}

// Scoring output
export interface ScanResult {
  score: number                        // 0-100
  conformance_level: ConformanceLevel
  pour_scores: PourScores
  issues: EquallIssue[]
  summary: ScanSummary
  scanners_used: ScannerInfo[]
  criteria_covered: string[]           // Union of all scanner coveredCriteria
  criteria_total: number               // Total WCAG criteria for the target level
  coverage?: CoverageReport            // Honest, exercised coverage (T1.3) — attached by runScan
  scanned_at: string                   // ISO timestamp
  duration_ms: number
}

export interface PourScores {
  perceivable: number | null           // 0-100, null if no criteria tested
  operable: number | null
  understandable: number | null
  robust: number | null
}

export type ConformanceLevel = 'AAA' | 'AA' | 'A' | 'Partial A' | 'None'

export interface ScanSummary {
  files_scanned: number
  total_issues: number
  by_severity: Record<Severity, number>
  by_scanner: Record<string, number>
  criteria_tested: string[]            // WCAG criteria IDs that were evaluated
  criteria_failed: string[]            // WCAG criteria IDs that had violations
  ignored_count: number                // Issues suppressed via equall-ignore comments
}

export interface ScannerInfo {
  name: string
  version: string
  rules_count: number
  issues_found: number
}
