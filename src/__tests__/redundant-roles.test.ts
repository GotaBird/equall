import { describe, it, expect } from 'vitest'
import { scanBuffer } from '../scan.js'
import type { EquallIssue, ScanResult } from '../types.js'

// jsx-a11y/no-redundant-roles: a role equal to the element's implicit role is a minor best
// practice, not a 4.1.2 failure, and the list roles restated on lists (the Safari/VoiceOver
// `list-style: none` workaround) are not reported at all.

const RULE = 'jsx-a11y/no-redundant-roles'

function redundant(result: ScanResult): EquallIssue[] {
  return result.issues.filter((i) => i.scanner_rule_id === RULE)
}

function component(body: string): string {
  return `export function C() {\n  return (\n    <div>\n${body}\n    </div>\n  )\n}\n`
}

describe('no-redundant-roles', () => {
  it('does not report role="list" on ul/ol nor role="listitem" on li', async () => {
    const result = await scanBuffer(
      component(`      <ul role="list" style={{ listStyle: 'none' }}>
        <li role="listitem">One</li>
      </ul>
      <ol role="list">
        <li>Two</li>
      </ol>`),
      'List.jsx'
    )
    expect(redundant(result)).toEqual([])
  })

  it('reports other redundant roles as a minor best practice with an explanation', async () => {
    const result = await scanBuffer(
      component(`      <button role="button" type="button">Go</button>
      <a href="/x" role="link">X</a>`),
      'Controls.jsx'
    )
    const issues = redundant(result)
    expect(issues).toHaveLength(2)
    for (const issue of issues) {
      expect(issue.wcag_criteria).toEqual([])
      expect(issue.wcag_level).toBeNull()
      expect(issue.pour).toBeNull()
      expect(issue.severity).toBe('minor')
      expect(issue.help_url).toBe('https://www.w3.org/TR/html-aria/#docconformance')
      expect(issue.suggestion).toMatch(/repeats the element's implicit role/)
    }
  })

  it('keeps the plugin default exemption for nav (the option is looked up per element)', async () => {
    const result = await scanBuffer(
      component(`      <nav role="navigation"><a href="/">Home</a></nav>`),
      'Nav.jsx'
    )
    expect(redundant(result)).toEqual([])
  })

  it('applies the same exemption and class on .astro files', async () => {
    const astro = `---
const title = 'x'
---
<ul role="list"><li>One</li></ul>
<button role="button" type="button">Go</button>
`
    const issues = redundant(await scanBuffer(astro, 'Page.astro'))
    expect(issues).toHaveLength(1)
    expect(issues[0].html_snippet).toContain('button')
    expect(issues[0].wcag_criteria).toEqual([])
    expect(issues[0].severity).toBe('minor')
  })

  it('no longer fails 4.1.2 and costs one minor best practice in the score', async () => {
    const result = await scanBuffer(
      component(`      <button role="button" type="button">Go</button>`),
      'One.jsx'
    )
    expect(redundant(result)).toHaveLength(1)
    // score_model 2: one minor best practice → 100 · exp(-0.01 · 1)
    expect(result.score).toBe(99.0)
    const c412 = result.criterion_conformance?.find((c) => c.criterion === '4.1.2')
    expect(c412?.verdict).not.toBe('fail')
  })
})
