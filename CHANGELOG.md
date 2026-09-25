# Changelog

All notable changes to Equall CLI are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`--show-review`** lists the findings static analysis cannot confirm (see below) in a
  "To review" section. Without it, the terminal prints a single line with their count; the
  JSON output always carries them.

### Changed

- **Diff scan: `new_issues` now holds counted violations only** (`runDiffScan`, library API).
  Review-only findings move to the new `new_review_only`, and best-practice and above-target
  findings to `new_advisory`; `legacy_issues` is unchanged. The result shape only gains
  fields, but code that read every introduced finding from `new_issues` must now also read
  the two new lists. `formatDiffGuardrail` names them when there are some.

- **Findings static analysis cannot confirm are reported for review, not counted.** On
  JSX/TSX, Vue, Svelte and Astro files, axe only sees markup reconstructed from the source
  code, not a rendered page. When its finding sits on an element whose content or name
  depends on props, runtime expressions or a component (`<Button>`, `{...props}`,
  `aria-checked={state}`), or comes from a rule that needs the rendered page, the issue is
  now flagged `review_only` with a `review_reason`. It keeps its fingerprint and stays in the
  JSON output, but no longer counts in the score, the violation counts or the conformance
  verdicts. The terminal report states how many were held back and lists them only with
  `--show-review`. Plain `.html` is never
  affected. Measured on a labelled corpus, the share of counted findings that are real rose
  from about half to more than three quarters, with no real defect dropped and no
  fingerprint changed. Scores on component code can rise as a result.

### Fixed

- **Diff scan reports what a change introduced, and nothing else.** Three defects made "new"
  unreliable in both directions:
  - a copy of an existing violation read as pre-existing, because the base and head
    fingerprints were compared as sets; occurrences are now counted per fingerprint;
  - the cross-engine merge could fire on one side of the diff and not the other, turning a
    pre-existing defect into a phantom new one; base and head are now compared before the
    merge, which is applied afterwards;
  - changed test, story and build files were scanned although a full scan skips them; they
    are now skipped and listed on the new `excluded` field.
  Identical copies added to one file still fold into one finding, as in a full scan.

- **The same code always produces the same JSON.** Files were scanned in filesystem-walk
  order and results collected as scanners finished, so two scans of an unchanged tree could
  list issues, page-level files and diagnostics in a different order (different bytes, same
  content). Files, issues, reclassified page-level files and diagnostics are now sorted; only
  `scanned_at` and `duration_ms` differ between two scans. Fingerprints are unchanged.
- **A file the engine could not analyse is reported, never passed as clean.** A JSX/TSX file
  that failed to parse used to produce no finding and no warning (score 100). Files skipped
  or not parsed by any scanner are now listed on `diagnostics` (printed on stderr by the CLI,
  carried in `--json`), and a scanner that fails outright is no longer credited in the
  coverage report: its criteria show as "Not evaluated" instead of tested. The engine itself
  no longer writes these warnings to stderr; they travel on the result.
- **axe no longer skips JSX files that use `autoComplete`.** axe-core shared its global state
  with the JSX lint rules (`autocomplete-valid` drives axe internally). Depending on how the
  engine was loaded, a lint pass could reset axe mid-run: the file was skipped with a
  warning, and the lint rules could then fail on a torn-down window. Each scanned document
  now gets its own axe instance, so both engines always analyse every file, and several
  scans can run in the same process. Scans take slightly longer (about 20% on a large repo).
- **`<label htmlFor>` is recognized on JSX.** The JSX spelling `htmlFor` (and `httpEquiv`,
  `acceptCharset`, `xlinkHref`) is translated to its HTML name before axe runs, so a
  correctly labelled input is no longer reported as unlabelled.
- **The terminal summary counts what the report lists.** Ignored issues were included in the
  "N WCAG violations" and severity counts while the list below excluded them; the summary
  now counts only the issues that affect the score, and states ignored and review-only
  findings on their own lines.

- **No criterion is reported as automatically tested unless a check can conclude on it.**
  Seven criteria were credited as "Supports (automated)" without a real test: 1.2.1,
  1.3.4 and 2.5.3 (their axe rules are deprecated or experimental and never run), 1.4.1
  and 2.5.8 (the rules run but cannot conclude without a rendered layout — a 10×10px
  button passed the target-size check), and 2.4.7 and 2.3.1 (only touched indirectly by
  the JSX lint rules). The first three are now "Not evaluated — manual"; the other four
  "Not evaluated — needs the rendered check". Issues, fingerprints and the score are
  unchanged; only the conformance verdicts and the coverage counts move.

- **Plain-text output when colors are off.** `--no-color` was accepted but ignored, so a
  report redirected to a file (`equall scan . --all > report.txt`) or read in a CI log was
  full of ANSI escape codes. Colors are now off with `--no-color`, when `NO_COLOR` is set
  (no-color.org), or when the output is not a terminal; `FORCE_COLOR` turns them back on.
  Severity stays readable without color: every level keeps its own shape (■ ▲ ● ○).

