# Skill: Scanner Adapter

## Purpose
Guide for implementing a new scanner adapter in Equall. Every scanner follows the `ScannerAdapter` interface and plugs into the registry.

## Interface Contract

Every scanner MUST implement `ScannerAdapter` from `src/types.ts`:

```typescript
interface ScannerAdapter {
  name: string                           // Unique scanner ID: 'axe-core', 'pa11y', etc.
  version: string                        // Populated at runtime from the scanner's package
  coveredCriteria: string[]              // WCAG criteria IDs this scanner CAN test (e.g. ['1.1.1', '4.1.2'])
  scan(context: ScanContext): Promise<EquallIssue[]>
  isAvailable(): Promise<boolean>        // Return false if deps not installed
}
```

## Step-by-Step: Adding a Scanner

### 1. Create the file
`src/scanners/<scanner-name>-scanner.ts`

### 2. Implement the adapter
- `isAvailable()`: Use `await import('<dep>')` in try/catch. Return `false` if missing.
- `scan()`: Receive `ScanContext` (root_path, files[], options). Return `EquallIssue[]`.
- `coveredCriteria`: Declare ALL WCAG criteria IDs this scanner is capable of testing. Use dot notation: `'1.1.1'`, not `'wcag111'`.
- `version`: Set dynamically in `scan()` from the underlying tool's package version.

### 3. Register in `src/scanners/index.ts`
```typescript
import { MyScanner } from './my-scanner.js'
const ALL_SCANNERS: ScannerAdapter[] = [
  new AxeScanner(),
  new EslintJsxA11yScanner(),
  new MyScanner(),  // Add here
]
```

### 4. Normalize output to `EquallIssue`
Every issue MUST have:
- `scanner`: your scanner name
- `scanner_rule_id`: original rule ID from the tool
- `wcag_criteria`: string[] of WCAG criteria (can be empty for best-practice)
- `wcag_level`: 'A' | 'AA' | 'AAA' | null
- `pour`: 'perceivable' | 'operable' | 'understandable' | 'robust' | null
- `severity`: 'critical' | 'serious' | 'moderate' | 'minor'
- `file_path`: relative path from project root
- `line` / `column`: provide if the scanner supports it, null otherwise
- `html_snippet`: offending HTML if available, null otherwise
- `message`: human-readable, format as `"<help text> (<rule-id>)"`
- `help_url`: link to the rule's documentation
- `suggestion`: how to fix, null if unavailable

### 5. POUR derivation
If the scanner doesn't provide POUR directly, derive from the WCAG criterion number:
- `1.x.x` → perceivable
- `2.x.x` → operable
- `3.x.x` → understandable
- `4.x.x` → robust

## Rules

- **Isolation**: A scanner crash MUST NOT affect other scanners. Wrap file-level processing in try/catch, log warnings, skip the file.
- **Dynamic imports**: Use `await import()` for scanner dependencies — they're optional.
- **No global state**: Scanners may run in parallel via `Promise.allSettled`.
- **Memory**: If the scanner creates DOM instances or heavy objects, clean up in a `finally` block.
- **Best-practices vs WCAG**: If a rule has no WCAG mapping, set `wcag_criteria: []` and `wcag_level: null`. The output layer handles the split.

## Files Impacted
- `src/scanners/<new-scanner>.ts` (new)
- `src/scanners/index.ts` (register)
- `src/types.ts` (no change unless new types needed)

## Reference Implementations
- `src/scanners/axe-scanner.ts` — DOM-based scanner with JSDOM, complex WCAG tag parsing
- `src/scanners/eslint-jsx-a11y-scanner.ts` — AST-based scanner with hardcoded WCAG mapping
