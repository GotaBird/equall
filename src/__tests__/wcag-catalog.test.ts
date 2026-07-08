import { describe, it, expect } from 'vitest'
import { getCriteriaForLevel, getCriteriaForStandardLevel, getCriterion } from '../wcag-catalog.js'

// BUR-161 — the catalog is the single source of truth for per-standard criteria totals.
// These counts match the real WCAG numbers (and caught the 2.5.6 mis-level bug).
describe('WCAG catalog — standard-aware criteria sets', () => {
  const count = (s: 'wcag22' | 'wcag21', l: 'A' | 'AA' | 'AAA') => getCriteriaForStandardLevel(s, l).length

  it('WCAG 2.2 (default view): A=31, A+AA=55, total=86', () => {
    expect(count('wcag22', 'A')).toBe(31)
    expect(count('wcag22', 'AA')).toBe(55)
    expect(count('wcag22', 'AAA')).toBe(86)
    expect(getCriteriaForLevel('AA').length).toBe(55) // the default helper == the wcag22 view
  })

  it('WCAG 2.1 (the legal bar): A=30, A+AA=50, total=78', () => {
    expect(count('wcag21', 'A')).toBe(30)
    expect(count('wcag21', 'AA')).toBe(50)
    expect(count('wcag21', 'AAA')).toBe(78)
  })

  it('2.5.6 Concurrent Input Mechanisms is Level AAA (was mis-catalogued as A)', () => {
    expect(getCriterion('2.5.6')?.level).toBe('AAA')
  })

  it('4.1.1 Parsing exists but only in the 2.1 view (removed/obsolete in 2.2)', () => {
    expect(getCriterion('4.1.1')).toBeDefined()
    expect(getCriteriaForStandardLevel('wcag21', 'AA').some((c) => c.id === '4.1.1')).toBe(true)
    expect(getCriteriaForStandardLevel('wcag22', 'AA').some((c) => c.id === '4.1.1')).toBe(false)
    expect(getCriteriaForLevel('AAA').some((c) => c.id === '4.1.1')).toBe(false)
  })

  it('the 9 new-in-2.2 criteria are excluded from the 2.1 view', () => {
    const new22 = ['2.4.11', '2.4.12', '2.4.13', '2.5.7', '2.5.8', '3.2.6', '3.3.7', '3.3.8', '3.3.9']
    const set21 = new Set(getCriteriaForStandardLevel('wcag21', 'AAA').map((c) => c.id))
    for (const id of new22) expect(set21.has(id)).toBe(false)
  })
})