## [0.2.3] - 2026-09-23

### Added

- **`--all` lists everything the terminal report would otherwise cut.** By default the
  report shows the eight highest-weighted WCAG criteria and two occurrences of each, and two
  affected files per best-practice or page-level rule; `equall scan . --all` lifts every one
  of these caps, so every critical and serious occurrence is reachable without switching to
  `--json`. `--verbose` still expands the file lists and the per-criterion support table.

### Changed

- **Truncation is always announced.** Criteria past the default top eight used to be
  dropped from the terminal report without a trace; they are now summarized in one line
  with their occurrence count and how many are critical or serious. Every cut — criteria,
  occurrences or files — now names `--all` (file-list cuts used to point at `--verbose`).
  The JSON output, score and counts are unchanged.

## [0.2.2] - 2026-09-19

### Fixed

- **A fresh install resolves only patched transitive dependencies.** Four packages reached
  through `eslint` and `@typescript-eslint/parser` — `js-yaml`, `brace-expansion` (both the
  1.x and 5.x lines) and `@humanfs/node` — carry denial-of-service and symlink-following
  advisories at the versions the 0.2.1 lockfile resolved. No declared dependency range changes: the fixed releases
  already fall inside them, and the refreshed lockfile now pins `js-yaml` 4.3.2,
  `brace-expansion` 1.1.21 / 5.0.12 and `@humanfs/node` 0.16.8, so a production audit of
  the tree reports zero findings. Scanning behavior, scores and output are unchanged.

### Known limitations

- `jsdom` 25 still depends on the deprecated `whatwg-encoding`. Dropping it requires
  `jsdom` 30, which raises the Node floor above the 20.x this release supports; that upgrade
  is tracked separately.

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
  Equall now emits an **advisory** (`ScanResult.confidence_flags`) when an `<img>` or Next.js
  `<Image>`'s alt looks like a file name (`alt="DSC00423"`), a placeholder (`alt="untitled"`),
  the `src` basename, or gibberish — shown as a gray "Low-confidence alt text — needs human
  review, not a WCAG violation" section. It never fires on good short alts ("Menu", "Cart") or
  decorative `alt=""`, and it never changes an issue, a conformance verdict (1.1.1 stays
  `Supports (automated)`), the score, or coverage.
- **`--standard wcag22 | wcag21` — evaluate against a chosen WCAG version.** `wcag22` is the
  default; `wcag21` renders the conformance table, coverage and verdict against WCAG 2.1 AA —
  the standard cited under the EU Web Accessibility Directive / EN 301 549. The 0–100 score is
  **identical** across standards. Under `wcag21`, the 9 criteria new in 2.2 leave the table
  (findings on them stay visible as issues) and `4.1.1 Parsing` reappears as a documented pass
  (obsolete per W3C erratum). The chosen `standard` is stamped on `ScanResult` and labelled in
  the terminal.
- `EquallIssue.scanners` — the engines that independently confirmed an issue
  (e.g. `["eslint-jsx-a11y", "axe-core"]`). `scanner` still names the engine of the
  surviving report, so existing consumers are unaffected.
- `ScanResult.engine_version` and `ScanResult.score_model` — version stamps so two scan
  outputs from different releases are comparable. Per-scanner versions remain in
  `scanners_used[].version`.
- **Per-criterion support verdicts (`ScanResult.criterion_conformance`).** For every WCAG
  success criterion of the target level, the scan now states a scan-scoped verdict derived
  from what it actually established, summing to the level's criteria total so none is
  silently missing. It never emits a formal "Supports"; that's a human attestation applied
  later, using the documented verdict → VPAT-term mapping.
  - Verdicts: `fail` (carries the failing fingerprints as `evidence`), `pass_automated` (an
    automated basis only, never a bare "pass"), `not_verifiable_on_this_scan` (a page-level
    rule needing the rendered page), `not_tested_assisted` (partially covered, e.g. contrast),
    or `not_tested_manual` (each non-fail verdict carries a `reason`).
- **Ignored issues are carried as accepted exceptions, never as failures.** Issues suppressed
  with `equall-ignore` stay out of every failing set, but the inventory is always kept: each
  per-criterion verdict now carries `accepted_exceptions: n` (absent = 0), so a criterion with
  suppressed findings is never presented as a bare pass. Per-exception reasons are a planned
  follow-up.
- **The terminal now closes with a "WCAG 2.2 Support Summary."** `Supports (automated) N ·
Does not support N · Not evaluated N` prints last, after the 0–100 score (framed as a
  trend indicator). `--verbose` prints the full per-criterion table above the summary,
  keeping the bucket line the final line.
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
- **Breaking: the POUR score breakdown (`pour_scores`) is gone — read the per-criterion
  Support Summary instead.** The per-principle Perceivable / Operable / Understandable /
  Robust bars are removed. `ScanResult` no longer carries `pour_scores`; the per-issue `pour`
  field is unchanged. Pin `0.1.11` if you need time.

### Fixed

