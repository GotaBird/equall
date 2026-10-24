import { describe, it, expect } from 'vitest'
import { AxeScanner } from '../scanners/axe-scanner.js'
import { deduplicateIssues, applyIgnoreComments, scanBuffer } from '../scan.js'
import { mergeCrossEngineDuplicates } from '../rules/equivalence.js'
import { fingerprint } from '../utils/fingerprint.js'
import { wrapFragment, FRAGMENT_PREFIX } from '../utils/html-extract.js'
import {
  offsetToLocation,
  locateHtmlElement,
  locateInComponentSource,
  markupRegion,
} from '../utils/source-location.js'
import type { ScanContext, FileType, EquallIssue, FileEntry } from '../types.js'

function contextWith(path: string, type: FileType, content: string): ScanContext {
  return {
    root_path: '/tmp/test',
    files: [{ path, absolute_path: `/tmp/test/${path}`, content, type }],
    options: { wcag_level: 'AA', include_patterns: [], exclude_patterns: [] },
  }
}

const scan = (path: string, type: FileType, content: string) => new AxeScanner().scan(contextWith(path, type, content))
const byRule = (issues: EquallIssue[], rule: string) => issues.filter((i) => i.scanner_rule_id === rule)

describe('axe-core source lines — plain .html', () => {
  it('reports the line and column of the element in a full document', async () => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head><title>T</title></head>
<body>
  <main>
    <p>Intro</p>
    <img src="a.png">
  </main>
</body>
</html>`
    const [img] = byRule(await scan('index.html', 'html', html), 'image-alt')
    expect(img.line).toBe(7)
    expect(img.column).toBe(5)
  })

  it('subtracts the wrapper added around a fragment', async () => {
    const html = `<div>
  <p>One</p>
</div>
<section>
    <img src="frag.png">
</section>`
    const [img] = byRule(await scan('partial.html', 'html', html), 'image-alt')
    expect(img.line).toBe(5)
    expect(img.column).toBe(5)
  })

  it('points each of two identical elements at its own line (the parser location is exact)', async () => {
    const html = `<main>\n<img src="x.png">\n<p>gap</p>\n<img src="x.png">\n</main>`
    const lines = byRule(await scan('dup.html', 'html', html), 'image-alt').map((i) => i.line).sort()
    expect(lines).toEqual([2, 4])
  })

  it('leaves the line null for an element the parser inserted (the wrapper <html>)', async () => {
    const issues = await scan('frag.html', 'html', '<p>no lang here</p>')
    const lang = byRule(issues, 'html-has-lang')
    expect(lang.length).toBe(1)
    expect(lang[0].line).toBeNull()
    expect(lang[0].column).toBeNull()
  })

  it('wrapFragment output is unchanged by the exported prefix', () => {
    expect(wrapFragment('<p>x</p>').startsWith(FRAGMENT_PREFIX + '<p>x</p></body>')).toBe(true)
    expect(wrapFragment('<html><body></body></html>')).toBe('<html><body></body></html>')
  })
})

describe('axe-core source lines — component sources', () => {
  it('maps an Astro element past the frontmatter, ignoring a look-alike tag inside it', async () => {
    const astro = `---
const snippet = '<img src="card.png">'
---
<section>
  <h2>Card</h2>
  <img src="card.png">
</section>`
    const [img] = byRule(await scan('src/Card.astro', 'astro', astro), 'image-alt')
    expect(img.line).toBe(6)
    expect(img.column).toBe(3)
  })

  it('ignores dynamic attributes on both sides (neutralized in the DOM, braces in the source)', async () => {
    const jsx = `export function Hero({ cls }) {
  return (
    <div className={cls}>
      <button type="button" className={cls} onClick={handle} aria-pressed={on}></button>
    </div>
  )
}`
    const [btn] = byRule(await scan('src/Hero.jsx', 'jsx', jsx), 'button-name')
    expect(btn.line).toBe(4)
    expect(btn.column).toBe(7)
  })

  it('maps Vue and Svelte templates', async () => {
    const vue = `<template>\n  <div>\n    <img src="v.png">\n  </div>\n</template>\n<script>\nexport default {}\n</script>`
    const svelte = `<script>\n  let x = '<img src="s.png">'\n</script>\n<div>\n  <img src="s.png">\n</div>`
    expect(byRule(await scan('src/W.vue', 'vue', vue), 'image-alt')[0].line).toBe(3)
    expect(byRule(await scan('src/T.svelte', 'svelte', svelte), 'image-alt')[0].line).toBe(5)
  })

  it('leaves the line null when two source tags match (ambiguous)', async () => {
    const astro = `---\n---\n<div>\n  <img src="same.png">\n  <img src="same.png">\n</div>`
    const imgs = byRule(await scan('src/Dup.astro', 'astro', astro), 'image-alt')
    expect(imgs.length).toBe(2)
    expect(imgs.every((i) => i.line === null && i.column === null)).toBe(true)
  })

  it('never changes the snippet: an issue with and without a line has the same fingerprint', async () => {
    const [img] = byRule(await scan('src/Card.astro', 'astro', `<div>\n  <img src="c.png">\n</div>`), 'image-alt')
    expect(img.line).toBe(2)
    expect(fingerprint(img)).toBe(fingerprint({ ...img, line: null, column: null }))
  })
})

describe('source-location helpers', () => {
  it('offsetToLocation is 1-based', () => {
    expect(offsetToLocation('ab\ncd', 0)).toEqual({ line: 1, column: 1 })
    expect(offsetToLocation('ab\ncd', 4)).toEqual({ line: 2, column: 2 })
  })

  it('locateHtmlElement rejects offsets in the wrapper or not on the tag', () => {
    expect(locateHtmlElement(null, 'img', '<img>', 0)).toBeNull()
    expect(locateHtmlElement(3, 'img', '<img>', 10)).toBeNull()
    expect(locateHtmlElement(0, 'p', '<img>', 0)).toBeNull()
    expect(locateHtmlElement(11, 'img', '<p></p>\n   <img>', 0)).toEqual({ line: 2, column: 4 })
  })

  it('markupRegion blanks what the extraction drops, keeping offsets', () => {
    const src = `---\nconst a = '<img>'\n---\n<!-- <img> -->\n<img>\n<script>'<img>'</script>`
    const region = markupRegion(src, 'astro')
    expect(region.length).toBe(src.length)
    expect(region.match(/<img/g)?.length).toBe(1)
  })

  it('locateInComponentSource needs a unique DOM element and a unique source tag', () => {
    const src = `<div>\n  <a href="/a"></a>\n  <a href="/b"></a>\n</div>`
    expect(locateInComponentSource(src, 'astro', 'a', 'href="/b"', 1)).toEqual({ line: 3, column: 3 })
    expect(locateInComponentSource(src, 'astro', 'a', 'href="/b"', 2)).toBeNull()
    expect(locateInComponentSource(src, 'astro', 'a', '', 1)).toBeNull()
  })
})

describe('dedup, merge and ignores are unchanged for axe-core findings with a line', () => {
  const axe = (overrides: Partial<EquallIssue>): EquallIssue => ({
    scanner: 'axe-core',
    scanner_rule_id: 'image-alt',
    wcag_criteria: ['1.1.1'],
    wcag_level: 'A',
    pour: 'perceivable',
    file_path: 'index.html',
    line: null,
    column: null,
    html_snippet: '<img src="x.png">',
    severity: 'critical',
    message: 'Images must have alternative text',
    help_url: null,
    suggestion: null,
    ...overrides,
  })

  it('still folds axe findings on the same snippet, whatever their lines', () => {
    const withLines = deduplicateIssues([axe({ line: 2, column: 1 }), axe({ line: 4, column: 1 })])
    const without = deduplicateIssues([axe({}), axe({})])
    expect(withLines.length).toBe(without.length)
    expect(withLines.length).toBe(1)
  })

  it('still keeps line-keyed eslint findings apart', () => {
    const eslint = (line: number) => axe({ scanner: 'eslint-jsx-a11y', scanner_rule_id: 'jsx-a11y/alt-text', line, column: 1 })
    expect(deduplicateIssues([eslint(2), eslint(4)]).length).toBe(2)
  })

  it('keeps the eslint side as the merge survivor when both sides carry a line', () => {
    const eslint = axe({ scanner: 'eslint-jsx-a11y', scanner_rule_id: 'jsx-a11y/alt-text', file_path: 'src/A.tsx', line: 12, column: 5, html_snippet: '<img src={x} />' })
    const twin = axe({ file_path: 'src/A.tsx', line: 3, column: 2 })
    for (const order of [[eslint, twin], [twin, eslint]]) {
      const merged = mergeCrossEngineDuplicates(order)
      expect(merged.length).toBe(1)
      const { scanners, merged_fingerprints, ...rest } = merged[0]
      expect(rest).toEqual(eslint)
      expect(scanners).toEqual(['eslint-jsx-a11y', 'axe-core'])
      expect(merged_fingerprints).toEqual([fingerprint(twin)])
      expect(fingerprint(merged[0])).toBe(fingerprint(eslint))
    }
  })

  it('does not apply a next-line ignore comment to an axe finding (handling unchanged)', () => {
    const file: FileEntry = { path: 'index.html', absolute_path: '/tmp/index.html', type: 'html', content: '<main>\n<!-- equall-ignore-next-line -->\n<img src="x.png">\n</main>' }
    const { active, ignored } = applyIgnoreComments([axe({ line: 3, column: 1 })], [file])
    expect(active.length).toBe(1)
    expect(ignored.length).toBe(0)
  })

  it('end to end: same counts and fingerprints, now with a line', async () => {
    const result = await scanBuffer('<main>\n  <img src="x.png">\n</main>', 'index.html')
    const img = result.issues.find((i) => i.scanner_rule_id === 'image-alt')!
    expect(img.line).toBe(2)
    expect(img.fingerprint).toBe(fingerprint({ ...img, line: null, column: null }))
  })
})
