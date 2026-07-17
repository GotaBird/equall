# Changelog

All notable changes to Equall CLI are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Route inventory from file-based routing.** Disk scans now carry `ScanResult.routes` — the
  URL patterns the project's file-based routing defines: Next.js App Router (`app/**/page.*`,
  route groups stripped), Next.js Pages Router (`pages/**` — mapped only when the project
  declares Next via a dependency or `next.config.*`, so a repo that merely has a `pages/`
  folder never grows phantom routes; API routes excluded), Astro (`src/pages/**`), and plain
  `.html` trees (fallback only, so a framework project's stray HTML never becomes a route). Each entry is `{ pattern, file, framework, dynamic }`, with
  dynamic segments keeping their bracket syntax (`/products/[slug]`). The field is tri-state:
  absent when detection was not attempted (in-memory input), `[]` when the scanned tree had no
  supported routing — both declared on `diagnostics`, never silently. Projects using SvelteKit
  or Nuxt routing get an explicit diagnostic that their routes are not yet mapped, and pages
  under Next.js parallel/intercepting segments are declared rather than guessed. Routes are
  inventory metadata only — they never affect the score, verdicts, or coverage. The terminal
  Summary shows a quiet per-framework count when routes are found; the new `RouteInfo` and
  `RouteFramework` types are exported.
  Known limitations: a custom Next `pageExtensions` and a custom Astro `srcDir` are not
  parsed, and detection is anchored to the scanned root (monorepo sub-apps: scan the package
  directory).

### Fixed

- **The score headline and the Support Summary now agree on the criteria counts.** The
  "N criteria automatically verified (M not evaluated)" line counted every exercised criterion —
  including beyond-target ones (e.g. AAA 3.1.5 Reading Level under an AA target) — against the
  level-scoped total, overstating "verified" and understating "not evaluated" by the same amount
  (e.g. 25/30 next to a Support Summary saying 23/32). Both lines now derive from the same
  per-criterion conformance verdicts, so they can no longer disagree.

## [0.2.0] - 2026-07-09

### Removed

- **The programmatic surface is curated down to the result contract.** The package no longer
  exports the internal producers `computeScanResult`, `computeConformance`, `computeCoverage`,
  `VERDICT_VPAT_MAP`, and `formatNoFailureVerdict` — breaking for consumers that rebuilt a
  result from the pieces: consume the `ScanResult` instead. The entry points are `runScan`,
  `scanBuffer`, `runDiffScan`, `formatDiffGuardrail`, and `fingerprint`, and the exported types
  now cover everything reachable from a `ScanResult` (adding `WcagStandard`, `ConfidenceFlag`,
  `ScanSummary`, `ScannerInfo`, `ReclassifiedRule`).
- **The POUR score breakdown (`pour_scores`) is gone.** The per-principle Perceivable / Operable /
  Understandable / Robust bars were a demoted-score artifact that masked which criteria actually
  failed or went unevaluated — the per-criterion Support Summary supersedes them. `ScanResult` no
  longer carries `pour_scores` (breaking for any consumer that read it); the per-issue `pour` field
  is unchanged.

### Fixed

- **Empty and no-scanner scans now carry the full `ScanResult` shape.** `coverage`,
  `criterion_conformance`, `standard`, and `confidence_flags` (documented in the programmatic API)
  are attached on **every** scan, including the early-return paths — previously a scan with no
  scannable files returned them as `undefined`, contradicting the docs.

### Changed

- **Scoring model 2 — your score will move, and here is why.** The score is now a function of the
  deduplicated issue set **only**: the file-count scaling and the 15-point per-criterion cap are
  gone, replaced by rank-damped severity summing (within a criterion, the heaviest failures count
  first and each repeat weighs less — but every failure weighs something). This fixes two real
  integrity defects in the old formula:
  - *Adding clean files raised the score.* The old density scaling divided the penalty by a log of
    the file count, so 20 inert files could lift a score by 10+ points — and single-buffer scans
    (the API/MCP path) were structurally penalized. Now the file count never touches the score:
    small repos and single-component scans stop being punished (they typically **rise**), and
    padding a repo cannot move the number.
  - *Fixes inside a saturated criterion were invisible.* With the cap, going from 30 missing alts
    to 5 left the score identical. Now **every fix strictly raises the score**, credited at the
    severity of the issue actually fixed — repos with one spammy criterion typically **drop**,
    because that criterion finally weighs its real size.
  The decay constant is recalibrated (0.02 → 0.01) so scores stay comparable in magnitude, and the
  score now carries two decimals — small fixes inside a heavily repeated criterion move the number
  by fractions of a point, and integer rounding would have swallowed them. `score_model` is
  stamped `2`; **do not compare scores across model versions** — re-scan both sides of any
  comparison with the same CLI version. The score remains a trend indicator, never a conformance
  claim; the full rationale lives in `docs/score-philosophy.md`.
- **Tighter, less repetitive terminal output.** The redundant top blocks are gone: the `Coverage`
  line(s) and the coaching block restated the failing set the headline (score + verdict + Support
  Summary) already states — the same count appeared up to six times. The scanner list moved behind
  `--verbose`. A default scan now reads cleanly: what was scanned → the violations (same detail) →
  the read-first headline.
- **The engine no longer writes to your stderr.** Non-fatal scan warnings (no scanners available,
  a scanner threw) are collected on the new `ScanResult.diagnostics` field instead of being
  `console.warn`'d from `runScan` — a library / MCP consumer can capture them, and `--json` output
  carries them. The CLI still prints them to stderr.
- **"Not verifiable on this scan" now tells you how to verify.** Page-level rules (landmarks,
  skip link, document title, `<html lang>`) reclassified out of a fragment scan — and the
  matching `not_verifiable_on_this_scan` conformance verdict — now name the concrete next step:
  run `equall scan` on your **built output** (`dist/`), where those rules execute as real
  documents and their criteria move from "Not evaluated" to Supports / Does-not-support. Both
  the terminal section and the verdict `reason` carry the command + a link to the guide. No new
  capability — the same static scan, pointed at the composed page.
- **Fragments no longer falsely pass page title / language.** A component can't know the page's
  `<title>` or `lang` — they live in the layout — so `document-title` (2.4.2) and `html-has-lang`
  (3.1.1) now read `not_verifiable_on_this_scan` on a fragment scan instead of a masked "Supports
  (automated)". They evaluate honestly on a document / built-output scan (this is what makes the
  post-build coverage uplift real).
