import { describe, it, expect, vi } from 'vitest'
import { scanBuffer } from '../scan.js'
import { fingerprint } from '../utils/fingerprint.js'
import { printResult } from '../output/terminal.js'
import type { ScanResult } from '../types.js'

// On component source axe only sees markup reconstructed from the code. A finding it cannot
// confirm there is reported with its fingerprint unchanged but flagged review_only, and never
// counted (score, summary, conformance). Plain .html is real markup and is never demoted.

const axeIssues = (r: ScanResult) => r.issues.filter((i) => i.scanner === 'axe-core')

describe('review-only findings on component source', () => {
  it('a finding on a component tag is review-only and does not count', async () => {
    // <Button> is a component: its accessible name comes from its own implementation.
    const r = await scanBuffer(
      `export function Toolbar() { return (<div><Button variant="ghost"><SunIcon /></Button></div>) }`,
      'Toolbar.tsx',
    )
    const buttonName = axeIssues(r).find((i) => i.scanner_rule_id === 'button-name')
    expect(buttonName?.review_only).toBe(true)
    expect(buttonName?.review_reason).toBeTruthy()
    expect(buttonName?.fingerprint).toBeTruthy()
    // Not counted anywhere.
    expect(r.score).toBe(100)
    expect(r.summary.total_issues).toBe(r.issues.filter((i) => !i.review_only && !i.ignored).length)
    expect(r.criterion_conformance?.find((c) => c.criterion === '4.1.2')?.verdict).not.toBe('fail')
  })

  it('a literal element with nothing hidden stays counted on component source', async () => {
    const r = await scanBuffer(`export function Close() { return (<div><button type="button"></button></div>) }`, 'Close.tsx')
    const buttonName = axeIssues(r).find((i) => i.scanner_rule_id === 'button-name')
    expect(buttonName).toBeDefined()
    expect(buttonName?.review_only).toBeUndefined()
    expect(r.score).toBeLessThan(100)
  })

  it('an element whose name may come from props is review-only', async () => {
    const r = await scanBuffer(`export function Field(props) { return (<div><input type="text" {...props} /></div>) }`, 'Field.tsx')
    for (const issue of axeIssues(r).filter((i) => i.scanner_rule_id === 'label')) {
      expect(issue.review_only).toBe(true)
    }
  })

  it('plain .html is never demoted', async () => {
    const r = await scanBuffer(`<!doctype html><html lang="en"><head><title>t</title></head><body><main><button></button></main></body></html>`, 'index.html')
    const buttonName = axeIssues(r).find((i) => i.scanner_rule_id === 'button-name')
    expect(buttonName).toBeDefined()
    expect(buttonName?.review_only).toBeUndefined()
  })

  it('the flag never enters the fingerprint', async () => {
    const r = await scanBuffer(`export function T() { return (<div><Button><Icon /></Button></div>) }`, 'T.tsx')
    const issue = r.issues.find((i) => i.review_only)!
    expect(issue).toBeDefined()
    const { review_only: _flag, review_reason: _reason, fingerprint: fp, ...rest } = issue
    expect(fingerprint(rest)).toBe(fp)
  })
})

describe('JSX attribute names are translated before axe', () => {
  it('a label associated with htmlFor is seen as a label', async () => {
    const r = await scanBuffer(
      `export function Email() { return (<form><label htmlFor="email">Email</label><input id="email" type="email" /></form>) }`,
      'Email.tsx',
    )
    expect(axeIssues(r).filter((i) => i.scanner_rule_id === 'label')).toHaveLength(0)
  })
})

describe('terminal report', () => {
  it('lists review-only findings under "To review", outside the violation counts', async () => {
    const r = await scanBuffer(`export function Toolbar() { return (<div><Button><SunIcon /></Button></div>) }`, 'Toolbar.tsx')
    const lines: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { lines.push(a.join(' ')) })
    try {
      printResult(r, { color: false })
    } finally {
      spy.mockRestore()
    }
    const out = lines.join('\n')
    expect(out).toContain('0 WCAG violations')
    expect(out).toContain('To review')
    expect(out).toContain('button-name')
    expect(out).not.toContain('WCAG Violations')
  })
})
