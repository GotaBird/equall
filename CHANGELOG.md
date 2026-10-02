# Changelog

All notable changes to Equall CLI are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.4] - 2026-10-02

### Added

- **Write the JSON report to a file, keeping the normal output.** Pass
  `--json-out result.json` to get the report as a file for a later step, such as an upload,
  while the terminal output, the GitHub annotations, the job summary and the exit code stay
  as they are; `--json` alone prints to stdout and, with `--diff`, turns off the
  annotations. The file holds exactly what `--json` prints: the diff result with `--diff`,
  the full report otherwise.
  - The path is relative to the working directory, not to the scanned path.
  - An empty path, a missing folder or a file that cannot be written exits `2`.
  - The file is only written when the scan ran, so a later step must check the exit code
    before reading it.

### Fixed

- **Advisory issues now name your target level, not "AAA".** With `--level A`, Level AA
  issues were labelled "AAA advisory". The summary now reads `N advisory (beyond <target>)`
  and the section `Advisory — beyond your <target> target, not counted`.
- **A failing scanner is now named in the warning.** `[scanner] failed` becomes, for
  example, `[axe-core] failed and did not run: <error>`, so you know which checks are
  missing from the report. The same text is in `diagnostics` in the JSON report.
- Ignored issues now read "ignored via equall-ignore" (was "suppressed via equall-ignore").
- With `--diff`, uncounted new findings now read "to review or advisory" (was "review-only
  or advisory").
- "No scannable files found" now lists `.htm`, which the scan already supported.

## [0.3.3] - 2026-10-01

### Changed

- **A path that does not exist now exits `2`.** `equall scan <path>` prints `path not found`
  on stderr and exits `2` (the scan could not run). It used to exit `0` with "No scannable
  files found", or with `--json` an empty report scored 100, so a typo in a CI step passed
  without scanning anything. A pipeline pointing at a wrong path now fails; fix the path.
  - With `--diff` it already exited `2`, but on a misleading git-ref error; the message is
    now the same.
  - A path that is a file exits `2` with `not a directory` instead of a generic error.
  - An existing folder with no scannable files still exits `0`.

### Fixed

- **The page-level hint now names the right package.** It now reads `npx equall-cli scan
  <build-dir>`. It suggested `npx equall scan <build-dir>`, which only works when equall-cli
  is installed locally; without it, `npx` looks for a package named `equall`.
- **The type of `ScanResult.unchecked` can now be imported.** `UncheckedFile` is exported
  from the package root: `import type { UncheckedFile } from 'equall-cli'`.

## [0.3.2] - 2026-09-27

### Added

- **CI can now fail only on what a change introduces.** `equall scan . --diff origin/main
  --fail-on serious` scans the changed files and exits `1` only when the change introduces
  a counted violation at `serious` or above. Existing violations are reported as not
  blocking; findings that cannot be confirmed statically, and best practices, never block.
  `--json` writes the diff result.
  - In a pull request on GitHub Actions, GitLab CI or Azure Pipelines, `--diff` with no value
    uses the target branch; on GitLab, the merge-base commit GitLab computes
    (`CI_MERGE_REQUEST_DIFF_BASE_SHA`), which is in a merge-request clone when the target
    branch usually is not.
  - `scan <dir> --diff` only looks at changes under `<dir>`.
  - Exit code `2` means the check could not run, for example when the base branch is missing
    from a shallow clone; the message says how to fetch it.
- **On GitHub Actions, each new finding becomes an annotation on its file and line.** Every
  finding is also written to the job summary, since GitHub shows at most ten annotations of
  each kind per step.
- **Changed files the check could not analyse are listed as not checked.** They appear in the
  terminal, the summary line, a warning annotation, and `unchecked` in `--json`: a passing
  check says nothing about them.

## [0.3.1] - 2026-09-26

Same content as 0.3.0, with one change to how axe-core is injected (below). Both versions
install identically; 0.3.1 is the recommended one. Everything listed under 0.3.0 below
ships in 0.3.1.

### Changed

- **axe-core is now compiled once per process, not once per document.** It runs as one
  script through jsdom's documented VM context; 0.3.0 evaluated axe's source as a string in
  each scanned document's window. Findings are identical (measured on 15 real repositories:
  every fingerprint kept).

