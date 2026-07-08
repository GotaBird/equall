import { ONE_LEVEL_BRACE_EXPR } from './fingerprint.js'

// A dynamic attribute value in attribute position: `attrName={ …expr… }`. The `=` is glued
// to the attribute name (no surrounding space) so prose like `<p>cost = {price}</p>` is NOT
// matched — only real attributes are. The name is captured so name-bearing attributes get
// special handling. The value uses the one-level brace matcher so `style={{ … }}` is whole.
const DYNAMIC_ATTR = new RegExp(`\\s([a-zA-Z_:][\\w:.-]*)=\\s*${ONE_LEVEL_BRACE_EXPR}`, 'g')

// Attributes that PROVIDE a value-based accessible name. A dynamic value here is present
// but unreadable — stripping it would make axe falsely report a *missing* name (e.g. a
// `label` violation on `<input aria-label={x}>`). We keep them present with a neutral
// placeholder instead.
const NAME_BY_VALUE = new Set(['alt', 'aria-label', 'title'])
const NAME_PLACEHOLDER = '…' // "…" — non-empty so the accessible name reads as present

// Neutralize dynamic attribute-value expressions before the markup reaches axe.
// A value like `aria-selected={i === 0}`, `class={x}` or `href={url}` is statically
// unknowable: fed raw, the braces mangle the tag and axe emits phantom violations (e.g. a
// CRITICAL `aria-valid-attr-value` on `aria-selected={i` ). Classification-based, not a
// uniform strip — a uniform strip turns a dynamic name into a *missing* name (false
// `label`/`image-alt`), and a uniform placeholder makes invalid token values (false
// `role="…"`). Text-node expressions (`<h1>{title}</h1>`) are left untouched — inert text.
export function neutralizeAttributeExpressions(html: string): string {
  return html.replace(DYNAMIC_ATTR, (_match, name: string) => {
    const lower = name.toLowerCase()
    // Value-based accessible name → keep present with a placeholder.
    if (NAME_BY_VALUE.has(lower)) return ` ${name}="${NAME_PLACEHOLDER}"`
    // aria-labelledby points to an element by id; a placeholder id would dangle and FP as
    // "referenced id missing". Confer the name directly as a placeholder aria-label instead.
    if (lower === 'aria-labelledby') return ` aria-label="${NAME_PLACEHOLDER}"`
    // Everything else (class, style, href, src, data-*, aria-selected, role, …) → strip;
    // a placeholder on a token/URI-validated attribute would itself false-flag.
    return ''
  })
}

// Extract scannable HTML from various file types
export function extractHtml(content: string, type: string): string {
  if (type === 'html') return content

  if (type === 'vue') {
    const templateMatch = content.match(/<template[^>]*>([\s\S]*?)<\/template>/)
    return neutralizeAttributeExpressions(templateMatch?.[1] ?? '')
  }

  // For JSX/TSX: extract return statement content (simplified)
  // This is a best-effort extraction — complex JSX may not parse perfectly
  if (type === 'jsx' || type === 'tsx') {
    const returnMatch = content.match(/return\s*\(\s*([\s\S]*?)\s*\)\s*[;\n}]/)
    if (returnMatch) return neutralizeAttributeExpressions(returnMatch[1])
    // Try single-line return
    const singleReturn = content.match(/return\s+(<[\s\S]*?>[\s\S]*?<\/[\s\S]*?>)/)
    return neutralizeAttributeExpressions(singleReturn?.[1] ?? '')
  }

  if (type === 'svelte') {
    // Remove script and style blocks, keep the HTML template
    return content
      .replace(/<script[\s\S]*?<\/script>/g, '')
      .replace(/<style[\s\S]*?<\/style>/g, '')
      .trim()
  }

  if (type === 'astro') {
    // Remove the component-script frontmatter (everything between the leading
    // --- delimiters), then drop client <script>/<style> blocks the same way we
    // do for svelte — they carry no a11y-relevant markup and only add noise.
    // Component tags (<Layout>) and text-node expressions ({title}) are left as-is: axe
    // treats unknown tags as inert custom elements and expressions as text. Dynamic
    // attribute values (class={x}, aria-selected={i === 0}) are neutralized so they don't
    // mangle the tag and produce phantom violations.
    return neutralizeAttributeExpressions(
      content
        .replace(/^---[\s\S]*?---\n?/, '')
        .replace(/<script[\s\S]*?<\/script>/g, '')
        .replace(/<style[\s\S]*?<\/style>/g, '')
        .trim()
    )
  }

  return content
}

// Is this source unit a full DOCUMENT (carries document-level structure itself) or a
// FRAGMENT (a component/partial whose page structure comes from cross-file composition
// at render time)? Drives the page-level rule reclassification: page-level
// axe rules stay active on documents, get reclassified to honest coverage on fragments.
// Checked on the EXTRACTED content so the predicate stays coherent with wrapFragment
// below — if wrapFragment would not wrap, axe saw real document structure — and so an
// `<html` inside Astro frontmatter strings (already stripped) cannot match.
// Conservative default: when unsure → fragment.
export function isDocumentUnit(content: string, type: string): boolean {
  const extracted = extractHtml(content, type)
  // Same predicate wrapFragment uses: such content is scanned unwrapped, as a document.
  if (extracted.includes('<html')) return true
  // A complete .html page may omit <html> but still declare document-ness.
  if (type === 'html') return /<body[\s>]|<!doctype\s+html/i.test(extracted)
  // jsx/tsx/vue/svelte components (and Astro pages rendering into a <Layout>) → fragment.
  // Next.js _document.tsx uses <Html> (capital — no match): stays fragment, correct,
  // since a component-based document shell is not statically evaluable anyway.
  return false
}

// Wrap a fragment in a minimal HTML document so parsers have a valid tree. Deliberately NO
// `lang` and NO `<title>`: a fragment (a component/partial) cannot know the page's title or
// language — those live in the layout. A synthetic lang/title would make `html-has-lang` (3.1.1)
// and `document-title` (2.4.2) falsely pass; leaving them out lets those page-level rules fire so
// they are reclassified as "not verifiable on this scan" (honest) rather than a masked pass.
export function wrapFragment(html: string): string {
  if (html.includes('<html')) return html
  return `
    <!DOCTYPE html>
    <html>
      <head></head>
      <body>${html}</body>
    </html>
  `
}
