import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runScan, scanBuffer } from '../scan.js'

// A label with no associated control: jsx-a11y/label-has-associated-control catches it,
// axe-core does not (axe checks controls-have-labels, not labels-have-controls). The
// canonical "multi-engine beats axe-only" case on an .astro template.
const ASTRO_LABEL = `---
const title = "Contact"
---
<main>
  <h1>{title}</h1>
  <label>Email</label>
</main>
`

const LABEL_RULE = 'jsx-a11y/label-has-associated-control'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'equall-astro-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('eslint-jsx-a11y on .astro (T1.8)', () => {
  it('catches a jsx-a11y-only issue via scanBuffer (in-memory path)', async () => {
    const result = await scanBuffer(ASTRO_LABEL, 'Contact.astro')

    const label = result.issues.find((i) => i.scanner_rule_id === LABEL_RULE)
    expect(label).toBeDefined()
    expect(label?.scanner).toBe('eslint-jsx-a11y')
    // axe-core misses it — proving the multi-engine value, not just axe.
    expect(result.issues.some((i) => i.scanner === 'axe-core' && i.scanner_rule_id === LABEL_RULE)).toBe(false)
  })

  it('catches the same issue via a disk scan (lintFiles path)', async () => {
    await writeFile(join(dir, 'Contact.astro'), ASTRO_LABEL, 'utf-8')

    const result = await runScan({ path: dir })

    const label = result.issues.find((i) => i.scanner_rule_id === LABEL_RULE)
    expect(label).toBeDefined()
    expect(label?.scanner).toBe('eslint-jsx-a11y')
    expect(label?.file_path).toBe('Contact.astro')
  })

  it('exercises readability on astro prose', async () => {
    const prose = Array(6)
      .fill('The aforementioned administrative correspondence necessitates comprehensive elucidation of multifarious bureaucratic considerations notwithstanding inherent procedural complexity.')
      .join(' ')
    const astro = `---\nconst t = 1\n---\n<main><h1>Doc</h1><p>${prose}</p></main>\n`

    const result = await scanBuffer(astro, 'Doc.astro')

    const readability = result.issues.find((i) => i.scanner === 'readability')
    expect(readability).toBeDefined()
    expect(readability?.wcag_criteria).toContain('3.1.5')
  })
})

describe('honest coverage on .astro (T1.8)', () => {
  it('credits the full engine set on astro — no longer axe-only', async () => {
    const result = await scanBuffer(ASTRO_LABEL, 'Contact.astro')
    const cov = result.coverage
    expect(cov).toBeDefined()

    const engines = new Set(cov!.criteria.flatMap((c) => c.scanners))
    expect(engines.has('axe-core')).toBe(true)
    expect(engines.has('eslint-jsx-a11y')).toBe(true)
    expect(engines.has('readability')).toBe(true)

    // Contrast is still partial (axe disables it); nothing is manual on a fully-covered astro scan.
    expect(cov!.criteria.find((c) => c.criterion === '1.4.3')?.status).toBe('partial')
    expect(cov!.counts.manual).toBe(0)
  })
})
