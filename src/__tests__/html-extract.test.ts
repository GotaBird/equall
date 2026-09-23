import { describe, it, expect } from 'vitest'
import {
  extractHtml,
  extractHtmlDetailed,
  extractReturnBlock,
  dropExtractionResidue,
  neutralizeAttributeExpressions,
} from '../utils/html-extract.js'
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

// ---------------------------------------------------------------------------
// JSX/TSX return-block extraction — balanced, not lazy
// ---------------------------------------------------------------------------

// shadcn/ui-style atoms: a multi-line `cn(…)` inside the tag is the shape that broke the
// lazy regex (it stopped at the `)` of `cn(`, leaving the tag open).
const SHADCN_INPUT = `import * as React from "react"
import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  if (!type) return null
  return (
    <input
      type={type}
      data-slot="input"
      aria-label="Search"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary h-9 w-full min-w-0 rounded-md border px-3 py-1",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }
`

const SHADCN_CHECKBOX = `"use client"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { CheckIcon } from "lucide-react"
import { cn } from "@/lib/utils"

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer border-input dark:bg-input/30 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        "size-4 shrink-0 rounded-[4px] border shadow-xs transition-shadow outline-none",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current transition-none"
      >
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
`

// Two-level braces defeat the one-level neutralizer, so the expression stays raw inside
// the tag → the residue net must sweep it.
const RESIDUE_FIELD = `export function Field({ invalid, dense }) {
  return (
    <main>
      <h1>Field</h1>
      <input type="text" aria-label="Name" className={cn({ "peer aria-invalid:border-destructive focus:ring": invalid, ...(dense ? { compact: true } : {}) })} required />
    </main>
  )
}
`

describe('extractReturnBlock — balanced scan', () => {
  it('closes the block at the real paren on a multi-line cn(…) className (shadcn Input)', () => {
    const { block, fallback } = extractReturnBlock(SHADCN_INPUT)
    expect(fallback).toBe(false)
    expect(block).not.toBeNull()
    expect(block!.startsWith('<input')).toBe(true)
    expect(block!.endsWith('/>')).toBe(true)            // ends at the element, not inside cn(
    expect(block).toContain('{...props}')
  })

  it('handles a nested Radix component tree with data-[state=checked] tokens (shadcn Checkbox)', () => {
    const { block, fallback } = extractReturnBlock(SHADCN_CHECKBOX)
    expect(fallback).toBe(false)
    expect(block!.startsWith('<CheckboxPrimitive.Root')).toBe(true)
    expect(block!.endsWith('</CheckboxPrimitive.Root>')).toBe(true)
    expect(block).toContain('<CheckIcon')
  })

  it('handles a template-literal className with ${…} and parens inside strings', () => {
    const src = 'const C = ({ on }) => {\n  return (\n    <div className={`card ${on ? \'card--on\' : \'card--off\'} p-(2)`}>\n      <span>x</span>\n    </div>\n  )\n}\n'
    const { block, fallback } = extractReturnBlock(src)
    expect(fallback).toBe(false)
    expect(block!.endsWith('</div>')).toBe(true)
  })

  it('handles a clsx({ … }) object form', () => {
    const src = `export function Row({ active }) {
  return (
    <li className={clsx({ 'row': true, 'row--active': active })}>
      <span>x</span>
    </li>
  )
}
`
    const { block, fallback } = extractReturnBlock(src)
    expect(fallback).toBe(false)
    expect(block!.endsWith('</li>')).toBe(true)
  })

  it('treats parens, quotes and apostrophes in JSX text as inert', () => {
    const src = `export function Note() {
  return (
    <p>Don't worry (yet), it's "fine"</p>
  )
}
`
    const { block, fallback } = extractReturnBlock(src)
    expect(fallback).toBe(false)
    expect(block).toBe(`<p>Don't worry (yet), it's "fine"</p>`)
  })

  it('skips an early `return null` and starts at `return (`', () => {
    const { block } = extractReturnBlock(SHADCN_INPUT)
    expect(block!.startsWith('<input')).toBe(true)
  })

  it('reads a TS generic call inside the block as a generic, not a tag (no fallback)', () => {
    const src = `export function List({ items, value }: Props) {
  return (
    <ul>
      {items.map<Item>((i) => <li key={i.id}>{i.name}</li>)}
      {format<string>(value)}
    </ul>
  )
}
`
    const { block, fallback } = extractReturnBlock(src)
    expect(fallback).toBe(false)
    expect(block!.endsWith('</ul>')).toBe(true)
    expect(block).toContain('<li key={i.id}>{i.name}</li>')  // nested JSX still reaches axe
  })

  it('reads a `<` comparison inside the block as an operator, not a tag (no fallback)', () => {
    const src = `export function Count({ count, a, b }: Props) {
  return (
    <div>
      {count < 10 && <span>few</span>}
      {a < b ? 'x' : 'y'}
    </div>
  )
}
`
    const { block, fallback } = extractReturnBlock(src)
    expect(fallback).toBe(false)
    expect(block!.endsWith('</div>')).toBe(true)
    expect(block).toContain('<span>few</span>')
  })

  it('skips JS comments between JSX attributes (an apostrophe in one is not a string)', () => {
    const src = `export function Filter({ options }) {
  return (
    <div>
      {options.map((o) => (
        <MenuItem
          key={o.value}
          // No \`size\` prop — MenuItem's default ('md') is what the rows render at
          title={o.label}
          icon={<span className="material-symbols-rounded" aria-hidden="true">filter_alt</span>}
        />
      ))}
    </div>
  )
}
`
    const { block, fallback } = extractReturnBlock(src)
    expect(fallback).toBe(false)
    expect(block!.endsWith('</div>')).toBe(true)
  })

  it('returns null block (no fallback) when there is no `return (`', () => {
    expect(extractReturnBlock('const x = 1')).toEqual({ block: null, fallback: false })
  })

  it('falls back to the lazy extraction on an unbalanced block and says so', () => {
    const src = `export function Broken() {
  return (
    <div className={cn(
      "a"
    )}
`
    const { block, fallback } = extractReturnBlock(src)
    expect(fallback).toBe(true)
    expect(block).toContain('<div')
  })
})

