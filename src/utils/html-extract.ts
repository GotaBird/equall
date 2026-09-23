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

// ---------------------------------------------------------------------------
// JSX/TSX return-block extraction
// ---------------------------------------------------------------------------

// What the extraction could NOT do cleanly. An extraction artefact is not a finding: it
// never becomes an issue, a fingerprint or an ignore — the orchestrator states it on
// `ScanResult.diagnostics` (same spirit as `coverage.reclassified`).
export interface ExtractionReport {
  // The balanced scan of `return ( … )` hit EOF (unbalanced source or a JSX shape the
  // scanner does not understand) and the lazy regex was used instead.
  fallback: boolean
  // Attribute-position tokens dropped by `dropExtractionResidue` before the markup
  // reached the parser.
  dropped: number
}

const RETURN_PAREN = /return\s*\(/
// The historical lazy extraction. It stops at the first `)` followed by `;`, a newline or
// `}` — which is the closing paren of a multi-line `cn(` inside a tag, not the block's.
// Kept ONLY as the fallback when the balanced scan cannot close the block.
const LAZY_RETURN_BLOCK = /return\s*\(\s*([\s\S]*?)\s*\)\s*[;\n}]/
const SINGLE_LINE_RETURN = /return\s+(<[\s\S]*?>[\s\S]*?<\/[\s\S]*?>)/

// Balanced scan of a `return ( … )` block. Not a JSX parser: a small mode machine that only
// tracks what can hide a paren — JS strings, template literals (with `${…}` nesting),
// comments, JSX attribute values, and JSX text (where `(`, `)`, `"` and the apostrophe in
// `<p>Don't worry (yet)</p>` are all inert). Returns the index of the block's closing paren,
// or null when EOF is reached first (caller falls back and reports it).
type Frame =
  | { mode: 'expr'; paren: number; brace: number }
  | { mode: 'template' }
  | { mode: 'jsx'; depth: number; inTag: boolean; closing: boolean }

// Characters after which a `<` in expression position starts a JSX element. After an
// identifier, a number or `)` it is a comparison (`count < 10`) or a TS generic
// (`map<Item>(…)`), never a tag. `>` covers `=>`, `&` covers `&&`, `|` covers `||`.
const JSX_START_PRECEDERS = new Set(['(', ',', '>', '&', '|', '?', ':', '{', '[', '!', '='])

function looksLikeJsxStart(src: string, i: number): boolean {
  const next = src[i + 1]
  if (next === undefined || !/[A-Za-z_$>]/.test(next)) return false
  let j = i - 1
  while (j >= 0 && /\s/.test(src[j])) j--
  if (j < 0) return true
  const prev = src[j]
  if (JSX_START_PRECEDERS.has(prev)) return true
  if (/[\w$]/.test(prev)) {
    let k = j
    while (k >= 0 && /[\w$]/.test(src[k])) k--
    return src.slice(k + 1, j + 1) === 'return'
  }
  return false
}

function skipQuoted(src: string, i: number, quote: string, escapes: boolean): number | null {
  let j = i + 1
  while (j < src.length) {
    const ch = src[j]
    if (escapes && ch === '\\') { j += 2; continue }
    if (ch === quote) return j + 1
    if (ch === '\n' && escapes) return null // unterminated JS string → malformed
    j++
  }
  return null
}

