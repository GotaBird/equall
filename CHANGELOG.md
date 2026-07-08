# Changelog

All notable changes to Equall CLI are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

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
- **A POUR principle that was never exercised now shows n/a instead of a green 100.** The bar
  reads `—` when no criterion under that principle was actually checked on this scan, rather
  than implying a perfect, tested result.

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
- **The terminal closes with a "WCAG 2.2 Support Summary"** — `Supports (automated) N ·
  Does not support N · Not evaluated N` — printed last so it is the takeaway you read first
  when the scan finishes (a terminal shows the bottom of the output). The 0–100 score sits
  just above it, framed as a trend indicator. `--verbose` prints the full per-criterion table
  above the summary, keeping the bucket line the final line.

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
