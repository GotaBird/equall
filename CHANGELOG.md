# Changelog

All notable changes to Equall CLI are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
