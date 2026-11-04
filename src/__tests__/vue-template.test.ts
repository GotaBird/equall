import { describe, it, expect } from 'vitest'
import { extractVueTemplate, vueTemplateParseFailed, clearVueTemplateCache } from '../utils/vue-template.js'
import { extractHtml } from '../utils/html-extract.js'
import { runScan } from '../scan.js'

// The first-template regex the parser replaces, kept here as the reference the extraction must
// match byte for byte on templates without the patterns it fixes.
const legacyExtract = (content: string) => content.match(/<template[^>]*>([\s\S]*?)<\/template>/)?.[1] ?? ''

const scanVue = (files: Record<string, string>) =>
  runScan({ path: '/virtual', files: Object.entries(files).map(([path, content]) => ({ path, content })) })

// --- Synthetic Vue corpus -------------------------------------------------------------------

const PLAIN = `<template>
  <main class="page">
    <h1>Settings</h1>
    <img src="banner.png">
    <label for="email">Email</label>
    <input id="email" type="email" :class="{ wide: true }">
    <input type="text" placeholder="Search">
    <p>{{ greeting }} — you have {{ count }} messages.</p>
  </main>
</template>

<script setup lang="ts">
const greeting: string = 'Hello'
const count: number = 3
</script>

<style scoped>
.page { padding: 1rem; }
</style>`

const NESTED = `<template>
  <section>
    <template v-if="ready">
      <p>Loaded</p>
    </template>
    <ul>
      <template v-for="item in items" :key="item.id">
        <li>{{ item.name }}</li>
      </template>
    </ul>
    <BaseCard>
      <template #footer="{ close }">
        <a href="/help">Help</a>
      </template>
    </BaseCard>
    <img src="after-nested.png">
    <button></button>
  </section>
</template>`

const SELF_CLOSING = `<template>
  <div>
    <button type="button"><component :is="icon" aria-hidden="true"/> Save changes</button>
    <button type="button"><IconClose aria-hidden="true" /> Close the dialog</button>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M0 0h24v24H0z"/></svg>
    <input type="checkbox" id="terms"/><label for="terms">I accept</label>
  </div>
</template>`

const KEY_WORDS = Array.from({ length: 40 }, (_, i) => `{{ $t('screen.section.entry_${i}') }} {{ __('labels.item_${i}') }}`).join(' ')
const I18N_ONLY = `<template>\n  <article><p>${KEY_WORDS}</p></article>\n</template>`

const INVALID_SCRIPT = `<template>
  <div><img src="x.png"></div>
</template>
<script>
const = ;
</script>`

// --- Extraction -----------------------------------------------------------------------------

