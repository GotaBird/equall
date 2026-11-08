import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile, rm, appendFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { runDiffScan, formatDiffGuardrail } from '../diff-scan.js'

const execFileAsync = promisify(execFile)

let dir: string

async function run(args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd: dir })
}

async function seedRepo(): Promise<void> {
  await run(['init', '-q'])
  await run(['config', 'user.email', 'test@equall.dev'])
  await run(['config', 'user.name', 'Equall Test'])
  await run(['config', 'commit.gpgsign', 'false'])
}

async function write(path: string, content: string): Promise<void> {
  await mkdir(dirname(join(dir, path)), { recursive: true })
  await writeFile(join(dir, path), content, 'utf-8')
}

async function commit(message: string): Promise<void> {
  await run(['add', '-A'])
  await run(['commit', '-q', '-m', message])
}

// A fully accessible document: lang, title, single <main>, an <h1>, alt on the image.
// Produces zero axe violations, so any violation that appears later is unambiguously new.
function cleanDoc(body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head><title>Test page</title></head>
  <body>
    <main>
      <h1>Hello</h1>
${body}
    </main>
  </body>
</html>
`
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'equall-diff-'))
  await seedRepo()
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('runDiffScan — only-new', () => {
  it('reports exactly one new violation introduced by a diff', async () => {
    await write('index.html', cleanDoc('      <img src="a.png" alt="Logo A">'))
    await commit('base: clean page')

    // Introduce a single violation: a second image with no alt.
    await write('index.html', cleanDoc('      <img src="a.png" alt="Logo A">\n      <img src="b.png">'))
    await commit('add image without alt')

    const result = await runDiffScan({ base: 'HEAD~1', head: 'HEAD', cwd: dir })

    expect(result.summary.new_count).toBe(1)
    expect(result.summary.legacy_count).toBe(0)
    expect(result.new_issues[0].wcag_criteria).toContain('1.1.1')
    expect(result.new_issues[0].scanner_rule_id).toBe('image-alt')
    expect(result.summary.files_scanned).toBe(1)
  })

  it('produces zero false "new" on a reformat-only diff', async () => {
    // A persistent violation exists from the start.
    await write('index.html', cleanDoc('      <img src="b.png">'))
    await commit('base: page with a missing-alt image')

    // Reformat only: reindent, newlines, switch quotes — same elements, same violation.
    await write(
      'index.html',
      `<!DOCTYPE html>
<html lang='en'>
  <head>
    <title>Test page</title>
  </head>
  <body>
    <main>
      <h1>Hello</h1>
      <img    src='b.png'   >
    </main>
  </body>
</html>
`
    )
    await commit('reformat only')

    const result = await runDiffScan({ base: 'HEAD~1', head: 'HEAD', cwd: dir })

    expect(result.summary.new_count).toBe(0)
    expect(result.summary.legacy_count).toBeGreaterThanOrEqual(1)
  })

  it('treats every violation in an added file as new', async () => {
    await write('index.html', cleanDoc('      <img src="a.png" alt="Logo A">'))
    await commit('base')

    await write('new.html', cleanDoc('      <img src="b.png">'))
    await commit('add a new page with a violation')

    const result = await runDiffScan({ base: 'HEAD~1', head: 'HEAD', cwd: dir })

    expect(result.summary.new_count).toBe(1)
    expect(result.new_issues[0].file_path).toBe('new.html')
    expect(result.new_issues[0].scanner_rule_id).toBe('image-alt')
  })

  it('lists non-scannable changed files as not-testable', async () => {
    await write('index.html', cleanDoc('      <img src="a.png" alt="Logo A">'))
    await write('styles.css', 'body { color: #000; }\n')
    await commit('base')

    await write('styles.css', 'body { color: #111; }\n')
    await commit('tweak css only')

    const result = await runDiffScan({ base: 'HEAD~1', head: 'HEAD', cwd: dir })

    expect(result.not_testable).toContain('styles.css')
    expect(result.summary.not_testable_count).toBe(1)
    expect(result.summary.new_count).toBe(0)
    expect(result.summary.files_scanned).toBe(0)
  })

  it('rejects a base ref with a leading dash (option injection)', async () => {
    await write('index.html', cleanDoc('      <img src="a.png" alt="Logo A">'))
    await commit('base')

    await expect(runDiffScan({ base: '--upload-pack=evil', cwd: dir })).rejects.toThrow(/Invalid git ref/)
  })

  it('rejects an unknown base ref', async () => {
    await write('index.html', cleanDoc('      <img src="a.png" alt="Logo A">'))
    await commit('base')

    await expect(runDiffScan({ base: 'no-such-ref-xyz', cwd: dir })).rejects.toThrow(/Cannot resolve git ref/)
  })
})

// A JSX component; `body` is literal markup, so axe findings on it are counted.
function nav(body: string): string {
  return `export function Nav() {
  return (
    <nav>
${body}
    </nav>
  )
}
`
}

const IMG = '      <img src="logo.png" />'
const BUTTON = '      <button type="button"></button>'

describe('runDiffScan — what counts as new', () => {
  it('reports exactly the violations a change added, even copies of existing ones', async () => {
    await write('src/Nav.tsx', nav([IMG, BUTTON].join('\n')))
    await write('page.html', cleanDoc('      <button type="button"></button>'))
    await commit('base: one image without alt and one empty button in Nav, one empty button in page')

    await write('src/Nav.tsx', nav([IMG, BUTTON, IMG, BUTTON].join('\n')))
    await write('page.html', cleanDoc(Array(3).fill('      <button type="button"></button>').join('\n')))
    await commit('add one image and one button to Nav, two buttons to page')

    const result = await runDiffScan({ base: 'HEAD~1', head: 'HEAD', cwd: dir })

    // Every added defect is reported and nothing pre-existing is. The two identical buttons
    // added to page.html fold into one finding, as a full scan reports them (the dedup
    // folds identical markup in a file); the image seen by two engines is reported once.
    const added = result.new_issues.map((i) => `${i.file_path}:${i.wcag_criteria.join(',')}`).sort()
    expect(added).toEqual(['page.html:4.1.2', 'src/Nav.tsx:1.1.1', 'src/Nav.tsx:4.1.2'])
    expect(result.new_issues.find((i) => i.wcag_criteria.includes('1.1.1'))?.scanners).toHaveLength(2)
  })

  it('reports a copy-pasted violation as one new, not as legacy', async () => {
    await write('index.html', cleanDoc('      <img src="b.png">'))
    await commit('base: one image without alt')

    await write('index.html', cleanDoc('      <img src="b.png">\n      <img src="b.png">'))
    await commit('copy the image')

    const result = await runDiffScan({ base: 'HEAD~1', head: 'HEAD', cwd: dir })

    expect(result.summary.new_count).toBe(1)
    expect(result.summary.legacy_count).toBe(1)
  })

  it('names the pasted copy, not the original, when an identical violation is added above it', async () => {
    await write('index.html', cleanDoc('      <p>gap</p>\n      <img src="b.png">'))
    await commit('base: one image without alt')

    await write('index.html', cleanDoc('      <img src="b.png">\n      <p>gap</p>\n      <img src="b.png">'))
    await commit('paste a copy above')

    const result = await runDiffScan({ base: 'HEAD~1', head: 'HEAD', cwd: dir })

    expect(result.summary.new_count).toBe(1)
    expect(result.summary.legacy_count).toBe(1)
    expect(result.new_issues[0].line).toBe(7)
    expect(result.legacy_issues[0].line).toBe(9)
  })

  it('clears the line of a new copy that sits on no added line, instead of naming an unchanged one', async () => {
    await write('index.html', cleanDoc('      <input type="text">\n      <label>Name\n      <input type="text">\n      </label>'))
    await commit('base: one unlabelled input, one labelled')

    // Only deletions: the second input loses its label without its own line changing.
    await write('index.html', cleanDoc('      <input type="text">\n      <input type="text">'))
    await commit('drop the label')

    const result = await runDiffScan({ base: 'HEAD~1', head: 'HEAD', cwd: dir })

    expect(result.summary.new_count).toBe(1)
    expect(result.summary.legacy_count).toBe(1)
    expect(result.new_issues[0].line).toBeNull()
    expect(result.legacy_issues[0].line).toBe(7)
  })

  it('reports one defect seen by two engines once, whether or not the merge fired at base', async () => {
    // At base the merge fires (one jsx-a11y alt-text, one axe image-alt). At head there are
    // two of each, so a whole-file merge would not fire and the axe twin would read as new.
    await write('src/Nav.tsx', nav(IMG))
    await commit('base: one image without alt')

    await write('src/Nav.tsx', nav([IMG, IMG].join('\n')))
    await commit('copy the image')

    const result = await runDiffScan({ base: 'HEAD~1', head: 'HEAD', cwd: dir })

    expect(result.summary.new_count).toBe(1)
    expect(result.new_issues[0].scanners).toHaveLength(2)
    expect(result.summary.legacy_count).toBe(1)
  })

  it('skips story and test files like a full scan does, and lists them', async () => {
    await write('index.html', cleanDoc('      <img src="a.png" alt="Logo A">'))
    await commit('base')

    await write('src/Nav.stories.tsx', nav(IMG))
    await write('src/__tests__/Nav.test.tsx', nav(IMG))
    await commit('add a story and a test')

    const result = await runDiffScan({ base: 'HEAD~1', head: 'HEAD', cwd: dir })

    expect(result.summary.new_count).toBe(0)
    expect(result.summary.files_scanned).toBe(0)
    expect(result.excluded).toEqual(['src/Nav.stories.tsx', 'src/__tests__/Nav.test.tsx'])
  })

  it('keeps an introduced review-only finding out of the counted new issues', async () => {
    await write('src/Toolbar.tsx', 'export function Toolbar() { return (<div></div>) }\n')
    await commit('base')

    // <Button> is a component: its name comes from its implementation, so axe can't confirm it.
    await write('src/Toolbar.tsx', 'export function Toolbar() { return (<div><Button><SunIcon /></Button></div>) }\n')
    await commit('add a component button')

    const result = await runDiffScan({ base: 'HEAD~1', head: 'HEAD', cwd: dir })

    expect(result.summary.new_count).toBe(0)
    expect(result.new_review_only.map((i) => i.scanner_rule_id)).toContain('button-name')
  })

  it('keeps an introduced best-practice finding out of the counted new issues', async () => {
    await write('index.html', cleanDoc('      <p>Intro</p>'))
    await commit('base')

    // Skipping from h1 to h3 is an axe best practice (no WCAG criterion).
    await write('index.html', cleanDoc('      <p>Intro</p>\n      <h3>Details</h3>'))
    await commit('add a skipped heading level')

    const result = await runDiffScan({ base: 'HEAD~1', head: 'HEAD', cwd: dir })

    expect(result.summary.new_count).toBe(0)
    expect(result.new_advisory.map((i) => i.scanner_rule_id)).toContain('heading-order')
  })
})

describe('runDiffScan — working tree', () => {
  // Base: one page with a pre-existing violation that stays untouched, plus the pages the
  // dirty tree then modifies, stages and deletes, and a binary asset.
  async function seedBase(): Promise<void> {
    await write('untouched.html', cleanDoc('      <img src="legacy.png">'))
    await write('modified.html', cleanDoc('      <p>Modified</p>'))
    await write('staged.html', cleanDoc('      <p>Staged</p>'))
    await write('deleted.html', cleanDoc('      <img src="gone.png">'))
    await writeFile(join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]))
    await commit('base')
  }

  async function dirtyTree(): Promise<void> {
    await write('modified.html', cleanDoc('      <p>Modified</p>\n      <img src="m.png">'))
    await write('staged.html', cleanDoc('      <p>Staged</p>\n      <button></button>'))
    await run(['add', 'staged.html'])
    await write('untracked.html', cleanDoc('      <a href="/next"></a>'))
    await rm(join(dir, 'deleted.html'))
    await writeFile(join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x02]))
  }

  it('reports only what the modified, staged and untracked files introduce, with lines', async () => {
    await seedBase()
    await dirtyTree()

    const result = await runDiffScan({ base: 'HEAD', workingTree: true, cwd: dir })

    expect(result.working_tree).toBe(true)
    expect(result.new_issues.map((i) => `${i.file_path}:${i.line} ${i.scanner_rule_id}`).sort()).toEqual([
      'modified.html:8 image-alt',
      'staged.html:8 button-name',
      'untracked.html:7 link-name',
    ])
    // The untouched page's violation and the deleted page are not part of the change.
    const all = [...result.new_issues, ...result.new_review_only, ...result.new_advisory, ...result.legacy_issues]
    expect(all.some((i) => i.file_path === 'untouched.html' || i.file_path === 'deleted.html')).toBe(false)
    expect(result.not_testable).toEqual(['logo.png'])
    expect(result.summary.files_scanned).toBe(3)
  })

  it('finds nothing in the working tree of a clean checkout, and nothing without the flag', async () => {
    await seedBase()
    expect((await runDiffScan({ base: 'HEAD', workingTree: true, cwd: dir })).summary.files_changed).toBe(0)

    await dirtyTree()
    const committedOnly = await runDiffScan({ base: 'HEAD', cwd: dir })
    expect(committedOnly.summary.files_changed).toBe(0)
    expect(committedOnly.working_tree).toBeUndefined()
    expect('working_tree' in committedOnly).toBe(false)
  })

  it('compares the working tree with the merge-base, so committed changes since base count too', async () => {
    await seedBase()
    await write('modified.html', cleanDoc('      <p>Modified</p>\n      <img src="m.png">'))
    await commit('commit a violation')
    await write('untracked.html', cleanDoc('      <a href="/next"></a>'))

    const result = await runDiffScan({ base: 'HEAD~1', workingTree: true, cwd: dir })

    expect(result.new_issues.map((i) => i.file_path).sort()).toEqual(['modified.html', 'untracked.html'])
  })

  it('skips untracked files that .gitignore excludes', async () => {
    await seedBase()
    await appendFile(join(dir, '.git', 'info', 'exclude'), 'ignored.html\n')
    await write('ignored.html', cleanDoc('      <img src="i.png">'))

    const result = await runDiffScan({ base: 'HEAD', workingTree: true, cwd: dir })

    expect(result.summary.files_changed).toBe(0)
  })

  it('lists a markup file with binary content as not statically testable', async () => {
    await seedBase()
    await writeFile(join(dir, 'blob.html'), Buffer.from('<p>\u0000binary</p>'))

    const result = await runDiffScan({ base: 'HEAD', workingTree: true, cwd: dir })

    expect(result.not_testable).toEqual(['blob.html'])
    expect(result.summary.files_scanned).toBe(0)
  })

  it('keeps paths relative to the repository root when run from a subdirectory', async () => {
    await write('site/index.html', cleanDoc('      <p>Home</p>'))
    await write('other/page.html', cleanDoc('      <p>Other</p>'))
    await commit('base')
    await write('site/new.html', cleanDoc('      <img src="n.png">'))
    await write('other/new.html', cleanDoc('      <img src="o.png">'))

    const result = await runDiffScan({ base: 'HEAD', workingTree: true, cwd: join(dir, 'site') })

    expect(result.new_issues.map((i) => i.file_path)).toEqual(['site/new.html'])
  })

  it('refuses a head ref together with the working tree', async () => {
    await seedBase()
    await expect(runDiffScan({ base: 'HEAD', head: 'HEAD', workingTree: true, cwd: dir })).rejects.toThrow(/cannot both/)
  })
})

describe('formatDiffGuardrail', () => {
  it('never claims done, and names uncounted new findings only when there are some', async () => {
    await write('src/Toolbar.tsx', 'export function Toolbar() { return (<div></div>) }\n')
    await commit('base')
    await write('src/Toolbar.tsx', 'export function Toolbar() { return (<div><Button><SunIcon /></Button></div>) }\n')
    await commit('add a component button')

    const line = formatDiffGuardrail(await runDiffScan({ base: 'HEAD~1', head: 'HEAD', cwd: dir }))

    expect(line).toMatch(/^0 new · 1 new to review · 0 legacy · 0 not statically testable → run the rendered check$/)
    expect(line).not.toMatch(/clean|done|pass/i)
  })
})