- **WCAG criteria totals corrected — a real over-count is fixed.** `2.5.6 Concurrent Input
  Mechanisms` was mis-catalogued as Level A; it is Level AAA. So the WCAG 2.2 totals drop by
  one: Level A 32→31, Level A+AA 56→55 (`criteria_total` in the JSON). Totals are now derived
  from the catalog (single source of truth) instead of hardcoded, so this class of drift can't
  recur. This is a correction, not a scope change.
- **The verdict now states what was actually verified, and never claims conformance.** A scan
  whose only finding was a AAA advisory used to print "Meets WCAG AA"; a clean scan reported
  "None". Both were misleading. The score header now reads, e.g., "0 A/AA failures among the
  25 criteria automatically verified (31 not evaluated)" — an honest subset statement. The
  words "Meets", "conformant", "compliant" and the "None" verdict are gone from every output.
- **"Criteria tested" now means the criteria actually exercised, not the ones that failed.**
  Previously the tested set was derived from the issues found, so it equalled the failed set —
  the A/AA/AAA determination had no awareness of coverage. It is now sourced from the exercised
  coverage (a scanner with eligible files ran the check), minus any page-level rule that could
  not be verified on a fragment. `summary.criteria_failed` is unchanged.
- **A problem confirmed by two engines now counts once.** When axe-core and
  eslint-plugin-jsx-a11y flag the same issue on the same element — the canonical case is a
  missing `alt`, reported as both `image-alt` and `alt-text` — the scan now merges them into
  a single issue instead of counting it twice. Equivalent rules are declared in a
  rule-equivalence table (`src/rules/equivalence.ts`): engine-agnostic and declarative, so
  supporting an additional engine means adding rows, not merge logic. The surviving issue is
  the one carrying a source line (the more actionable of the two) and credits every engine
  that agreed (see `scanners` below) — cross-engine agreement is surfaced, never silently
  collapsed.
