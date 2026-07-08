import type { ConfidenceFlag, FileEntry } from '../types.js'

// Alt-quality confidence flags — a precision-first ADVISORY layer. It reads the raw
// file contents for `<img>` tags with a present-but-suspect static `alt` and emits a low-confidence
// flag per match. It is orthogonal metadata: it never touches issues, the conformance verdicts,
// the score, or coverage. Honesty cuts both ways — a crude alt heuristic promoted to a WCAG
// FAILURE would reintroduce false-positive noise, so this only ever advises. Signals are a
// declarative table so precision can be tightened without touching the extraction logic.

// The criterion an image's alt serves (Non-text Content). The flag qualifies its verdict, never
// changes it.
const CRITERION = '1.1.1'

// Extraction runs over RAW file.content (never the neutralized extractHtml() output, which
// collapses alt={x}→alt="…" and strips src): static `alt="…"`/`alt='…'` only. Dynamic forms
// (`alt={…}`, `:alt`, `v-bind:alt`) and `data-alt` don't match — the required leading whitespace
// before `alt` excludes `:`/`-`-prefixed names.
const IMG_TAG = /<img\b[^>]*>/gi
const ALT_ATTR = /(?:^|\s)alt\s*=\s*("([^"]*)"|'([^']*)')/i
const SRC_ATTR = /(?:^|\s)src\s*=\s*("([^"]*)"|'([^']*)')/i

const IMG_EXT = /\.(jpe?g|png|gif|webp|svg|avif|bmp|ico|tiff?)$/i
// A camera/export/placeholder filename stem + a number: DSC00423, IMG_1024, screenshot-3, photo2.
const FILENAME_LIKE = /^(dsc|dscn|img|imgp|pxl|mvimg|screen[\s_-]?shot|screenshot|photo|image|pic|picture|capture|scan)[\s._-]?\d+$/i
// The WHOLE alt (optionally + a trailing number) equal to one of these → generic. Kept exact so a
// real description that merely CONTAINS the word ("Acme logo", "Summer sale banner") is never hit.
// `logo` is deliberately absent — brand alts are usually "<Brand> logo".
const GENERIC_PLACEHOLDERS = new Set(['untitled', 'image', 'photo', 'picture', 'graphic', 'graphics', 'spacer', 'blank', 'placeholder', 'thumbnail', 'thumb', 'img', 'icon', 'banner', 'pic'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HEX = /^[0-9a-f]{8,}$/i

// Read a static double- or single-quoted attribute value from a tag string. Returns null when the
// attribute is absent or dynamic (no static quotes) — the caller then stays silent.
function staticAttr(tag: string, re: RegExp): string | null {
  const m = re.exec(tag)
  if (!m) return null
  return m[2] ?? m[3] ?? ''
}

function srcBasename(src: string): string {
  const clean = src.split(/[?#]/)[0]
  return (clean.split(/[\\/]/).pop() ?? clean).toLowerCase()
}

// Subordinate signal, tightly gated so plausible words never fire: a single token with no vowels
// (len ≥ 5), a long hex string, or a UUID. "Menu"/"Cart"/"Play"/"PDF" all have a vowel or are short.
function isGibberish(alt: string): boolean {
  if (UUID.test(alt)) return true
  if (HEX.test(alt)) return true
  return !/\s/.test(alt) && alt.length >= 5 && /^[a-z0-9]+$/i.test(alt) && !/[aeiouy]/i.test(alt)
}

// The declarative signal table, first-match-wins → at most one flag per alt.
function detect(alt: string, src: string | null): Pick<ConfidenceFlag, 'signal' | 'reason'> | null {
  const raw = alt.trim()
  const lower = raw.toLowerCase()

  if (IMG_EXT.test(lower) || FILENAME_LIKE.test(lower)) {
    return { signal: 'filename_as_alt', reason: 'The alt looks like a file name, not a description.' }
  }
  if (src) {
    const base = srcBasename(src)
    if (lower === base || lower === base.replace(IMG_EXT, '')) {
      return { signal: 'alt_equals_src', reason: 'The alt just repeats the image file name.' }
    }
  }
  const noTrailingDigits = lower.replace(/[\s_-]*\d+$/, '')
  if (GENERIC_PLACEHOLDERS.has(lower) || GENERIC_PLACEHOLDERS.has(noTrailingDigits)) {
    return { signal: 'generic_placeholder', reason: 'Generic placeholder alt — describe the image instead.' }
  }
  if (isGibberish(raw)) {
    return { signal: 'gibberish', reason: "The alt isn't human-readable text." }
  }
  return null
}

// Pure, deterministic derivation over the scanned files. No scanning engine, no network.
// Skips `type: 'other'`, dynamic alts, and empty `alt=""` (intentional decorative images).
export function computeConfidenceFlags(files: FileEntry[]): ConfidenceFlag[] {
  const flags: ConfidenceFlag[] = []
  for (const file of files) {
    if (file.type === 'other') continue
    const content = file.content
    IMG_TAG.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = IMG_TAG.exec(content)) !== null) {
      const tag = m[0]
      const alt = staticAttr(tag, ALT_ATTR)
      if (alt === null || alt.trim() === '') continue // missing / dynamic / decorative → silent
      const hit = detect(alt, staticAttr(tag, SRC_ATTR))
      if (!hit) continue
      const line = content.slice(0, m.index).split('\n').length
      flags.push({ criterion: CRITERION, signal: hit.signal, value: alt, file_path: file.path, line, reason: hit.reason, confidence: 'low' })
    }
  }
  return flags
}
