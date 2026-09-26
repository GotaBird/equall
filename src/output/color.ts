// ANSI color codes for terminal output (chalk-free, zero dependency).
//
// Exported as live bindings: `setColorEnabled(false)` blanks every code, and every module
// importing them sees the change — call sites keep writing `${GRAY}…${RESET}` unchanged.
// Colors are ON by default so library consumers of printResult keep today's output; the
// CLI decides with `shouldUseColor()` before rendering.

const CODES = {
  BOLD: '\x1b[1m',
  // Bright black (\x1b[90m) rather than the DIM attribute (\x1b[2m) —
  // DIM renders inconsistently and near-invisible on many terminals.
  GRAY: '\x1b[90m',
  RESET: '\x1b[0m',
  RED: '\x1b[31m',
  YELLOW: '\x1b[33m',
  GREEN: '\x1b[32m',
  CYAN: '\x1b[36m',
  WHITE: '\x1b[37m',
  BG_RED: '\x1b[41m',
  BG_YELLOW: '\x1b[43m',
  BG_GREEN: '\x1b[42m',
} as const

export let BOLD: string = CODES.BOLD
export let GRAY: string = CODES.GRAY
export let RESET: string = CODES.RESET
export let RED: string = CODES.RED
export let YELLOW: string = CODES.YELLOW
export let GREEN: string = CODES.GREEN
export let CYAN: string = CODES.CYAN
export let WHITE: string = CODES.WHITE
export let BG_RED: string = CODES.BG_RED
export let BG_YELLOW: string = CODES.BG_YELLOW
export let BG_GREEN: string = CODES.BG_GREEN

export function setColorEnabled(enabled: boolean): void {
  const c = (code: string) => (enabled ? code : '')
  BOLD = c(CODES.BOLD)
  GRAY = c(CODES.GRAY)
  RESET = c(CODES.RESET)
  RED = c(CODES.RED)
  YELLOW = c(CODES.YELLOW)
  GREEN = c(CODES.GREEN)
  CYAN = c(CODES.CYAN)
  WHITE = c(CODES.WHITE)
  BG_RED = c(CODES.BG_RED)
  BG_YELLOW = c(CODES.BG_YELLOW)
  BG_GREEN = c(CODES.BG_GREEN)
}

// Whether the CLI should color its output, in precedence order:
//   --no-color → off · NO_COLOR (any non-empty value, no-color.org) → off ·
//   FORCE_COLOR (any value but "0") → on · otherwise on only when stdout is a terminal,
//   so `equall scan . --all > report.txt` and CI logs get plain text.
export function shouldUseColor(opts: { flag?: boolean; env?: NodeJS.ProcessEnv; isTTY?: boolean } = {}): boolean {
  const env = opts.env ?? process.env
  if (opts.flag === false) return false
  if (env.NO_COLOR) return false
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '0') return true
  return opts.isTTY ?? Boolean(process.stdout.isTTY)
}
