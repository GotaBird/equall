import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { shouldUseColor } from '../output/color.js'
import { printResult } from '../output/terminal.js'
import { runScan } from '../scan.js'

const ESC = '\x1b['

describe('shouldUseColor', () => {
  it('--no-color always wins', () => {
    expect(shouldUseColor({ flag: false, env: { FORCE_COLOR: '1' }, isTTY: true })).toBe(false)
  })

  it('NO_COLOR (any non-empty value) turns color off, even on a terminal', () => {
    expect(shouldUseColor({ env: { NO_COLOR: '1' }, isTTY: true })).toBe(false)
    expect(shouldUseColor({ env: { NO_COLOR: 'true', FORCE_COLOR: '1' }, isTTY: true })).toBe(false)
  })

  it('an empty NO_COLOR is ignored (no-color.org)', () => {
    expect(shouldUseColor({ env: { NO_COLOR: '' }, isTTY: true })).toBe(true)
  })

  it('FORCE_COLOR turns color on when output is not a terminal; FORCE_COLOR=0 does not', () => {
    expect(shouldUseColor({ env: { FORCE_COLOR: '1' }, isTTY: false })).toBe(true)
    expect(shouldUseColor({ env: { FORCE_COLOR: '' }, isTTY: false })).toBe(true)
    expect(shouldUseColor({ env: { FORCE_COLOR: '0' }, isTTY: false })).toBe(false)
  })

  it('otherwise follows the terminal: colored on a TTY, plain when piped or redirected', () => {
    expect(shouldUseColor({ env: {}, isTTY: true })).toBe(true)
    expect(shouldUseColor({ env: {}, isTTY: false })).toBe(false)
  })
})

describe('printResult with colors off', () => {
  it('emits no ANSI escape and keeps the severity shapes', async () => {
    const result = await runScan({ files: [{ path: 'index.html', content: '<!doctype html><html lang="en"><head><title>t</title></head><body><main><h1>H</h1><img src="a.png"></main></body></html>' }] })
    const lines: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { lines.push(a.join(' ')) })
    try {
      printResult(result, { color: false, all: true, verbose: true })
    } finally {
      spy.mockRestore()
    }
    const out = lines.join('\n')
    expect(out).toContain('WCAG 1.1.1')
    expect(out).not.toContain(ESC)
    // Severity is carried by shape as well as color, so it survives without color.
    expect(out).toMatch(/[■▲●○]/)
  })

  it('colors stay on by default for library callers', async () => {
    const result = await runScan({ files: [{ path: 'index.html', content: '<!doctype html><html lang="en"><body><img src="a.png"></body></html>' }] })
    const lines: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { lines.push(a.join(' ')) })
    try {
      printResult(result, { color: false })
      lines.length = 0
      printResult(result)
    } finally {
      spy.mockRestore()
    }
    expect(lines.join('\n')).toContain(ESC)
  })
})

// --- Integration: the real CLI, stdout piped (never a TTY here) ---
const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = join(__dirname, '..', 'cli.ts')
const TIMEOUT = 60_000

function runCli(args: string[], env: Record<string, string> = {}): string {
  const baseEnv = { ...process.env }
  delete baseEnv.NO_COLOR
  delete baseEnv.FORCE_COLOR
  try {
    return execFileSync('node', ['--import', 'tsx', CLI, ...args], { stdio: 'pipe', env: { ...baseEnv, ...env } }).toString()
  } catch (err) {
    return (err as { stdout?: Buffer }).stdout?.toString() ?? ''
  }
}

describe('CLI color resolution (integration)', () => {
  let dir: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'equall-color-'))
    writeFileSync(join(dir, 'index.html'), '<!doctype html><html lang="en"><body><img src="x.png"></body></html>\n')
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('piped output is plain text', () => {
    const out = runCli(['scan', dir])
    expect(out).toContain('WCAG')
    expect(out).not.toContain(ESC)
  }, TIMEOUT)

  it('--no-color is plain text even with FORCE_COLOR', () => {
    expect(runCli(['scan', dir, '--no-color'], { FORCE_COLOR: '1' })).not.toContain(ESC)
  }, TIMEOUT)

  it('FORCE_COLOR keeps colors when piped', () => {
    expect(runCli(['scan', dir], { FORCE_COLOR: '1' })).toContain(ESC)
  }, TIMEOUT)

  it('NO_COLOR wins over FORCE_COLOR', () => {
    expect(runCli(['scan', dir], { NO_COLOR: '1', FORCE_COLOR: '1' })).not.toContain(ESC)
  }, TIMEOUT)
})