## [0.3.0] - 2026-09-26

Findings the engine cannot confirm by static analysis are now reported for review instead
of counted, coverage no longer claims criteria no check concludes on, and the diff scan
reports only what a change introduced.

Scores and verdicts on component code (JSX/TSX, Vue, Svelte, Astro) can rise with no change
to the code: the scoring formula is unchanged (`score_model` stays 2), but review-only
findings leave the score, the counts and the conformance verdicts, and some criteria are now
reported as partial. Compare scores from before and after 0.3.0 with care. Plain HTML is not
affected.

No fingerprint change was measured: on 15 real repositories every fingerprint was kept, none
appeared and none disappeared. One narrow case can change a fingerprint; it is described
under the `htmlFor` entry below.

### Added

- **Scan results now list the files a scanner could not check.** `unchecked` carries
  `{ scanner, file_path, reason }` (`parse_error`, `analysis_error`, `language_skipped`), the
  structured form of the matching `diagnostics` lines. For a tool tracking issues across
  scans, a finding missing from an unchecked file was not re-checked, not fixed. A scanner
  that failed outright is not listed per file; it is absent from `scanners_used`.
- **Merged issues now keep the fingerprint of the twin they absorbed.**
  `merged_fingerprints` holds the fingerprint of the finding a cross-engine merge absorbed
  (the axe twin of a jsx-a11y finding), exactly as it reads when unmerged, so a tracking tool
  can tell that a twin which reappears and then disappears again was merged back, not fixed.
  The issue's own fingerprint is unchanged.
- **The findings held back for review can now be listed.** `--show-review` prints the
  findings static analysis cannot confirm (see below) in a "To review" section. Without it,
  the terminal prints a single line with their count; the JSON output always carries them.

### Changed

- **Diff scan: introduced findings are now split into three lists (library API).**
  `runDiffScan`'s `new_issues` holds counted violations only; review-only findings move to
  the new `new_review_only`, and best-practice and above-target findings to `new_advisory`.
  `legacy_issues` is unchanged. The result shape only gains fields, but code that read every
  introduced finding from `new_issues` must now also read the two new lists.
  `formatDiffGuardrail` names them when there are some.
- **Findings static analysis cannot confirm are reported for review, not counted.** On
  JSX/TSX, Vue, Svelte and Astro files, an axe finding on an element whose content or name
  depends on props, runtime expressions or a component (`<Button>`, `{...props}`,
  `aria-checked={state}`), or from a rule that needs the rendered page, is now flagged
  `review_only` with a `review_reason`: axe only sees markup reconstructed from the source
  code, not a rendered page. Scores on component code can rise as a result. Plain `.html` is
  never affected.
  - The issue keeps its fingerprint and stays in the JSON output, but no longer counts in the
    score, the violation counts or the conformance verdicts.
  - The terminal report states how many were held back and lists them only with
    `--show-review`.
  - Measured on a labelled corpus, the share of counted findings that are real rose from
    about half to more than three quarters, with no real defect dropped and no fingerprint
    changed.

### Fixed

- **Diff scan reports what a change introduced, and nothing else.** "New" is no longer wrong
  in either direction. Identical copies added to one file still fold into one finding, as in
  a full scan.
  - A copy of an existing violation no longer reads as pre-existing: occurrences are counted
    per fingerprint instead of comparing base and head fingerprints as sets.
  - A pre-existing defect no longer becomes a phantom new one when the cross-engine merge
    fired on one side of the diff only: base and head are compared before the merge, which
    is applied afterwards.
  - Changed test, story and build files, which a full scan skips, are now skipped too and
    listed on the new `excluded` field.
