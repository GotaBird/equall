import * as cheerio from 'cheerio'
import type {
  ScannerAdapter,
  ScanContext,
  EquallIssue,
} from '../types.js'
import { extractHtml } from '../utils/html-extract.js'

export class ErrorIdentificationScanner implements ScannerAdapter {
  name = 'error-identification'
  version = '1.0.0'
  coveredCriteria = ['3.3.1']

  async isAvailable(): Promise<boolean> {
    return true // cheerio is bundled
  }

  async scan(context: ScanContext): Promise<EquallIssue[]> {
    const scannableFiles = context.files.filter(
      (f) => f.type === 'html' || f.type === 'vue' || f.type === 'svelte' || f.type === 'astro'
    )

    const allIssues: EquallIssue[] = []

    for (const file of scannableFiles) {
      try {
        const html = extractHtml(file.content, file.type)
        if (!html.trim()) continue

        const $ = cheerio.load(html)

        // Check: [aria-invalid="true"] without aria-errormessage or aria-describedby
        $('[aria-invalid="true"]').each((_, el) => {
          const $el = $(el)
          const hasErrorMessage = !!$el.attr('aria-errormessage')
          const hasDescribedBy = !!$el.attr('aria-describedby')

          if (!hasErrorMessage && !hasDescribedBy) {
            const snippet = $.html(el)?.slice(0, 200) ?? null

            allIssues.push({
              scanner: 'error-identification',
              scanner_rule_id: 'aria-invalid-no-message',
              wcag_criteria: ['3.3.1'],
              wcag_level: 'A',
              pour: 'understandable',
              file_path: file.path,
              line: null,
              column: null,
              html_snippet: snippet,
              severity: 'moderate',
              message: 'Element with aria-invalid="true" has no aria-errormessage or aria-describedby to describe the error',
              help_url: 'https://www.w3.org/WAI/WCAG22/Understanding/error-identification',
              suggestion: 'Add aria-errormessage pointing to an element that describes the error, or use aria-describedby to link to an error description.',
            })
          }
        })
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.warn(`  [error-identification] Skipped ${file.path}: ${msg.slice(0, 80)}`)
      }
    }

    return allIssues
  }
}
