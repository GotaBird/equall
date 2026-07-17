# Equall

> **Open-source accessibility scoring for dev teams.**

Equall aggregates `axe-core`, `eslint-plugin-jsx-a11y`, `text-readability`, and more into a single WCAG score — and delivers an honest, per-criterion conformance verdict.

**One command. Real score. No config.**

```bash
npx equall-cli scan .
```

```
  ◆ EQUALL — Accessibility Score

  Summary
  1 file scanned  ·  3 WCAG violations  ·  0 best-practice recommendations
  Coverage  Level A   17/31 checked (55%)  ·  3 failing
            Level AA  25/55 checked (45%)  ·  3 failing

  …grouped WCAG violations, each with how-to-fix and its scanner source…

    54.63    WCAG 2.2 · score is a trend indicator
  3 A/AA failures among the 25 criteria automatically verified (30 not evaluated).

  WCAG 2.2 Support Summary — AA target · automated basis only
  ✓ Supports (automated) 20   ✕ Does not support 3   ○ Not evaluated 32
  What each verdict means → equallscan.com/docs/verdicts
```

## What is Equall?

Accessibility tools today usually fall into two camps: dev tools that show violations without context (axe, Lighthouse), and enterprise platforms that cost $75K+/year (Deque, Siteimprove). Nothing in between.

Equall sits in that gap. It wraps existing open-source scanners and adds what they're missing: a **per-criterion conformance verdict** you can actually act on, and a **score** to track your trend over time.

- **Aggregator, not a reinventor** — wraps axe-core, eslint-plugin-jsx-a11y, readability, and more. We don't rewrite the rules; we unify and de-duplicate their results.
- **Framework-aware** — scans HTML, JSX/TSX, Vue, Svelte, and **Astro**. `.astro` is scanned full multi-engine (axe-core + jsx-a11y via `astro-eslint-parser` + readability), not axe alone.
- **Per-criterion verdicts** — for every WCAG success criterion of your target level: `Supports (automated)`, `Does not support`, or `Not evaluated`. It's the backbone of the report; the [verdict reference](https://equallscan.com/docs/verdicts) says exactly what each claims — and what it doesn't.
- **Score is a trend, not a grade** — a 0–100 number to watch move over time. It motivates; it certifies nothing. No fake "100% Meets WCAG" badges here.
- **Speaks the legal standard** — `--standard wcag21` renders the WCAG 2.1 AA view cited by the EU Web Accessibility Directive / EN 301 549; `wcag22` is the default. Same scan, same score — only the criteria set changes.
- **Honest about coverage** — automation covers a subset; the rest is `Not evaluated` (needs a rendered check or manual review). Page-level rules (landmarks, skip link, `<html lang>`) are reported as "not verifiable on this scan" when you scan components or partials — not as false violations.

## Install

```bash
npm install -g equall-cli   # or run on demand with: npx equall-cli scan .
```

## Usage

```bash
equall scan .                      # score the current directory (WCAG 2.2, Level AA)
equall scan . --standard wcag21    # WCAG 2.1 AA — the public-sector legal bar
equall scan . --level A            # target a different conformance level
equall scan . --verbose            # full per-criterion support table
equall scan . --json               # machine-readable output for CI / tooling
equall scan . --min-score 90       # CI gate: exit 1 if the score is below 90
equall --help                      # all commands and options
```

A successful scan always exits `0`. Pass `--min-score <n>` to fail a pipeline when the
score drops below a threshold. Criteria above your target level (e.g. AAA under the
default AA target) are advisory and never count against the score.

## Programmatic use

```typescript
import { runScan } from 'equall-cli'

const result = await runScan({
  path: './my-project',
  level: 'AA',
})

console.log('Score:', result.score)
console.log('Verdicts:', result.criterion_conformance)
```

`ScanResult` carries `criterion_conformance` (the per-criterion verdicts), `coverage`
(what was actually exercised), `summary`, `standard`, and `engine_version` / `score_model`
version stamps so results stay comparable across releases.

Disk scans also carry `routes` — the URL patterns the project's file-based routing defines
(Next.js App/Pages Router, Astro, plain `.html`), each as `{ pattern, file, framework,
dynamic }` with dynamic segments keeping their bracket syntax (`/products/[slug]`). The
field is tri-state: absent when detection was not attempted (in-memory input), `[]` when
the tree had no supported routing — both declared on `diagnostics`. Routes are inventory
metadata only and never affect the score, verdicts, or coverage.

## Documentation

Full guide — scanners, the scoring model, the verdict reference, ignoring issues, CI gates
and the API: **https://equallscan.com/docs**

## License

MIT © Kevin Delval