- **Merging is deliberately conservative.** Findings merge only when the match is
  unambiguous: in plain HTML the offending element is located in the source; in extracted
  formats (JSX/TSX, Astro, Vue) a pair merges only when it cannot be confused with another
  occurrence in the same file. Ambiguous cases keep both issues — counting a duplicate twice
  is a known, visible cost; dropping a real finding is not acceptable.
- **Scores may rise slightly on multi-engine projects as a result.** The scoring formula is
  unchanged; the deduplicated issue set is simply smaller. This is a counting correction,
  not a relaxation.

### Added

- **Low-confidence alt-text advisory — surfaces present-but-useless `alt` without ever failing.**
  Static checks confirm an `alt` *exists*, not that it *helps*: `alt="DSC00423"`, `alt="untitled"`,
  or the image's file name all pass. Equall now emits an **advisory** (`ScanResult.confidence_flags`,
  each `{ criterion, signal, value, file_path, line?, reason, confidence }`) when an image's alt
  (`<img>` or a Next.js `<Image>`) looks like a file name, a generic placeholder, the `src` basename,
  or gibberish — shown as a gray
  "Low-confidence alt text — needs human review, not a WCAG violation" section. **Precision-first**:
  it never fires on good short alts ("Menu", "Cart") or decorative `alt=""`, and it is purely
  additive — it never changes an issue, a conformance verdict (1.1.1 stays `Supports (automated)`),
  the score, or coverage.
- **`--standard wcag22 | wcag21` — evaluate against a chosen WCAG version.** `wcag22` (default)
  is Equall's identity; `wcag21` renders the conformance table, coverage and verdict against
  WCAG 2.1 AA — the standard cited under the Web Accessibility Directive / EN 301 549 (the
  public-sector legal bar). It is a VIEW filter: the 0–100 score is **identical** across
  standards. Under `wcag21` the 9 criteria new in 2.2 leave the table (findings on them stay
  visible as issues) and `4.1.1 Parsing` reappears as a documented automated pass (obsolete
  per W3C erratum). The chosen `standard` is stamped on `ScanResult` and labelled in the terminal.
- `EquallIssue.scanners` — the engines that independently confirmed an issue
  (e.g. `["eslint-jsx-a11y", "axe-core"]`). `scanner` still names the engine of the
  surviving report, so existing consumers are unaffected.
- `ScanResult.engine_version` and `ScanResult.score_model` — version stamps so two scan
  outputs from different releases are comparable. Per-scanner versions remain in
  `scanners_used[].version`.
- **Per-criterion support verdicts (`ScanResult.criterion_conformance`).** For every WCAG
  success criterion of the target level, the scan now states an honest, scan-scoped verdict
  derived from what it actually established — `fail`, `pass_automated` (an automated basis
  only, never a bare "pass"), `not_verifiable_on_this_scan` (a page-level rule needing the
  rendered page), `not_tested_assisted` (partially covered, e.g. contrast), or
  `not_tested_manual`. Each `fail` carries the failing issue fingerprints as `evidence`; the
  not-tested verdicts carry a `reason`. The verdicts sum to the level's criteria total, so no
  criterion is silently missing. This is the evidence layer behind an accessibility
  statement / VPAT — it never emits a formal "Supports"; that is a human attestation applied
  later against the documented verdict → VPAT-term mapping.
- **Ignored issues are carried as accepted exceptions, never as failures.** Issues suppressed
  with `equall-ignore` stay out of every failing set, but the inventory is always kept: each
  per-criterion verdict now carries `accepted_exceptions: n` (absent = 0), so a criterion with
  suppressed findings is never presented as a bare pass. Per-exception reasons are a planned
  follow-up.
- **The terminal closes with a "WCAG 2.2 Support Summary"** — `Supports (automated) N ·
  Does not support N · Not evaluated N` — printed last so it is the takeaway you read first
  when the scan finishes (a terminal shows the bottom of the output). The 0–100 score sits
  just above it, framed as a trend indicator. `--verbose` prints the full per-criterion table
  above the summary, keeping the bucket line the final line.
- **A verdict reference is one click away.** The Support Summary now points to a docs page
  defining what each verdict asserts (and what it does not) plus the VPAT mapping, so a reader
  of "Supports (automated)" has an authoritative reference — not just a colour.

### Known limitations

