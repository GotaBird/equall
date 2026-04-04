import { describe, it, expect } from 'vitest'
import { ErrorIdentificationScanner } from '../scanners/error-identification-scanner.js'
import type { ScanContext } from '../types.js'

function makeContext(html: string): ScanContext {
  return {
    root_path: '/test',
    files: [{ path: 'test.html', absolute_path: '/test/test.html', type: 'html', content: html }],
    options: { wcag_level: 'AA', include_patterns: [], exclude_patterns: [] },
  }
}

describe('ErrorIdentificationScanner', () => {
  const scanner = new ErrorIdentificationScanner()

  it('flags aria-invalid="true" without error description', async () => {
    const ctx = makeContext('<input type="email" aria-invalid="true" />')
    const issues = await scanner.scan(ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0].scanner_rule_id).toBe('aria-invalid-no-message')
    expect(issues[0].wcag_criteria).toEqual(['3.3.1'])
    expect(issues[0].severity).toBe('moderate')
  })

  it('passes when aria-errormessage is present', async () => {
    const ctx = makeContext(`
      <input type="email" aria-invalid="true" aria-errormessage="err1" />
      <span id="err1">Invalid email</span>
    `)
    const issues = await scanner.scan(ctx)
    expect(issues).toHaveLength(0)
  })

  it('passes when aria-describedby is present', async () => {
    const ctx = makeContext(`
      <input type="email" aria-invalid="true" aria-describedby="desc1" />
      <span id="desc1">Please enter a valid email</span>
    `)
    const issues = await scanner.scan(ctx)
    expect(issues).toHaveLength(0)
  })

  it('ignores elements with aria-invalid="false"', async () => {
    const ctx = makeContext('<input type="text" aria-invalid="false" />')
    const issues = await scanner.scan(ctx)
    expect(issues).toHaveLength(0)
  })

  it('flags multiple invalid elements independently', async () => {
    const ctx = makeContext(`
      <input type="email" aria-invalid="true" />
      <select aria-invalid="true"></select>
    `)
    const issues = await scanner.scan(ctx)
    expect(issues).toHaveLength(2)
  })

  it('returns no issues on clean HTML', async () => {
    const ctx = makeContext('<form><input type="text" required /><button>Submit</button></form>')
    const issues = await scanner.scan(ctx)
    expect(issues).toHaveLength(0)
  })
})