describe('extractHtml — jsx/tsx', () => {
  it('keeps the single-line `return <div>…</div>` path', () => {
    const out = extractHtml('function A() { return <div><img src="x.png"></div> }', 'jsx')
    expect(out).toBe('<div><img src="x.png"></div>')
  })

  it('never leaves a classname="{cn(" fragment after a multi-line className', () => {
    for (const src of [SHADCN_INPUT, SHADCN_CHECKBOX]) {
      const { html, report } = extractHtmlDetailed(src, 'tsx')
      expect(html).not.toContain('cn(')
      expect(html).not.toContain('aria-invalid:')
      expect(html).toContain('data-slot=')                 // the static attributes survive
      expect(report).toEqual({ fallback: false, dropped: 0 })
    }
  })

  it('sweeps residue from a two-level clsx/cn object and counts it', () => {
    const { html, report } = extractHtmlDetailed(RESIDUE_FIELD, 'tsx')
    expect(html).not.toContain('aria-invalid:')
    expect(html).toContain('<input type="text" aria-label="Name" required />')
    expect(report.fallback).toBe(false)
    expect(report.dropped).toBeGreaterThan(0)
  })
})

describe('dropExtractionResidue', () => {
  it('drops the contaminated span, keeps the real attributes on both sides', () => {
    const tag = '<input type="text" className={cn({ "peer aria-invalid:border-destructive focus:ring": invalid, ...(dense ? { compact: true } : {}) })} required />'
    const { html, dropped } = dropExtractionResidue(tag)
    expect(html).toBe('<input type="text" required />')
    // Every token between the first and the last marked one is gone, the middle one included.
    expect(html).not.toContain('aria-invalid:border-destructive')
    expect(dropped).toBeGreaterThan(1)
  })

  it('returns a clean tag byte-identical with dropped = 0', () => {
    const tag = '<button type="button" aria-label="Save, then close (now)" data-x="a > b">Go</button>'
    expect(dropExtractionResidue(tag)).toEqual({ html: tag, dropped: 0 })
  })

  it('leaves a spread `{...props}` alone (not residue)', () => {
    const tag = '<input type="text" {...props} />'
    expect(dropExtractionResidue(tag)).toEqual({ html: tag, dropped: 0 })
  })
})

describe('extractHtml — html pass-through', () => {
  it('returns a rendered document byte-for-byte, Tailwind class tokens included', () => {
    const dom = `<!DOCTYPE html>
<html lang="en"><head><title>T</title></head>
<body><input type="text" class="peer aria-invalid:border-destructive" aria-label="Name (required), yes"></body></html>`
    expect(extractHtml(dom, 'html')).toBe(dom)
    expect(extractHtmlDetailed(dom, 'html')).toEqual({ html: dom, report: { fallback: false, dropped: 0 } })
  })
})

// ---------------------------------------------------------------------------
// Integration: shadcn atoms produce no phantom 4.1.2, real findings survive
// ---------------------------------------------------------------------------
const PHANTOM_RULES = new Set(['aria-valid-attr', 'aria-allowed-attr', 'aria-prohibited-attr'])

describe('axe sees no phantom ARIA violations from a multi-line className', () => {
  it('reports no aria-* phantom and no 4.1.2 issue on shadcn Input / Checkbox', async () => {
    for (const [name, src] of [['input.tsx', SHADCN_INPUT], ['checkbox.tsx', SHADCN_CHECKBOX]]) {
      const result = await scanBuffer(src, `components/ui/${name}`)
      const phantom = result.issues.filter((i) => PHANTOM_RULES.has(i.scanner_rule_id))
      expect(phantom).toHaveLength(0)
      expect(result.issues.filter((i) => i.wcag_criteria.includes('4.1.2'))).toHaveLength(0)
      for (const i of result.issues) expect(i.html_snippet ?? '').not.toContain('classname="{cn(')
      expect(result.diagnostics?.filter((d) => d.startsWith('[extract]'))).toEqual([])
    }
  })

  it('still reports a missing alt next to a multi-line cn(…) className', async () => {
    const src = `import { cn } from "@/lib/utils"
export function Card({ className }) {
  return (
    <main>
      <h1>Card</h1>
      <div
        className={cn(
          "rounded-md border",
          "aria-invalid:border-destructive",
          className
        )}
      >
        <img src="photo.jpg" />
      </div>
    </main>
  )
}
`
    const result = await scanBuffer(src, 'Card.tsx')
    expect(result.issues.filter((i) => PHANTOM_RULES.has(i.scanner_rule_id))).toHaveLength(0)
    expect(result.issues.filter((i) => i.wcag_criteria.includes('1.1.1'))).toHaveLength(1)
  })

  it('states swept residue on diagnostics, per file, and never as an issue', async () => {
    const result = await scanBuffer(RESIDUE_FIELD, 'Field.tsx')
    expect(result.issues.filter((i) => PHANTOM_RULES.has(i.scanner_rule_id))).toHaveLength(0)
    const extract = result.diagnostics?.filter((d) => d.startsWith('[extract]')) ?? []
    expect(extract).toHaveLength(1)
    expect(extract[0]).toMatch(/^\[extract\] Field\.tsx: \d+ attribute tokens dropped as JSX extraction residue$/)
  })
})
