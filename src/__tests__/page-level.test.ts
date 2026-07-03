import { describe, it, expect } from 'vitest'
import { runScan } from '../scan.js'
import { isDocumentUnit } from '../utils/html-extract.js'
import { PAGE_LEVEL_RULE_IDS, PAGE_LEVEL_REASON } from '../rules/page-level.js'
import { fingerprint } from '../utils/fingerprint.js'

// Page-level axe rules are reclassified out of violations on FRAGMENT scans
// (honest coverage), and stay fully active on DOCUMENT scans.

// A React component fragment: no landmarks, plus one element-level violation (img
// without alt) that must survive reclassification.
const TSX_FRAGMENT = `
export function Card() {
  return (
    <div>
      <h2>Latest post</h2>
      <img src="/cover.png" />
      <p>Content outside any landmark.</p>
    </div>
  )
}
`

// A complete HTML document with content outside landmarks and no skip link —
// page-level rules must still fire here.
const FULL_HTML_DOCUMENT = `<!DOCTYPE html>
<html lang="en">
<head><title>Home</title></head>
<body>
  <p>Content outside any landmark.</p>
</body>
</html>
`

const ASTRO_LAYOUT = `---
const { title } = Astro.props
---
<html lang="en">
  <head><title>{title}</title></head>
  <body>
    <p>Content outside any landmark.</p>
  </body>
</html>
`

const ASTRO_PAGE = `---
import Layout from '../layouts/Layout.astro'
---
<Layout title="Blog">
  <div>
    <p>Content outside any landmark.</p>
  </div>
</Layout>
`

describe('isDocumentUnit', () => {
  it('classifies a full .html page as document', () => {
    expect(isDocumentUnit(FULL_HTML_DOCUMENT, 'html')).toBe(true)
  })

  it('classifies a <body>-only .html page as document', () => {
    expect(isDocumentUnit('<body><p>hi</p></body>', 'html')).toBe(true)
  })

  it('classifies a doctype-only .html page as document', () => {
    expect(isDocumentUnit('<!DOCTYPE html>\n<p>hi</p>', 'html')).toBe(true)
  })

  it('classifies a partial .html include as fragment', () => {
    expect(isDocumentUnit('<div><p>partial</p></div>', 'html')).toBe(false)
  })

  it('classifies an Astro layout carrying <html> as document', () => {
    expect(isDocumentUnit(ASTRO_LAYOUT, 'astro')).toBe(true)
  })

  it('classifies an Astro page rendering into <Layout> as fragment', () => {
    expect(isDocumentUnit(ASTRO_PAGE, 'astro')).toBe(false)
  })

  it('does not match <html mentioned inside Astro frontmatter', () => {
    const astro = `---\nconst note = "<html> is the root element"\n---\n<div>hi</div>\n`
    expect(isDocumentUnit(astro, 'astro')).toBe(false)
  })

  it('classifies components as fragments (tsx/vue/svelte)', () => {
    expect(isDocumentUnit(TSX_FRAGMENT, 'tsx')).toBe(false)
    expect(isDocumentUnit('<template><div>hi</div></template>', 'vue')).toBe(false)
    expect(isDocumentUnit('<div>hi</div>', 'svelte')).toBe(false)
  })

  it('classifies a JSX file that returns a literal <html> as document', () => {
    const tsx = `export default function Doc() {\n  return (\n    <html lang="en"><body><main>hi</main></body></html>\n  )\n}\n`
    expect(isDocumentUnit(tsx, 'tsx')).toBe(true)
  })

  it('defaults to fragment when unsure', () => {
    expect(isDocumentUnit('', 'tsx')).toBe(false)
    expect(isDocumentUnit('plain text', 'other')).toBe(false)
  })
})