describe('Vue template extraction (official parser)', () => {
  it('is byte-identical to the previous extraction on templates without nested templates or self-closing elements', () => {
    expect(extractVueTemplate(PLAIN)).toBe(legacyExtract(PLAIN))
    expect(extractVueTemplate(PLAIN, { prose: true })).not.toBe(legacyExtract(PLAIN)) // sanity: prose differs
  })

  it('reads past nested <template> wrappers instead of stopping at the first </template>', () => {
    const out = extractVueTemplate(NESTED)!
    expect(legacyExtract(NESTED)).not.toContain('after-nested.png')
    expect(out).toContain('<img src="after-nested.png">')
    expect(out).toContain('<a href="/help">Help</a>')
    expect(out).not.toMatch(/<template/)
  })

  it('closes a self-closing element that hides its subtree when content follows; leaves void and foreign (svg) elements alone', () => {
    const out = extractVueTemplate(SELF_CLOSING)!
    expect(out).toContain('<component :is="icon" aria-hidden="true"></component> Save changes')
    expect(out).toContain('<IconClose aria-hidden="true" ></IconClose> Close the dialog')
    expect(out).toContain('<path d="M0 0h24v24H0z"/>')
    expect(out).toContain('<input type="checkbox" id="terms"/>')
  })

  it('leaves other self-closing elements exactly as written (their surroundings keep their identity)', () => {
    const src = '<template>\n  <button><BaseIcon name="x"/> Save</button>\n  <button><span aria-hidden="true" class="i"/></button>\n</template>'
    expect(extractVueTemplate(src)).toBe(legacyExtract(src))
  })

  it('closes self-closing raw-text elements in prose mode only', () => {
    const src = '<template>\n  <label>Bio <textarea v-model="bio" /></label>\n  <p>Visible text</p>\n</template>'
    expect(extractVueTemplate(src)).toBe(legacyExtract(src))
    expect(extractVueTemplate(src, { prose: true })).toContain('<textarea v-model="bio" ></textarea>')
  })

  it('blanks interpolations in prose mode only', () => {
    expect(extractVueTemplate(I18N_ONLY)).toContain("$t('screen.section.entry_0')")
    expect(extractVueTemplate(I18N_ONLY, { prose: true })).not.toMatch(/\$t\(|__\(/)
    // Prose mode is a documented no-op outside Vue.
    const astro = '<p>{t("home.title")}</p>'
    expect(extractHtml(astro, 'astro', { prose: true })).toBe(extractHtml(astro, 'astro'))
  })

  it('handles <script lang="ts"> and reports an unreadable file as a parse failure', () => {
    expect(vueTemplateParseFailed(PLAIN)).toBe(false)
    expect(vueTemplateParseFailed(INVALID_SCRIPT)).toBe(true)
    expect(extractVueTemplate(INVALID_SCRIPT)).toBeNull()
    // Fallback: the regex extraction still feeds the scanners.
    expect(extractHtml(INVALID_SCRIPT, 'vue')).toContain('<img src="x.png">')
  })

  it('cache can be cleared', () => {
    extractVueTemplate(PLAIN)
    clearVueTemplateCache()
    expect(extractVueTemplate(PLAIN)).toBe(legacyExtract(PLAIN))
  })
})

// --- Through the full pipeline --------------------------------------------------------------

describe('Vue files through runScan', () => {
  it('a self-closing component inside a button does not hide the label text (no false button-name)', async () => {
    const result = await scanVue({ 'src/Toolbar.vue': SELF_CLOSING })
    expect(result.issues.filter((i) => i.scanner_rule_id === 'button-name')).toHaveLength(0)
  })

  it('finds defects after a nested <template>, each with its exact source line', async () => {
    const result = await scanVue({ 'src/Panel.vue': NESTED })
    const alt = result.issues.find((i) => i.scanner_rule_id === 'image-alt')
    const button = result.issues.find((i) => i.scanner_rule_id === 'button-name' && i.html_snippet === '<button></button>')
    expect(alt?.line).toBe(16)
    expect(button?.line).toBe(17)
  })

  it('folds identical tags into one finding, located at the first copy', async () => {
    const twins = '<template>\n  <div>\n    <img src="a.png">\n    <img src="a.png">\n  </div>\n</template>'
    const result = await scanVue({ 'src/Twins.vue': twins })
    const lines = result.issues.filter((i) => i.scanner_rule_id === 'image-alt').map((i) => i.line)
    expect(lines).toEqual([3])
  })

  it('does not grade the reading level of a template made of translation keys', async () => {
    const result = await scanVue({ 'src/Article.vue': I18N_ONLY })
    expect(result.issues.filter((i) => i.scanner === 'readability')).toHaveLength(0)
  })

  it('flags a self-closing raw-text element that hides the markup after it from axe', async () => {
    const src = '<template>\n  <div>\n    <textarea v-model="note" />\n    <img src="later.png">\n  </div>\n</template>'
    const result = await scanVue({ 'src/Note.vue': src })
    expect((result.diagnostics ?? []).some((d) => d.includes('src/Note.vue') && d.includes('textarea'))).toBe(true)
  })

  it('reports a Vue file the parser cannot read as not fully checked', async () => {
    const result = await scanVue({ 'src/Broken.vue': INVALID_SCRIPT })
    const entries = (result.unchecked ?? []).filter((u) => u.file_path === 'src/Broken.vue')
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.every((u) => u.reason === 'parse_error')).toBe(true)
    expect(entries.map((u) => u.scanner)).toContain('axe-core')
    expect((result.diagnostics ?? []).some((d) => d.includes('src/Broken.vue'))).toBe(true)
    // The fallback still checks what it can read.
    expect(result.issues.some((i) => i.scanner_rule_id === 'image-alt')).toBe(true)
  })

  it('keeps snippets as the source markup on a template without the fixed patterns (stable fingerprints)', async () => {
    const a = await scanVue({ 'src/Plain.vue': PLAIN })
    expect(a.issues.some((i) => i.scanner === 'axe-core')).toBe(true)
    for (const issue of a.issues.filter((i) => i.scanner === 'axe-core' && i.html_snippet)) {
      const openTag = issue.html_snippet!.split('>')[0]
      expect(legacyExtract(PLAIN).replace(/\s+/g, ' ')).toContain(openTag.replace(/\s+/g, ' '))
    }
  })
})
