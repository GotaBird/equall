---
name: update-readme
description: Sync README.md with the current state of the codebase — scanners, CLI flags, scoring, API
allowed-tools: Read, Grep, Glob, Bash, Edit
disable-model-invocation: false
---

# Update README.md

Synchronize `README.md` with the current state of the Equall codebase. The README is the public face of the project — it must be accurate, concise, and reflect reality.

## Process

### 1. Gather current state
Read these files to understand what has changed:

- `src/cli.ts` — CLI flags and commands (--level, --json, --include, --exclude, etc.)
- `src/scanners/index.ts` — registered scanners
- `src/scanners/*.ts` — each scanner's `name`, `coveredCriteria`, file types supported
- `src/scoring/score.ts` — scoring constants (SEVERITY_WEIGHT, MAX_PENALTY_PER_CRITERION, k)
- `src/types.ts` — public interfaces (ScanResult, EquallIssue, etc.)
- `src/discover.ts` — supported file extensions, default include/exclude patterns
- `src/output/terminal.ts` — output format, coaching messages
- `src/index.ts` — public API exports
- `package.json` — version, bin, engines, scripts

### 2. Compare with README
Read `README.md` and identify:
- **Stale info**: scanners listed that no longer exist, missing new scanners, wrong CLI flags
- **Missing features**: new flags, new scanners, new output sections not documented
- **Wrong numbers**: rule counts, WCAG criteria totals, severity weights
- **Outdated examples**: scan output that doesn't match current terminal format
- **API changes**: if the programmatic API signature has changed

### 3. Update sections
Only update what has actually changed. Preserve the existing tone and structure:
- **No fluff** — Kevin's writing style is direct, opinionated, technical
- **Keep the personality** — "No 100% compliant bullshit", "One command. Real score. No config."
- **Tables for scanners** — update scanner table with current registry
- **Scoring section** — only update if constants or formula changed
- **File types** — sync with `discover.ts` patterns
- **Exit codes** — sync with `cli.ts`
- **Version** — reflect package.json version

### 4. Verify
After editing, run:
```bash
# Check that all CLI flags mentioned in README actually exist
grep -oP '\-\-\w+' README.md | sort -u
# Compare with actual flags in cli.ts
grep -oP '\.option\([^)]+' src/cli.ts
```

## Rules
- NEVER add badges, shields, or contributor sections unless Kevin asks
- NEVER add a table of contents — the README is short enough without one
- NEVER change the "Why Equall?" section — that's product positioning, Kevin owns it
- NEVER invent features — only document what exists in the code
- Keep it under 150 lines
- English only (code + README are always in English)