- **Empty and no-scanner scans now carry the full `ScanResult` shape.** `coverage`,
  `criterion_conformance`, `standard`, and `confidence_flags` (documented in the programmatic API)
  are attached on **every** scan, including the early-return paths — previously a scan with no
  scannable files returned them as `undefined`, contradicting the docs.

### Changed

- **Scoring model 2: the score is now a function of the deduplicated issue set only.** The
  file-count scaling and the 15-point per-criterion cap are gone, replaced by rank-damped
  severity summing per criterion. File count no longer affects the score — padding a repo
  cannot move the number, and small repos or single-component scans typically rise. Every
  fix strictly raises the score, credited at the severity of the issue fixed; repos with one
  heavily repeated criterion typically drop as that criterion counts its real size.
- **`score_model` is stamped `2` — do not compare scores across model versions.** The decay
  constant changes from 0.02 to 0.01, and the score now carries two decimals so small fixes
  inside a heavily repeated criterion are visible. Rationale: `docs/score-philosophy.md`.
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
  skip link, document title, `<html lang>`) carrying the `not_verifiable_on_this_scan` verdict
  on a fragment scan now name the next step: run `equall scan` on your **built output**
  (`dist/`), where they execute as real documents and move from "Not evaluated" to
  Supports / Does-not-support. Both the terminal section and the verdict `reason` carry the
  command and a link to the guide.
- **Fragments no longer falsely pass page title / language.** A component can't know the page's
  `<title>` or `lang` — they live in the layout — so `document-title` (2.4.2) and `html-has-lang`
  (3.1.1) now read `not_verifiable_on_this_scan` on a fragment scan instead of a masked "Supports
  (automated)". They evaluate correctly on a document / built-output scan.
- **WCAG criteria totals corrected — a real over-count is fixed.** `2.5.6 Concurrent Input
Mechanisms` was mis-catalogued as Level A; it is Level AAA. So the WCAG 2.2 totals drop by
  one: Level A 32→31, Level A+AA 56→55 (`criteria_total` in the JSON). Totals are now derived
  from the catalog (single source of truth) instead of hardcoded.
- **The verdict now states what was actually verified, and never claims conformance.** A scan
  whose only finding was a AAA advisory used to print "Meets WCAG AA"; a clean scan reported
  "None". The score header now reads, e.g., "0 A/AA failures among the 25 criteria
  automatically verified (31 not evaluated)". The words "Meets", "conformant", "compliant" and
  the "None" verdict are gone from every output.
- **"Criteria tested" now means the criteria actually exercised, not the ones that failed.**
  It is now sourced from the exercised coverage (a scanner with eligible files ran the check),
  minus any page-level rule that could not be verified on a fragment — previously it was
  derived from the failed set. `summary.criteria_failed` is unchanged.
- **A problem two engines both flag now counts once.** When axe-core and eslint-plugin-jsx-a11y
  report the same defect on the same element — the canonical case is a missing `alt`, reported
  as both `image-alt` and `alt-text` — the scan keeps one issue instead of two, crediting every
  engine that agreed (see `scanners` under Added). Equivalent rules are declared in a
  rule-equivalence table (`src/rules/equivalence.ts`): declarative, so supporting another engine
  means adding rows, not merge logic. Scores on multi-engine projects may rise slightly since
  the deduplicated set is smaller; the formula is unchanged.
  - Merging is deliberately conservative: in plain HTML the offending element is always
    locatable in the source; in JSX/TSX, Astro or Vue, a pair merges only when it can't be
    confused with another occurrence in the same file. Ambiguous cases keep both issues.

### Known limitations

- Consumers that track issues by fingerprint across scans will see the merged twin of a
  cross-engine duplicate (usually the axe-core one) disappear at the next scan and may mark
  it resolved. It was a duplicate being merged, not a fix — the issue itself remains open
  under its surviving fingerprint.

## [0.1.11] - 2026-07-03

### Changed

- **Fragment scans no longer report page-level rules as violations.** Components and
  partials — JSX/TSX/Vue/Svelte files, an Astro page rendered into a layout, a partial
  `.html` include — can't carry page structure: landmarks, skip link, document title,
  `<html lang>` live in the composing layout. Those rules are now reclassified instead of
  failing, named in the honest-coverage report (`coverage.reclassified`, plus a "Not
  verifiable on this scan" terminal section) with occurrence counts and affected files.
  - Rules concerned: `region`, `landmark-one-main` and the rest of the `landmark-*`
    family, `page-has-heading-one`, `bypass`, `skip-link`, `document-title`,
    `html-has-lang`.
- **Full documents are unaffected — these rules still fire there.** A complete `.html`
  page, an Astro layout, or a component carrying its own `<html>` is scanned as before.
- **Scores rise on component-heavy projects as a result.** Reclassified findings no
  longer count against the score or the conformance level (`region` alone was previously
  the majority of reported issues on fragment-heavy codebases). The rules still apply to
  the rendered page, and the CLI names exactly which ones to verify there.

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