- **The same code always produces the same JSON.** Files, issues, reclassified page-level
  files and diagnostics are now sorted, so two scans of an unchanged tree differ only in
  `scanned_at` and `duration_ms`. They used to follow filesystem-walk and scanner-completion
  order (different bytes, same content). Fingerprints are unchanged.
- **A file the engine could not analyse is reported, never passed as clean.** Files skipped
  or not parsed by any scanner are now listed on `diagnostics` (printed on stderr by the CLI,
  carried in `--json`); a JSX/TSX file that failed to parse used to produce no finding and no
  warning (score 100). A scanner that fails outright is no longer credited in the coverage
  report: its criteria show as "Not evaluated" instead of tested. The engine itself no longer
  writes these warnings to stderr; they travel on the result.
- **axe no longer skips JSX files that use `autoComplete`.** Each scanned document now gets
  its own axe instance, so axe and the JSX lint rules always analyse every file, and several
  scans can run in the same process. Scans take slightly longer (about 20% on a large repo).
  The two shared axe-core's global state (`autocomplete-valid` drives axe internally):
  depending on how the engine was loaded, a lint pass could reset axe mid-run, skipping the
  file with a warning and leaving the lint rules on a torn-down window.
- **Inputs labelled with `htmlFor` in JSX are no longer reported as unlabelled.** The JSX
  spellings `htmlFor`, `httpEquiv`, `acceptCharset` and `xlinkHref` are translated to their
  HTML names before axe runs. The axe `label` finding on such an input was a false positive
  and no longer appears.
  - In a narrow case, an axe finding whose element markup is shorter than 300 characters and
    contains a `<label htmlFor>` carries `for` in its snippet instead, which changes its
    fingerprint. Measured on 15 real repositories (46 uses of `htmlFor`): no fingerprint
    changed.
- **The terminal summary counts what the report lists.** The "N WCAG violations" and
  severity counts now include only the issues that affect the score, and ignored and
  review-only findings are stated on their own lines. Ignored issues used to be counted while
  the list below excluded them.
- **Criteria are reported as automatically tested only when a check concludes.** Seven
  criteria credited as "Supports (automated)" without a real test are now "Not evaluated".
  Issues, fingerprints and the score are unchanged; only the conformance verdicts and the
  coverage counts move.
  - "Not evaluated — manual": 1.2.1, 1.3.4 and 2.5.3 (their axe rules are deprecated or
    experimental and never run).
  - "Not evaluated — needs the rendered check": 1.4.1 and 2.5.8 (the rules run but cannot
    conclude without a rendered layout — a 10×10px button passed the target-size check), and
    2.4.7 and 2.3.1 (only touched indirectly by the JSX lint rules).
- **The report no longer prints ANSI codes when colors are off.** Colors are now off with
  `--no-color` (accepted but ignored before), when `NO_COLOR` is set (no-color.org), or when
  the output is not a terminal, such as a report redirected to a file
  (`equall scan . --all > report.txt`) or read in a CI log. `FORCE_COLOR` turns them back on.
  Severity stays readable without color: every level keeps its own shape (■ ▲ ● ○).

## [0.2.3] - 2026-09-23

### Added

- **The terminal report can now show everything it would otherwise cut.**
  `equall scan . --all` lifts every default cap — the eight highest-weighted WCAG criteria,
  two occurrences of each, and two affected files per best-practice or page-level rule — so
  every critical and serious occurrence is reachable without switching to `--json`.
  `--verbose` still expands the file lists and the per-criterion support table.

### Changed

- **Truncation is always announced.** Criteria past the default top eight are now summarized
  in one line with their occurrence count and how many are critical or serious, instead of
  being dropped from the terminal report without a trace. Every cut — criteria, occurrences
  or files — now names `--all` (file-list cuts used to point at `--verbose`). The JSON
  output, score and counts are unchanged.

