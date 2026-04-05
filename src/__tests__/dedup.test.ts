import { describe, it, expect } from 'vitest'
import { deduplicateIssues } from '../scan.js'
import type { EquallIssue } from '../types.js'

function makeIssue(overrides: Partial<EquallIssue> = {}): EquallIssue {
  return {
    scanner: 'test',
    scanner_rule_id: 'test-rule',
    wcag_criteria: ['1.1.1'],
    wcag_level: 'A',
    pour: 'perceivable',
    file_path: 'comp.tsx',
    line: 10,
    column: 1,
    html_snippet: null,
    severity: 'moderate',
    message: 'test',
    help_url: null,
    suggestion: null,
    ...overrides,
  }
}

describe('deduplicateIssues', () => {
  it('removes exact duplicates (same file, criteria, line)', () => {
    const issues = [
      makeIssue({ scanner: 'axe-core' }),
      makeIssue({ scanner: 'htmlcs' }),
    ]
    const result = deduplicateIssues(issues)
    expect(result).toHaveLength(1)
  })

  it('keeps issues with different criteria', () => {
    const issues = [
      makeIssue({ wcag_criteria: ['1.1.1'] }),
      makeIssue({ wcag_criteria: ['2.1.1'] }),
    ]
    const result = deduplicateIssues(issues)
    expect(result).toHaveLength(2)
  })

  it('keeps issues with different files', () => {
    const issues = [
      makeIssue({ file_path: 'a.tsx' }),
      makeIssue({ file_path: 'b.tsx' }),
    ]
    const result = deduplicateIssues(issues)
    expect(result).toHaveLength(2)
  })

  it('keeps issues with different lines', () => {
    const issues = [
      makeIssue({ line: 10 }),
      makeIssue({ line: 20 }),
    ]
    const result = deduplicateIssues(issues)
    expect(result).toHaveLength(2)
  })

  it('deduplicates regardless of criteria order', () => {
    const issues = [
      makeIssue({ wcag_criteria: ['1.1.1', '4.1.2'] }),
      makeIssue({ wcag_criteria: ['4.1.2', '1.1.1'] }),
    ]
    const result = deduplicateIssues(issues)
    expect(result).toHaveLength(1)
  })

  it('uses html_snippet for dedup when line is null', () => {
    const issues = [
      makeIssue({ line: null, html_snippet: '<img src="a" />' }),
      makeIssue({ line: null, html_snippet: '<img src="a" />' }),
    ]
    const result = deduplicateIssues(issues)
    expect(result).toHaveLength(1)
  })

  it('keeps issues with different snippets when line is null', () => {
    const issues = [
      makeIssue({ line: null, html_snippet: '<img src="a" />' }),
      makeIssue({ line: null, html_snippet: '<img src="b" />' }),
    ]
    const result = deduplicateIssues(issues)
    expect(result).toHaveLength(2)
  })

  it('returns empty for empty input', () => {
    expect(deduplicateIssues([])).toHaveLength(0)
  })

  it('keeps first issue when deduplicating', () => {
    const issues = [
      makeIssue({ scanner: 'axe-core', message: 'first' }),
      makeIssue({ scanner: 'htmlcs', message: 'second' }),
    ]
    const result = deduplicateIssues(issues)
    expect(result[0].message).toBe('first')
  })
})
