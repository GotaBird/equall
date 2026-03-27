import { describe, it, expect } from 'vitest'
import { applyIgnoreComments } from '../scan.js'
import type { GladosIssue, FileEntry } from '../types.js'

function makeIssue(overrides: Partial<GladosIssue> = {}): GladosIssue {
  return {
    scanner: 'test-scanner',
    scanner_rule_id: 'test-rule',
    wcag_criteria: ['1.1.1'],
    wcag_level: 'A',
    pour: 'perceivable',
    file_path: 'comp.tsx',
    line: 10,
    column: 1,
    html_snippet: null,
    severity: 'moderate',
    message: 'test issue',
    help_url: null,
    suggestion: null,
    ...overrides,
  }
}

function makeFile(path: string, content: string): FileEntry {
  return {
    path,
    absolute_path: `/project/${path}`,
    content,
    type: 'tsx',
  }
}

function lines(...parts: string[]): string {
  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// applyIgnoreComments
// ---------------------------------------------------------------------------
describe('applyIgnoreComments', () => {
  it('ignores issue when previous line has equall-ignore-next-line', () => {
    const files = [makeFile('comp.tsx', lines(
      'line 1',
      'line 2',
      'line 3',
      'line 4',
      'line 5',
      'line 6',
      'line 7',
      'line 8',
      '// equall-ignore-next-line',
      '<img src="a" />',
    ))]
    const issues = [makeIssue({ file_path: 'comp.tsx', line: 10 })]

    const { active, ignored } = applyIgnoreComments(issues, files)
    expect(active).toHaveLength(0)
    expect(ignored).toHaveLength(1)
    expect(ignored[0].ignored).toBe(true)
  })

  it('does not ignore when previous line has no comment', () => {
    const files = [makeFile('comp.tsx', lines(
      'line 1',
      'line 2',
      '<img src="a" />',
    ))]
    const issues = [makeIssue({ file_path: 'comp.tsx', line: 3 })]

    const { active, ignored } = applyIgnoreComments(issues, files)
    expect(active).toHaveLength(1)
    expect(ignored).toHaveLength(0)
  })

  it('matches specific rule-id', () => {
    const files = [makeFile('comp.tsx', lines(
      '// equall-ignore-next-line jsx-a11y/alt-text',
      '<img />',
    ))]

    const matching = makeIssue({ file_path: 'comp.tsx', line: 2, scanner_rule_id: 'jsx-a11y/alt-text' })
    const other = makeIssue({ file_path: 'comp.tsx', line: 2, scanner_rule_id: 'jsx-a11y/anchor-is-valid' })

    const { active, ignored } = applyIgnoreComments([matching, other], files)
    expect(ignored).toHaveLength(1)
    expect(ignored[0].scanner_rule_id).toBe('jsx-a11y/alt-text')
    expect(active).toHaveLength(1)
    expect(active[0].scanner_rule_id).toBe('jsx-a11y/anchor-is-valid')
  })

  it('ignores all rules on that line when no rule-id specified', () => {
    const files = [makeFile('comp.tsx', lines(
      '// equall-ignore-next-line',
      '<img />',
    ))]

    const issues = [
      makeIssue({ file_path: 'comp.tsx', line: 2, scanner_rule_id: 'rule-a' }),
      makeIssue({ file_path: 'comp.tsx', line: 2, scanner_rule_id: 'rule-b' }),
    ]

    const { active, ignored } = applyIgnoreComments(issues, files)
    expect(ignored).toHaveLength(2)
    expect(active).toHaveLength(0)
  })

  it('equall-ignore-file suppresses all issues in that file', () => {
    const files = [makeFile('layout.tsx', lines(
      '// equall-ignore-file',
      '<html>',
      '<body></body>',
      '</html>',
    ))]

    const issues = [
      makeIssue({ file_path: 'layout.tsx', line: 3 }),
      makeIssue({ file_path: 'layout.tsx', line: null }),
    ]

    const { active, ignored } = applyIgnoreComments(issues, files)
    expect(ignored).toHaveLength(2)
    expect(active).toHaveLength(0)
  })

  it('equall-ignore-file only works in first 5 lines', () => {
    const files = [makeFile('late.tsx', lines(
      'line 1',
      'line 2',
      'line 3',
      'line 4',
      'line 5',
      '// equall-ignore-file',
      '<img />',
    ))]

    const issues = [makeIssue({ file_path: 'late.tsx', line: 7 })]

    const { active, ignored } = applyIgnoreComments(issues, files)
    expect(active).toHaveLength(1)
    expect(ignored).toHaveLength(0)
  })

  it('issues without line number can only be ignored by equall-ignore-file', () => {
    const files = [makeFile('page.html', lines(
      'line 1',
      '// equall-ignore-next-line',
      '<img />',
    ))]

    const issues = [makeIssue({ file_path: 'page.html', line: null })]

    const { active, ignored } = applyIgnoreComments(issues, files)
    expect(active).toHaveLength(1)
    expect(ignored).toHaveLength(0)
  })

  it('supports HTML comment syntax', () => {
    const files = [makeFile('page.html', lines(
      '<!-- equall-ignore-next-line -->',
      '<img />',
    ))]

    const issues = [makeIssue({ file_path: 'page.html', line: 2 })]

    const { active, ignored } = applyIgnoreComments(issues, files)
    expect(ignored).toHaveLength(1)
  })

  it('supports JSX comment syntax', () => {
    const files = [makeFile('comp.tsx', lines(
      '{/* equall-ignore-next-line */}',
      '<img />',
    ))]

    const issues = [makeIssue({ file_path: 'comp.tsx', line: 2 })]

    const { active, ignored } = applyIgnoreComments(issues, files)
    expect(ignored).toHaveLength(1)
  })

  it('does not ignore issues on line 1', () => {
    const files = [makeFile('comp.tsx', '<img />')]
    const issues = [makeIssue({ file_path: 'comp.tsx', line: 1 })]

    const { active, ignored } = applyIgnoreComments(issues, files)
    expect(active).toHaveLength(1)
    expect(ignored).toHaveLength(0)
  })

  it('preserves original issue data on ignored issues', () => {
    const files = [makeFile('comp.tsx', lines(
      '// equall-ignore-next-line',
      '<img />',
    ))]
    const original = makeIssue({ file_path: 'comp.tsx', line: 2, message: 'original msg' })

    const { ignored } = applyIgnoreComments([original], files)
    expect(ignored[0].message).toBe('original msg')
    expect(ignored[0].scanner_rule_id).toBe('test-rule')
    expect(ignored[0].ignored).toBe(true)
  })
})