- Consumers that track issues by fingerprint across scans will see the merged twin of a
  cross-engine duplicate (usually the axe-core one) disappear at the next scan and may mark
  it resolved. It was a duplicate being merged, not a fix — the issue itself remains open
  under its surviving fingerprint.

## [0.1.11] - 2026-07-03

### Changed

- **Fragment scans no longer report page-level rules as violations.** Components and
  partials — JSX/TSX/Vue/Svelte files, Astro pages that render into a layout, partial
  `.html` includes — cannot carry page structure: landmarks, the skip link, the document
  title, `<html lang>` live in the layout that composes them at render time. Page-level
  axe rules (`region`, `landmark-one-main`, the `landmark-*` family, `page-has-heading-one`,
  `bypass`, `skip-link`, `document-title`, `html-has-lang`, and related) are now
  reclassified on fragment scans: instead of appearing as violations, they are named in
  the honest-coverage report (`coverage.reclassified`, plus a "Not verifiable on this
  scan" terminal section) with occurrence counts and affected files, as "page-level rule,
  not verifiable on a per-file static scan". Full documents — a complete `.html` page, an
  Astro layout or component carrying its own `<html>` — are unaffected; these rules still
  fire there.
- **Scores rise on component-heavy projects as a result.** Reclassified findings no
  longer count against the score or the conformance level (`region` alone was previously
  the majority of reported issues on fragment-heavy codebases). This is a reporting
  correction, not a relaxation: the rules still apply to the rendered page, and the CLI
  now names exactly which ones to verify there.

### Known limitations

- Consumers that track issues by fingerprint across scans will see previously open
  page-level issues on fragments (most commonly `region`) disappear at the next scan
  and may mark them resolved. They were reclassified as not statically verifiable —
  not fixed. Verify them on the rendered page.

## [0.1.10] - 2026-06-20

### Changed

- `equall scan` now exits `0` whenever the scan completes. Previously it exited
  `1` when the score fell below a fixed internal threshold, so a successful scan
  of a low-scoring site looked like a failure and broke CI pipelines. Pass
  `--min-score <n>` to opt into a CI gate that exits `1` when the score is below `n`.

### Fixed

- Criteria above your conformance target — for example a Level AAA reading-level
  finding under the default AA target — no longer count against the score and are
  no longer listed under "must fix to reach conformance". They appear in a separate
  **Advisory** section instead. A prose-heavy site is no longer dragged below
  conformance by an optional AAA enhancement.

## [0.1.9] - 2026-06-20

### Added

- **In-memory scanning (API).** `runScan({ files: [{ path, content }] })` and
  `scanBuffer(content, filename)` scan source held in memory, with no disk writes,
  returning the same results as scanning the files from disk.
- **Diff-aware "only-new" scanning (API).** `runDiffScan({ base, head })` reports
  only the accessibility issues a change introduced. It tells new from pre-existing
  by a content fingerprint rather than line numbers, so a reformat-only change
  produces zero false "new". Results separate `new_issues`, `legacy_issues`, and
  `not_testable` files (changed files outside the scannable set). _API only — there
  is no `equall scan` flag for this yet._
- **Honest coverage.** Scan results carry a `coverage` report (`ScanResult.coverage`)
  describing what each WCAG criterion's status actually is on this scan
  (`auto` / `partial` / `manual`) — what was exercised, not what a scanner is merely
  capable of. The CLI never claims the code is "done"; criteria it could not
  statically verify are surfaced for manual review.
- **Stable issue fingerprint.** Issues can carry a `fingerprint` that survives
  reformatting, so the same issue can be matched across commits.
- **Full Astro multi-engine support.** `.astro` files are now scanned by every
  engine — axe-core, eslint-plugin-jsx-a11y (through the Astro parser), readability,
  and error-identification — not by axe alone. Dynamic attribute expressions
  (`aria-selected={…}`, `class={…}`, …) are neutralised before axe so they no
  longer produce phantom violations.

### Known limitations

- Dynamic attribute _values_ in `.astro` / JSX / Vue are not statically asserted
  (the markup is normalised, not rendered). Full-fidelity Astro parsing via
  `@astrojs/compiler` is planned for **0.1.11**.

[0.1.10]: https://github.com/GotaBird/equall/compare/v0.1.9...v0.1.10
[0.1.9]: https://github.com/GotaBird/equall/releases/tag/v0.1.9