describe('page-level reclassification on fragments', () => {
  it('removes page-level rules from violations and names them in coverage', async () => {
    const result = await runScan({ files: [{ path: 'src/Card.tsx', content: TSX_FRAGMENT }] })

    // No page-level rule survives as an issue…
    const pageLevel = result.issues.filter((i) => PAGE_LEVEL_RULE_IDS.has(i.scanner_rule_id))
    expect(pageLevel).toHaveLength(0)

    // …while element-level findings are untouched.
    expect(result.issues.some((i) => i.scanner_rule_id === 'image-alt')).toBe(true)

    // The reclassified rules are named in the coverage surface, honestly.
    const reclassified = result.coverage?.reclassified ?? []
    const region = reclassified.find((r) => r.rule_id === 'region')
    expect(region).toBeDefined()
    expect(region!.count).toBeGreaterThan(0)
    expect(region!.files).toContain('src/Card.tsx')
    expect(region!.reason).toBe(PAGE_LEVEL_REASON)
    expect(region!.scanner).toBe('axe-core')
  })

  it('keeps page-level rules active on a full .html document', async () => {
    const result = await runScan({ files: [{ path: 'index.html', content: FULL_HTML_DOCUMENT }] })

    expect(result.issues.some((i) => i.scanner_rule_id === 'region')).toBe(true)
    expect(result.coverage?.reclassified).toEqual([])
  })

  it('keys per file in a mixed document + fragment scan', async () => {
    const result = await runScan({
      files: [
        { path: 'index.html', content: FULL_HTML_DOCUMENT },
        { path: 'src/Card.tsx', content: TSX_FRAGMENT },
      ],
    })

    const regionIssues = result.issues.filter((i) => i.scanner_rule_id === 'region')
    expect(regionIssues.length).toBeGreaterThan(0)
    expect(regionIssues.every((i) => i.file_path === 'index.html')).toBe(true)

    const region = result.coverage?.reclassified?.find((r) => r.rule_id === 'region')
    expect(region?.files).toEqual(['src/Card.tsx'])
  })

  it('keeps rules on an Astro layout, reclassifies on an Astro page', async () => {
    const result = await runScan({
      files: [
        { path: 'src/layouts/Layout.astro', content: ASTRO_LAYOUT },
        { path: 'src/pages/blog.astro', content: ASTRO_PAGE },
      ],
    })

    const regionIssues = result.issues.filter((i) => i.scanner_rule_id === 'region')
    expect(regionIssues.length).toBeGreaterThan(0)
    expect(regionIssues.every((i) => i.file_path === 'src/layouts/Layout.astro')).toBe(true)

    const region = result.coverage?.reclassified?.find((r) => r.rule_id === 'region')
    expect(region?.files).toEqual(['src/pages/blog.astro'])
  })

  it('reclassifies WCAG-mapped page-level rules (bypass 2.4.1) out of criteria_failed', async () => {
    const result = await runScan({ files: [{ path: 'src/Card.tsx', content: TSX_FRAGMENT }] })

    expect(result.issues.some((i) => i.scanner_rule_id === 'bypass')).toBe(false)
    expect(result.summary.criteria_failed).not.toContain('2.4.1')
  })

  it('keeps fingerprints of surviving issues byte-identical to the algorithm', async () => {
    const result = await runScan({ files: [{ path: 'src/Card.tsx', content: TSX_FRAGMENT }] })

    const imageAlt = result.issues.find((i) => i.scanner_rule_id === 'image-alt')
    expect(imageAlt).toBeDefined()
    expect(imageAlt!.fingerprint).toBe(fingerprint(imageAlt!))
  })

  it('does not count reclassified issues as ignored', async () => {
    const ignoredFragment = `// equall-ignore-file\n${TSX_FRAGMENT}`
    const result = await runScan({ files: [{ path: 'src/Card.tsx', content: ignoredFragment }] })

    // Reclassification happens before ignore handling: page-level issues never reach
    // the ignore path, so they cannot inflate ignored_count.
    const ignoredPageLevel = result.issues.filter(
      (i) => i.ignored && PAGE_LEVEL_RULE_IDS.has(i.scanner_rule_id)
    )
    expect(ignoredPageLevel).toHaveLength(0)
    expect(result.summary.ignored_count).toBe(
      result.issues.filter((i) => i.ignored).length
    )
  })

  it('strictly drops the issue count on a page-level-only fragment', async () => {
    // A clean fragment: no element-level violations, only page-level noise possible.
    const clean = `export function Box() {\n  return (\n    <div><p>hello</p></div>\n  )\n}\n`
    const result = await runScan({ files: [{ path: 'src/Box.tsx', content: clean }] })

    expect(result.issues.filter((i) => !i.ignored)).toHaveLength(0)
    const reclassified = result.coverage?.reclassified ?? []
    expect(reclassified.length).toBeGreaterThan(0)
  })

  it('always attaches coverage.reclassified (empty array when none)', async () => {
    const result = await runScan({ files: [{ path: 'index.html', content: FULL_HTML_DOCUMENT }] })
    expect(result.coverage?.reclassified).toEqual([])
  })
})
