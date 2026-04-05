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
}

export type WcagLevel = 'A' | 'AA' | 'AAA'
export type PourPrinciple = 'perceivable' | 'operable' | 'understandable' | 'robust'
export type Severity = 'critical' | 'serious' | 'moderate' | 'minor'

// Scanner adapter interface — every scanner implements this
export interface ScannerAdapter {
  name: string
  version: string
  coveredCriteria: string[]            // WCAG criteria this scanner is capable of testing
  scan(context: ScanContext): Promise<EquallIssue[]>
  isAvailable(): Promise<boolean>     // Can this scanner run? (e.g., are deps installed?)
}

// What we pass to each scanner
export interface ScanContext {
  root_path: string                   // Absolute path to the project root
  files: FileEntry[]                  // Files to scan
  options: ScanOptions
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