function scanBalancedReturn(src: string, start: number): number | null {
  const frames: Frame[] = [{ mode: 'expr', paren: 1, brace: 0 }]
  const n = src.length
  let i = start
  while (i < n) {
    const f = frames[frames.length - 1]
    const ch = src[i]

    if (f.mode === 'expr') {
      if (ch === '/' && src[i + 1] === '/') {
        const nl = src.indexOf('\n', i)
        i = nl === -1 ? n : nl
        continue
      }
      if (ch === '/' && src[i + 1] === '*') {
        const end = src.indexOf('*/', i + 2)
        if (end === -1) return null
        i = end + 2
        continue
      }
      if (ch === '"' || ch === "'") {
        const end = skipQuoted(src, i, ch, true)
        if (end === null) return null
        i = end
        continue
      }
      if (ch === '`') { frames.push({ mode: 'template' }); i++; continue }
      if (ch === '(') { f.paren++; i++; continue }
      if (ch === ')') {
        f.paren--
        if (f.paren === 0 && frames.length === 1) return i
        if (f.paren < 0) return null
        i++
        continue
      }
      if (ch === '{') { f.brace++; i++; continue }
      if (ch === '}') {
        if (f.brace === 0) {
          if (frames.length === 1) return null
          frames.pop()
        } else {
          f.brace--
        }
        i++
        continue
      }
      if (ch === '<' && looksLikeJsxStart(src, i)) {
        frames.push({ mode: 'jsx', depth: 0, inTag: true, closing: src[i + 1] === '/' })
        i++
        continue
      }
      i++
      continue
    }

    if (f.mode === 'template') {
      if (ch === '\\') { i += 2; continue }
      if (ch === '`') { frames.pop(); i++; continue }
      if (ch === '$' && src[i + 1] === '{') {
        frames.push({ mode: 'expr', paren: 0, brace: 0 })
        i += 2
        continue
      }
      i++
      continue
    }

    // f.mode === 'jsx'
    if (f.inTag) {
      // JS comments are legal between JSX attributes; an apostrophe in one must not open
      // an attribute-value string.
      if (ch === '/' && src[i + 1] === '/') {
        const nl = src.indexOf('\n', i)
        i = nl === -1 ? n : nl
        continue
      }
      if (ch === '/' && src[i + 1] === '*') {
        const end = src.indexOf('*/', i + 2)
        if (end === -1) return null
        i = end + 2
        continue
      }
      if (ch === '"' || ch === "'") {
        const end = skipQuoted(src, i, ch, false)
        if (end === null) return null
        i = end
        continue
      }
      if (ch === '{') { frames.push({ mode: 'expr', paren: 0, brace: 0 }); i++; continue }
      if (ch === '>') {
        let k = i - 1
        while (k >= 0 && /\s/.test(src[k])) k--
        const selfClosing = src[k] === '/'
        if (f.closing) f.depth--
        else if (!selfClosing) f.depth++
        if (f.depth <= 0) frames.pop()
        else f.inTag = false
        i++
        continue
      }
      i++
      continue
    }
    // JSX text: everything is inert except a new tag or an embedded expression.
    if (ch === '<') {
      f.inTag = true
      f.closing = src[i + 1] === '/'
      i += f.closing ? 2 : 1
      continue
    }
    if (ch === '{') { frames.push({ mode: 'expr', paren: 0, brace: 0 }); i++; continue }
    i++
  }
  return null
}

// The JSX a component returns, as raw source. `block` is null when the file has no
// `return (` (the caller then tries the single-line `return <div>…</div>` shape).
export function extractReturnBlock(content: string): { block: string | null; fallback: boolean } {
  const m = RETURN_PAREN.exec(content)
  if (!m) return { block: null, fallback: false }
  const start = m.index + m[0].length
  const end = scanBalancedReturn(content, start)
  if (end !== null) return { block: content.slice(start, end).trim(), fallback: false }
  return { block: LAZY_RETURN_BLOCK.exec(content)?.[1] ?? null, fallback: true }
}

// ---------------------------------------------------------------------------
// Safety net: extraction residue must never reach the parser as attributes
// ---------------------------------------------------------------------------

// When `neutralizeAttributeExpressions` cannot consume an expression (braces nested more
// than one level, a fallback-truncated block), its raw source stays inside the tag and the
// HTML tokenizer turns every whitespace-separated word into an attribute — Tailwind tokens
// like `aria-invalid:border-destructive` then trigger phantom `aria-valid-attr` findings.
// A real attribute name never contains a quote, a comma or a paren, and after
// neutralization no legitimate `={` can remain: those are the residue markers.
// Contaminated-span rule: a real attribute can never sit between two fragments of one
// expression, so everything from the first marked token to the last is dropped.
const RESIDUE_MARK = /["'`,()]/
// One tag: a name, then an interior where quoted values are consumed whole (so a `>` in
// `aria-label="a > b"` does not end the tag). A tag truncated by the fallback extraction
// has no `>` at all — end of input closes it, so its residue is swept too.
const TAG_INTERIOR = /<([A-Za-z][^\s/>]*)((?:"[^"]*"|'[^']*'|[^>"'])*)(?:>|$)/g
// Attribute-position tokens: `name`, `name="…"`, `name='…'`, `name=bare`, a stray quoted
// run, or any other single character.
const ATTR_TOKEN = /[^\s"'=]+(?:=(?:"[^"]*"|'[^']*'|[^\s"']*))?|"[^"]*"|'[^']*'|\S/g

