import { describe, it, expect } from 'vitest'
import { ReadabilityScanner } from '../scanners/readability-scanner.js'
import type { ScanContext, FileEntry } from '../types.js'

function makeFile(
  path: string,
  content: string,
  type: 'html' | 'jsx' | 'tsx' | 'vue' = 'html'
): FileEntry {
  return { path, absolute_path: `/fake/${path}`, content, type }
}

describe('ReadabilityScanner', () => {
  const scanner = new ReadabilityScanner()

  // Helper context
  const makeContext = (files: FileEntry[]): ScanContext => ({
    root_path: '/fake',
    files,
    options: { wcag_level: 'AA', include_patterns: [], exclude_patterns: [] },
  })

  it('skips files with less than 30 words', async () => {
    // Only ~10 words
    const content = '<div>This is a very short text. Readability formulas need more words.</div>'
    const ctx = makeContext([makeFile('test.html', content)])
    const issues = await scanner.scan(ctx)
    expect(issues.length).toBe(0)
  })

  it('adds spaces around block tags to prevent words sticking together', async () => {
    // Complex multi-syllable words in block tags that would stick together without spacing
    const complexWords = Array.from({ length: 30 }).map(() => 'Extracurricular conceptually').join(' ')
    const htmlWithBlocks = `
      <h1>Extracurricular</h1><p>conceptually</p><div>Extracurricular</div><br>conceptually<section>Extracurricular</section>
      ${complexWords}
    `
    const ctx = makeContext([makeFile('test2.html', htmlWithBlocks)])
    const issues = await scanner.scan(ctx)

    // Since we used complex multi-syllable words, median grade > 9 -> an issue should be emitted
    expect(issues.length).toBe(1)
    expect(issues[0].scanner).toBe('readability')
  })

  it('emits an issue with correct mapping when median grade > 9', async () => {
    // The Gettysburg address has a high reading level
    const complexText = `
      Four score and seven years ago our fathers brought forth on this continent, a new nation, 
      conceived in Liberty, and dedicated to the proposition that all men are created equal.
      Now we are engaged in a great civil war, testing whether that nation, or any nation so 
      conceived and so dedicated, can long endure. We are met on a great battle-field of that 
      war. We have come to dedicate a portion of that field, as a final resting place for those 
      who here gave their lives that that nation might live. It is altogether fitting and proper 
      that we should do this. But, in a larger sense, we can not dedicate -- we can not consecrate 
      -- we can not hallow -- this ground. The brave men, living and dead, who struggled here, 
      have consecrated it, far above our poor power to add or detract. The world will little note, 
      nor long remember what we say here, but it can never forget what they did here.
    `
    const ctx = makeContext([makeFile('gettysburg.html', complexText)])
    const issues = await scanner.scan(ctx)

    expect(issues.length).toBe(1)
    const issue = issues[0]
    expect(issue.scanner_rule_id).toBe('reading-level-high')
    expect(issue.wcag_criteria).toEqual(['3.1.5'])
    expect(issue.pour).toBe('understandable')
    expect(issue.message).toContain('Median Grade')
    // Suggestion should contain named formula breakdowns
    expect(issue.suggestion).toContain('Flesch-Kincaid')
    expect(issue.suggestion).toContain('Dale-Chall')
  })

  it('skips non-English files if lang attribute is present', async () => {
    const complexText = `
      <html lang="fr">
      <body>
        Aujourd'hui, l'épistémologie et l'herméneutique post-structuraliste 
        engendrent des questionnements fondamentalement dichotomiques concernant 
        la phénoménologie de la conscience paradigmatique et son évolution.
        Aujourd'hui, l'épistémologie et l'herméneutique post-structuraliste 
        engendrent des questionnements fondamentalement dichotomiques concernant 
        la phénoménologie de la conscience paradigmatique et son évolution.
        Aujourd'hui, l'épistémologie et l'herméneutique post-structuraliste 
        engendrent des questionnements fondamentalement dichotomiques concernant 
        la phénoménologie.
      </body>
      </html>
    `
    const ctx = makeContext([makeFile('french.html', complexText)])
    const issues = await scanner.scan(ctx)
    expect(issues.length).toBe(0)
  })

  it('skips JSX/TSX files (regex extraction is too noisy for readability)', async () => {
    const jsxContent = `
      import React from 'react';
      export function MyComplexComponent() {
        const someLogic = true;
        return (
          <div className="container">
            <h1>The complexity of metaphysical philosophy</h1>
            <p>
              In contemporary epistemological discourse, the fundamental dichotomies 
              pertaining to existential phenomenological paradigms are frequently scrutinized.
              In contemporary epistemological discourse, the fundamental dichotomies 
              pertaining to existential phenomenological paradigms are frequently scrutinized.
              In contemporary epistemological discourse, the fundamental dichotomies 
              pertaining to existential phenomenological paradigms are frequently scrutinized.
            </p>
          </div>
        )
      }
    `
    const ctx = makeContext([makeFile('Component.jsx', jsxContent, 'jsx')])
    const issues = await scanner.scan(ctx)

    // JSX files are skipped — regex extraction captures className and {expressions}
    expect(issues.length).toBe(0)
  })
})
