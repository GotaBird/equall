---
name: add-scanner
description: Scaffold a new scanner adapter with full ScannerAdapter implementation, registry wiring, and test file
argument-hint: [scanner-name]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
---

# Add Scanner: $ARGUMENTS

Before writing any code, read the scanner-adapter skill:
- Read `.claude/skills/scanner-adapter/SKILL.md`
- Read `.claude/skills/wcag-mapping/SKILL.md`

Then scaffold the new scanner `$ARGUMENTS`:

## 1. Create scanner file
Create `src/scanners/$ARGUMENTS-scanner.ts` implementing `ScannerAdapter`:
- Import types from `../types.js`
- Implement `isAvailable()` with dynamic `await import()` for the scanner's npm dependency
- Implement `scan(context: ScanContext)` returning `EquallIssue[]`
- Declare `coveredCriteria` with all WCAG criteria the scanner can test (dot notation: '1.1.1')
- Map the scanner's native severity to Equall severity: critical/serious/moderate/minor
- Map rules to WCAG criteria and POUR principles
- Wrap per-file processing in try/catch — never crash the whole scan
- Use `pourFromCriterion()` pattern: derive POUR from first digit of criterion number

## 2. Register in scanner index
Edit `src/scanners/index.ts`:
- Import the new scanner class
- Add `new $0Scanner()` to `ALL_SCANNERS` array
- Export the class

## 3. Create test file
Create `tests/scanners/$ARGUMENTS-scanner.test.ts`:
- Test `isAvailable()` returns true (if dep is installed)
- Test detection of at least one known violation
- Test clean file produces 0 issues
- Assert on `wcag_criteria`, `severity`, `scanner` fields — not exact messages

## 4. Update README
Run `/update-readme` to sync the scanner table, file types, and coverage numbers with the new scanner.

## 5. Verify
- Run `npm run build` — must succeed
- Run `npm run test` — must pass
- Show the `coveredCriteria` for review
