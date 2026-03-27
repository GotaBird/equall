import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { findIgnores, removeIgnore, clearAllIgnores } from '../ignores.js'

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
// findIgnores
// ---------------------------------------------------------------------------
describe('findIgnores', () => {
  it('detects JS-style equall-ignore-next-line', async () => {
    await writeFixture('app.tsx', [
      'const x = 1',
      '// equall-ignore-next-line',
      '<img src="a" />',
    ].join('\n'))

    const ignores = await findIgnores(tempDir)
    expect(ignores).toHaveLength(1)
    expect(ignores[0].type).toBe('next-line')
    expect(ignores[0].line).toBe(2)
    expect(ignores[0].rule_id).toBeNull()
  })

  it('detects HTML-style equall-ignore-next-line', async () => {
    await writeFixture('page.html', [
      '<div>',
      '<!-- equall-ignore-next-line -->',
      '<img />',
      '</div>',
    ].join('\n'))

    const ignores = await findIgnores(tempDir)
    expect(ignores).toHaveLength(1)
    expect(ignores[0].type).toBe('next-line')
  })

  it('detects JSX-style equall-ignore-next-line', async () => {
    await writeFixture('comp.jsx', [
      'return (',
      '  {/* equall-ignore-next-line */}',
      '  <img />',
      ')',
    ].join('\n'))

    const ignores = await findIgnores(tempDir)
    expect(ignores).toHaveLength(1)
  })

  it('detects equall-ignore-next-line with rule-id', async () => {
    await writeFixture('comp.tsx', [
      '// equall-ignore-next-line jsx-a11y/alt-text',
      '<img src="a" />',
    ].join('\n'))

    const ignores = await findIgnores(tempDir)
    expect(ignores).toHaveLength(1)
    expect(ignores[0].rule_id).toBe('jsx-a11y/alt-text')
  })

  it('detects equall-ignore-file in first 5 lines', async () => {
    await writeFixture('layout.tsx', [
      '// equall-ignore-file',
      'export default function Layout() {',
      '  return <div />',
      '}',
    ].join('\n'))

    const ignores = await findIgnores(tempDir)
    expect(ignores).toHaveLength(1)
    expect(ignores[0].type).toBe('file')
    expect(ignores[0].line).toBe(1)
  })

  it('ignores equall-ignore-file after line 5', async () => {
    await writeFixture('late.tsx', [
      'line 1',
      'line 2',
      'line 3',
      'line 4',
      'line 5',
      '// equall-ignore-file',
      '<img />',
    ].join('\n'))

    const ignores = await findIgnores(tempDir)
    expect(ignores).toHaveLength(0)
  })

  it('finds multiple ignores across files', async () => {
    await writeFixture('a.tsx', '// equall-ignore-next-line\n<img />')
    await writeFixture('b.tsx', '// equall-ignore-file\n<div />')
    await writeFixture('c.tsx', [
      '// equall-ignore-next-line rule-a',
      '<img />',
      '// equall-ignore-next-line rule-b',
      '<button />',
    ].join('\n'))

    const ignores = await findIgnores(tempDir)
    expect(ignores).toHaveLength(4)
  })

  it('returns empty for project with no ignores', async () => {
    await writeFixture('clean.tsx', '<div>hello</div>')

    const ignores = await findIgnores(tempDir)
    expect(ignores).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// removeIgnore
// ---------------------------------------------------------------------------
describe('removeIgnore', () => {
  it('removes ignore at specific file:line', async () => {
    await writeFixture('comp.tsx', [
      'const x = 1',
      '// equall-ignore-next-line',
      '<img src="a" />',
      'const y = 2',
    ].join('\n'))

    const { removed, notFound } = await removeIgnore(tempDir, 'comp.tsx:2')
    expect(notFound).toBe(false)
    expect(removed).toHaveLength(1)

    const content = await readFile(join(tempDir, 'comp.tsx'), 'utf-8')
    expect(content).not.toContain('equall-ignore')
    expect(content).toContain('const x = 1')
    expect(content).toContain('<img src="a" />')
    expect(content).toContain('const y = 2')
  })

  it('removes all ignores in a file when no line specified', async () => {
    await writeFixture('comp.tsx', [
      '// equall-ignore-next-line',
      '<img />',
      '// equall-ignore-next-line jsx-a11y/alt-text',
      '<img />',
    ].join('\n'))

    const { removed } = await removeIgnore(tempDir, 'comp.tsx')
    expect(removed).toHaveLength(2)

    const content = await readFile(join(tempDir, 'comp.tsx'), 'utf-8')
    expect(content).not.toContain('equall-ignore')
  })

  it('returns notFound for non-existent target', async () => {
    await writeFixture('clean.tsx', '<div />')

    const { removed, notFound } = await removeIgnore(tempDir, 'clean.tsx:1')
    expect(notFound).toBe(true)
    expect(removed).toHaveLength(0)
  })

  it('does not modify other lines', async () => {
    await writeFixture('comp.tsx', [
      'line 1',
      '// equall-ignore-next-line',
      'line 3',
      'line 4',
    ].join('\n'))

    await removeIgnore(tempDir, 'comp.tsx:2')
    const content = await readFile(join(tempDir, 'comp.tsx'), 'utf-8')
    expect(content).toBe('line 1\nline 3\nline 4')
  })
})

// ---------------------------------------------------------------------------
// clearAllIgnores
// ---------------------------------------------------------------------------
describe('clearAllIgnores', () => {
  it('removes all ignores across all files', async () => {
    await writeFixture('a.tsx', '// equall-ignore-next-line\n<img />')
    await writeFixture('b.tsx', '// equall-ignore-file\n<div />')

    const removed = await clearAllIgnores(tempDir)
    expect(removed).toHaveLength(2)

    const a = await readFile(join(tempDir, 'a.tsx'), 'utf-8')
    const b = await readFile(join(tempDir, 'b.tsx'), 'utf-8')
    expect(a).not.toContain('equall-ignore')
    expect(b).not.toContain('equall-ignore')
  })

  it('returns empty array when no ignores exist', async () => {
    await writeFixture('clean.tsx', '<div />')

    const removed = await clearAllIgnores(tempDir)
    expect(removed).toHaveLength(0)
  })
})
