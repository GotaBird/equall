// Vue single-file component templates, read through the official parser (vue-eslint-parser)
// instead of a regex. The regex this replaces stopped at the first `</template>`, so every
// nested <template v-if/v-for/#slot> silently cut the rest of the component out of the scan,
// and a self-closing tag (`<Icon aria-hidden="true"/>`) reached the HTML parser as an open tag
// that swallowed the text after it — hiding a button's label behind aria-hidden.
//
// Identity-preserving by design: the extraction is the raw template source, byte for byte,
// with only these local edits —
//   1. a nested `<template>` wrapper loses its own start/end tags (its children are what renders);
//   2. a self-closing non-void HTML element that hides its subtree (static aria-hidden="true",
//      hidden, inert) and is followed by content gets an explicit end tag, so that content is
//      no longer hidden with it. Other self-closing elements are left exactly as written: closing
//      them changes the markup (and so the snippet and fingerprint) of the findings around them
//      without changing what assistive technology is told;
//   3. in prose mode only (reading level), interpolations are blanked and self-closing raw-text
//      elements (`<textarea/>`, which the HTML parser would extend over all following markup)
//      are closed, so markup never reaches the grader as words;
//   4. optionally, each element carries a source-offset marker the axe scanner reads (exact
//      lines) and removes before axe runs.
// A template without these patterns therefore yields exactly the markup the regex did, so its
// findings keep their snippets and fingerprints. Foreign content (svg, math) is never edited:
// the HTML parser already honours `/>` there.
import * as vueParserModule from 'vue-eslint-parser'
import * as tsParserModule from '@typescript-eslint/parser'

const vueParser: any = (vueParserModule as any).default ?? vueParserModule
const tsParser: any = (tsParserModule as any).default ?? tsParserModule

const HTML_NS = 'http://www.w3.org/1999/xhtml'
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
// Elements whose content the HTML parser reads as text up to their end tag.
const RAW_TEXT = new Set(['textarea', 'title', 'iframe', 'noembed', 'noframes', 'noscript', 'xmp', 'style', 'script'])

// Attribute carrying an element's offset in the .vue source (see markSource). The axe scanner
// records it and removes it before axe runs, like the other extraction markers.
export const SOURCE_OFFSET_MARKER = 'data-eq-src'

export interface VueExtractOptions {
  // Prose-only text, for reading-level grading (see edit 3 above).
  prose?: boolean
  // Leave a SOURCE_OFFSET_MARKER on every element.
  markSource?: boolean
}

// One parse per file content, shared by every caller of a scan (extraction for axe,
// readability and error-identification, document/fragment detection). Bounded, and cleared at
// the end of each runScan so a long-lived host never keeps syntax trees around.
const CACHE_LIMIT = 256
const cache = new Map<string, any | null>()

function parseTemplate(content: string): any | null {
  if (cache.has(content)) return cache.get(content)
  let root: any | null = null
  try {
    const ast = vueParser.parse(content, { parser: tsParser, sourceType: 'module', ecmaVersion: 'latest' })
    const body = ast?.templateBody
    // A root <template> without its end tag cannot be bounded: treat as unparseable.
    if (body?.startTag && body.endTag) root = body
  } catch {
    root = null
  }
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
  cache.set(content, root)
  return root
}

export function clearVueTemplateCache(): void {
  cache.clear()
}

// Does the file declare a root <template> the parser could not read? Such a file falls back to
// the regex extraction and must be reported as not fully checked.
export function vueTemplateParseFailed(content: string): boolean {
  return /<template[\s>]/.test(content) && parseTemplate(content) === null
}

const isSelfClosingHtml = (node: any): boolean =>
  node.startTag.selfClosing && !node.endTag && node.namespace === HTML_NS && !VOID.has(node.name)

const followedByContent = (node: any): boolean => {
  const siblings: any[] = node.parent?.children ?? []
  return siblings.slice(siblings.indexOf(node) + 1).some((s) => s.type !== 'VText' || s.value.trim() !== '')
}

const hidesSubtree = (node: any): boolean => node.startTag.attributes.some((a: any) => !a.directive && (
  (a.key.name === 'aria-hidden' && a.value?.value === 'true') || a.key.name === 'hidden' || a.key.name === 'inert'))

// Self-closing raw-text elements the axe extraction leaves as written: the HTML parser reads
// everything after them as their text, so that markup is not checked by axe. Reported by the
// scan as a diagnostic (closing them would re-identify the findings that contain them).
export function vueRawTextSwallow(content: string): boolean {
  const root = parseTemplate(content)
  if (!root) return false
  let found = false
  const walk = (node: any): void => {
    if (found || node.type !== 'VElement') return
    if (isSelfClosingHtml(node) && RAW_TEXT.has(node.name)) found = true
    for (const child of node.children ?? []) walk(child)
  }
  for (const child of root.children) walk(child)
  return found
}

interface Edit { start: number; end: number; text: string }

// The root template's inner markup with the local edits applied, or null when the parser
// could not read the file (the caller falls back and reports it).
export function extractVueTemplate(content: string, options: VueExtractOptions = {}): string | null {
  const root = parseTemplate(content)
  if (!root) return null
  const innerStart: number = root.startTag.range[1]
  const innerEnd: number = root.endTag.range[0]
  const edits: Edit[] = []

  const walk = (node: any): void => {
    if (node.type === 'VExpressionContainer') {
      if (options.prose) edits.push({ start: node.range[0], end: node.range[1], text: ' ' })
      return
    }
    if (node.type !== 'VElement') return
    if (node.name === 'template') {
      // Unwrap: drop the wrapper's own tags, keep its children.
      edits.push({ start: node.startTag.range[0], end: node.startTag.range[1], text: '' })
      if (node.endTag) edits.push({ start: node.endTag.range[0], end: node.endTag.range[1], text: '' })
    } else {
      const tagStart: number = node.startTag.range[0]
      const tagEnd: number = node.startTag.range[1]
      if (options.markSource) {
        const afterName = tagStart + 1 + node.rawName.length
        edits.push({ start: afterName, end: afterName, text: ` ${SOURCE_OFFSET_MARKER}="${tagStart}"` })
      }
      const close = isSelfClosingHtml(node) && (
        (hidesSubtree(node) && followedByContent(node)) ||
        (options.prose === true && RAW_TEXT.has(node.name)))
      if (close) edits.push({ start: tagEnd - 2, end: tagEnd, text: `></${node.rawName}>` })
    }
    for (const child of node.children ?? []) walk(child)
  }
  for (const child of root.children) walk(child)

  // Assemble in one pass, in source order. At equal start, an insertion (empty range) comes
  // before a replacement, so a marker lands inside the tag it belongs to.
  edits.sort((a, b) => a.start - b.start || a.end - b.end)
  const parts: string[] = []
  let cursor = innerStart
  for (const e of edits) {
    parts.push(content.slice(cursor, e.start), e.text)
    cursor = e.end
  }
  parts.push(content.slice(cursor, innerEnd))
  return parts.join('')
}
