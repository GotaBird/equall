import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
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
