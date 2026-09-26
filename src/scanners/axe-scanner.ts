import axeModule from 'axe-core'
import { JSDOM, VirtualConsole } from 'jsdom'
import type {
  ScannerAdapter,
  ScanContext,
  EquallIssue,
  Severity,
  PourPrinciple,
  WcagLevel,
  FileType,
} from '../types.js'
import { extractHtml, wrapFragment, DYNAMIC_MARKER_PREFIX, COMPONENT_MARKER } from '../utils/html-extract.js'

const axe = (axeModule as any).default ?? axeModule

// --- Review-only findings on component source -------------------------------------------
// On jsx/tsx/vue/svelte/astro, axe runs on markup RECONSTRUCTED from source, not on a
// rendered DOM. Measured on a labelled corpus and on real repositories, most of its findings
// there are false positives: props spread into an element, children produced by .map(),
// dynamic attributes the extractor has to drop, components read as native tags. Removing
// those findings would also lose a few real defects that only axe sees, so instead they stay
// in the output with their fingerprint unchanged, flagged `review_only` (never counted).
// A finding stays COUNTED on component source only when both hold:
//   - its rule is an element-level naming rule that the static markup can decide, and
//   - the element carries nothing the static markup cannot see (see isUnverifiableElement).
// Plain .html is never affected: it is real markup.
const COMPONENT_COUNTED_RULES = new Set([
  'image-alt', 'input-image-alt', 'area-alt', 'object-alt', 'svg-img-alt', 'role-img-alt',
  'button-name', 'input-button-name', 'link-name', 'label', 'select-name', 'frame-title',
  // Counted only when the <li> sits under a literal, non-component parent (checked below).
  'listitem',
])

const REVIEW_REASON_RULE = 'This rule needs the rendered page; on component source axe only sees a reconstruction of the markup.'
const REVIEW_REASON_ELEMENT = 'The element depends on props, runtime expressions or a component, which static analysis cannot see.'

// Bindings that cannot change an element's accessible name, role or label association:
// an element carrying only these is still fully decidable for the naming rules.
const NAME_NEUTRAL_BINDING = /^(on[a-z].*|class|classname|style|key|ref|src|href|value|checked|disabled|v-model.*|v-for|v-if|v-else-if|v-else|v-show|v-on:.*|@.*|:class|:style|:key|:src|:href|:value|v-bind:class|v-bind:style|v-bind:key)$/

