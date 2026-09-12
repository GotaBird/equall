# Changelog

All notable changes to Equall CLI are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-07-17

### Added

- **Scans now list the routes your project defines.** A disk scan of a Next.js, Astro or
  plain-HTML project reports its URL patterns — `/products/[slug]`, `/about` — one entry per
  route as `{ pattern, file, framework, dynamic }` on `ScanResult.routes`, with a per-framework
  count in the terminal Summary. Routes are inventory only: they never touch the score,
  verdicts or coverage. New exported types: `RouteInfo`, `RouteFramework`.
  - Detection: Next.js App Router matches `app/**/page.*` (route groups stripped); Pages
    Router matches `pages/**` (API routes excluded) but only when the project declares Next
    via a dependency or `next.config.*`, so a bare `pages/` folder never grows phantom routes.
    Astro matches `src/pages/**`; plain `.html` trees are a fallback used only when no
    framework is detected. Next.js parallel/intercepting segments are declared, not guessed.
  - Coverage is stated, not implied: the field is absent when detection wasn't attempted
    (in-memory input) and `[]` when the tree had no supported routing — both said on
    `diagnostics`. SvelteKit and Nuxt projects get an explicit "routes not yet mapped"
    diagnostic instead of a silent gap.

### Fixed

- **The score headline and the Support Summary now agree on the criteria counts.** The
  "N criteria automatically verified (M not evaluated)" line counted every exercised criterion —
  including beyond-target ones (e.g. AAA 3.1.5 Reading Level under an AA target) — against the
  level-scoped total, overstating "verified" and understating "not evaluated" by the same amount
  (e.g. 25/30 next to a Support Summary saying 23/32). Both lines now derive from the same
  per-criterion conformance verdicts, so they can no longer disagree.

### Known limitations

- Route detection reads routing conventions, not framework config: a custom Next
  `pageExtensions` and a custom Astro `srcDir` are not parsed. Detection is anchored to the
  scanned root — for monorepo sub-apps, scan the package directory. In-memory scans
  (`scanBuffer`, buffer input) skip route detection and say so on `diagnostics`.

## [0.2.0] - 2026-07-09

### Added

- **Low-confidence alt-text advisory — surfaces present-but-useless `alt` without ever failing.**
  Static checks confirm an `alt` _exists_, not that it _helps_: `alt="DSC00423"`, `alt="untitled"`,
  or the file name all pass. Equall now emits an **advisory** (`ScanResult.confidence_flags`) when
  an `<img>` or Next.js `<Image>`'s alt looks like a file name, a placeholder, the `src` basename,
  or gibberish — shown as a gray "Low-confidence alt text — needs human review, not a WCAG
  violation" section. **Precision-first**: it never fires on good short alts ("Menu", "Cart") or
  decorative `alt=""`, and it never changes an issue, a conformance verdict (1.1.1 stays `Supports
(automated)`), the score, or coverage.
- **`--standard wcag22 | wcag21` — evaluate against a chosen WCAG version.** `wcag22` (default)
  is Equall's identity; `wcag21` renders the conformance table, coverage and verdict against
  WCAG 2.1 AA — the standard cited under the EU Web Accessibility Directive / EN 301 549 (the
  public-sector legal bar). It's a view filter only: the 0–100 score is **identical** across
  standards. Under `wcag21`, the 9 criteria new in 2.2 leave the table (findings on them stay
  visible as issues) and `4.1.1 Parsing` reappears as a documented pass (obsolete per W3C
  erratum). The chosen `standard` is stamped on `ScanResult` and labelled in the terminal.
- `EquallIssue.scanners` — the engines that independently confirmed an issue
  (e.g. `["eslint-jsx-a11y", "axe-core"]`). `scanner` still names the engine of the
  surviving report, so existing consumers are unaffected.
- `ScanResult.engine_version` and `ScanResult.score_model` — version stamps so two scan
  outputs from different releases are comparable. Per-scanner versions remain in
  `scanners_used[].version`.
- **Per-criterion support verdicts (`ScanResult.criterion_conformance`).** For every WCAG
  success criterion of the target level, the scan now states an honest, scan-scoped verdict
  derived from what it actually established, summing to the level's criteria total so none is
  silently missing. This is the evidence layer behind an accessibility statement or VPAT — it
  never emits a formal "Supports"; that's a human attestation applied later against the
  documented verdict → VPAT-term mapping.
  - Verdicts: `fail` (carries the failing fingerprints as `evidence`), `pass_automated` (an
    automated basis only, never a bare "pass"), `not_verifiable_on_this_scan` (a page-level
    rule needing the rendered page), `not_tested_assisted` (partially covered, e.g. contrast),
    or `not_tested_manual` (each non-fail verdict carries a `reason`).
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

