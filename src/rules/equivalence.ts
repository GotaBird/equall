import type { EquallIssue } from '../types.js'

// Cross-engine rule equivalence — the dedup layer's knowledge of which rules assert the
// SAME requirement on the SAME element across engines. Aggregating engines means the same
// missing `alt` arrives twice: once as eslint `jsx-a11y/alt-text` (with a source line),
// once as axe `image-alt` (with a DOM snippet, no line). Counting it twice inflates every
// number a consumer sees; this table lets the merge pass collapse the pair into one issue
// that credits both engines.
//
// Declarative on purpose (same philosophy as page-level.ts): supporting a new engine means
// adding rows, not merge logic.
//
// Inclusion principle (audited against the eslint RULE_WCAG_MAP and axe-core 4.x metadata):
// - PAIR only rules that fire on the SAME element for the same defect. Both engines
//   agreeing is one finding observed twice.
// - Audited and deliberately EXCLUDED: `jsx-a11y/label-has-associated-control` vs axe
//   `label`/`select-name` — they see the same broken pairing from opposite ends (eslint
//   flags the orphan <label>, axe flags the unlabeled control). Those can be two distinct
//   spots in the same file; merging could drop a real finding. Also excluded:
//   `img-redundant-alt` vs axe `image-redundant-alt` (advisory, low duplication value).

export interface EquivalentRulePair {
  // scanner_rule_id as emitted by eslint-jsx-a11y (plugin-prefixed) — the line-bearing side
  eslint: string
  // axe-core rule ids asserting the same requirement on the same element
  axe: string[]
  wcag_criteria: string[]
  note: string
}

const pair = (eslint: string, axe: string[], wcag_criteria: string[], note: string): EquivalentRulePair => ({
  eslint,
  axe,
  wcag_criteria,
  note,
})

export const RULE_EQUIVALENCE: EquivalentRulePair[] = [
  pair(
    'jsx-a11y/alt-text',
    ['image-alt', 'input-image-alt', 'area-alt', 'object-alt'],
    ['1.1.1'],
    'Text alternative missing on the media element itself.'
  ),
  pair(
    'jsx-a11y/anchor-has-content',
    ['link-name'],
    ['2.4.4', '4.1.2'],
    'Anchor with no discernible content / accessible name.'
  ),
  pair(
    'jsx-a11y/iframe-has-title',
    ['frame-title'],
    ['2.4.1', '4.1.2'],
    'Frame element without a title.'
  ),
  pair('jsx-a11y/aria-role', ['aria-roles'], ['4.1.2'], 'Invalid role value on the element.'),
  pair('jsx-a11y/aria-props', ['aria-valid-attr'], ['4.1.2'], 'Unknown aria-* attribute name.'),
  pair(
    'jsx-a11y/aria-proptypes',
    ['aria-valid-attr-value'],
    ['4.1.2'],
    'Invalid value for a valid aria-* attribute.'
  ),
  pair(
    'jsx-a11y/role-has-required-aria-props',
    ['aria-required-attr'],
    ['4.1.2'],
    'Role missing one of its required aria-* attributes.'
  ),
  pair(
    'jsx-a11y/html-has-lang',
    ['html-has-lang'],
    ['3.1.1'],
    'Same rule id on both engines. eslint only fires on a literal <html> element, which also makes the file a document unit — so the axe twin is active (not reclassified) whenever this pair can match.'
  ),
]

// Merge cross-engine duplicates: when both sides of an equivalence pair fired in the same
// file and the match is UNAMBIGUOUS (exactly one finding on each side), keep the
// line-bearing eslint issue and credit both engines on it (`scanners`).
//
// Deliberately conservative: with multiple occurrences on either side there is no reliable
// way to pair findings — axe snippets come from the extracted/neutralized HTML and cannot
// be located back in JSX/Astro/Vue source — so ambiguous cases keep BOTH issues.
// Over-counting a duplicate is a visible, known cost; silently dropping a real finding is
// not acceptable.
//
// Runs before deduplicateIssues and before fingerprinting: the survivor keeps every field
// it had (rule id, snippet, criteria), so its fingerprint — and diff-aware identity — is
// exactly what it would have been without the merge.
export function mergeCrossEngineDuplicates(issues: EquallIssue[]): EquallIssue[] {
  // file_path → scanner_rule_id → issues
  const byFileAndRule = new Map<string, Map<string, EquallIssue[]>>()
  for (const issue of issues) {
    let rules = byFileAndRule.get(issue.file_path)
    if (!rules) {
      rules = new Map()
      byFileAndRule.set(issue.file_path, rules)
    }
    const list = rules.get(issue.scanner_rule_id)
    if (list) list.push(issue)
    else rules.set(issue.scanner_rule_id, [issue])
  }

  const dropped = new Set<EquallIssue>()
  const credited = new Map<EquallIssue, string[]>()

  for (const rules of byFileAndRule.values()) {
    for (const { eslint, axe } of RULE_EQUIVALENCE) {
      const eslintSide = rules.get(eslint) ?? []
      const axeSide = axe.flatMap((id) => rules.get(id) ?? [])
      // Only the unambiguous 1:1 case merges (see header comment).
      if (eslintSide.length !== 1 || axeSide.length !== 1) continue
      const survivor = eslintSide[0]
      const twin = axeSide[0]
      dropped.add(twin)
      credited.set(survivor, [survivor.scanner, twin.scanner])
    }
  }

  if (dropped.size === 0) return issues
  return issues
    .filter((issue) => !dropped.has(issue))
    .map((issue) => {
      const scanners = credited.get(issue)
      return scanners ? { ...issue, scanners } : issue
    })
}
