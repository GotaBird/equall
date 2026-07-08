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

  // Stable identity — survives reformatting; see utils/fingerprint.ts.
  // Populated by runScan() after dedup; absent on raw scanner output.
  // Hash of file_path + scanner_rule_id + sorted criteria + normalized html_snippet.
  fingerprint?: string

  // Engines that independently confirmed this issue — populated only when equivalent
  // findings from different engines were merged (see rules/equivalence.ts). `scanner`
  // still names the surviving engine, so existing consumers are unaffected.
  scanners?: string[]
}

export type WcagLevel = 'A' | 'AA' | 'AAA'
// The WCAG version the conformance VIEW is rendered against. `wcag22` (default) is
// Equall's identity; `wcag21` is the public-sector legal bar (WAD / EN 301 549). A view filter
// only — it never changes the score. See getCriteriaForStandardLevel in wcag-catalog.ts.
export type WcagStandard = 'wcag22' | 'wcag21'
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

// A page-level rule reclassified out of violations on a fragment scan.
// Honest coverage: named, counted, never silently dropped. Engine-agnostic shape —
// `scanner` is 'axe-core' today, but the suppression layer is designed for any engine.
export interface ReclassifiedRule {
  rule_id: string
  scanner: string
  reason: string
  count: number                        // occurrences reclassified this scan
  files: string[]                      // unique affected files
  wcag_criteria: string[]              // [] for best-practice rules
}

export interface CoverageReport {
  criteria: CriterionCoverage[]
  counts: Record<CoverageStatus, number>
  auto_criteria: string[]              // criteria with status `auto` — the genuinely-checked set
  // Both halves are deliberate: the `?` keeps older JSON consumers type-compatible,
  // while runScan ALWAYS attaches it (`[]` when none) so the emitted shape stays stable.
  // Do not remove the `?` and do not make the attachment conditional.
  reclassified?: ReclassifiedRule[]
}

// Per-criterion conformance — the honest, scan-scoped verdict the audit
// report stands on. Pure derivation from issues × coverage × reclassified; no scanning,
// no scoring. This is the EVIDENCE layer, NOT the VPAT: the engine states only what
// automation established this scan, and a documented map (VERDICT_VPAT_MAP in
// conformance/) translates each verdict to the ITI VPAT vocabulary in E3-A4 + human
// attestation. Automation never emits a bare "Supports".
export type ConformanceVerdict =
  | 'fail'                         // ≥1 active issue maps to the criterion — fail always wins
  | 'pass_automated'              // exercised `auto` this scan, zero issues (automated checks only)
  | 'not_verifiable_on_this_scan' // reclassified page-level rule on a fragment — verify on the rendered page
  | 'not_tested_assisted'         // coverage `partial` (e.g. contrast) — needs a rendered/assisted check
  | 'not_tested_manual'           // coverage `manual` or uncovered — verify manually

export interface CriterionConformance {
  criterion: string                    // '1.4.3'
  level: WcagLevel                     // from the WCAG catalog
  name: string                         // criterion name from the catalog (inline for report/MCP)
  verdict: ConformanceVerdict
  evidence?: string[]                  // failing issue fingerprints — `fail` only
  reason?: string                      // why not verifiable / not tested — verdicts 3–5 only
}

// Alt-quality confidence flag — an ADVISORY, never a WCAG failure. Surfaces a
// present-but-suspect `alt` (a filename, a generic placeholder, the src basename) that passes
// automated checks (so the criterion's verdict stays `pass_automated`) but is likely useless to
// a screen-reader user. Orthogonal metadata: it never touches issues, verdicts, the score, or
// coverage. Precision-first — it only fires on near-certain junk. Routes to human/agent review.
export interface ConfidenceFlag {
  criterion: string                    // the criterion the advisory relates to (e.g. '1.1.1')
  signal: string                       // which precision signal fired (see src/confidence)
  value: string                        // the offending attribute value (the alt text)
  file_path: string
  line?: number                        // best-effort; absent when not derivable
  reason: string                       // plain-language why it looks suspect
  confidence: 'low'                    // advisory only — reserved for future tiers
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
  standard?: WcagStandard             // WCAG version view — 'wcag22' (default) | 'wcag21'
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
  // Per-criterion conformance — the audit report backbone. Like `coverage?`, the `?`
  // is for older-consumer compatibility; runScan ALWAYS attaches it (absent only on the
  // early-return paths that also omit `coverage`). Never routed into the score.
  criterion_conformance?: CriterionConformance[]
  // WCAG standard the conformance view was rendered against. Optional for older
  // consumers; runScan always sets it. `wcag22` (default) or `wcag21` (the legal-bar view).
  standard?: WcagStandard
  // Alt-quality advisories — additive, attached by runScan ([] when none). Never
  // routed into the score, verdicts, coverage, or issues; a review suggestion only.
  confidence_flags?: ConfidenceFlag[]
  scanned_at: string                   // ISO timestamp
  duration_ms: number
  // Version stamps so results are comparable across releases.
  // Optional to keep older JSON consumers type-compatible, but runScan / computeScanResult
  // ALWAYS populate them — like `coverage?`, the `?` is compatibility, not "sometimes absent".
  // Per-scanner versions live in `scanners_used[].version`.
  engine_version?: string              // Engine (package) version, e.g. "0.1.12"
  score_model?: number                 // Scoring-model version (bumped when the formula/semantics change)
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
