import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { resolveBaseRef, computeDiffExitCode, formatAnnotations, gatingIssues, formatStepSummary } from '../ci/diff-gate.js'
import { runDiffScan } from '../diff-scan.js'
import type { DiffScanResult } from '../diff-scan.js'
import type { EquallIssue, Severity } from '../types.js'

// The CI gate fails a pull request only on violations the change introduces, at or above a
// severity, and points at them with GitHub annotations. Legacy debt never fails the check.

const issue = (over: Partial<EquallIssue> = {}): EquallIssue => ({
  scanner: 'axe-core',
  scanner_rule_id: 'image-alt',
  wcag_criteria: ['1.1.1'],
  wcag_level: 'A',
  pour: 'perceivable',
  file_path: 'src/Nav.tsx',
  line: 12,
  column: 5,
  html_snippet: '<img src="a.png">',
  severity: 'critical',
  message: 'Images must have alternative text',
  help_url: '',
  suggestion: '',
  ...over,
} as EquallIssue)

const result = (over: Partial<DiffScanResult> = {}): DiffScanResult => ({
  base: 'b', head: 'h', merge_base: 'm',
  new_issues: [], new_review_only: [], new_advisory: [], legacy_issues: [], not_testable: [], excluded: [], unchecked: [],
  summary: { files_changed: 0, files_scanned: 0, new_count: 0, new_review_only_count: 0, new_advisory_count: 0, legacy_count: 0, not_testable_count: 0, excluded_count: 0, unchecked_count: 0 },
  ...over,
})

describe('base ref', () => {
  it('uses an explicit ref as given', () => {
    expect(resolveBaseRef('origin/develop', {})).toBe('origin/develop')
  })
  it('reads the pull request target branch on GitHub Actions, GitLab CI and Azure Pipelines', () => {
    expect(resolveBaseRef(true, { GITHUB_BASE_REF: 'main' })).toBe('origin/main')
    expect(resolveBaseRef(true, { CI_MERGE_REQUEST_TARGET_BRANCH_NAME: 'dev' })).toBe('origin/dev')
    expect(resolveBaseRef(true, { SYSTEM_PULLREQUEST_TARGETBRANCH: 'refs/heads/release' })).toBe('origin/release')
  })
  it('prefers the merge-base commit GitLab computes, which is in the clone when the target branch is not', () => {
    expect(resolveBaseRef(true, { CI_MERGE_REQUEST_DIFF_BASE_SHA: 'abc123', CI_MERGE_REQUEST_TARGET_BRANCH_NAME: 'main' })).toBe('abc123')
  })
  it('refuses to guess outside a pull request', () => {
    expect(() => resolveBaseRef(true, {})).toThrow(/No base to compare against/)
  })
})

describe('gate', () => {
  const at = (severity: Severity) => result({ new_issues: [issue({ severity })] })

  it('fails on a new violation at or above the threshold, passes below it', () => {
    expect(computeDiffExitCode(at('critical'), 'serious')).toBe(1)
    expect(computeDiffExitCode(at('serious'), 'serious')).toBe(1)
    expect(computeDiffExitCode(at('moderate'), 'serious')).toBe(0)
  })
  it('never fails on legacy debt, review-only or advisory findings', () => {
    const r = result({
      legacy_issues: [issue()],
      new_review_only: [issue({ review_only: true })],
      new_advisory: [issue({ wcag_criteria: [] })],
    })
    expect(computeDiffExitCode(r, 'minor')).toBe(0)
  })
  it('reports only when no threshold is set', () => {
    expect(computeDiffExitCode(at('critical'), null)).toBe(0)
    expect(gatingIssues(at('critical'), null)).toEqual([])
  })
})

describe('files a scanner could not check', () => {
  it('get a warning annotation and a line in the job summary, and never pass silently', () => {
    const r = result({ unchecked: [{ scanner: 'eslint-jsx-a11y', file_path: 'src/Broken.tsx', reason: 'parse_error' }] })
    expect(computeDiffExitCode(r, 'critical')).toBe(0)
    expect(formatAnnotations(r, 'critical')).toEqual([expect.stringMatching(/^::warning file=src\/Broken\.tsx,title=Equall · not checked::eslint-jsx-a11y could not analyse/)])
    expect(formatStepSummary(r, 'origin/main', 'critical')).toContain('`src/Broken.tsx`: eslint-jsx-a11y (parse_error)')
  })
})

