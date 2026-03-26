import type { JSDOM } from 'jsdom'
import type {
  ScannerAdapter,
  ScanContext,
  GladosIssue,
  Severity,
  PourPrinciple,
  WcagLevel,
} from '../types.js'

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
  coveredCriteria = [
    '1.1.1', '1.2.1', '1.2.2', '1.3.1', '1.3.4', '1.3.5',
    '1.4.1', '1.4.2', '1.4.3', '1.4.4', '1.4.12',
    '2.1.1', '2.1.3', '2.2.1', '2.2.2', '2.4.1', '2.4.2', '2.4.4',
    '2.5.3', '2.5.8',
    '3.1.1', '3.1.2', '3.3.2',
    '4.1.2',
  ]

  async isAvailable(): Promise<boolean> {
    try {
      await import('axe-core')
      await import('jsdom')
      return true
    } catch {
      return false
    }
  }

  async scan(context: ScanContext): Promise<GladosIssue[]> {
    const axeModule = await import('axe-core') as any
    const axe = axeModule.default ?? axeModule
    const { JSDOM } = await import('jsdom')

    this.version = axe.version ?? 'unknown'

    const htmlFiles = context.files.filter(
      (f) => f.type === 'html' || f.type === 'jsx' || f.type === 'tsx' || f.type === 'vue'
    )

    // For JSX/TSX/Vue, we only scan files that contain HTML-like content
    const scannableFiles = htmlFiles.filter((f) => {
      if (f.type === 'html') return true
      // For component files, check if they contain renderable HTML
      return f.content.includes('<') && (
        f.content.includes('return') ||
        f.content.includes('<template')
      )
    })

    const allIssues: GladosIssue[] = []

    // Determine axe run tags based on target level
    const runTags = buildRunTags(context.options.wcag_level)

    for (const file of scannableFiles) {
      try {
        const html = extractHtml(file.content, file.type)
        if (!html.trim()) continue

        const issues = await this.scanHtml(axe, JSDOM, html, file.path, runTags)
        allIssues.push(...issues)
      } catch (error) {
        // Skip files that fail to parse — don't crash the whole scan
        const msg = error instanceof Error ? error.message : String(error)
        console.warn(`  [axe-core] Skipped ${file.path}: ${msg.slice(0, 80)}`)
      }
    }

    return allIssues
  }

  private async scanHtml(
    axe: any,
    JSDOMClass: typeof JSDOM,
    html: string,
    filePath: string,
    runTags: string[]
  ): Promise<GladosIssue[]> {
    // Wrap fragment in a basic HTML document if needed
    const fullHtml = html.includes('<html') ? html : `
      <!DOCTYPE html>
      <html lang="en">
        <head><title>Scan</title></head>
        <body>${html}</body>
      </html>
    `

    // Suppress JSDOM "not implemented" errors (canvas, etc.)
    const originalConsoleError = console.error
    console.error = (...args: any[]) => {
      const msg = String(args[0] ?? '')
      if (msg.includes('Not implemented') || msg.includes('HTMLCanvasElement')) return
      originalConsoleError(...args)
    }

    const dom = new JSDOMClass(fullHtml, {
      runScripts: 'outside-only',
      pretendToBeVisual: true,
      virtualConsole: new (await import('jsdom')).VirtualConsole(),
    })

    try {
      const document = dom.window.document

      // Disable color-contrast rule (needs real browser rendering)
      axe.configure({
        rules: [
          { id: 'color-contrast', enabled: false },
          { id: 'color-contrast-enhanced', enabled: false },
        ],
      })

      const results = await axe.run(document.documentElement, {
        runOnly: {
          type: 'tag',
          values: runTags,
        },
        resultTypes: ['violations'],
      })

      const issues: GladosIssue[] = []

      for (const violation of results.violations) {
        const { criteria, level, pour } = parseWcagTags(violation.tags)
        const derivedPour = pour ?? (criteria[0] ? pourFromCriterion(criteria[0]) : null)

        for (const node of violation.nodes) {
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

// Extract scannable HTML from various file types
function extractHtml(content: string, type: string): string {
  if (type === 'html') return content

  if (type === 'vue') {
    const templateMatch = content.match(/<template[^>]*>([\s\S]*?)<\/template>/)
    return templateMatch?.[1] ?? ''
  }

  // For JSX/TSX: extract return statement content (simplified)
  // This is a best-effort extraction — complex JSX may not parse perfectly
  if (type === 'jsx' || type === 'tsx') {
    const returnMatch = content.match(/return\s*\(\s*([\s\S]*?)\s*\)\s*[;\n}]/)
    if (returnMatch) return returnMatch[1]
    // Try single-line return
    const singleReturn = content.match(/return\s+(<[\s\S]*?>[\s\S]*?<\/[\s\S]*?>)/)
    return singleReturn?.[1] ?? ''
  }

  return content
}
