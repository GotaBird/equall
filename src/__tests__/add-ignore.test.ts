import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { addIgnore, addIgnoreFile, checkLineIgnore, lineIgnoreCoverage } from '../ignores.js'
import type { EquallIssue } from '../types.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'equall-test-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

async function writeFixture(relativePath: string, content: string) {
  const dir = join(tempDir, relativePath, '..')
  await mkdir(dir, { recursive: true })
  await writeFile(join(tempDir, relativePath), content, 'utf-8')
}

// ---------------------------------------------------------------------------
// addIgnore
// ---------------------------------------------------------------------------
describe('addIgnore', () => {
  it('adds JS comment above target line in tsx file', async () => {
    await writeFixture('comp.tsx', 'line 1\nline 2\nline 3')

    const result = await addIgnore(tempDir, 'comp.tsx:2')
    expect(result).not.toBeNull()
    expect(result!.line).toBe(2)

    const content = await readFile(join(tempDir, 'comp.tsx'), 'utf-8')
    const lines = content.split('\n')
    expect(lines[1]).toContain('equall-ignore-next-line')
    expect(lines[2]).toBe('line 2')
  })

  it('adds comment with specific rule-id', async () => {
    await writeFixture('comp.tsx', 'line 1\n<img />')

    await addIgnore(tempDir, 'comp.tsx:2', 'jsx-a11y/alt-text')

    const content = await readFile(join(tempDir, 'comp.tsx'), 'utf-8')
    expect(content).toContain('equall-ignore-next-line jsx-a11y/alt-text')
  })

  it('uses JSX comment syntax when line starts with <', async () => {
    await writeFixture('comp.tsx', '<div>\n  <img />\n</div>')

    await addIgnore(tempDir, 'comp.tsx:2')

    const content = await readFile(join(tempDir, 'comp.tsx'), 'utf-8')
    expect(content).toContain('{/* equall-ignore-next-line */}')
  })

  it('uses HTML comment syntax for .html files', async () => {
    await writeFixture('page.html', '<div>\n<img />\n</div>')

    await addIgnore(tempDir, 'page.html:2')

    const content = await readFile(join(tempDir, 'page.html'), 'utf-8')
    expect(content).toContain('<!-- equall-ignore-next-line -->')
  })

  it('preserves indentation of target line', async () => {
    await writeFixture('comp.tsx', '<div>\n    <img />\n</div>')

    await addIgnore(tempDir, 'comp.tsx:2')

    const content = await readFile(join(tempDir, 'comp.tsx'), 'utf-8')
    const lines = content.split('\n')
    expect(lines[1]).toMatch(/^    /)
  })

  it('returns null for non-existent file', async () => {
    const result = await addIgnore(tempDir, 'nope.tsx:1')
    expect(result).toBeNull()
  })

  it('returns null for line beyond file length', async () => {
    await writeFixture('short.tsx', 'line 1')

    const result = await addIgnore(tempDir, 'short.tsx:99')
    expect(result).toBeNull()
  })

  it('returns null for target without line number', async () => {
    const result = await addIgnore(tempDir, 'comp.tsx')
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// addIgnoreFile
// ---------------------------------------------------------------------------
describe('addIgnoreFile', () => {
  it('adds equall-ignore-file at top of file', async () => {
    await writeFixture('comp.tsx', '<div>hello</div>')

    const result = await addIgnoreFile(tempDir, 'comp.tsx')
    expect(result).not.toBeNull()
    expect(result!.comment).toBe('// equall-ignore-file')

    const content = await readFile(join(tempDir, 'comp.tsx'), 'utf-8')
    expect(content.startsWith('// equall-ignore-file\n')).toBe(true)
  })

  it('uses HTML comment for .html files', async () => {
    await writeFixture('page.html', '<div>hello</div>')

    const result = await addIgnoreFile(tempDir, 'page.html')
    expect(result!.comment).toBe('<!-- equall-ignore-file -->')
  })

  it('returns null if file already has equall-ignore-file', async () => {
    await writeFixture('comp.tsx', '// equall-ignore-file\n<div />')

    const result = await addIgnoreFile(tempDir, 'comp.tsx')
    expect(result).toBeNull()
  })

  it('returns null for non-existent file', async () => {
    const result = await addIgnoreFile(tempDir, 'nope.tsx')
    expect(result).toBeNull()
  })

  it('preserves original content after the comment', async () => {
    await writeFixture('comp.tsx', 'const x = 1\nconst y = 2')

    await addIgnoreFile(tempDir, 'comp.tsx')

    const content = await readFile(join(tempDir, 'comp.tsx'), 'utf-8')
    expect(content).toBe('// equall-ignore-file\nconst x = 1\nconst y = 2')
  })
})

// ---------------------------------------------------------------------------
// Line-level ignores and axe-core findings
// ---------------------------------------------------------------------------
describe('line ignores on axe-core findings', () => {
  const finding = (scanner: string, rule: string, line: number): EquallIssue => ({
    scanner, scanner_rule_id: rule, wcag_criteria: ['1.1.1'], wcag_level: 'A', pour: 'perceivable',
    file_path: 'page.html', line, column: 1, html_snippet: null, severity: 'critical',
    message: 'm', help_url: null, suggestion: null,
  })

  it('reports which findings at the line a comment would and would not cover', () => {
    const issues = [finding('axe-core', 'image-alt', 2), finding('eslint-jsx-a11y', 'jsx-a11y/alt-text', 2), finding('axe-core', 'label', 3)]
    expect(lineIgnoreCoverage(issues, 'page.html', 2)).toEqual({ axeRules: ['image-alt'], otherCount: 1 })
    expect(lineIgnoreCoverage(issues, 'page.html', 3)).toEqual({ axeRules: ['label'], otherCount: 0 })
    expect(lineIgnoreCoverage(issues, 'page.html', 2, 'image-alt')).toEqual({ axeRules: ['image-alt'], otherCount: 0 })
    expect(lineIgnoreCoverage(issues, 'page.html', 9)).toEqual({ axeRules: [], otherCount: 0 })
  })

  it('finds the axe-core finding on a real file', async () => {
    await writeFixture('page.html', '<main>\n<img src="a.png">\n</main>\n')
    expect(await checkLineIgnore(tempDir, 'page.html:2')).toEqual({ axeRules: ['image-alt'], otherCount: 0 })
    expect(await checkLineIgnore(tempDir, 'missing.html:2')).toBeNull()
  })

  it('the CLI refuses with exit 1 and leaves the file untouched when only axe-core findings are on the line', async () => {
    const content = '<main>\n<img src="a.png">\n</main>\n'
    await writeFixture('page.html', content)
    const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli.ts')
    let status = 0
    let stderr = ''
    try {
      execFileSync('node', ['--import', 'tsx', cli, 'ignore', 'page.html:2', '-p', tempDir], { stdio: 'pipe', encoding: 'utf8' })
    } catch (err) {
      const e = err as { status?: number; stderr?: string }
      status = e.status ?? -1
      stderr = e.stderr ?? ''
    }
    expect(status).toBe(1)
    expect(stderr).toContain('do not apply to axe-core findings')
    expect(stderr).toContain('equall ignore page.html')
    expect(await readFile(join(tempDir, 'page.html'), 'utf-8')).toBe(content)
  }, 60_000)
})