describe('job summary', () => {
  it('lists every finding, blocking ones marked, with the verdict', () => {
    const many = Array.from({ length: 15 }, (_, n) => issue({ file_path: `src/C${n}.tsx` }))
    const text = formatStepSummary(result({ new_issues: many }), 'origin/main', 'critical')
    expect(text).toContain('**Check fails**: 15 new violation(s) at critical or above.')
    expect(text.match(/\| blocking \|/g)).toHaveLength(15)
  })
})

describe('GitHub annotations', () => {
  it('errors at the gate, warns below it, notices uncounted findings, ignores legacy', () => {
    const r = result({
      new_issues: [issue({ severity: 'critical' }), issue({ severity: 'moderate', scanner_rule_id: 'region' })],
      new_review_only: [issue({ review_only: true, review_reason: 'Name may come from props.' })],
      legacy_issues: [issue({ file_path: 'src/Old.tsx' })],
    })
    const lines = formatAnnotations(r, 'serious')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatch(/^::error file=src\/Nav\.tsx,line=12,col=5,title=/)
    expect(lines[1]).toMatch(/^::warning /)
    expect(lines[2]).toMatch(/^::notice .*Name may come from props\./)
    expect(lines.join('\n')).not.toContain('src/Old.tsx')
  })
  it('omits the line when the engine has none, and escapes workflow-command syntax', () => {
    const [line] = formatAnnotations(result({ new_issues: [issue({ line: null, file_path: 'a,b:c.html', message: '50% off\nnext' })] }), 'serious')
    expect(line).toContain('file=a%2Cb%3Ac.html,title=')
    expect(line).not.toContain('line=')
    expect(line).toContain('50%25 off%0Anext')
  })
})

// --- End to end: the real CLI on a real git repository ---
const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli.ts')

// Spawned from the package root (where tsx resolves); the repository is passed as the path.
function cli(args: string[], repo: string, env: NodeJS.ProcessEnv = {}) {
  const r = spawnSync('node', ['--import', 'tsx', CLI, ...args.map((a) => (a === '.' ? repo : a))], {
    encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1', GITHUB_ACTIONS: '', ...env },
  })
  return { code: r.status, out: r.stdout, err: r.stderr }
}

