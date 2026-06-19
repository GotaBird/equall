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

// Neutralize dynamic attribute-value expressions before the markup reaches axe (BUR-120).
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
    // mangle the tag and produce phantom violations (BUR-120).
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

// Wrap fragment in a basic HTML document if needed for parsers
export function wrapFragment(html: string): string {
  if (html.includes('<html')) return html
  return `
    <!DOCTYPE html>
    <html lang="en">
      <head><title>Scan</title></head>
      <body>${html}</body>
    </html>
  `
}
