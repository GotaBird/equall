import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, openSync, closeSync } from 'node:fs'
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

// Same, keeping the output streams (to assert on error messages).
function runCliFull(args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('node', ['--import', 'tsx', CLI, ...args], { stdio: 'pipe', encoding: 'utf8' })
    return { status: 0, stdout, stderr: '' }
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    return { status: e.status ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
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

  it('--json-out writes the full report to a file, identical to --json, with the exit code unchanged', () => {
    const out = join(dir, 'report.json')
    // stdout goes to a file, not a pipe: a 20 KB JSON report through a pipe is cut at the
    // first chunk when the child exits (asynchronous pipe writes on macOS), which is a
    // test-harness artefact, not what the comparison is about.
    const printed = join(dir, 'printed.json')
    const fd = openSync(printed, 'w')
    try {
      execFileSync('node', ['--import', 'tsx', CLI, 'scan', join(dir, 'site'), '--json', '--json-out', out], { stdio: ['ignore', fd, 'pipe'] })
    } finally {
      closeSync(fd)
    }
    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(JSON.parse(readFileSync(printed, 'utf8')))
    // Without --json the terminal output stays, the file is still written and the gate still applies.
    rmSync(out, { force: true }) // a stale file from the run above must not make this pass
    const plain = runCliFull(['scan', join(dir, 'site'), '--json-out', out, '--min-score', '100'])
    expect(plain.status).toBe(1)
    expect(plain.stdout).toContain('Automated verdicts only')
    expect(JSON.parse(readFileSync(out, 'utf8')).issues.length).toBeGreaterThan(0)
  }, TIMEOUT * 2)

  it('--json-out rejects an empty path and a missing folder before scanning', () => {
    // An unset CI input gives `--json-out ""`: that must not pass as a check with no file.
    const empty = runCliFull(['scan', join(dir, 'site'), '--json-out', ''])
    expect(empty.status).toBe(2)
    expect(empty.stderr).toMatch(/--json-out expects a file path/)
    const missing = runCliFull(['scan', join(dir, 'site'), '--json-out', join(dir, 'no-such-dir', 'r.json')])
    expect(missing.status).toBe(2)
    expect(missing.stderr).toMatch(/folder not found/)
  }, TIMEOUT * 2)

  it('exits 2 and names the missing path, with or without --diff or --json', () => {
    // A typo in a CI path must fail, not pass on "No scannable files found". The message is
    // asserted too: with --diff a missing path used to exit 2 on a misleading git-ref error.
    const missing = join(dir, 'no-such-dir')
    for (const extra of [[], ['--diff', 'main'], ['--json']]) {
      const run = runCliFull(['scan', missing, ...extra])
      expect(run.status).toBe(2)
      expect(run.stderr).toContain('path not found')
      expect(run.stdout).toBe('')
    }
  }, TIMEOUT)

  it('exits 2 and says so when the path is a file, not a directory', () => {
    const run = runCliFull(['scan', join(dir, 'site', 'index.html')])
    expect(run.status).toBe(2)
    expect(run.stderr).toContain('not a directory')
  }, TIMEOUT)

  it('still exits 0 on an existing path with no scannable files', () => {
    mkdirSync(join(dir, 'empty'), { recursive: true })
    expect(runCli(['scan', join(dir, 'empty')])).toBe(0)
  }, TIMEOUT)
})