## [0.2.2] - 2026-09-19

### Fixed

- **A fresh install resolves only patched transitive dependencies.** The refreshed lockfile
  pins `js-yaml` 4.3.2, `brace-expansion` 1.1.21 / 5.0.12 and `@humanfs/node` 0.16.8, so a
  production audit of the tree reports zero findings; the versions the 0.2.1 lockfile
  resolved carry denial-of-service and symlink-following advisories. Scanning behavior,
  scores and output are unchanged.
  - The four packages are reached through `eslint` and `@typescript-eslint/parser`
    (`brace-expansion` on both the 1.x and 5.x lines).
  - No declared dependency range changes: the fixed releases already fall inside them.

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
  - Next.js: the App Router matches `app/**/page.*` (route groups stripped); the Pages Router
    matches `pages/**` (API routes excluded) only when the project declares Next via a
    dependency or `next.config.*`, so a bare `pages/` folder never grows phantom routes.
    Parallel/intercepting segments are declared, not guessed.
  - Astro matches `src/pages/**`; plain `.html` trees are a fallback used only when no
    framework is detected.
  - The field is absent when detection wasn't attempted (in-memory input) and `[]` when the
    tree had no supported routing, both stated on `diagnostics`. SvelteKit and Nuxt projects
    get an explicit "routes not yet mapped" diagnostic.

### Fixed

- **The score headline and the Support Summary now agree on the criteria counts.** Both
  lines now derive from the same per-criterion conformance verdicts. The "N criteria
  automatically verified (M not evaluated)" line counted every exercised criterion, including
  beyond-target ones (e.g. AAA 3.1.5 Reading Level under an AA target), against the
  level-scoped total, overstating "verified" and understating "not evaluated" by the same
  amount (e.g. 25/30 next to a Support Summary saying 23/32).

### Known limitations

- Route detection reads routing conventions, not framework config: a custom Next
  `pageExtensions` and a custom Astro `srcDir` are not parsed. Detection is anchored to the
  scanned root — for monorepo sub-apps, scan the package directory. In-memory scans
  (`scanBuffer`, buffer input) skip route detection and say so on `diagnostics`.

## [0.2.0] - 2026-07-09

### Added

- **Present-but-useless `alt` text now gets an advisory, never a failure.** When the alt of
  an `<img>` or Next.js `<Image>` looks like a file name (`alt="DSC00423"`), a placeholder
  (`alt="untitled"`), the `src` basename, or gibberish, the scan emits an advisory on
  `ScanResult.confidence_flags`, shown as a gray "Low-confidence alt text — needs human
  review, not a WCAG violation" section. It never fires on good short alts ("Menu", "Cart")
  or decorative `alt=""`, and never changes an issue, a conformance verdict (1.1.1 stays
  `Supports (automated)`), the score, or coverage.
- **You can now evaluate against WCAG 2.1 or 2.2.** `--standard wcag22` is the default;
  `--standard wcag21` renders the conformance table, coverage and verdict against WCAG 2.1
  AA, the standard cited under the EU Web Accessibility Directive / EN 301 549. The 0–100
  score is identical across standards. The chosen `standard` is stamped on `ScanResult` and
  labelled in the terminal.
  - Under `wcag21`, the 9 criteria new in 2.2 leave the table (findings on them stay visible
    as issues) and `4.1.1 Parsing` reappears as a documented pass (obsolete per W3C erratum).
- **Issues now say which engines confirmed them.** `EquallIssue.scanners` lists the engines
  that independently confirmed an issue (e.g. `["eslint-jsx-a11y", "axe-core"]`). `scanner`
  still names the engine of the surviving report, so existing consumers are unaffected.
- **Scan results now carry the engine and score-model versions.**
  `ScanResult.engine_version` and `ScanResult.score_model` make two scan outputs from
  different releases comparable. Per-scanner versions remain in `scanners_used[].version`.