// Does this element carry something the static markup cannot see? A component tag, a
// neutralized dynamic attribute that could affect the name, a spread, a Vue binding, or the
// residue of an expression the extractor could not neutralize.
function isUnverifiableElement(el: Element): boolean {
  for (const a of Array.from(el.attributes)) {
    const n = a.name
    if (n === COMPONENT_MARKER) return true
    if (n.startsWith(DYNAMIC_MARKER_PREFIX)) {
      if (!NAME_NEUTRAL_BINDING.test(n.slice(DYNAMIC_MARKER_PREFIX.length))) return true
      continue
    }
    if (n.startsWith('{')) return true // spread {...props}
    if (a.value.includes('{') || /[<>()'"`]/.test(n)) return true // unneutralized residue
    if (NAME_NEUTRAL_BINDING.test(n)) continue
    if (n.includes('{') || n.startsWith(':') || n.startsWith('v-bind')) return true
  }
  return false
}

// axe-core WCAG tag format: "wcag111" → "1.1.1", "wcag2a" → level A, etc.
// WCAG criterion numbers follow the pattern: Principle(1-4).Guideline(single digit).SC(1+ digits)
// So "wcag2411" = Principle 2, Guideline 4, SC 11 → "2.4.11"
// This is unambiguous because principles are always 1-4 and guidelines are single-digit.
function parseWcagTags(tags: string[]): {
  criteria: string[]
  level: WcagLevel | null
  pour: PourPrinciple | null
} {
  const criteria: string[] = []
  let level: WcagLevel | null = null
  let pour: PourPrinciple | null = null

  for (const tag of tags) {
    // Match criterion tags like "wcag111", "wcag143", "wcag2411"
    // Format: wcag + principle(1-4) + guideline(1 digit) + SC(1+ digits)
    const criterionMatch = tag.match(/^wcag([1-4])(\d)(\d+)$/)
    if (criterionMatch) {
      criteria.push(`${criterionMatch[1]}.${criterionMatch[2]}.${criterionMatch[3]}`)
      continue
    }

    // Match level tags
    if (tag === 'wcag2a' || tag === 'wcag21a' || tag === 'wcag22a') level = 'A'
    else if (tag === 'wcag2aa' || tag === 'wcag21aa' || tag === 'wcag22aa') level = 'AA'
    else if (tag === 'wcag2aaa' || tag === 'wcag21aaa' || tag === 'wcag22aaa') level = 'AAA'

    // POUR categories from axe tags
    if (tag === 'cat.text-alternatives' || tag === 'cat.color' || tag === 'cat.sensory-and-visual-cues' || tag === 'cat.time-and-media' || tag === 'cat.tables' || tag === 'cat.forms') {
      pour = pour ?? 'perceivable'
    }
    if (tag === 'cat.keyboard' || tag === 'cat.navigation' || tag === 'cat.time-and-media') {
      pour = pour ?? 'operable'
    }
    if (tag === 'cat.language' || tag === 'cat.parsing' || tag === 'cat.forms') {
      pour = pour ?? 'understandable'
    }
    if (tag === 'cat.name-role-value' || tag === 'cat.structure' || tag === 'cat.aria') {
      pour = pour ?? 'robust'
    }
  }

  return { criteria, level, pour }
}

// Map axe impact to Equall severity
function mapSeverity(impact: string | undefined): Severity {
  switch (impact) {
    case 'critical': return 'critical'
    case 'serious': return 'serious'
    case 'moderate': return 'moderate'
    case 'minor': return 'minor'
    default: return 'moderate'
  }
}

// Derive POUR from WCAG criterion number
function pourFromCriterion(criterion: string): PourPrinciple | null {
  const principle = criterion.charAt(0)
  switch (principle) {
    case '1': return 'perceivable'
    case '2': return 'operable'
    case '3': return 'understandable'
    case '4': return 'robust'
    default: return null
  }
}

export class AxeScanner implements ScannerAdapter {
  name = 'axe-core'
  version = ''
  fileTypes: FileType[] = ['html', 'jsx', 'tsx', 'vue', 'astro', 'svelte']
  // Criteria whose rules run but cannot conclude without a rendered layout, so they are
  // never reported as automatically tested (verdict: needs the rendered/assisted check):
  // - 1.4.3: contrast rules are disabled below (they need real rendering)
  // - 1.4.1: link-in-text-block is always "inapplicable" under jsdom (no computed styles)
  // - 2.5.8: target-size "passes" any size under jsdom (no layout: a 10×10px button passes)
  partialCriteria = ['1.4.3', '1.4.1', '2.5.8']
  // Only criteria with at least one rule that actually runs under this configuration.
  // Not listed although axe tags them: 1.2.1 (audio-caption is deprecated and never runs),
  // 1.3.4 (css-orientation-lock) and 2.5.3 (label-content-name-mismatch) are experimental
  // rules outside the run tags — claiming them would report untested criteria as tested.
  coveredCriteria = [
    '1.1.1', '1.2.2', '1.3.1', '1.3.5',
    '1.4.1', '1.4.2', '1.4.3', '1.4.4', '1.4.12',
    '2.1.1', '2.1.3', '2.2.1', '2.2.2', '2.4.1', '2.4.2', '2.4.4',
    '2.5.8',
    '3.1.1', '3.1.2', '3.3.2',
    '4.1.2',
  ]

  async isAvailable(): Promise<boolean> {
    return true
  }

  async scan(context: ScanContext): Promise<EquallIssue[]> {
    this.version = axe.version ?? 'unknown'

    // Read exactly the file types declared in `fileTypes` (the single source that coverage
    // also relies on), never a separate hardcoded list.
    const htmlFiles = context.files.filter((f) => this.fileTypes.includes(f.type))

    // Only scan files that actually contain renderable HTML.
    const scannableFiles = htmlFiles.filter((f) => {
      if (f.type === 'html') return true
      // Astro/Svelte are markup-first: the template lives at the top level (no
      // `return`), so scan as soon as there's a tag. extractHtml strips their
      // frontmatter/script/style blocks before axe sees the content.
      if (f.type === 'astro' || f.type === 'svelte') return f.content.includes('<')
      // JSX/TSX/Vue component files: only those that actually render HTML.
      return f.content.includes('<') && (
        f.content.includes('return') ||
        f.content.includes('<template')
      )
    })

    const allIssues: EquallIssue[] = []

    // Determine axe run tags based on target level
    const runTags = buildRunTags(context.options.wcag_level)


    for (const file of scannableFiles) {
      try {
        const componentSource = file.type !== 'html'
        const html = extractHtml(file.content, file.type, { markUnverifiable: componentSource })
        if (!html.trim()) continue

        const issues = await this.scanHtml(html, file.path, runTags, componentSource)
        allIssues.push(...issues)
      } catch (error) {
        // Skip files that fail — never crash the whole scan, never pass silently: the file
        // was not checked by axe, and the result says so.
        const msg = error instanceof Error ? error.message : String(error)
        context.unchecked?.push({ scanner: this.name, file_path: file.path, reason: 'analysis_error' })
        context.diagnostics?.push(`[axe-core] ${file.path} could not be analysed and was not checked by axe: ${msg.slice(0, 100)}`)
      }
    }

    return allIssues
  }

  private async scanHtml(
    html: string,
    filePath: string,
    runTags: string[],
    componentSource = false
  ): Promise<EquallIssue[]> {
    // Wrap fragment in a basic HTML document if needed
    const fullHtml = wrapFragment(html)

    // Suppress JSDOM "not implemented" errors (canvas, etc.)
    const originalConsoleError = console.error
    console.error = (...args: any[]) => {
      const msg = String(args[0] ?? '')
      if (msg.includes('Not implemented') || msg.includes('HTMLCanvasElement')) return
      originalConsoleError(...args)
    }

    const dom = new JSDOM(fullHtml, {
      runScripts: 'outside-only',
      pretendToBeVisual: true,
      virtualConsole: new VirtualConsole(),
    })

    try {
      const document = dom.window.document

      // Component source: note the elements the static markup cannot fully see, then remove
      // every marker so the DOM axe inspects (and so every snippet and fingerprint) is exactly
      // the unmarked extraction.
      const unverifiable = new Set<Element>()
      if (componentSource) {
        for (const el of Array.from(document.querySelectorAll('*'))) {
          // <slot>: the content (and so the accessible name) is supplied by the caller.
          if (isUnverifiableElement(el) || el.querySelector('slot')) unverifiable.add(el)
          for (const a of Array.from(el.attributes)) {
            if (a.name === COMPONENT_MARKER || a.name.startsWith(DYNAMIC_MARKER_PREFIX)) el.removeAttribute(a.name)
          }
        }
      }

      // Run a fresh axe-core injected into THIS document's window (the injection pattern axe
      // is designed for) rather than the module instance. axe keeps global state and resets it
      // after every run; eslint-plugin-jsx-a11y drives the same module instance internally
      // (autocomplete-valid), so sharing it made axe throw on any JSX with autoComplete= and
      // left jsx-a11y reading a torn-down window. Whether the two shared one instance depended
      // on how the engine was loaded (from source they did; the bundled build ships two
      // copies), so tests and the published CLI disagreed. One axe per document removes the
      // shared state in every build, and makes concurrent scans in one process safe.
      dom.window.eval(axe.source)
      const windowAxe = (dom.window as unknown as { axe: typeof axe }).axe
      windowAxe.configure({ rules: AXE_RULE_OVERRIDES })
      const results = await windowAxe.run(document.documentElement, {
        runOnly: {
          type: 'tag',
          values: runTags,
        },
        resultTypes: ['violations'],
      })

      const issues: EquallIssue[] = []

      for (const violation of results.violations) {
        const { criteria, level, pour } = parseWcagTags(violation.tags)
        const derivedPour = pour ?? (criteria[0] ? pourFromCriterion(criteria[0]) : null)

        for (const node of violation.nodes) {
          const reviewReason = componentSource
            ? componentReviewReason(violation.id, node, document, unverifiable)
            : null
          issues.push({
            scanner: 'axe-core',
            scanner_rule_id: violation.id,
            wcag_criteria: criteria,
            wcag_level: level,
            pour: derivedPour,
            file_path: filePath,
            line: null,     // axe-core doesn't provide line numbers on static HTML
            column: null,
            html_snippet: node.html?.slice(0, 200) ?? null,
            severity: mapSeverity(violation.impact),
            message: `${violation.help} (${violation.id})`,
            help_url: violation.helpUrl ?? null,
            suggestion: node.failureSummary ?? null,
            ...(reviewReason ? { review_only: true, review_reason: reviewReason } : {}),
          })
        }
      }

      return issues
    } finally {
      dom.window.close()
      console.error = originalConsoleError
    }
  }
}

// Why a finding on component source cannot be confirmed statically, or null when it can.
function componentReviewReason(
  ruleId: string,
  node: { target?: unknown[] },
  document: Document,
  unverifiable: Set<Element>,
): string | null {
  if (!COMPONENT_COUNTED_RULES.has(ruleId)) return REVIEW_REASON_RULE
  const selector = node.target?.[0]
  const el = typeof selector === 'string' ? document.querySelector(selector) : null
  if (el && unverifiable.has(el)) return REVIEW_REASON_ELEMENT
  if (ruleId === 'listitem') {
    const parent = el?.parentElement
    if (!parent || parent.tagName === 'BODY' || unverifiable.has(parent)) return REVIEW_REASON_ELEMENT
  }
  return null
}

// Contrast needs real rendering (computed colors, layout, backgrounds): disabled here, and
// declared partial (1.4.3) so it is never reported as tested.
const AXE_RULE_OVERRIDES = [
  { id: 'color-contrast', enabled: false },
  { id: 'color-contrast-enhanced', enabled: false },
]

// Build the tag filter for axe.run based on target WCAG level
function buildRunTags(level: WcagLevel): string[] {
  const tags = ['wcag2a', 'wcag21a', 'wcag22a']
  if (level === 'AA' || level === 'AAA') {
    tags.push('wcag2aa', 'wcag21aa', 'wcag22aa')
  }
  if (level === 'AAA') {
    tags.push('wcag2aaa', 'wcag21aaa', 'wcag22aaa')
  }
  // Always include best-practice for bonus value
  tags.push('best-practice')
  return tags
}
