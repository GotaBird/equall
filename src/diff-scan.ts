import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { scanBuffer, deduplicateIssues } from './scan.js'
import { fileTypeForPath, isDefaultExcluded } from './discover.js'
import { mergeCrossEngineDuplicates } from './rules/equivalence.js'
import { isBeyondTarget } from './scoring/score.js'
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
  // Counted WCAG violations the diff introduced, within the target level: the ones a gate
  // acts on. Review-only, best-practice and above-target findings have their own lists.
  new_issues: EquallIssue[]
  new_review_only: EquallIssue[] // Introduced, but static analysis can't confirm them (review_only)
  new_advisory: EquallIssue[]    // Introduced best-practice or above-target findings (never counted)
  legacy_issues: EquallIssue[] // Findings in changed files that already existed at base (any kind)
  not_testable: string[]       // Changed files outside the scannable set
  excluded: string[]           // Changed files skipped like a full scan skips them (tests, stories, builds)
  summary: {
    files_changed: number
    files_scanned: number
    new_count: number
    new_review_only_count: number
    new_advisory_count: number
    legacy_count: number
    not_testable_count: number
    excluded_count: number
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

// Split head occurrences into new / legacy by counting them per fingerprint. Set membership
// is not enough: a copy-pasted violation has the same fingerprint as the original, so the
// first N occurrences at head match the N at base and every extra one is new.
function classifyByCount(headIssues: EquallIssue[], baseIssues: EquallIssue[]): Set<EquallIssue> {
  const remaining = new Map<string, number>()
  for (const issue of baseIssues) {
    if (issue.fingerprint) remaining.set(issue.fingerprint, (remaining.get(issue.fingerprint) ?? 0) + 1)
  }
  const isNew = new Set<EquallIssue>()
  for (const issue of headIssues) {
    const left = issue.fingerprint ? remaining.get(issue.fingerprint) ?? 0 : 0
    if (left > 0) remaining.set(issue.fingerprint as string, left - 1)
    else isNew.add(issue)
  }
  return isNew
}

// Fold the classified occurrences the way a full scan does (cross-engine merge, then dedup),
// within the new and within the legacy findings separately. One added defect seen by two
// engines is reported once, even when the file already held copies of it (the merge only
// fires 1:1). Identical added copies fold into one new finding, as in a full scan.
function foldClassified(headIssues: EquallIssue[], isNew: Set<EquallIssue>): { newIssues: EquallIssue[]; legacyIssues: EquallIssue[] } {
  const fold = (issues: EquallIssue[]) => deduplicateIssues(mergeCrossEngineDuplicates(issues))
  return {
    newIssues: fold(headIssues.filter((i) => isNew.has(i))),
    legacyIssues: fold(headIssues.filter((i) => !isNew.has(i))),
  }
}

// Diff-aware "only-new" scan (T1.2): scan each changed scannable file at HEAD and at
// the merge-base, then classify each HEAD violation against the base occurrences of the
// same fingerprint. Identity is the fingerprint (never the line), so a pure reformat keeps
// the same identity and produces zero false "new".
export async function runDiffScan(options: DiffScanOptions): Promise<DiffScanResult> {
  const cwd = options.cwd ?? process.cwd()
  const level = options.level ?? 'AA'

  const baseSha = await resolveCommit(cwd, options.base)
  const headSha = await resolveCommit(cwd, options.head ?? 'HEAD')
  const mergeBase = (await git(cwd, ['merge-base', baseSha, headSha])).trim()

  const changed = await changedFiles(cwd, mergeBase, headSha)

  const newIssues: EquallIssue[] = []
  const newReviewOnly: EquallIssue[] = []
  const newAdvisory: EquallIssue[] = []
  const legacyIssues: EquallIssue[] = []
  const notTestable: string[] = []
  const excluded: string[] = []
  let filesScanned = 0

  // Compare occurrence by occurrence, then fold the classified head issues (foldClassified).
  const scanOptions = { level, keepOccurrences: true }
  const active = (issues: EquallIssue[]) => issues.filter((i) => !i.ignored)

  // Sequential on purpose: keeps memory flat and the output order stable.
  for (const file of changed) {
    if (file.status === 'D') continue // gone at HEAD — nothing to assess

    // Same default excludes as a full scan: a test or story file is not product code.
    if (isDefaultExcluded(file.path)) {
      excluded.push(file.path)
      continue
    }

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

    const headIssues = active((await scanBuffer(headContent, file.path, scanOptions)).issues)

    // Whole-file scope: the base version of the SAME path is the reference set.
    const baseContent = file.status === 'A' ? null : await showFile(cwd, mergeBase, file.path)
    const baseIssues = baseContent == null ? [] : active((await scanBuffer(baseContent, file.path, scanOptions)).issues)

    const classified = foldClassified(headIssues, classifyByCount(headIssues, baseIssues))
    legacyIssues.push(...classified.legacyIssues)
    for (const issue of classified.newIssues) {
      if (issue.review_only) newReviewOnly.push(issue)
      else if (issue.wcag_criteria.length === 0 || isBeyondTarget(issue, level)) newAdvisory.push(issue)
      else newIssues.push(issue)
    }
    filesScanned++
  }

  return {
    base: baseSha,
    head: headSha,
    merge_base: mergeBase,
    new_issues: newIssues,
    new_review_only: newReviewOnly,
    new_advisory: newAdvisory,
    legacy_issues: legacyIssues,
    not_testable: notTestable,
    excluded,
    summary: {
      files_changed: changed.length,
      files_scanned: filesScanned,
      new_count: newIssues.length,
      new_review_only_count: newReviewOnly.length,
      new_advisory_count: newAdvisory.length,
      legacy_count: legacyIssues.length,
      not_testable_count: notTestable.length,
      excluded_count: excluded.length,
    },
  }
}

// Always-formulated diff guardrail (T1.3): a single line that never claims "clean/done",
// even at zero new — it always names the legacy debt, the untested files, and the next step.
// Findings introduced but not counted (review-only, advisory) are named only when present.
export function formatDiffGuardrail(result: DiffScanResult): string {
  const { new_count, new_review_only_count = 0, new_advisory_count = 0, legacy_count, not_testable_count } = result.summary
  const uncounted = [
    new_review_only_count > 0 ? `${new_review_only_count} new to review` : '',
    new_advisory_count > 0 ? `${new_advisory_count} new advisory` : '',
  ].filter(Boolean)
  return [`${new_count} new`, ...uncounted, `${legacy_count} legacy`, `${not_testable_count} not statically testable`].join(' · ') + ' → run the rendered check'
}
