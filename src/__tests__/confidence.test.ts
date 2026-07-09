import { describe, it, expect, vi } from 'vitest'
import { computeConfidenceFlags } from '../confidence/index.js'
import { runScan } from '../scan.js'
import { printResult } from '../output/terminal.js'
import type { FileEntry, FileType } from '../types.js'

// Build a synthetic FileEntry from raw content (extraction runs over content, not disk).
function file(content: string, type: FileType = 'html', path = 'page.html'): FileEntry {
  return { path, absolute_path: `/abs/${path}`, content, type }
}

// One <img> tag with a given alt (+ optional src), inline so line numbers are predictable.
function img(alt: string, src = '/x.png'): string {
  return `<img src="${src}" alt="${alt}">`
}

describe('computeConfidenceFlags — signal precision', () => {
  it('flags a filename-style alt (DSC / extension / IMG_n)', () => {
    for (const alt of ['DSC00423', 'hero.jpg', 'IMG_1024', 'screenshot-3', 'photo2']) {
      const flags = computeConfidenceFlags([file(img(alt))])
      expect(flags, alt).toHaveLength(1)
      expect(flags[0].signal, alt).toBe('filename_as_alt')
      expect(flags[0].criterion).toBe('1.1.1')
      expect(flags[0].confidence).toBe('low')
      expect(flags[0].value).toBe(alt)
    }
  })

  it('flags an alt that just repeats the src basename', () => {
    const flags = computeConfidenceFlags([file(img('hero', '/assets/img/hero.png'))])
    expect(flags).toHaveLength(1)
    expect(flags[0].signal).toBe('alt_equals_src')
  })

  it('flags generic placeholders (whole alt, ± trailing digits)', () => {
    for (const alt of ['untitled', 'image', 'spacer', 'placeholder', 'photo2', 'graphic']) {
      const flags = computeConfidenceFlags([file(img(alt))])
      expect(flags, alt).toHaveLength(1)
      // 'photo2'/'image' match the filename stem first; both are still exactly one flag.
      expect(['generic_placeholder', 'filename_as_alt'], alt).toContain(flags[0].signal)
    }
  })

  it('flags gibberish (no-vowel token / hex / uuid) but not short real words', () => {
    expect(computeConfidenceFlags([file(img('xkcdvbn'))])[0]?.signal).toBe('gibberish')
    expect(computeConfidenceFlags([file(img('550e8400-e29b-41d4-a716-446655440000'))])[0]?.signal).toBe('gibberish')
    expect(computeConfidenceFlags([file(img('a1b2c3d4e5'))])[0]?.signal).toBe('gibberish')
  })

  it('never flags good, short, or decorative alts (precision-first)', () => {
    for (const alt of ['Menu', 'Cart', 'Play', 'PDF', 'Acme logo', 'Kevin Delval on LinkedIn', 'Sales chart for Q3']) {
      expect(computeConfidenceFlags([file(img(alt))]), alt).toEqual([])
    }
    // Empty alt = intentional decorative image → silent.
    expect(computeConfidenceFlags([file('<img src="/spacer.gif" alt="">')])).toEqual([])
  })

  it('skips dynamic alts (JSX expression, Vue binding) — statically unknowable', () => {
    expect(computeConfidenceFlags([file('<img src={s} alt={x} />', 'jsx')])).toEqual([])
    expect(computeConfidenceFlags([file('<img :alt="dsc00423" />', 'vue')])).toEqual([])
    expect(computeConfidenceFlags([file('<img v-bind:alt="untitled" />', 'vue')])).toEqual([])
    // A data-alt must not be read as alt.
    expect(computeConfidenceFlags([file('<img src="/a.png" data-alt="untitled">')])).toEqual([])
  })

  it('matches the Next.js <Image> component, not just lowercase <img>', () => {
    // The dominant image element in React/Next.js codebases.
    const flags = computeConfidenceFlags([file('<Image src="/a.jpg" alt="DSC00423" width={9} height={9} />', 'tsx')])
    expect(flags).toHaveLength(1)
    expect(flags[0].signal).toBe('filename_as_alt')
    // …but not an arbitrary component whose name merely starts with "Image".
    expect(computeConfidenceFlags([file('<ImageGallery alt="DSC00423" />', 'tsx')])).toEqual([])
  })

  it('computes the line number and handles multiple imgs per file', () => {
    const content = `<div>\n  ${img('DSC00423')}\n  ${img('Menu')}\n  ${img('untitled')}\n</div>`
    const flags = computeConfidenceFlags([file(content)])
    expect(flags).toHaveLength(2) // DSC00423 + untitled; Menu is clean
    expect(flags[0]).toMatchObject({ value: 'DSC00423', line: 2 })
    expect(flags[1]).toMatchObject({ value: 'untitled', line: 4 })
  })

  it('skips non-markup files', () => {
    expect(computeConfidenceFlags([file(img('DSC00423'), 'other', 'notes.txt')])).toEqual([])
  })
})

describe('confidence flags are inert', () => {
  const page = (alt: string) =>
    `<!doctype html><html lang="en"><head><title>t</title></head><body><main><h1>Hi</h1><img src="/a.jpg" alt="${alt}"><p>Some body copy for the readability engine to chew on.</p></main></body></html>`

  it('attaches confidence_flags, keeps 1.1.1 pass_automated, never a fail', async () => {
    const result = await runScan({ files: [{ path: 'index.html', content: page('DSC00423') }] })
    expect(result.confidence_flags?.length).toBe(1)
    expect(result.confidence_flags?.[0].signal).toBe('filename_as_alt')
    const v111 = result.criterion_conformance?.find(c => c.criterion === '1.1.1')
    expect(v111?.verdict).toBe('pass_automated')
    // The advisory never becomes an issue.
    expect(result.issues.some(i => i.wcag_criteria.includes('1.1.1'))).toBe(false)
  })

  it('does not move the score — junk alt vs good alt score identically', async () => {
    const junk = await runScan({ files: [{ path: 'index.html', content: page('DSC00423') }] })
    const good = await runScan({ files: [{ path: 'index.html', content: page('A clear photo of the product') }] })
    expect(junk.score).toBe(good.score)
    expect(junk.confidence_flags?.length).toBe(1)
    expect(good.confidence_flags?.length).toBe(0)
  })
})

describe('terminal advisory surface', () => {
  it('prints a gray advisory, framed as not a violation, with no banned words', async () => {
    const result = await runScan({ files: [{ path: 'index.html', content: '<!doctype html><html lang="en"><head><title>t</title></head><body><main><h1>H</h1><img src="/a.jpg" alt="DSC00423"><p>Body.</p></main></body></html>' }] })
    const lines: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((...a) => { lines.push(a.join(' ')) })
    try {
      printResult(result)
    } finally {
      spy.mockRestore()
    }
    const out = lines.join('\n')
    expect(out).toContain('Low-confidence alt text')
    expect(out).toContain('not a WCAG violation')
    expect(out).toContain('DSC00423')
    // Advisory must never be styled as a failure (no red on the confidence rows).
    const RED = '\x1b[31m'
    const confLine = lines.find(l => l.includes('DSC00423') && l.includes('alt='))
    expect(confLine).toBeDefined()
    expect(confLine).not.toContain(RED)
    // Honesty doctrine — the banned conformance-claim words never appear.
    expect(out).not.toMatch(/\b(Meets|conformant|compliant|conformance)\b/i)
  })
})
