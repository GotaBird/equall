import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { scanBuffer } from './scan.js'
import { fileTypeForPath } from './discover.js'
import type { EquallIssue, WcagLevel } from './types.js'

const execFileAsync = promisify(execFile)

// File types the engine can statically assess. A changed file outside this set is
// reported as "not-testable" — honest coverage, never silently dropped.
const SCANNABLE = new Set(['html', 'jsx', 'tsx', 'vue', 'svelte', 'astro'])

export interface DiffScanOptions {
  base: string                 // Git ref to diff against (UNTRUSTED → validated)
  head?: string                // Git ref for the new state (default 'HEAD')
  cwd?: string                 // Repo root (default process.cwd())
  level?: WcagLevel            // WCAG target, forwarded to scanBuffer (default 'AA')
}

// Diff-aware result: only the new violations are surfaced. `legacy` is surfaced for honesty (it
// pre-existed the diff, so the agent is not asked to fix it). `not_testable` lists
// changed files we could not statically assess — never claim "clean" on blind spots.
export interface DiffScanResult {
  base: string                 // Resolved base commit SHA
  head: string                 // Resolved head commit SHA
  merge_base: string           // merge-base(base, head) — the three-dot anchor
  new_issues: EquallIssue[]    // Violations the diff introduced (fingerprint absent at base)
  legacy_issues: EquallIssue[] // Violations present in changed files but already at base
  not_testable: string[]       // Changed files outside the scannable set
  summary: {
    files_changed: number
    files_scanned: number
    new_count: number
    legacy_count: number
    not_testable_count: number
  }
}

// Reject refs that could inject git options or carry control characters. We never
// build a shell string (execFile + arg arrays), so the only real vectors are a
// leading '-' (parsed as an option) and control bytes. Existence is verified
// separately via rev-parse, so anything bogus fails there with a clear error.
function assertSafeRef(ref: string): void {
  if (typeof ref !== 'string' || ref.length === 0 || ref.length > 256) {
    throw new Error(`Invalid git ref: ${JSON.stringify(ref)}`)
  }
  if (ref.startsWith('-')) {
    throw new Error(`Invalid git ref (leading dash): ${JSON.stringify(ref)}`)
  }
  if (/[\x00-\x1f\x7f]/.test(ref)) {
    throw new Error(`Invalid git ref (control character): ${JSON.stringify(ref)}`)
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  })
  return stdout
}

// Resolve a ref to a commit SHA, validating it exists. Throws on anything unsafe
// or unknown — the base ref is untrusted input.
async function resolveCommit(cwd: string, ref: string): Promise<string> {
  assertSafeRef(ref)
  try {
    const out = await git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
    const sha = out.trim()
    if (!sha) throw new Error('empty')
    return sha
  } catch {
    throw new Error(`Cannot resolve git ref: ${ref}`)
  }
}

interface ChangedFile {
  status: string               // 'A' | 'M' | 'D' | 'T' | ...
  path: string
}

// List files changed between two commits (rename detection off, so a move is a
// delete + add — moved code is intentionally treated as "new", not tracked).
async function changedFiles(cwd: string, fromSha: string, toSha: string): Promise<ChangedFile[]> {
  const out = await git(cwd, ['diff', '--name-status', '--no-renames', '-z', fromSha, toSha])
  const tokens = out.split('\0').filter((t) => t.length > 0)
  const files: ChangedFile[] = []
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    files.push({ status: tokens[i], path: tokens[i + 1] })
  }
  return files
}

// Read a file's content at a given commit. Returns null if it does not exist there
// (a newly added file has no base version → all its violations are new).
async function showFile(cwd: string, sha: string, path: string): Promise<string | null> {
  try {
    return await git(cwd, ['show', `${sha}:${path}`])
  } catch {
    return null
  }
}

const activeFingerprints = (issues: EquallIssue[]): Set<string> =>
  new Set(issues.filter((i) => !i.ignored && i.fingerprint).map((i) => i.fingerprint as string))

// Diff-aware "only-new" scan (T1.2): scan each changed scannable file at HEAD and at
// the merge-base, then classify each HEAD violation by whether its fingerprint already
// existed at base. Identity is the T0.4 fingerprint (never the line), so a pure
// reformat keeps the same identity and produces zero false "new".
export async function runDiffScan(options: DiffScanOptions): Promise<DiffScanResult> {
  const cwd = options.cwd ?? process.cwd()
  const level = options.level ?? 'AA'

  const baseSha = await resolveCommit(cwd, options.base)
  const headSha = await resolveCommit(cwd, options.head ?? 'HEAD')
  const mergeBase = (await git(cwd, ['merge-base', baseSha, headSha])).trim()

  const changed = await changedFiles(cwd, mergeBase, headSha)

  const newIssues: EquallIssue[] = []
  const legacyIssues: EquallIssue[] = []
  const notTestable: string[] = []
  let filesScanned = 0

  // Sequential on purpose: scanBuffer drives axe-core, whose global console.error
  // patch races under parallel scans (same constraint as the worker).
  for (const file of changed) {
    if (file.status === 'D') continue // gone at HEAD — nothing to assess

    if (!SCANNABLE.has(fileTypeForPath(file.path))) {
      notTestable.push(file.path)
      continue
    }

    const headContent = await showFile(cwd, headSha, file.path)
    if (headContent == null) {
      // Present in the name-status diff but unreadable at HEAD (e.g. submodule) — be honest.
      notTestable.push(file.path)
      continue
    }

    const headIssues = (await scanBuffer(headContent, file.path, { level })).issues.filter((i) => !i.ignored)

    // Whole-file scope: the base version of the SAME path is the reference set.
    const baseContent = file.status === 'A' ? null : await showFile(cwd, mergeBase, file.path)
    const baseFps = baseContent == null
      ? new Set<string>()
      : activeFingerprints((await scanBuffer(baseContent, file.path, { level })).issues)

    for (const issue of headIssues) {
      if (issue.fingerprint && baseFps.has(issue.fingerprint)) {
        legacyIssues.push(issue)
      } else {
        newIssues.push(issue)
      }
    }
    filesScanned++
  }

  return {
    base: baseSha,
    head: headSha,
    merge_base: mergeBase,
    new_issues: newIssues,
    legacy_issues: legacyIssues,
    not_testable: notTestable,
    summary: {
      files_changed: changed.length,
      files_scanned: filesScanned,
      new_count: newIssues.length,
      legacy_count: legacyIssues.length,
      not_testable_count: notTestable.length,
    },
  }
}

// Always-formulated diff guardrail (T1.3): a single line that never claims "clean/done",
// even at zero new — it always names the legacy debt, the untested files, and the next step.
export function formatDiffGuardrail(result: DiffScanResult): string {
  const { new_count, legacy_count, not_testable_count } = result.summary
  return `${new_count} new · ${legacy_count} legacy · ${not_testable_count} not statically testable → run the rendered check`
}
