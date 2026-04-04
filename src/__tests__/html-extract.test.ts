import { describe, it, expect } from 'vitest'
import { extractHtml } from '../utils/html-extract.js'

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
})
