import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeExitCode } from '../exit-code.js'

// --- Unit: the pure exit-code policy (asserting process.exit directly is impractical) ---
describe('computeExitCode', () => {
  it('exits 0 on a successful scan when no --min-score is given', () => {
    expect(computeExitCode({ score: 43 }, null)).toBe(0)
    expect(computeExitCode({ score: 0 }, null)).toBe(0)
  })

  it('exits 1 when the score is strictly below --min-score', () => {
    expect(computeExitCode({ score: 43 }, 90)).toBe(1)
    expect(computeExitCode({ score: 89 }, 90)).toBe(1)
  })

  it('exits 0 when the score is at or above --min-score', () => {
    expect(computeExitCode({ score: 90 }, 90)).toBe(0) // boundary: not below
    expect(computeExitCode({ score: 52 }, 50)).toBe(0)
    expect(computeExitCode({ score: 100 }, 100)).toBe(0)
  })
})

// --- Integration: spawn the real CLI and read its exit code ($?) ---
const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = join(__dirname, '..', 'cli.ts')

// Run the CLI through tsx (no build step needed) and return its exit code.
function runCli(args: string[]): number {
  try {
    execFileSync('node', ['--import', 'tsx', CLI, ...args], { stdio: 'pipe' })
    return 0
  } catch (err) {
    return (err as { status?: number }).status ?? -1
  }
}

describe('scan exit code (integration)', () => {
  let dir: string

  beforeAll(() => {
    // A fixture with guaranteed violations (img without alt, no landmarks) → score < 100
    dir = mkdtempSync(join(tmpdir(), 'equall-exit-'))
    mkdirSync(join(dir, 'site'), { recursive: true })
    writeFileSync(
      join(dir, 'site', 'index.html'),
      '<!doctype html><html lang="en"><body><img src="x.png"><a href="#"></a></body></html>\n'
    )
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  // Each case spawns a real subprocess scan (tsx startup + axe/jsdom), which can
  // exceed vitest's 5s default under parallel load — give them generous headroom.
  const TIMEOUT = 30000

  it('a successful scan exits 0 with no gate', () => {
    expect(runCli(['scan', join(dir, 'site')])).toBe(0)
  }, TIMEOUT)

  it('exits 1 when the score is below --min-score', () => {
    // The fixture has real violations, so its score is < 100.
    expect(runCli(['scan', join(dir, 'site'), '--min-score', '100'])).toBe(1)
  }, TIMEOUT)

  it('exits 0 when the score clears --min-score', () => {
    expect(runCli(['scan', join(dir, 'site'), '--min-score', '0'])).toBe(0)
  }, TIMEOUT)

  it('exits 1 on an invalid --min-score', () => {
    expect(runCli(['scan', join(dir, 'site'), '--min-score', '999'])).toBe(1)
  }, TIMEOUT)
})
