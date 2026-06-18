import { createHash } from 'node:crypto'
import type { EquallIssue } from '../types.js'

// Stable identity for an issue (BUR-106).
//
// The fingerprint must survive cosmetic churn so diff-aware scanning (T1.2) and
// the decision registry (T2.1) can match the *same* issue across commits:
//   - a Prettier reformat (whitespace / quote style / line breaks) must NOT change it,
//   - a CSS class change on the offending element must NOT change it,
//   - it must NEVER depend on line/column (axe returns line: null, and any added
//     import shifts every line — every violation would look "new").
//
// Identity = hash of: file_path + scanner_rule_id + sorted WCAG criteria + normalized snippet.
// For eslint issues the "snippet" is the offending source token captured by the scanner
// (see eslint-jsx-a11y-scanner.ts), so two violations of the same rule in the same file
// stay distinct instead of collapsing onto one fingerprint.
export function fingerprint(issue: EquallIssue): string {
  const criteria = [...issue.wcag_criteria].sort()
  const context = normalizeSnippet(issue.html_snippet)
  // JSON.stringify gives unambiguous field boundaries (quotes are escaped), so no
  // value can bleed across fields and forge a collision.
  const canonical = JSON.stringify([issue.file_path, issue.scanner_rule_id, criteria, context])
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16)
}

// Strip the parts of a snippet that change without changing the issue's identity:
// cosmetic presentation attributes (class/className/style), quote style and whitespace.
// The brace alternative handles one level of nesting so JSX `style={{ ... }}` is stripped
// whole. Deeper nesting is best-effort — it only risks a (harmless) split into two
// fingerprints, never a false merge.
export function normalizeSnippet(snippet: string | null | undefined): string {
  if (!snippet) return ''
  return snippet
    // drop cosmetic attributes entirely (HTML class / JSX className / inline style)
    .replace(/\s+(?:class|className|style)\s*=\s*(?:"[^"]*"|'[^']*'|\{(?:[^{}]|\{[^{}]*\})*\}|[^\s>]+)/gi, '')
    // normalize quote style (Prettier may rewrite ' -> ")
    .replace(/['"]/g, '"')
    // collapse all whitespace runs to a single space
    .replace(/\s+/g, ' ')
    // normalize whitespace around tag closers so `<img ... >` == `<img ...>`
    .replace(/\s*\/>/g, '/>')
    .replace(/\s+>/g, '>')
    .trim()
}
