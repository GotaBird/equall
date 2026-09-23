import { describe, it, expect, vi } from 'vitest'
import { scanBuffer } from '../scan.js'

// axe-core used to be shared with eslint-plugin-jsx-a11y (its autocomplete-valid rule drives
// axe internally). Loaded from source — as these tests are — the two scanners corrupted each
// other's state: axe skipped any JSX file containing autoComplete=, and jsx-a11y then read a
// torn-down window. The published bundle ships two copies, so the bug only showed in tests.
// Each document now gets its own injected axe; both scanners must work on such a file.

const SIGN_IN = `export function SignInForm() {
  return (
    <form>
      <label>
        Email
        <input type="email" name="email" autoComplete="email" />
      </label>
      <button type="submit">
        <svg width="16" height="16" viewBox="0 0 16 16"><path d="M2 8h12" /></svg>
      </button>
    </form>
  )
}`

describe('axe runs isolated from jsx-a11y', () => {
  it('both scanners analyse a JSX file with autoComplete, on every run', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      for (let run = 0; run < 3; run++) {
        const r = await scanBuffer(SIGN_IN, 'SignIn.tsx')
        // axe analysed the file: the icon-only submit button has no accessible name.
        expect(r.issues.some((i) => i.scanner === 'axe-core' && i.scanner_rule_id === 'button-name')).toBe(true)
      }
      // Neither scanner skipped or failed.
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('concurrent scans in one process do not interfere', async () => {
    const results = await Promise.all([1, 2, 3, 4].map(() => scanBuffer(SIGN_IN, 'SignIn.tsx')))
    for (const r of results) {
      expect(r.issues.some((i) => i.scanner === 'axe-core' && i.scanner_rule_id === 'button-name')).toBe(true)
    }
  })
})
