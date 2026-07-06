import { describe, expect, it } from 'vitest'
import { mergeCrossEngineDuplicates, RULE_EQUIVALENCE } from '../rules/equivalence.js'
import { fingerprint } from '../utils/fingerprint.js'
import type { EquallIssue } from '../types.js'

const issue = (overrides: Partial<EquallIssue>): EquallIssue => ({
  scanner: 'axe-core',
  scanner_rule_id: 'image-alt',
  wcag_criteria: ['1.1.1'],
  wcag_level: 'A',
  pour: 'perceivable',
  file_path: 'src/Card.tsx',
  line: null,
  column: null,
  html_snippet: '<img src="logo.png">',
  severity: 'critical',
  message: 'Images must have alternative text',
  help_url: null,
  suggestion: null,
  ...overrides,
})

const eslintAlt = (overrides: Partial<EquallIssue> = {}): EquallIssue =>
  issue({
    scanner: 'eslint-jsx-a11y',
    scanner_rule_id: 'jsx-a11y/alt-text',
    line: 12,
    column: 5,
    html_snippet: '<img src={logo} />',
    ...overrides,
  })

describe('RULE_EQUIVALENCE', () => {
  it('is declarative and internally consistent', () => {
    for (const pair of RULE_EQUIVALENCE) {
      expect(pair.eslint.startsWith('jsx-a11y/')).toBe(true)
      expect(pair.axe.length).toBeGreaterThan(0)
      expect(pair.wcag_criteria.length).toBeGreaterThan(0)
      expect(pair.note.length).toBeGreaterThan(0)
    }
    // No axe rule id claimed by two different pairs — a finding must have one home.
    const axeIds = RULE_EQUIVALENCE.flatMap((p) => p.axe)
    expect(new Set(axeIds).size).toBe(axeIds.length)
  })
})

describe('mergeCrossEngineDuplicates', () => {
  it('merges the reference pair: one <img>, both engines → one issue', () => {
    const eslint = eslintAlt()
    const axe = issue({})
    const merged = mergeCrossEngineDuplicates([axe, eslint])

    expect(merged).toHaveLength(1)
    // Survivor is the line-bearing eslint issue…
    expect(merged[0].scanner_rule_id).toBe('jsx-a11y/alt-text')
    expect(merged[0].line).toBe(12)
    // …and both engines are credited, survivor's engine first.
    expect(merged[0].scanners).toEqual(['eslint-jsx-a11y', 'axe-core'])
    expect(merged[0].scanner).toBe('eslint-jsx-a11y')
  })

  it('does not touch the survivor identity: fingerprint is byte-identical to pre-merge', () => {
    const eslint = eslintAlt()
    const before = fingerprint(eslint)
    const [survivor] = mergeCrossEngineDuplicates([issue({}), eslint])
    expect(fingerprint(survivor)).toBe(before)
  })

  it('leaves ambiguous multi-occurrence cases unmerged (conservative)', () => {
    // Two axe findings, one eslint finding — no reliable way to pair them.
    const issues = [issue({}), issue({ html_snippet: '<img src="hero.png">' }), eslintAlt()]
    expect(mergeCrossEngineDuplicates(issues)).toHaveLength(3)
  })

  it('does not merge same-criterion rules that are not an equivalence pair', () => {
    // Both 4.1.2, but aria-role ≠ aria-required-attr: different defects.
    const eslint = eslintAlt({
      scanner_rule_id: 'jsx-a11y/aria-role',
      wcag_criteria: ['4.1.2'],
      html_snippet: '<div role="banana">',
    })
    const axe = issue({
      scanner_rule_id: 'aria-required-attr',
      wcag_criteria: ['4.1.2'],
      html_snippet: '<div role="checkbox">',
    })
    expect(mergeCrossEngineDuplicates([axe, eslint])).toHaveLength(2)
  })

  it('does not merge across files', () => {
    const issues = [issue({ file_path: 'src/A.tsx' }), eslintAlt({ file_path: 'src/B.tsx' })]
    expect(mergeCrossEngineDuplicates(issues)).toHaveLength(2)
  })

  it('merges pair-wise per file in a multi-file scan', () => {
    const issues = [
      issue({ file_path: 'src/A.tsx' }),
      eslintAlt({ file_path: 'src/A.tsx' }),
      issue({ file_path: 'src/B.tsx' }),
      eslintAlt({ file_path: 'src/B.tsx' }),
    ]
    const merged = mergeCrossEngineDuplicates(issues)
    expect(merged).toHaveLength(2)
    expect(merged.every((i) => i.scanners?.length === 2)).toBe(true)
  })

  it('covers every axe id of a pair (input-image-alt merges into alt-text too)', () => {
    const axe = issue({ scanner_rule_id: 'input-image-alt', html_snippet: '<input type="image">' })
    const merged = mergeCrossEngineDuplicates([axe, eslintAlt()])
    expect(merged).toHaveLength(1)
    expect(merged[0].scanners).toContain('axe-core')
  })

  it('returns the input untouched when nothing merges', () => {
    const issues = [issue({}), issue({ file_path: 'src/Other.tsx' })]
    const merged = mergeCrossEngineDuplicates(issues)
    expect(merged).toEqual(issues)
    expect(merged.every((i) => i.scanners === undefined)).toBe(true)
  })
})
