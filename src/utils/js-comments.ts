import * as tsParserModule from '@typescript-eslint/parser'

// The JSX of a component is cut out of its file as text and handed to an HTML parser, which
// knows nothing about JavaScript comments: `// no <img src> here` would become an element.
// Only a `<` can open an element, so every `<` inside a JS comment (`// …`, `/* … */`, and
// the `{/* … */}` form inside JSX) is replaced by a space. Nothing else is touched: the
// length, the line breaks and the rest of the comment text stay as written, so offsets,
// lines and the snippets of the real markup do not move.
//
// The comment ranges come from the parser, not from a pattern: `//` inside a string, a URL in
// JSX text or a template literal is not a comment and must stay.

// Same parser, and the same options, as the lint scanner (which adds ESLint's own defaults:
// latest syntax, ES modules): a file the lint scanner reads is read here too.
const tsParser = (tsParserModule as unknown as { default?: typeof tsParserModule }).default ?? tsParserModule

// The extraction runs several times on each file of a scan (one call per scanner, the
// document check, the source-location lookup), not always back to back: results are kept
// per content, up to a bound on the text held, then dropped together.
const CACHE_CHAR_LIMIT = 4_000_000
const cache = new Map<string, string>()
let cachedChars = 0

// Can a comment of this text contain a `<`? A necessary condition, checked without parsing:
// a `//` followed by a `<` before the end of its line, or a `/*` with a `<` before the next
// `*/`. It also answers yes for text that is not a comment (a URL before a tag on one
// line), which only costs a parse. One forward pass per form: every cursor only moves
// forward, so the cost is linear in the length of the text whatever it contains.
export function mayHaveMarkupInComment(content: string): boolean {
  // Line form.
  let lt = -1
  for (let at = content.indexOf('//'); at !== -1; ) {
    if (lt < at) lt = content.indexOf('<', at)
    if (lt === -1) break
    const lineEnd = content.indexOf('\n', at)
    if (lineEnd === -1 || lt < lineEnd) return true
    at = content.indexOf('//', lineEnd)
  }
  // Block form.
  lt = -1
  let close = -1
  for (let at = content.indexOf('/*'); at !== -1; at = content.indexOf('/*', at + 2)) {
    if (lt < at) lt = content.indexOf('<', at)
    if (lt === -1) break
    if (close < at + 2) close = content.indexOf('*/', at + 2)
    if (close === -1) break
    if (lt < close) return true
  }
  return false
}

// `type` is the file type ('jsx' or 'tsx'); it tells the parser how to read the file.
export function neutralizeCommentMarkup(content: string, type: string): string {
  // Most files have no `<` in any comment: skip them without parsing.
  if (!mayHaveMarkupInComment(content)) return content
  const key = `${type}\n${content}`
  const cached = cache.get(key)
  if (cached !== undefined) return cached

  let output = content
  try {
    const { ast } = tsParser.parseForESLint(content, {
      ecmaFeatures: { jsx: true },
      ecmaVersion: 'latest',
      sourceType: 'module',
      filePath: `source.${type}`,
      range: true,
    })
    let text = ''
    let cursor = 0
    for (const comment of ast.comments ?? []) {
      const [start, end] = comment.range
      const body = content.slice(start, end)
      if (!body.includes('<')) continue
      text += content.slice(cursor, start) + body.replace(/</g, ' ')
      cursor = end
    }
    if (cursor > 0) output = text + content.slice(cursor)
  } catch {
    // A file the parser cannot read is left as written: the extraction then behaves as it
    // did before comments were neutralized.
  }

  if (cachedChars + content.length > CACHE_CHAR_LIMIT) {
    cache.clear()
    cachedChars = 0
  }
  cache.set(key, output)
  cachedChars += content.length
  return output
}
