import { describe, it, expect } from 'vitest'
import { fingerprint, normalizeSnippet } from '../utils/fingerprint.js'
import type { EquallIssue } from '../types.js'

function makeIssue(overrides: Partial<EquallIssue> = {}): EquallIssue {
  return {
    scanner: 'axe-core',
    scanner_rule_id: 'image-alt',
    wcag_criteria: ['1.1.1'],
    wcag_level: 'A',
    pour: 'perceivable',
    file_path: 'src/Hero.tsx',
    line: null,
    column: null,
    html_snippet: '<img src="logo.png">',
    severity: 'serious',
    message: 'Images must have alternate text (image-alt)',
    help_url: null,
    suggestion: null,
    ...overrides,
  }
}

describe('fingerprint', () => {
  // AC: same issue before/after a Prettier reformat yields the same fingerprint.
  it('is stable across a Prettier reformat (whitespace, quotes, line breaks)', () => {
    const before = makeIssue({ html_snippet: `<img src='logo.png'>` })
    const after = makeIssue({ html_snippet: `<img\n  src="logo.png"\n>` })
    expect(fingerprint(before)).toBe(fingerprint(after))
  })

  // AC: a CSS-class-only change on the offending element keeps the fingerprint stable.
  it('is stable when only a CSS class changes (HTML)', () => {
    const a = makeIssue({ html_snippet: '<img class="w-4 h-4" src="logo.png">' })
    const b = makeIssue({ html_snippet: '<img class="mt-2 rounded" src="logo.png">' })
    expect(fingerprint(a)).toBe(fingerprint(b))
  })

  it('is stable when only a className/style changes (JSX)', () => {
    const a = makeIssue({
      scanner: 'eslint-jsx-a11y',
      scanner_rule_id: 'jsx-a11y/alt-text',
      html_snippet: '<img className="foo" src={logo} />',
    })
    const b = makeIssue({
      scanner: 'eslint-jsx-a11y',
      scanner_rule_id: 'jsx-a11y/alt-text',
      html_snippet: '<img className="bar baz" style={{ marginTop: 8 }} src={logo} />',
    })
    expect(fingerprint(a)).toBe(fingerprint(b))
  })

  // AC: two distinct issues → distinct fingerprints.
  it('differs when the offending element differs', () => {
    const a = makeIssue({ html_snippet: '<img src="a.png">' })
    const b = makeIssue({ html_snippet: '<img src="b.png">' })
    expect(fingerprint(a)).not.toBe(fingerprint(b))
  })

  it('differs by rule id', () => {
    expect(fingerprint(makeIssue({ scanner_rule_id: 'image-alt' })))
      .not.toBe(fingerprint(makeIssue({ scanner_rule_id: 'label' })))
  })

  it('differs by file path', () => {
    expect(fingerprint(makeIssue({ file_path: 'a.tsx' })))
      .not.toBe(fingerprint(makeIssue({ file_path: 'b.tsx' })))
  })

  it('differs by WCAG criteria', () => {
    expect(fingerprint(makeIssue({ wcag_criteria: ['1.1.1'] })))
      .not.toBe(fingerprint(makeIssue({ wcag_criteria: ['4.1.2'] })))
  })

  it('is independent of criteria order', () => {
    expect(fingerprint(makeIssue({ wcag_criteria: ['1.1.1', '4.1.2'] })))
      .toBe(fingerprint(makeIssue({ wcag_criteria: ['4.1.2', '1.1.1'] })))
  })

  // The core reason the fingerprint exists: axe returns line: null and any added
  // import shifts every line. Identity must not move with it.
  it('does NOT depend on line or column', () => {
    expect(fingerprint(makeIssue({ line: 10, column: 4 })))
      .toBe(fingerprint(makeIssue({ line: 87, column: 12 })))
  })

  // eslint token context: two same-rule violations in the same file stay distinct.
  it('distinguishes two same-rule eslint issues by their token context', () => {
    const a = makeIssue({
      scanner: 'eslint-jsx-a11y',
      scanner_rule_id: 'jsx-a11y/alt-text',
      html_snippet: '<img src={logo} />',
    })
    const b = makeIssue({
      scanner: 'eslint-jsx-a11y',
      scanner_rule_id: 'jsx-a11y/alt-text',
      html_snippet: '<img src={hero} />',
    })
    expect(fingerprint(a)).not.toBe(fingerprint(b))
  })

  it('produces a 16-char hex digest', () => {
    expect(fingerprint(makeIssue())).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('normalizeSnippet', () => {
  it('returns empty string for null/undefined', () => {
    expect(normalizeSnippet(null)).toBe('')
    expect(normalizeSnippet(undefined)).toBe('')
  })

  it('strips cosmetic attributes and normalizes quotes/whitespace', () => {
    expect(normalizeSnippet(`<img  class='a b'   src='x.png' >`)).toBe('<img src="x.png">')
  })
})