- **Every WCAG criterion of the target level now gets a verdict.**
  `ScanResult.criterion_conformance` states a scan-scoped verdict per success criterion,
  derived from what the scan actually established and summing to the level's criteria total,
  so none is silently missing. It never emits a formal "Supports": that is a human
  attestation applied later, using the documented verdict → VPAT-term mapping.
  - Verdicts: `fail` (carries the failing fingerprints as `evidence`), `pass_automated` (an
    automated basis only, never a bare "pass"), `not_verifiable_on_this_scan` (a page-level
    rule needing the rendered page), `not_tested_assisted` (partially covered, e.g. contrast),
    or `not_tested_manual` (each non-fail verdict carries a `reason`).
- **Ignored issues are carried as accepted exceptions, never as failures.** Issues suppressed
  with `equall-ignore` stay out of every failing set but stay in the inventory: each
  per-criterion verdict now carries `accepted_exceptions: n` (absent = 0), so a criterion with
  suppressed findings is never presented as a bare pass. Per-exception reasons are a planned
  follow-up.
- **The terminal now closes with a "WCAG 2.2 Support Summary."** `Supports (automated) N ·
  Does not support N · Not evaluated N` prints last, after the 0–100 score (framed as a
  trend indicator). `--verbose` prints the full per-criterion table above the summary,
  keeping the bucket line the final line.
- **The Support Summary now links to a verdict reference.** The docs page defines what each
  verdict asserts (and what it does not) plus the VPAT mapping.

### Removed

- **Breaking: five internal exports are gone — build on `ScanResult` instead.**
  `computeScanResult`, `computeConformance`, `computeCoverage`, `VERDICT_VPAT_MAP` and
  `formatNoFailureVerdict` are no longer exported; consume the `ScanResult` returned by
  `runScan`, `scanBuffer` or `runDiffScan` instead — it carries everything they produced. The
  exported types now cover everything reachable from a `ScanResult` (adding `WcagStandard`,
  `ConfidenceFlag`, `ScanSummary`, `ScannerInfo`, `ReclassifiedRule`). Pin `0.1.11` if you need
  time to migrate.
- **Breaking: `pour_scores` is gone — read the per-criterion Support Summary.** The
  per-principle Perceivable / Operable / Understandable / Robust bars are removed and
  `ScanResult` no longer carries `pour_scores`; the per-issue `pour` field is unchanged. Pin
  `0.1.11` if you need time.

### Fixed

- **Empty and no-scanner scans now carry the full `ScanResult` shape.** `coverage`,
  `criterion_conformance`, `standard` and `confidence_flags` (documented in the programmatic
  API) are attached on every scan, including the early-return paths; a scan with no
  scannable files used to return them as `undefined`, contradicting the docs.

### Changed

- **Scoring model 2: file count no longer affects the score.** The score is now a function
  of the deduplicated issue set only: the file-count scaling and the 15-point per-criterion
  cap are replaced by rank-damped severity summing per criterion, so padding a repo cannot
  move the number. Small repos and single-component scans typically rise; repos with one
  heavily repeated criterion typically drop, as that criterion counts its real size. Every
  fix strictly raises the score, credited at the severity of the issue fixed.
- **Scores from different model versions are not comparable.** Results are stamped
  `score_model` `2`. The decay constant changes from 0.02 to 0.01, and the score now carries
  two decimals so small fixes inside a heavily repeated criterion are visible. Rationale:
  `docs/score-philosophy.md`.
- **The terminal report no longer repeats the failing set.** The `Coverage` line(s) and the
  coaching block are gone: they restated what the headline (score + verdict + Support
  Summary) already states, so the same count appeared up to six times. The scanner list moved
  behind `--verbose`. A default scan now reads: what was scanned → the violations (same
  detail) → the read-first headline.
