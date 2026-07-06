import { describe, it, expect } from 'vitest'
import { extractHtml, neutralizeAttributeExpressions } from '../utils/html-extract.js'
import { scanBuffer } from '../scan.js'

describe('extractHtml — svelte', () => {
  it('strips script and style blocks, keeps template', () => {
    const svelteFile = `<script>
  let count = 0
</script>

<button on:click={() => count++}>
  Clicked {count} times
</button>

<style>
  button { color: red; }
</style>`

    const result = extractHtml(svelteFile, 'svelte')
    expect(result).not.toContain('<script')
    expect(result).not.toContain('let count')
    expect(result).not.toContain('<style')
    expect(result).not.toContain('color: red')
    expect(result).toContain('<button')
  })

  it('handles svelte file with no script or style', () => {
    const result = extractHtml('<div>Hello</div>', 'svelte')
    expect(result).toBe('<div>Hello</div>')
  })

  it('handles multiple script blocks', () => {
    const svelteFile = `<script context="module">
  export const prerender = true
</script>

<script>
  let name = 'world'
</script>

<h1>Hello {name}</h1>`

    const result = extractHtml(svelteFile, 'svelte')
    expect(result).not.toContain('<script')
    expect(result).toContain('<h1>Hello {name}</h1>')
  })
})

describe('extractHtml — astro', () => {
  it('strips frontmatter and returns template HTML', () => {
    const astroFile = `---
import Layout from '../layouts/Layout.astro'
const title = "Hello"
---
<Layout>
  <h1>{title}</h1>
  <img src="photo.jpg" />
</Layout>`

    const result = extractHtml(astroFile, 'astro')
    expect(result).not.toContain('---')
    expect(result).not.toContain('import Layout')
    expect(result).toContain('<Layout>')
    expect(result).toContain('<img src="photo.jpg" />')
  })

  it('handles astro file with no frontmatter', () => {
    const result = extractHtml('<div>Hello</div>', 'astro')
    expect(result).toBe('<div>Hello</div>')
  })

  it('handles empty frontmatter', () => {
    const astroFile = `---
---
<p>Content</p>`

    const result = extractHtml(astroFile, 'astro')
    expect(result).toBe('<p>Content</p>')
  })

  it('strips client script and scoped style blocks, keeps the markup', () => {
    const astroFile = `---
const title = "Hi"
---
<Layout>
  <h1>{title}</h1>
  <img src="photo.jpg" />
  <style>h1 { color: red; }</style>
  <script>console.log('hydrate')</script>
</Layout>`

    const result = extractHtml(astroFile, 'astro')
    expect(result).not.toContain('const title')   // frontmatter gone
    expect(result).not.toContain('<style')
    expect(result).not.toContain('color: red')
    expect(result).not.toContain('<script')
    expect(result).not.toContain('hydrate')
    expect(result).toContain('<h1>{title}</h1>')  // markup + expressions kept
    expect(result).toContain('<img src="photo.jpg" />')
  })
})

// ---------------------------------------------------------------------------
// Dynamic attribute-expression neutralization — before axe
// ---------------------------------------------------------------------------
describe('neutralizeAttributeExpressions', () => {
  it('strips dynamic attribute values (aria/class/href)', () => {
    const out = neutralizeAttributeExpressions(
      '<button aria-selected={i === 0} class={cls} type="button">Tab</button>'
    )
    expect(out).not.toContain('{')
    expect(out).not.toContain('aria-selected')
    expect(out).not.toContain('class')
    expect(out).toContain('type="button"') // static attrs untouched
    expect(out).toContain('>Tab</button>')
  })

  it('consumes a nested style={{ ... }} whole (no mangled leftover)', () => {
    const out = neutralizeAttributeExpressions('<div style={{ color: x }} id="a">hi</div>')
    expect(out).toBe('<div id="a">hi</div>')
  })

  it('strips href={url} so no mangled link attribute reaches the parser', () => {
    const out = neutralizeAttributeExpressions('<a href={url}>Home</a>')
    expect(out).toBe('<a>Home</a>')
  })

  it('does NOT touch text-node expressions', () => {
    // `<h1>{title}</h1>` and prose `cost = {price}` are content, not attributes.
    const out = neutralizeAttributeExpressions('<h1>{title}</h1><p>cost = {price}</p>')
    expect(out).toBe('<h1>{title}</h1><p>cost = {price}</p>')
  })

  it('keeps a genuinely static missing-alt image intact for axe', () => {
    const out = neutralizeAttributeExpressions('<img src="logo.png" class={c}>')
    expect(out).toBe('<img src="logo.png">')
  })

  it('keeps a placeholder for dynamic accessible-name attributes (no false "missing name")', () => {
    expect(neutralizeAttributeExpressions('<input aria-label={aria ?? label} class={c}>'))
      .toBe('<input aria-label="…">')
    expect(neutralizeAttributeExpressions('<img alt={getAlt()} src="x.png">'))
      .toBe('<img alt="…" src="x.png">')
  })

  it('converts a dynamic aria-labelledby into a placeholder aria-label (no dangling IDREF)', () => {
    expect(neutralizeAttributeExpressions('<button aria-labelledby={id}>X</button>'))
      .toBe('<button aria-label="…">X</button>')
  })

  it('strips non-name token attributes rather than placeholdering them', () => {
    // role="…" / aria-selected="…" would themselves be invalid values → must be stripped.
    expect(neutralizeAttributeExpressions('<div role={r} aria-selected={s}>x</div>'))
      .toBe('<div>x</div>')
  })

  it('applies through extractHtml for astro', () => {
    const astro = `---\nconst i = 0\n---\n<button class={\`t \${i}\`} aria-selected={i === 0}>X</button>`
    const out = extractHtml(astro, 'astro')
    expect(out).not.toContain('{')
    expect(out).toContain('>X</button>')
  })
})

// ---------------------------------------------------------------------------
// Integration: the artifacts must not survive into axe results
// ---------------------------------------------------------------------------
describe('axe sees no phantom violations from attribute expressions', () => {
  it('does not flag aria-valid-attr-value on aria-selected={i === 0}', async () => {
    const astro = `---\nconst i = 0\n---\n<main><h1>Tabs</h1><button type="button" role="tab" aria-selected={i === 0}>One</button></main>`
    const result = await scanBuffer(astro, 'Tabs.astro')

    const phantom = result.issues.filter(
      (i) => i.scanner === 'axe-core' && i.scanner_rule_id === 'aria-valid-attr-value'
    )
    expect(phantom).toHaveLength(0)
  })

  it('still catches a genuinely missing alt on the same surface', async () => {
    const astro = `---\nconst c = 'x'\n---\n<main><h1>Img</h1><img src="logo.png" class={c}></main>`
    const result = await scanBuffer(astro, 'Img.astro')

    // Cross-engine merge collapses the pair into one issue — axe's catch must still be
    // visible, either as the credited engine on the merged issue or as its own finding.
    const alt = result.issues.filter((i) => i.wcag_criteria.includes('1.1.1'))
    expect(alt).toHaveLength(1)
    expect(alt[0].scanners ?? [alt[0].scanner]).toContain('axe-core')
  })

  it('does NOT falsely flag a missing label on a dynamic aria-label (placeholder keeps it present)', async () => {
    const astro = `---\nconst aria = 'Email'\n---\n<main><h1>Form</h1><input type="text" name="email" aria-label={aria}></main>`
    const result = await scanBuffer(astro, 'Form.astro')

    const labelFp = result.issues.filter((i) => i.scanner === 'axe-core' && i.scanner_rule_id === 'label')
    expect(labelFp).toHaveLength(0)
  })
})