### Removed

- **Breaking: five internal exports are gone — build on `ScanResult` instead.**
  `computeScanResult`, `computeConformance`, `computeCoverage`, `VERDICT_VPAT_MAP` and
  `formatNoFailureVerdict` are no longer exported; consume the `ScanResult` returned by
  `runScan`, `scanBuffer` or `runDiffScan` instead — it carries everything they produced. The
  exported types now cover everything reachable from a `ScanResult` (adding `WcagStandard`,
  `ConfidenceFlag`, `ScanSummary`, `ScannerInfo`, `ReclassifiedRule`). Pin `0.1.11` if you need
  time to migrate.
- **Breaking: the POUR score breakdown (`pour_scores`) is gone.** The per-principle
  Perceivable / Operable / Understandable / Robust bars were a demoted-score artifact that
  masked which criteria actually failed or went unevaluated — the per-criterion Support
  Summary supersedes them. `ScanResult` no longer carries `pour_scores`; the per-issue `pour`
  field is unchanged. Pin `0.1.11` if you need time.

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
  - _Adding clean files raised the score._ The old density scaling divided the penalty by a log of
    the file count, so 20 inert files could lift a score by 10+ points — and single-buffer scans
    (the API/MCP path) were structurally penalized. Now the file count never touches the score:
    small repos and single-component scans stop being punished (they typically **rise**), and
    padding a repo cannot move the number.
  - _Fixes inside a saturated criterion were invisible._ With the cap, going from 30 missing alts
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
  skip link, document title, `<html lang>`) reclassified out of a fragment scan — the
  `not_verifiable_on_this_scan` conformance verdict — now name the concrete next step: run
  `equall scan` on your **built output** (`dist/`), where they execute as real documents and
  move from "Not evaluated" to Supports / Does-not-support. Both the terminal section and the
  verdict `reason` carry the command and a link to the guide. No new capability — the same
  static scan, pointed at the composed page.
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
- **A problem two engines both flag now counts once.** When axe-core and eslint-plugin-jsx-a11y
  report the same defect on the same element — the canonical case is a missing `alt`, reported
  as both `image-alt` and `alt-text` — the scan keeps one issue instead of two, crediting every
  engine that agreed (see `scanners` under Added). Equivalent rules are declared in a
  rule-equivalence table (`src/rules/equivalence.ts`): declarative, so supporting another engine
  means adding rows, not merge logic. Scores on multi-engine projects may rise slightly — the
  formula is unchanged, the deduplicated set is just smaller; a counting correction, not a
  relaxation.
  - Merging is deliberately conservative: in plain HTML the offending element is always
    locatable in the source; in JSX/TSX, Astro or Vue, a pair merges only when it can't be
    confused with another occurrence in the same file. Ambiguous cases keep both issues — an
    occasional double count is a visible cost, a dropped finding is not.

### Known limitations

- Consumers that track issues by fingerprint across scans will see the merged twin of a
  cross-engine duplicate (usually the axe-core one) disappear at the next scan and may mark
  it resolved. It was a duplicate being merged, not a fix — the issue itself remains open
  under its surviving fingerprint.

## [0.1.11] - 2026-07-03

### Changed

- **Fragment scans no longer report page-level rules as violations.** Components and
  partials — JSX/TSX/Vue/Svelte files, an Astro page that renders into a layout, a partial
  `.html` include — can't carry page structure: landmarks, the skip link, the document
  title, `<html lang>` live in the layout that composes them at render time. Those rules
  are now reclassified instead of failing: they're named in the honest-coverage report
  (`coverage.reclassified`, plus a "Not verifiable on this scan" terminal section) with
  occurrence counts and affected files. Full documents — a complete `.html` page, an Astro
  layout or component carrying its own `<html>` — are unaffected; these rules still fire
  there.
  - Rules concerned: `region`, `landmark-one-main` and the rest of the `landmark-*`
    family, `page-has-heading-one`, `bypass`, `skip-link`, `document-title`,
    `html-has-lang`.
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

- **A low score no longer breaks CI.** `equall scan` now exits `0` whenever the scan
  completes; previously it exited `1` when the score fell below a fixed internal
  threshold, so a successful scan of a low-scoring site looked like a failure and
  broke pipelines. Pass `--min-score <n>` to opt into a CI gate that exits `1` when
  the score is below `n`.

### Fixed

- **AAA-only findings no longer count against your conformance score.** Criteria
  above your target — for example a Level AAA reading-level finding under the
  default AA target — no longer count against the score and are no longer listed
  under "must fix to reach conformance"; they appear in a separate **Advisory**
  section instead. A prose-heavy site is no longer dragged below conformance by
  an optional AAA enhancement.

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
