# Equall

Open-source accessibility scoring for dev teams. Aggregates axe-core, eslint-plugin-jsx-a11y, text-readability, and more into a single WCAG score.

**One command. Real score. No config.**

```bash
npx equall scan .
```

```
  ◆ EQUALL — Accessibility Score

  56   ~A   WCAG 2.2

  P Perceivable    ██████████████████░░ 89
  O Operable       ███████████████░░░░░ 76
  U Understandable ░░░░░░░░░░░░░░░░░░░░ n/a
  R Robust         █████████████████░░░ 85

  Score 56/100  ·  29/56 Level AA criteria checked (52%)
```

## What is Equall?

Accessibility tools today fall into two camps: dev tools that show violations without context (axe, Lighthouse), and enterprise platforms that cost $75K+/year (Deque, Siteimprove). Nothing in between.

Equall sits in that gap. It wraps existing open-source scanners and adds what they're missing — a **score**, a **trend**, and a **POUR breakdown** that tells you where to focus.

- **Aggregator, not reinventor** — wraps axe-core, eslint-plugin-jsx-a11y, and more. We don't rewrite rules, we unify their results.
- **Framework-aware** — scans HTML, JSX/TSX, Vue, Svelte and **Astro**. `.astro` is **full multi-engine** (axe-core + jsx-a11y via `astro-eslint-parser` + readability), not axe-only.
- **Score 0–100** — weighted by severity, grouped by WCAG criterion, with a conformance level (A / AA / AAA).
- **POUR breakdown** — see which principle (Perceivable, Operable, Understandable, Robust) is your weakest.
- **Zero config** — point it at a folder, get a score. No setup, no account, no signup.
- **Honest about coverage** — it tells you exactly which criteria are tested and which still need manual review. No "100% compliant" claims. Page-level rules (landmarks, skip link, document title) are reported as "not verifiable on this scan" when you scan components or partials, instead of as false violations — they only fire on full documents.

## Install

```bash
npm install -g equall-cli   # or run on demand with: npx equall scan .
```

## Usage

```bash
equall scan .                  # score the current directory
equall scan . --json           # machine-readable output for CI / tooling
equall scan . --min-score 90   # CI gate: exit 1 if the score is below 90
equall --help                  # all commands and options
```

A successful scan always exits `0`. Pass `--min-score <n>` to fail a pipeline when
the score drops below a threshold. Criteria above your target level (e.g. AAA under
the default AA target) are reported as advisory and never count against the score.

Programmatic use:

```typescript
import { runScan } from 'equall-cli'

const result = await runScan({ path: './my-project', level: 'AA' })
console.log(result.score, result.pour_scores)
```

## Documentation

Full guide — scanners, scoring model, ignoring issues, CI gates and the API:
**https://equallscan.com/docs**

## License

MIT © Kevin Delval
