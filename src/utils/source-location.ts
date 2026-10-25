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
//
// Everything that depends only on the file (line index, source tags) or only on the DOM
// (signature counts) is built once per file, so each finding costs one lookup.

export interface SourceLocation {
  line: number   // 1-based
  column: number // 1-based, in UTF-16 code units (like ESLint), not counting a byte-order mark
}

// Line index of a text: offsets where each line starts. "\n", "\r\n" and a lone "\r" all end
// a line, as editors count them.
export class LineIndex {
  private readonly starts: number[] = [0]
  private readonly bom: boolean

  constructor(private readonly text: string) {
    this.bom = text.charCodeAt(0) === 0xfeff
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i)
      if (c === 10) this.starts.push(i + 1)
      else if (c === 13 && text.charCodeAt(i + 1) !== 10) this.starts.push(i + 1)
    }
  }

  locate(offset: number): SourceLocation {
    // Binary search: the last line start <= offset.
    let lo = 0
    let hi = this.starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.starts[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    let column = offset - this.starts[lo] + 1
    if (lo === 0 && this.bom && offset > 0) column-- // a byte-order mark is not a column
    return { line: lo + 1, column }
  }
}

// 1-based line and column of a character offset (one-off; use LineIndex for many lookups).
export function offsetToLocation(content: string, offset: number): SourceLocation {
  return new LineIndex(content).locate(offset)
}

// Does `content` carry the opening tag of `tagName` at `offset`?
function opensTagAt(content: string, offset: number, tagName: string): boolean {
  if (content.charCodeAt(offset) !== 60) return false // '<'
  const name = content.slice(offset + 1, offset + 1 + tagName.length)
  if (name.toLowerCase() !== tagName.toLowerCase()) return false
  const next = content[offset + 1 + tagName.length]
  return next === undefined || /[\s/>]/.test(next)
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
  index: LineIndex = new LineIndex(content),
): SourceLocation | null {
  if (startOffset == null) return null
  const offset = startOffset - prefixLength
  if (offset < 0 || offset >= content.length) return null
  // Sanity check: the file must open this very tag at that offset (guards against any
  // offset drift, e.g. a byte-order mark or line-ending normalization by the parser).
  if (!opensTagAt(content, offset, tagName)) return null
  return index.locate(offset)
}

// --- Component sources -------------------------------------------------------------------

// Replace a range with spaces, keeping line breaks, so offsets and lines are unchanged.
function blank(text: string, start: number, end: number): string {
  return text.slice(0, start) + text.slice(start, end).replace(/[^\n\r]/g, ' ') + text.slice(end)
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

// Elements whose content never becomes elements of the scanned document: raw text
// (<textarea>, <title>, <noscript> with scripting on, <xmp>, <script>, <style>) or an inert
// template fragment (<template>, which document queries do not enter). A tag inside them is
// never the element axe reported on.
const OPAQUE_CONTENT = /<(template|textarea|title|noscript|xmp|script|style)(?=[\s/>])[\s\S]*?<\/\1\s*>/gi

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
  } else if (type === 'astro') {
    const fm = /^---[\s\S]*?---\n?/.exec(text)
    if (fm) text = blank(text, 0, fm[0].length)
  }
  text = blankAll(text, /<!--[\s\S]*?-->/g)
  return blankAll(text, OPAQUE_CONTENT)
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

const NAMED_ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' }

// Decode character references. Returns null on a named entity outside the short list above:
// the source value cannot then be compared reliably with the DOM value.
function decodeEntities(value: string): string | null {
  let unknown = false
  const out = value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10)
      try { return String.fromCodePoint(code) } catch { unknown = true; return m }
    }
    const named = NAMED_ENTITIES[ref.toLowerCase()]
    if (named === undefined) unknown = true
    return named ?? m
  })
  return unknown ? null : out
}

// Static attributes of the DOM element, as a canonical signature.
export function elementSignature(el: Element): string {
  const attrs: string[] = []
  for (const a of Array.from(el.attributes)) {
    if (isComparable(a.name, a.value)) attrs.push(`${a.name.toLowerCase()}=${JSON.stringify(a.value)}`)
  }
  return attrs.sort().join(' ')
}

