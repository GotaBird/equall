// WCAG 2.2 Success Criteria catalog
// Source: https://www.w3.org/TR/WCAG22/
// 4.1.1 Parsing is obsolete in WCAG 2.2 and excluded.

import type { WcagLevel, PourPrinciple } from './types.js'

export interface WcagCriterion {
  id: string
  name: string
  level: WcagLevel
  pour: PourPrinciple
}

// prettier-ignore
export const WCAG_CATALOG: WcagCriterion[] = [
  // Principle 1 — Perceivable
  { id: '1.1.1', name: 'Non-text Content',                          level: 'A',   pour: 'perceivable' },
  { id: '1.2.1', name: 'Audio-only and Video-only (Prerecorded)',   level: 'A',   pour: 'perceivable' },
  { id: '1.2.2', name: 'Captions (Prerecorded)',                    level: 'A',   pour: 'perceivable' },
  { id: '1.2.3', name: 'Audio Description or Media Alternative',    level: 'A',   pour: 'perceivable' },
  { id: '1.2.4', name: 'Captions (Live)',                           level: 'AA',  pour: 'perceivable' },
  { id: '1.2.5', name: 'Audio Description (Prerecorded)',           level: 'AA',  pour: 'perceivable' },
  { id: '1.2.6', name: 'Sign Language (Prerecorded)',               level: 'AAA', pour: 'perceivable' },
  { id: '1.2.7', name: 'Extended Audio Description (Prerecorded)',  level: 'AAA', pour: 'perceivable' },
  { id: '1.2.8', name: 'Media Alternative (Prerecorded)',           level: 'AAA', pour: 'perceivable' },
  { id: '1.2.9', name: 'Audio-only (Live)',                         level: 'AAA', pour: 'perceivable' },
  { id: '1.3.1', name: 'Info and Relationships',                    level: 'A',   pour: 'perceivable' },
  { id: '1.3.2', name: 'Meaningful Sequence',                       level: 'A',   pour: 'perceivable' },
  { id: '1.3.3', name: 'Sensory Characteristics',                   level: 'A',   pour: 'perceivable' },
  { id: '1.3.4', name: 'Orientation',                               level: 'AA',  pour: 'perceivable' },
  { id: '1.3.5', name: 'Identify Input Purpose',                    level: 'AA',  pour: 'perceivable' },
  { id: '1.3.6', name: 'Identify Purpose',                          level: 'AAA', pour: 'perceivable' },
  { id: '1.4.1', name: 'Use of Color',                              level: 'A',   pour: 'perceivable' },
  { id: '1.4.2', name: 'Audio Control',                             level: 'A',   pour: 'perceivable' },
  { id: '1.4.3', name: 'Contrast (Minimum)',                        level: 'AA',  pour: 'perceivable' },
  { id: '1.4.4', name: 'Resize Text',                               level: 'AA',  pour: 'perceivable' },
  { id: '1.4.5', name: 'Images of Text',                            level: 'AA',  pour: 'perceivable' },
  { id: '1.4.6', name: 'Contrast (Enhanced)',                       level: 'AAA', pour: 'perceivable' },
  { id: '1.4.7', name: 'Low or No Background Audio',                level: 'AAA', pour: 'perceivable' },
  { id: '1.4.8', name: 'Visual Presentation',                       level: 'AAA', pour: 'perceivable' },
  { id: '1.4.9', name: 'Images of Text (No Exception)',             level: 'AAA', pour: 'perceivable' },
  { id: '1.4.10', name: 'Reflow',                                   level: 'AA',  pour: 'perceivable' },
  { id: '1.4.11', name: 'Non-text Contrast',                        level: 'AA',  pour: 'perceivable' },
  { id: '1.4.12', name: 'Text Spacing',                             level: 'AA',  pour: 'perceivable' },
  { id: '1.4.13', name: 'Content on Hover or Focus',                level: 'AA',  pour: 'perceivable' },

  // Principle 2 — Operable
  { id: '2.1.1', name: 'Keyboard',                                  level: 'A',   pour: 'operable' },
  { id: '2.1.2', name: 'No Keyboard Trap',                          level: 'A',   pour: 'operable' },
  { id: '2.1.3', name: 'Keyboard (No Exception)',                   level: 'AAA', pour: 'operable' },
  { id: '2.1.4', name: 'Character Key Shortcuts',                   level: 'A',   pour: 'operable' },
  { id: '2.2.1', name: 'Timing Adjustable',                         level: 'A',   pour: 'operable' },
  { id: '2.2.2', name: 'Pause, Stop, Hide',                         level: 'A',   pour: 'operable' },
  { id: '2.2.3', name: 'No Timing',                                 level: 'AAA', pour: 'operable' },
  { id: '2.2.4', name: 'Interruptions',                             level: 'AAA', pour: 'operable' },
  { id: '2.2.5', name: 'Re-authenticating',                         level: 'AAA', pour: 'operable' },
  { id: '2.2.6', name: 'Timeouts',                                  level: 'AAA', pour: 'operable' },
  { id: '2.3.1', name: 'Three Flashes or Below Threshold',          level: 'A',   pour: 'operable' },
  { id: '2.3.2', name: 'Three Flashes',                             level: 'AAA', pour: 'operable' },
  { id: '2.3.3', name: 'Animation from Interactions',               level: 'AAA', pour: 'operable' },
  { id: '2.4.1', name: 'Bypass Blocks',                             level: 'A',   pour: 'operable' },
  { id: '2.4.2', name: 'Page Titled',                               level: 'A',   pour: 'operable' },
  { id: '2.4.3', name: 'Focus Order',                               level: 'A',   pour: 'operable' },
  { id: '2.4.4', name: 'Link Purpose (In Context)',                 level: 'A',   pour: 'operable' },
  { id: '2.4.5', name: 'Multiple Ways',                             level: 'AA',  pour: 'operable' },
  { id: '2.4.6', name: 'Headings and Labels',                       level: 'AA',  pour: 'operable' },
  { id: '2.4.7', name: 'Focus Visible',                             level: 'AA',  pour: 'operable' },
  { id: '2.4.8', name: 'Location',                                  level: 'AAA', pour: 'operable' },
  { id: '2.4.9', name: 'Link Purpose (Link Only)',                  level: 'AAA', pour: 'operable' },
  { id: '2.4.10', name: 'Section Headings',                         level: 'AAA', pour: 'operable' },
  { id: '2.4.11', name: 'Focus Not Obscured (Minimum)',             level: 'AA',  pour: 'operable' },
  { id: '2.4.12', name: 'Focus Not Obscured (Enhanced)',            level: 'AAA', pour: 'operable' },
  { id: '2.4.13', name: 'Focus Appearance',                         level: 'AAA', pour: 'operable' },
  { id: '2.5.1', name: 'Pointer Gestures',                          level: 'A',   pour: 'operable' },
  { id: '2.5.2', name: 'Pointer Cancellation',                      level: 'A',   pour: 'operable' },
  { id: '2.5.3', name: 'Label in Name',                             level: 'A',   pour: 'operable' },
  { id: '2.5.4', name: 'Motion Actuation',                          level: 'A',   pour: 'operable' },
  { id: '2.5.5', name: 'Target Size (Enhanced)',                    level: 'AAA', pour: 'operable' },
  { id: '2.5.6', name: 'Concurrent Input Mechanisms',               level: 'A',   pour: 'operable' },
  { id: '2.5.7', name: 'Dragging Movements',                        level: 'AA',  pour: 'operable' },
  { id: '2.5.8', name: 'Target Size (Minimum)',                     level: 'AA',  pour: 'operable' },

  // Principle 3 — Understandable
  { id: '3.1.1', name: 'Language of Page',                          level: 'A',   pour: 'understandable' },
  { id: '3.1.2', name: 'Language of Parts',                         level: 'AA',  pour: 'understandable' },
  { id: '3.1.3', name: 'Unusual Words',                             level: 'AAA', pour: 'understandable' },
  { id: '3.1.4', name: 'Abbreviations',                             level: 'AAA', pour: 'understandable' },
  { id: '3.1.5', name: 'Reading Level',                             level: 'AAA', pour: 'understandable' },
  { id: '3.1.6', name: 'Pronunciation',                             level: 'AAA', pour: 'understandable' },
  { id: '3.2.1', name: 'On Focus',                                  level: 'A',   pour: 'understandable' },
  { id: '3.2.2', name: 'On Input',                                  level: 'A',   pour: 'understandable' },
  { id: '3.2.3', name: 'Consistent Navigation',                     level: 'AA',  pour: 'understandable' },
  { id: '3.2.4', name: 'Consistent Identification',                 level: 'AA',  pour: 'understandable' },
  { id: '3.2.5', name: 'Change on Request',                         level: 'AAA', pour: 'understandable' },
  { id: '3.2.6', name: 'Consistent Help',                           level: 'A',   pour: 'understandable' },
  { id: '3.3.1', name: 'Error Identification',                      level: 'A',   pour: 'understandable' },
  { id: '3.3.2', name: 'Labels or Instructions',                    level: 'A',   pour: 'understandable' },
  { id: '3.3.3', name: 'Error Suggestion',                          level: 'AA',  pour: 'understandable' },
  { id: '3.3.4', name: 'Error Prevention (Legal, Financial, Data)', level: 'AA',  pour: 'understandable' },
  { id: '3.3.5', name: 'Help',                                      level: 'AAA', pour: 'understandable' },
  { id: '3.3.6', name: 'Error Prevention (All)',                    level: 'AAA', pour: 'understandable' },
  { id: '3.3.7', name: 'Redundant Entry',                           level: 'A',   pour: 'understandable' },
  { id: '3.3.8', name: 'Accessible Authentication (Minimum)',       level: 'AA',  pour: 'understandable' },
  { id: '3.3.9', name: 'Accessible Authentication (Enhanced)',      level: 'AAA', pour: 'understandable' },

  // Principle 4 — Robust
  { id: '4.1.2', name: 'Name, Role, Value',                         level: 'A',   pour: 'robust' },
  { id: '4.1.3', name: 'Status Messages',                           level: 'AA',  pour: 'robust' },
]

const LEVEL_RANK: Record<WcagLevel, number> = { A: 1, AA: 2, AAA: 3 }

const catalogMap = new Map<string, WcagCriterion>()
for (const c of WCAG_CATALOG) catalogMap.set(c.id, c)

export function getCriterion(id: string): WcagCriterion | undefined {
  return catalogMap.get(id)
}

export function getCriteriaForLevel(level: WcagLevel): WcagCriterion[] {
  const maxRank = LEVEL_RANK[level]
  return WCAG_CATALOG.filter(c => LEVEL_RANK[c.level] <= maxRank)
}
