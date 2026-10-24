// Source location of an axe-core finding: the line (and column) of the offending element's
// opening tag in the ORIGINAL file, so a report, a PR annotation or an "open the file" link
// can point at it. axe only sees a DOM, so the location is derived here, and only when it is
// certain. A wrong line is worse than no line: every path below returns null when in doubt.
//
// Location is display metadata only. It never feeds the fingerprint, the dedup key of an
// axe-core finding, or the score.
//
// Two strategies:
// - Plain .html is parsed as-is (optionally wrapped in a minimal document), so the parser's
//   own node location is exact once the wrapper prefix is subtracted.
// - Component sources (astro/svelte/vue/jsx/tsx) reach axe through a regex extraction that
//   drops and rewrites text, so DOM offsets cannot be mapped back. Instead the element's
//   opening tag is searched in the original source by tag name and static attributes, and the
//   line is kept only when exactly one tag matches.

export interface SourceLocation {
  line: number   // 1-based
  column: number // 1-based
}

// 1-based line and column of a character offset.
export function offsetToLocation(content: string, offset: number): SourceLocation {
  let line = 1
  let lineStart = 0
  for (let i = 0; i < offset; i++) {
    if (content.charCodeAt(i) === 10) {
      line++
      lineStart = i + 1
    }
  }
  return { line, column: offset - lineStart + 1 }
}

// Does `content` carry the opening tag of `tagName` at `offset`?
function opensTagAt(content: string, offset: number, tagName: string): boolean {
  const head = content.slice(offset, offset + tagName.length + 2)
  return new RegExp(`^<${escapeRegExp(tagName)}(?=[\\s/>]|$)`, 'i').test(head)
}

// Plain .html: map the parser's start offset (in the parsed document) back to the file.
// `prefixLength` is the length of the wrapper text placed before the file content (0 when
// the file was parsed unwrapped). Elements the parser inserted itself (an implied <tbody>,
// the wrapper's <html>/<body>) have no location in the file and yield null.
export function locateHtmlElement(
  startOffset: number | null | undefined,
  tagName: string,
  content: string,
  prefixLength: number,
): SourceLocation | null {
  if (startOffset == null) return null
  const offset = startOffset - prefixLength
  if (offset < 0 || offset >= content.length) return null
  // Sanity check: the file must open this very tag at that offset (guards against any
  // offset drift, e.g. a byte-order mark or line-ending normalization by the parser).
  if (!opensTagAt(content, offset, tagName)) return null
  return offsetToLocation(content, offset)
}

// --- Component sources -------------------------------------------------------------------

// Replace a range with spaces, keeping newlines, so offsets and lines are unchanged.
function blank(text: string, start: number, end: number): string {
  return text.slice(0, start) + text.slice(start, end).replace(/[^\n]/g, ' ') + text.slice(end)
}

function blankAll(text: string, pattern: RegExp): string {
  let out = text
  for (const m of text.matchAll(pattern)) out = blank(out, m.index!, m.index! + m[0].length)
  return out
}

// Keep only [start, end) of the text (everything else blanked).
function keepOnly(text: string, start: number, end: number): string {
  return blank(blank(text, end, text.length), 0, start)
}

// The source with every region the extraction does not hand to axe blanked out (offsets
// preserved), mirroring extractHtml: a tag in the frontmatter, a <script>, a comment or a
// second JSX return cannot be the element axe reported on, so it must not count as a match.
export function markupRegion(content: string, type: string): string {
  let text = content
  if (type === 'vue') {
    const m = /<template[^>]*>([\s\S]*?)<\/template>/d.exec(text)
    if (!m?.indices?.[1]) return ''
    text = keepOnly(text, m.indices[1][0], m.indices[1][1])
  } else if (type === 'jsx' || type === 'tsx') {
    const m = /return\s*\(\s*([\s\S]*?)\s*\)\s*[;\n}]/d.exec(text)
      ?? /return\s+(<[\s\S]*?>[\s\S]*?<\/[\s\S]*?>)/d.exec(text)
    if (!m?.indices?.[1]) return ''
    text = keepOnly(text, m.indices[1][0], m.indices[1][1])
    text = blankAll(text, /\{\/\*[\s\S]*?\*\/\}/g)
  } else if (type === 'astro' || type === 'svelte') {
    if (type === 'astro') {
      const fm = /^---[\s\S]*?---\n?/.exec(text)
      if (fm) text = blank(text, 0, fm[0].length)
    }
    text = blankAll(text, /<script[\s\S]*?<\/script>/g)
    text = blankAll(text, /<style[\s\S]*?<\/style>/g)
  }
  return blankAll(text, /<!--[\s\S]*?-->/g)
}