function isResidueToken(token: string): boolean {
  const name = token.slice(0, token.indexOf('=') === -1 ? token.length : token.indexOf('='))
  return RESIDUE_MARK.test(name) || token.includes('={')
}

export function dropExtractionResidue(html: string): { html: string; dropped: number } {
  let dropped = 0
  const out = html.replace(TAG_INTERIOR, (whole, name: string, interior: string) => {
    // Fast path: nothing that could be residue → byte-identical.
    if (!RESIDUE_MARK.test(interior) && !interior.includes('={')) return whole
    let body = interior
    let selfClose = ''
    const sc = /\s*\/\s*$/.exec(body)
    if (sc) { selfClose = ' /'; body = body.slice(0, sc.index) }
    const tokens = body.match(ATTR_TOKEN) ?? []
    const first = tokens.findIndex(isResidueToken)
    if (first === -1) return whole
    let last = tokens.length - 1
    while (last > first && !isResidueToken(tokens[last])) last--
    dropped += last - first + 1
    const survivors = [...tokens.slice(0, first), ...tokens.slice(last + 1)]
    return `<${name}${survivors.length ? ' ' + survivors.join(' ') : ''}${selfClose}>`
  })
  return { html: out, dropped }
}

// ---------------------------------------------------------------------------
// Extraction entry points
// ---------------------------------------------------------------------------

// Extract scannable HTML from various file types, with a report of what the extraction
// could not do cleanly. `extractHtml` below is the plain-string view most callers want.
export function extractHtmlDetailed(content: string, type: string): { html: string; report: ExtractionReport } {
  const report: ExtractionReport = { fallback: false, dropped: 0 }

  // A rendered DOM carries real attributes: a class value like
  // `aria-invalid:border-destructive` is legitimate there. Pass-through, byte-for-byte —
  // neither the neutralization nor the residue net may ever touch this branch.
  if (type === 'html') return { html: content, report }

  if (type === 'vue') {
    const templateMatch = content.match(/<template[^>]*>([\s\S]*?)<\/template>/)
    return { html: neutralizeAttributeExpressions(templateMatch?.[1] ?? ''), report }
  }

  // JSX/TSX: the component's return block, balanced-scanned (a multi-line `cn(…)` inside
  // a tag must not end the block), then neutralized, then swept for residue.
  if (type === 'jsx' || type === 'tsx') {
    const { block, fallback } = extractReturnBlock(content)
    report.fallback = fallback
    const source = block ?? SINGLE_LINE_RETURN.exec(content)?.[1] ?? ''
    const swept = dropExtractionResidue(neutralizeAttributeExpressions(source))
    report.dropped = swept.dropped
    return { html: swept.html, report }
  }

  if (type === 'svelte') {
    // Remove script and style blocks, keep the HTML template
    return {
      html: content
        .replace(/<script[\s\S]*?<\/script>/g, '')
        .replace(/<style[\s\S]*?<\/style>/g, '')
        .trim(),
      report,
    }
  }

  if (type === 'astro') {
    // Remove the component-script frontmatter (everything between the leading
    // --- delimiters), then drop client <script>/<style> blocks the same way we
    // do for svelte — they carry no a11y-relevant markup and only add noise.
    // Component tags (<Layout>) and text-node expressions ({title}) are left as-is: axe
    // treats unknown tags as inert custom elements and expressions as text. Dynamic
    // attribute values (class={x}, aria-selected={i === 0}) are neutralized so they don't
    // mangle the tag and produce phantom violations.
    return {
      html: neutralizeAttributeExpressions(
        content
          .replace(/^---[\s\S]*?---\n?/, '')
          .replace(/<script[\s\S]*?<\/script>/g, '')
          .replace(/<style[\s\S]*?<\/style>/g, '')
          .trim()
      ),
      report,
    }
  }

  return { html: content, report }
}

// Extract scannable HTML from various file types
export function extractHtml(content: string, type: string): string {
  return extractHtmlDetailed(content, type).html
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