describe('scan --diff (integration)', () => {
  let dir: string
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
  const page = (body: string) =>
    `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><h1>Hi</h1>${body}</main></body></html>\n`

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'equall-ci-'))
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'test@equall.dev')
    git('config', 'user.name', 'Equall Test')
    git('config', 'commit.gpgsign', 'false')
    writeFileSync(join(dir, 'index.html'), page('<img src="old.png">'))
    git('add', '-A'); git('commit', '-q', '-m', 'base: legacy image without alt')
    git('switch', '-q', '-c', 'feature')
    writeFileSync(join(dir, 'index.html'), page('<img src="old.png"><a href="/next"></a>'))
    git('add', '-A'); git('commit', '-q', '-m', 'add an empty link (serious)')
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('fails on the violation the change introduced, and says the legacy one is not blocking', () => {
    const r = cli(['scan', '.', '--diff', 'main', '--fail-on', 'serious'], dir)
    expect(r.code).toBe(1)
    expect(r.out).toContain('Introduced by this change')
    expect(r.out).toContain('link-name')
    expect(r.out).toMatch(/1 finding\(s\) in the changed files already existed/)
  }, 60_000)

  it('passes when the threshold is above what the change introduced', () => {
    expect(cli(['scan', '.', '--diff', 'main', '--fail-on', 'critical'], dir).code).toBe(0)
  }, 60_000)

  it('emits annotations on GitHub Actions and reads the base from the pull request', () => {
    git('update-ref', 'refs/remotes/origin/main', 'main')
    const r = cli(['scan', '.', '--diff', '--fail-on', 'serious'], dir, { GITHUB_ACTIONS: 'true', GITHUB_BASE_REF: 'main' })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/^::error file=index\.html,title=Equall/m)
    expect(r.out).not.toMatch(/^::.*old\.png/m)
  }, 60_000)

  it('exits 2 when the check cannot run', () => {
    expect(cli(['scan', '.', '--fail-on', 'serious'], dir).code).toBe(2)
    expect(cli(['scan', '.', '--diff', 'main', '--fail-on', 'blocker'], dir).code).toBe(2)
    expect(cli(['scan', '.', '--diff', 'no-such-branch'], dir).code).toBe(2)
    expect(cli(['scan', '.', '--diff'], dir, { GITHUB_BASE_REF: '' }).code).toBe(2)
  }, 120_000)

  it('writes the job summary when GitHub provides the file', () => {
    const summary = join(dir, '..', `summary-${Date.now()}.md`)
    cli(['scan', '.', '--diff', 'main', '--fail-on', 'serious'], dir, { GITHUB_STEP_SUMMARY: summary })
    expect(readFileSync(summary, 'utf-8')).toMatch(/### Equall: changes since main[\s\S]*\| blocking \| serious \|/)
    rmSync(summary, { force: true })
  }, 60_000)

  it('writes the diff result as JSON with --json, without annotations', () => {
    const r = cli(['scan', '.', '--diff', 'main', '--json'], dir, { GITHUB_ACTIONS: 'true' })
    const json = JSON.parse(r.out)
    expect(json.summary.new_count).toBe(1)
    expect(r.out).not.toContain('::error')
  }, 60_000)

  it('--json-out writes the diff result to a file and keeps the gate, annotations and summary', () => {
    // The Action needs both: the annotations on the PR and the result for a later upload step.
    const out = join(dir, 'result.json')
    const summary = join(dir, '..', `summary-out-${Date.now()}.md`)
    const r = cli(['scan', '.', '--diff', 'main', '--fail-on', 'serious', '--json-out', out], dir, { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summary })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/^::error file=index\.html,title=Equall/m)
    expect(r.out).toContain('Introduced by this change')
    expect(readFileSync(summary, 'utf-8')).toMatch(/### Equall: changes since main/)
    const file = JSON.parse(readFileSync(out, 'utf-8'))
    expect(file.summary.new_count).toBe(1)
    expect(file.new_issues[0].scanner_rule_id).toBe('link-name')
    // The file is exactly what --json prints.
    const printed = cli(['scan', '.', '--diff', 'main', '--json'], dir).out
    expect(JSON.parse(printed)).toEqual(file)
    rmSync(summary, { force: true })
  }, 120_000)

  it('--json-out exits 2 when the file cannot be written', () => {
    const r = cli(['scan', '.', '--diff', 'main', '--json-out', join(dir, 'no-such-dir', 'r.json')], dir)
    expect(r.code).toBe(2)
    expect(r.err).toMatch(/could not write --json-out file/)
  }, 60_000)
})

describe('diff scan scope and blind spots', () => {
  let dir: string
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'equall-ci-scope-'))
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'test@equall.dev')
    git('config', 'user.name', 'Equall Test')
    git('config', 'commit.gpgsign', 'false')
    mkdirSync(join(dir, 'app')); mkdirSync(join(dir, 'other'))
    writeFileSync(join(dir, 'app', 'Ok.tsx'), 'export function Ok() { return (<main><h1>Hi</h1></main>) }\n')
    git('add', '-A'); git('commit', '-q', '-m', 'base')
    // A file jsx-a11y cannot parse, and a change outside the scanned directory.
    writeFileSync(join(dir, 'app', 'Broken.tsx'), 'export function Broken() {\n  return (\n    <div>\n      <img src="a.png">\n')
    writeFileSync(join(dir, 'other', 'page.html'), '<!doctype html><html lang="en"><head><title>t</title></head><body><main><img src="x.png"></main></body></html>\n')
    git('add', '-A'); git('commit', '-q', '-m', 'change')
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('lists a changed file a scanner could not check', async () => {
    const r = await runDiffScan({ base: 'HEAD~1', cwd: join(dir, 'app') })
    expect(r.unchecked).toContainEqual({ scanner: 'eslint-jsx-a11y', file_path: 'app/Broken.tsx', reason: 'parse_error' })
    expect(r.summary.unchecked_count).toBeGreaterThan(0)
  }, 60_000)

  it('only looks at changes under the scanned directory, with paths from the repository root', async () => {
    const r = await runDiffScan({ base: 'HEAD~1', cwd: join(dir, 'app') })
    const touched = [...r.new_issues, ...r.new_review_only, ...r.new_advisory].map((i) => i.file_path)
    expect(touched.every((p) => p.startsWith('app/'))).toBe(true)
    expect(r.summary.files_changed).toBe(1)
  }, 60_000)
})
