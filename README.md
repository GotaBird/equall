# Equall

Open-source accessibility scoring for dev teams. Aggregates axe-core, eslint-plugin-jsx-a11y, text-readability, and more into a unified score.

**One command. Real score. No config.**

```bash
equall scan .
```

```
  ◆ EQUALL — Accessibility Score

  56   ~A   WCAG 2.2

  POUR Breakdown
  P Perceivable    ██████████████████░░ 89
  O Operable       ███████████████░░░░░ 76
  U Understandable ░░░░░░░░░░░░░░░░░░░░ n/a
  R Robust         █████████████████░░░ 85

  Summary
  33 files scanned  ·  15 WCAG violations · 19 best-practice issues
  2 critical  11 serious  19 moderate  0 minor
  2 issues ignored via equall-ignore
  Score 56/100  ·  18/32 Level A criteria checked (56%)  ·  5 failed
                   29/56 Level AA criteria checked (52%)  ·  6 failed

  ⓘ You're failing 5 Level A criteria (1.3.1, 2.1.1, 2.4.2, 2.4.4, 4.1.2).
    Level A is the legal minimum — fix these first.

  Best Practices
  ● region — 26 issues  Landmarks help screen reader users navigate page sections
    src/app/layout.tsx
    src/components/Navigation.tsx
    ... and 24 more (use --verbose to see all)

  Scanners: axe-core@4.11.1 (23 issues), eslint-jsx-a11y@6.10.2 (13 issues)
  Completed in 0.8s
```

## Install

```bash
npm install -g equall-cli
```

Or run directly with npx:

```bash
npx equall scan .
```

## Why Equall?

Accessibility tools today fall into two camps: dev tools that show violations without context (axe, Lighthouse), and enterprise platforms that cost $75K+/year (Deque, Siteimprove). Nothing in between.

Equall aggregates existing open-source scanners and adds what's missing: a **score**, a **trend**, and a **POUR breakdown** that tells you where to focus.

- **Aggregator, not reinventor** — wraps axe-core, eslint-plugin-jsx-a11y, and more. We don't rewrite rules, we unify results.
- **Score 0-100** — weighted by severity, grouped by WCAG criterion, with a conformance level (A / AA / AAA).
- **POUR breakdown** — see which accessibility principle (Perceivable, Operable, Understandable, Robust) is your weakest.
- **Zero config** — point it at a folder, get a score. No setup, no account, no signup.
- **Honest about coverage** — we tell you exactly which criteria we test and which need manual review. No "100% compliant" bullshit.

## Usage

### Scan a project

```bash
equall scan .                    # current directory
equall scan ./my-app             # specific path
equall scan . --level A          # target Level A only
equall scan . --level AAA        # include Level AAA criteria
```

### JSON output

```bash
equall scan . --json             # pipe to other tools
equall scan . --json > report.json
```

### Options

```bash
equall scan . --include "src/**/*.tsx"
equall scan . --exclude "**/*.stories.*"
equall scan . --verbose              # show all files per best-practice rule
equall scan . --show-ignored         # show ignored issues
equall scan . --show-manual          # list untested criteria needing manual review
equall scan . --no-color             # disable colored output
```

## What gets scanned

Equall discovers and scans: `.html`, `.htm`, `.jsx`, `.tsx`, `.vue`, `.svelte`, `.astro`

It automatically skips: `node_modules`, `dist`, `build`, `.next`, test files, stories, and respects `.gitignore`.

## Scanners

| Scanner | What it checks | WCAG criteria covered |
|---------|---------------|----------------------|
| **axe-core** | HTML structure, ARIA, landmarks, forms, media | 24 |
| **eslint-plugin-jsx-a11y** | JSX/React-specific a11y patterns | 16 |
| **readability** | Required reading level of text content (Flesch, ARI, SMOG, etc.) | 1 (WCAG 3.1.5 AAA) |

### Readability scoring

The readability scanner checks [WCAG 3.1.5 (Reading Level)](https://www.w3.org/WAI/WCAG22/Understanding/reading-level) — text should be understandable at a lower secondary education level (approximately Grade 9).

It runs 6 formulas (Flesch-Kincaid, Coleman-Liau, ARI, Gunning Fog, SMOG, Dale-Chall) and uses the **median grade** across all formulas to reduce single-formula bias. If the median exceeds Grade 9, an issue is reported with the full breakdown.

- Scans `.html` and `.vue` files only — JSX/TSX excluded because regex extraction captures `className` attributes and `{expressions}` that pollute scores
- Skips files with fewer than 30 words (formulas are statistically invalid on short text)
- Skips non-English files (detected via `lang` attribute) — formulas are English-calibrated

## Scoring

The score (0-100) is designed to be fair and scalable, whether you are scanning 5 files or 5,000. It is calculated using a **density-based asymptotic algorithm**:

- **Severity Weights**: Violations add a penalty based on severity (critical: 10, serious: 5, moderate: 2, minor: 1).
- **Criterion Caps**: Penalties are capped at 15 points per WCAG criterion to prevent a single recurring issue from entirely destroying the score.
- **Density Scaling**: Total penalties are scaled down logarithmically based on the number of files scanned (`1 / (1 + log10(files))`). A large repository is allowed more absolute errors than a tiny project for the same score.
- **Exponential Curve**: The final score follows an asymptotic decay curve (`100 * exp(-k * penalty)`). It drops quickly for the first few errors but smoothly approaches `0` without ever hitting it brutally, leaving room to measure progression.

### POUR Breakdown
The POUR metrics (Perceivable, Operable, Understandable, Robust) strictly follow the same scoring logic, isolated by principle, providing an independent 0-100 score for each accessibility pillar.

### Conformance Level
Conformance (A / AA / AAA) is evaluated strictly against your `--level` target. If you target `AA`, any `AAA` rules incidentally flagged by the scanners will not downgrade your conformance status.

## Ignoring issues

Some issues are false positives (e.g. an orphan `<li>` in a component that's always rendered inside a `<ul>`). Suppress them with inline comments:

```tsx
// equall-ignore-next-line
<li>{item.name}</li>

// equall-ignore-next-line jsx-a11y/alt-text
<img src={logo} />

{/* equall-ignore-next-line */}
<div onClick={handler}>...</div>
```

```html
<!-- equall-ignore-next-line -->
<img src="decorative.png" />
```

Or use the CLI to inject/manage comments without opening the file:

```bash
equall ignore src/Modal.tsx                             # ignore an entire file
equall ignore src/Modal.tsx:89                          # ignore all rules at line 89
equall ignore src/Modal.tsx:89 jsx-a11y/alt-text        # ignore a specific rule
equall ignore .                                         # list all ignores
equall ignore --remove src/Modal.tsx:89                 # remove an ignore
equall ignore --remove src/Modal.tsx                    # remove all ignores in a file
equall ignore --clear                                   # remove all ignores
```

Ignored issues are excluded from the score. Use `equall scan . -i` to show them, or `--json` to get them with `"ignored": true`.

## Programmatic API

```typescript
import { runScan } from 'equall-cli'

const result = await runScan({
  path: './my-project',
  level: 'AA',
})

console.log(result.score)              // 73
console.log(result.conformance_level)  // 'A'
console.log(result.pour_scores)        // { perceivable: 90, operable: 65, ... }
console.log(result.issues.length)      // 12
```

## Exit codes

- `0` — score >= 50
- `1` — score < 50 (useful for CI gates)
- `2` — scan error

## Contributing

Issues and PRs welcome — https://github.com/GotaBird/equall/issues

## License

MIT