- **The engine no longer writes to your stderr.** Non-fatal scan warnings (no scanners
  available, a scanner threw) are collected on the new `ScanResult.diagnostics` field instead
  of being `console.warn`'d from `runScan`, so a library or MCP consumer can capture them and
  `--json` output carries them. The CLI still prints them to stderr.
- **"Not verifiable on this scan" now tells you how to verify.** On a fragment scan,
  page-level rules (landmarks, skip link, document title, `<html lang>`) carrying the
  `not_verifiable_on_this_scan` verdict now name the next step: run `equall scan` on your
  built output (`dist/`), where they execute as real documents and move from "Not evaluated"
  to Supports / Does-not-support. Both the terminal section and the verdict `reason` carry
  the command and a link to the guide.
- **Fragments no longer falsely pass page title / language.** On a fragment scan,
  `document-title` (2.4.2) and `html-has-lang` (3.1.1) now read `not_verifiable_on_this_scan`
  instead of a masked "Supports (automated)": a component's `<title>` and `lang` live in the
  layout. They evaluate correctly on a document / built-output scan.
- **WCAG 2.2 totals drop by one: 2.5.6 is Level AAA, not A.** `2.5.6 Concurrent Input
  Mechanisms` was mis-catalogued as Level A. Level A goes from 32 to 31 and Level A+AA from
  56 to 55 (`criteria_total` in the JSON). Totals are now derived from the catalog instead of
  hardcoded.
- **The verdict now states what was actually verified, and never claims conformance.** A scan
  whose only finding was a AAA advisory used to print "Meets WCAG AA"; a clean scan reported
  "None". The score header now reads, e.g., "0 A/AA failures among the 25 criteria
  automatically verified (31 not evaluated)". The words "Meets", "conformant", "compliant" and
  the "None" verdict are gone from every output.
- **"Criteria tested" now counts exercised criteria, not failed ones.** It is sourced from
  the exercised coverage (a scanner with eligible files ran the check), minus any page-level
  rule that could not be verified on a fragment; it used to be derived from the failed set.
  `summary.criteria_failed` is unchanged.
- **A problem two engines both flag now counts once.** When axe-core and
  eslint-plugin-jsx-a11y report the same defect on the same element (canonically a missing
  `alt`, as both `image-alt` and `alt-text`), the scan keeps one issue and credits every
  engine that agreed (see `scanners` under Added). Scores on multi-engine projects may rise
  slightly since the deduplicated set is smaller; the formula is unchanged.
  - Equivalent rules are declared in a rule-equivalence table (`src/rules/equivalence.ts`);
    supporting another engine means adding rows, not merge logic.
  - In plain HTML the offending element is always locatable in the source; in JSX/TSX, Astro
    or Vue, a pair merges only when it can't be confused with another occurrence in the same
    file. Ambiguous cases keep both issues.

### Known limitations

- Consumers that track issues by fingerprint across scans will see the merged twin of a
  cross-engine duplicate (usually the axe-core one) disappear at the next scan and may mark
  it resolved. It was a duplicate being merged, not a fix — the issue itself remains open
  under its surviving fingerprint.

## [0.1.11] - 2026-07-03

### Changed

- **Fragment scans no longer report page-level rules as violations.** In components and
  partials — JSX/TSX/Vue/Svelte files, an Astro page rendered into a layout, a partial
  `.html` include — these rules are now reclassified instead of failing: landmarks, skip
  link, document title and `<html lang>` live in the composing layout. They are named in the
  honest-coverage report (`coverage.reclassified`, plus a "Not verifiable on this scan"
  terminal section) with occurrence counts and affected files.
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
  under "must fix to reach conformance"; they appear in a separate "Advisory"
  section instead.

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
  `@astrojs/compiler` is planned for 0.1.11.

[0.1.10]: https://github.com/GotaBird/equall/compare/v0.1.9...v0.1.10
[0.1.9]: https://github.com/GotaBird/equall/releases/tag/v0.1.9
