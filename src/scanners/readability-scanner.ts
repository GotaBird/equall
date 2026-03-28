import { createRequire } from 'node:module'
import * as cheerio from 'cheerio'
import textReadability from 'text-readability'
import type {
  ScannerAdapter,
  ScanContext,
  GladosIssue,
  Severity,
  PourPrinciple,
} from '../types.js'
import { extractHtml } from '../utils/html-extract.js'

// Resolve the bundled text-readability version
const req = createRequire(import.meta.url)
let trVersion = 'unknown'
try {
  const trPkgPath = req.resolve('text-readability/package.json')
  const trPkg = req(trPkgPath)
  trVersion = trPkg.version ?? 'unknown'
} catch {
  // version stays 'unknown'
}

function calculateMedian(numbers: number[]): number {
  if (numbers.length === 0) return 0
  const sorted = [...numbers].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2
  }
  return sorted[middle]
}

function mapSeverity(grade: number): Severity {
  if (grade > 14) return 'critical' // College level
  if (grade > 12) return 'serious'  // Advanced high school
  return 'moderate'                 // High school
}

// Spacing around block tags prevents words from adjacent elements sticking together during text extraction
const BLOCK_TAGS_SELECTOR = 'div, p, br, li, h1, h2, h3, h4, h5, h6, section, article, td, th'

export class ReadabilityScanner implements ScannerAdapter {
  name = 'readability'
  version = trVersion
  coveredCriteria = ['3.1.5'] // WCAG AAA: Reading Level

  async isAvailable(): Promise<boolean> {
    return true // bundled
  }

  async scan(context: ScanContext): Promise<GladosIssue[]> {
    // Only scan HTML and Vue files — JSX/TSX extraction via regex captures
    // className attributes and {expressions} which pollute readability scores.
    // A real JSX parser would fix this but is overkill for v1.
    const scannableFiles = context.files.filter((f) => {
      if (f.type === 'html') return true
      if (f.type === 'vue') return f.content.includes('<template')
      return false
    })

    const allIssues: GladosIssue[] = []

    for (const file of scannableFiles) {
      try {
        const html = extractHtml(file.content, file.type)
        if (!html.trim()) continue

        const $ = cheerio.load(html)
        $('style, script, svg, noscript').remove()

        const langAttr = $('html').attr('lang')
        if (langAttr && !langAttr.toLowerCase().startsWith('en')) {
          // If language is explicitly set to non-English, readability formulas will be skewed based on English syllables
          // It's safer to skip unless the user forces it (not supported yet)
          console.warn(`  [readability] Skipped ${file.path}: Document language is '${langAttr}', but scoring is English-calibrated`)
          continue
        }

        $(BLOCK_TAGS_SELECTOR).each(function() {
          $(this).prepend(' ')
          $(this).append(' ')
        })

        const text = $.root().text().replace(/\s+/g, ' ').trim()
        if (!text) continue

        // Noise gate: skip files with very little text (e.g. logic-heavy components with a few labels)
        // Readability formulas are statistically invalid on very short texts (smog expects 30+ sentences, but overall formulas need at least 30 words)
        const wordCount = text.split(' ').length
        if (wordCount < 30) continue

        const scores: Record<string, number | null> = {
          'Flesch-Kincaid': textReadability.fleschKincaidGrade(text),
          'Coleman-Liau': textReadability.colemanLiauIndex(text),
          'ARI': textReadability.automatedReadabilityIndex(text),
          'Gunning Fog': textReadability.gunningFog(text),
          'SMOG': null,
          'Dale-Chall': null,
        }

        // smogIndex can throw or return invalid results if sentences < 3
        try {
          const smog = textReadability.smogIndex(text)
          if (typeof smog === 'number' && !isNaN(smog) && smog > 0) {
            scores['SMOG'] = smog
          }
        } catch {
          // Ignore smog if it crashes on short text
        }

        // Dale-Chall uses its own scale (4.9-9.9) instead of grade level (1-18).
        // Convert to approximate grade equivalent before including in the median.
        const daleChallRaw = textReadability.daleChallReadabilityScore(text)
        if (typeof daleChallRaw === 'number' && !isNaN(daleChallRaw)) {
          // Conversion: DC < 5 → grade 4, 5-5.9 → 5-6, 6-6.9 → 7-8, 7-7.9 → 9-10,
          // 8-8.9 → 11-12, 9+ → 13-15. Linear approximation:
          const daleChallGrade = Math.round(daleChallRaw * 1.67 - 4.15)
          scores['Dale-Chall'] = Math.max(1, daleChallGrade)
        }

        const gradeValues = Object.values(scores).filter(
          (v): v is number => v !== null && !isNaN(v)
        )

        const medianGrade = calculateMedian(gradeValues)

        // WCAG 3.1.5 recommends lower secondary education level (approx Grade 9)
        if (medianGrade > 9) {
          // Build the breakdown string from named scores
          const breakdown = Object.entries(scores)
            .map(([name, val]) => `- ${name}: ${val !== null ? val.toFixed(1) : 'n/a'}`)
            .join('\n')

          allIssues.push({
            scanner: 'readability',
            scanner_rule_id: 'reading-level-high',
            wcag_criteria: ['3.1.5'],
            wcag_level: 'AAA',
            pour: 'understandable' as PourPrinciple,
            file_path: file.path,
            line: null,
            column: null,
            html_snippet: null, // Readability is a full-file metric
            severity: mapSeverity(medianGrade),
            message: `Reading level is too advanced (Median Grade ${medianGrade.toFixed(1)}). Text should ideally be readable by people with lower secondary education.`,
            help_url: 'https://www.w3.org/WAI/WCAG22/Understanding/reading-level',
            suggestion: `Consider simplifying the text. Breakdown:\n${breakdown}`,
          })
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.warn(`  [readability] Skipped ${file.path}: ${msg.slice(0, 80)}`)
      }
    }

    return allIssues
  }
}
