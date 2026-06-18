import { describe, it, expect } from 'vitest'
import { AxeScanner } from '../scanners/axe-scanner.js'
import type { ScanContext, FileType } from '../types.js'

function contextWith(path: string, type: FileType, content: string): ScanContext {
  return {
    root_path: '/tmp/test',
    files: [{ path, absolute_path: `/tmp/test/${path}`, content, type }],
    options: { wcag_level: 'AA', include_patterns: [], exclude_patterns: [] },
  }
}

describe('AxeScanner — Astro / Svelte coverage', () => {
  it('scans .astro files (previously skipped by the engine) and flags missing alt', async () => {
    const astro = `---
const title = "Home"
---
<main>
  <h1>{title}</h1>
  <img src="photo.jpg">
</main>`

    const issues = await new AxeScanner().scan(contextWith('src/pages/index.astro', 'astro', astro))

    expect(issues.length).toBeGreaterThan(0)
    expect(issues.some((i) => i.wcag_criteria.includes('1.1.1'))).toBe(true)
    expect(issues.every((i) => i.file_path === 'src/pages/index.astro')).toBe(true)
  })

  it('does not choke on Astro component tags and stripped script/style', async () => {
    const astro = `---
import Layout from '../layouts/Layout.astro'
---
<Layout>
  <img src="logo.png">
  <style>h1 { color: red }</style>
  <script>console.log('hi')</script>
</Layout>`

    const issues = await new AxeScanner().scan(contextWith('src/pages/about.astro', 'astro', astro))
    expect(issues.some((i) => i.scanner_rule_id === 'image-alt')).toBe(true)
  })

  it('scans .svelte files (same engine gap as astro)', async () => {
    const svelte = `<script>
  let url = '/x'
</script>

<main>
  <img src="hero.png">
</main>

<style>main { padding: 1rem }</style>`

    const issues = await new AxeScanner().scan(contextWith('src/Hero.svelte', 'svelte', svelte))
    expect(issues.some((i) => i.wcag_criteria.includes('1.1.1'))).toBe(true)
  })
})
