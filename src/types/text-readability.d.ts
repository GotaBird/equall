declare module 'text-readability' {
  export function fleschReadingEase(text: string): number
  export function fleschKincaidGrade(text: string): number
  export function gunningFog(text: string): number
  export function smogIndex(text: string): number
  export function automatedReadabilityIndex(text: string): number
  export function colemanLiauIndex(text: string): number
  export function linsearWriteFormula(text: string): number
  export function daleChallReadabilityScore(text: string): number
  export function textStandard(text: string, float_output?: boolean): number | string
  
  export function syllableCount(text: string, lang?: string): number
  export function lexiconCount(text: string, removePunctuation?: boolean): number
  export function sentenceCount(text: string): number
}