// JSX attribute names the extraction translates to their HTML spelling.
const JSX_ATTR_ALIASES: Record<string, string> = {
  htmlfor: 'for',
  httpequiv: 'http-equiv',
  acceptcharset: 'accept-charset',
  xlinkhref: 'xlink:href',
}

// Placeholder the extraction puts in place of a dynamic accessible name (alt={x} → alt="…").
const NAME_PLACEHOLDER = '…'

// An attribute whose value is decided at runtime, or a placeholder for one, carries no
// static identity: it is left out of the comparison on both sides.
function isComparable(name: string, value: string): boolean {
  return !/[{}]/.test(name) && !value.includes('{') && value !== NAME_PLACEHOLDER
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

// Static attributes of the DOM element, as a canonical signature.
export function elementSignature(el: Element): string {
  const attrs: string[] = []
  for (const a of Array.from(el.attributes)) {
    if (isComparable(a.name, a.value)) attrs.push(`${a.name.toLowerCase()}=${JSON.stringify(a.value)}`)
  }
  return attrs.sort().join(' ')
}

// Parse the opening tag starting at `start` (on the `<`). Returns its static attribute
// signature, or null when the tag cannot be read (unterminated quote or brace).
function sourceTagSignature(text: string, start: number, nameLength: number, jsx: boolean): string | null {
  let i = start + 1 + nameLength
  const attrs: string[] = []
  const n = text.length
  while (i < n) {
    const c = text[i]
    if (/\s/.test(c) || c === '/') { i++; continue }
    if (c === '>') return attrs.sort().join(' ')
    if (c === '{') { // spread or bare expression: dynamic, skipped
      const end = skipBraces(text, i)
      if (end < 0) return null
      i = end
      continue
    }
    const nameMatch = /^[^\s=/>{}"']+/.exec(text.slice(i, i + 256))
    if (!nameMatch) return null
    let name = nameMatch[0].toLowerCase()
    if (jsx) name = JSX_ATTR_ALIASES[name] ?? name
    i += nameMatch[0].length
    while (i < n && /\s/.test(text[i])) i++
    let value = ''
    let dynamic = false
    if (text[i] === '=') {
      i++
      while (i < n && /\s/.test(text[i])) i++
      const q = text[i]
      if (q === '"' || q === "'") {
        const end = text.indexOf(q, i + 1)
        if (end < 0) return null
        value = decodeEntities(text.slice(i + 1, end))
        i = end + 1
      } else if (q === '{') {
        const end = skipBraces(text, i)
        if (end < 0) return null
        dynamic = true
        i = end
      } else {
        const m = /^[^\s>]+/.exec(text.slice(i, i + 1024))
        if (!m) return null
        value = decodeEntities(m[0])
        i += m[0].length
      }
    }
    if (!dynamic && isComparable(name, value)) attrs.push(`${name}=${JSON.stringify(value)}`)
  }
  return null
}

// Index just past the brace expression opening at `start`, or -1 when unbalanced.
// Quoted strings and template literals inside the expression are skipped whole.
function skipBraces(text: string, start: number): number {
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (c === '"' || c === "'" || c === '`') {
      const end = text.indexOf(c, i + 1)
      if (end < 0) return -1
      i = end
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return -1
}

// Component source: find the element's opening tag in the original file. `domMatches` is
// the number of elements in the scanned DOM with the same tag and signature; the location is
// kept only when that element is unique in the DOM AND exactly one tag in the source matches.
export function locateInComponentSource(
  content: string,
  type: string,
  tagName: string,
  signature: string,
  domMatches: number,
): SourceLocation | null {
  if (domMatches !== 1) return null
  const region = markupRegion(content, type)
  if (!region) return null
  const jsx = type === 'jsx' || type === 'tsx'
  const opening = new RegExp(`<${escapeRegExp(tagName)}(?=[\\s/>])`, 'gi')
  let found: number | null = null
  for (const m of region.matchAll(opening)) {
    if (sourceTagSignature(region, m.index!, tagName.length, jsx) !== signature) continue
    if (found !== null) return null // more than one candidate: ambiguous
    found = m.index!
  }
  return found === null ? null : offsetToLocation(content, found)
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