// How many elements of the document carry each tag + signature. Built once per document.
export function domSignatureCounts(document: Document): Map<string, number> {
  const counts = new Map<string, number>()
  for (const el of Array.from(document.querySelectorAll('*'))) {
    const key = `${el.localName}\u0000${elementSignature(el)}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
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

interface SourceTag {
  offset: number
  signature: string | null // null: the tag could not be read with certainty
}

interface ParsedTag {
  end: number              // index just past the tag ('>' included), or -1 when unterminated
  signature: string | null
}

// Parse the opening tag whose name ends at `i`. Reads the attributes in order (quoted and
// brace values skipped whole), keeps the first of duplicate attributes as the HTML parser
// does, and returns null as the signature when a value cannot be compared reliably.
function parseOpeningTag(text: string, i: number, jsx: boolean): ParsedTag {
  const n = text.length
  const attrs = new Map<string, string>()
  const seen = new Set<string>()
  let certain = true
  while (i < n) {
    const c = text[i]
    if (/\s/.test(c) || c === '/') { i++; continue }
    if (c === '>') {
      const signature = certain ? [...attrs].map(([k, v]) => `${k}=${JSON.stringify(v)}`).sort().join(' ') : null
      return { end: i + 1, signature }
    }
    if (c === '{') { // spread or bare expression: dynamic, skipped
      const end = skipBraces(text, i)
      if (end < 0) return { end: -1, signature: null }
      i = end
      continue
    }
    const nameMatch = /^[^\s=/>{}"']+/.exec(text.slice(i, i + 256))
    if (!nameMatch) return { end: -1, signature: null }
    let name = nameMatch[0].toLowerCase()
    if (jsx) name = JSX_ATTR_ALIASES[name] ?? name
    i += nameMatch[0].length
    while (i < n && /\s/.test(text[i])) i++
    let raw = ''
    let dynamic = false
    if (text[i] === '=') {
      i++
      while (i < n && /\s/.test(text[i])) i++
      const q = text[i]
      if (q === '"' || q === "'") {
        const end = text.indexOf(q, i + 1)
        if (end < 0) return { end: -1, signature: null }
        raw = text.slice(i + 1, end)
        i = end + 1
      } else if (q === '{') {
        const end = skipBraces(text, i)
        if (end < 0) return { end: -1, signature: null }
        dynamic = true
        i = end
      } else {
        const m = /^[^\s>]+/.exec(text.slice(i, i + 1024))
        if (!m) return { end: -1, signature: null }
        raw = m[0]
        i += m[0].length
      }
    }
    if (seen.has(name)) continue // duplicate attribute: the first one wins
    seen.add(name)
    if (dynamic) continue
    const value = decodeEntities(raw)
    if (value === null) { certain = false; continue }
    if (isComparable(name, value)) attrs.set(name, value)
  }
  return { end: -1, signature: null }
}

// Every opening tag of the markup region, read left to right: a tag is consumed whole, so a
// `<img>` written inside a quoted attribute value is never taken for an element.
function scanSourceTags(region: string, jsx: boolean): Map<string, SourceTag[]> {
  const tags = new Map<string, SourceTag[]>()
  const opening = /<([a-zA-Z][\w:.-]*)/g
  let m: RegExpExecArray | null
  while ((m = opening.exec(region)) !== null) {
    const name = m[1].toLowerCase()
    const parsed = parseOpeningTag(region, m.index + m[0].length, jsx)
    const list = tags.get(name) ?? []
    list.push({ offset: m.index, signature: parsed.signature })
    tags.set(name, list)
    if (parsed.end < 0) break // unterminated tag: what follows cannot be read in sequence
    opening.lastIndex = parsed.end
  }
  return tags
}

// The source side of a component file, built once and queried per finding.
export class ComponentSource {
  private tags: Map<string, SourceTag[]> | undefined
  private index: LineIndex | undefined

  constructor(private readonly content: string, private readonly type: string) {}

  // `domMatches` is the number of elements in the scanned DOM with the same tag and
  // signature. The location is kept only when that element is unique in the DOM, exactly one
  // source tag matches, and no other tag of that name was unreadable (it could be the one).
  locate(tagName: string, signature: string, domMatches: number): SourceLocation | null {
    if (domMatches !== 1) return null
    this.tags ??= scanSourceTags(markupRegion(this.content, this.type), this.type === 'jsx' || this.type === 'tsx')
    const candidates = this.tags.get(tagName.toLowerCase()) ?? []
    let found: number | null = null
    for (const tag of candidates) {
      if (tag.signature === null) return null
      if (tag.signature !== signature) continue
      if (found !== null) return null // more than one candidate: ambiguous
      found = tag.offset
    }
    if (found === null) return null
    this.index ??= new LineIndex(this.content)
    return this.index.locate(found)
  }
}

// One-off form of ComponentSource.locate.
export function locateInComponentSource(
  content: string,
  type: string,
  tagName: string,
  signature: string,
  domMatches: number,
): SourceLocation | null {
  return new ComponentSource(content, type).locate(tagName, signature, domMatches)
}
