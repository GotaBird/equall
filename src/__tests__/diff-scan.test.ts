import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runDiffScan } from '../diff-scan.js'

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
