import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { detectRoutes } from '../routes.js'
import { runScan, scanBuffer } from '../scan.js'

// Route detection derives patterns from file PATHS only, so fixture contents are
// irrelevant placeholders — except package.json (framework markers) and .gitignore.
async function layout(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, relative)), { recursive: true })
    await writeFile(join(root, relative), content, 'utf-8')
  }
}

function patterns(routes: { pattern: string }[]): string[] {
  return routes.map((r) => r.pattern)
}

const BANNED = /meets|conformant|compliant|conformance/i

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'equall-routes-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Next.js App Router
// ---------------------------------------------------------------------------
describe('next-app', () => {
  it('derives patterns from app/**/page.*, stripping route groups and keeping brackets', async () => {
    await layout(tempDir, {
      'app/page.tsx': '',
      'app/about/page.tsx': '',
      'app/blog/[slug]/page.tsx': '',
      'app/docs/[...path]/page.tsx': '',
      'app/opt/[[...path]]/page.tsx': '',
      'app/(shop)/cart/page.tsx': '',
      'app/layout.tsx': '',
      'app/api/route.ts': '',
      'app/_private/secret/page.tsx': '',
    })

    const { routes } = await detectRoutes(tempDir)

    expect(patterns(routes).sort()).toEqual([
      '/',
      '/about',
      '/blog/[slug]',
      '/cart',
      '/docs/[...path]',
      '/opt/[[...path]]',
    ])
    expect(routes.every((r) => r.framework === 'next-app')).toBe(true)
    expect(routes.find((r) => r.pattern === '/blog/[slug]')?.dynamic).toBe(true)
    expect(routes.find((r) => r.pattern === '/opt/[[...path]]')?.dynamic).toBe(true)
    expect(routes.find((r) => r.pattern === '/about')?.dynamic).toBe(false)
    expect(routes.find((r) => r.pattern === '/cart')?.file).toBe('app/(shop)/cart/page.tsx')
  })

  it('declares parallel/intercepting segments instead of guessing a URL', async () => {
    await layout(tempDir, {
      'app/page.tsx': '',
      'app/@modal/photo/page.tsx': '',
      'app/feed/(.)photo/page.tsx': '',
    })

    const { routes, diagnostics } = await detectRoutes(tempDir)

    expect(patterns(routes)).toEqual(['/'])
    expect(diagnostics.some((d) => d.includes('2 page file(s) under Next.js parallel/intercepting segments'))).toBe(true)
  })

  it('supports src/app, and root app/ wins when both exist', async () => {
    await layout(tempDir, { 'src/app/only/page.tsx': '' })
    expect(patterns((await detectRoutes(tempDir)).routes)).toEqual(['/only'])

    await layout(tempDir, { 'app/root/page.tsx': '' })
    expect(patterns((await detectRoutes(tempDir)).routes)).toEqual(['/root'])
  })
})

// ---------------------------------------------------------------------------
// Next.js Pages Router
// ---------------------------------------------------------------------------
describe('next-pages', () => {
  it('collapses index, excludes _internals and api/, keeps 404/500 (URL-addressable)', async () => {
    await layout(tempDir, {
      'package.json': JSON.stringify({ dependencies: { next: '^15.0.0' } }),
      'pages/index.tsx': '',
      'pages/about/index.tsx': '',
      'pages/p/[id].tsx': '',
      'pages/404.tsx': '',
      'pages/500.tsx': '',
      'pages/_app.tsx': '',
      'pages/_document.tsx': '',
      'pages/api/hello.ts': '',
      'pages/api/user/[id].ts': '',
    })

    const { routes, diagnostics } = await detectRoutes(tempDir)

    expect(patterns(routes).sort()).toEqual(['/', '/404', '/500', '/about', '/p/[id]'])
    expect(routes.every((r) => r.framework === 'next-pages')).toBe(true)
    expect(routes.find((r) => r.pattern === '/404')?.dynamic).toBe(false)
    expect(routes.find((r) => r.pattern === '/p/[id]')?.dynamic).toBe(true)
    expect(diagnostics.some((d) => d.includes('2 file(s) under pages/api/'))).toBe(true)
  })

  it('never maps a pages/ directory without the Next marker (phantom-route guard)', async () => {
    // A pages/ folder of js files is not distinctive — any repo can have one. Without
    // the marker (next dependency or next.config.*) it must yield ZERO routes.
    await layout(tempDir, {
      'pages/index.tsx': '',
      'pages/about.tsx': '',
    })

    const { routes, diagnostics } = await detectRoutes(tempDir)

    expect(routes).toEqual([])
    expect(diagnostics).toEqual(['[routes] no supported file-based routing detected (Next.js App/Pages Router, Astro, plain HTML).'])
  })

  it('never maps src/pages js (or lone .md) without a marker — a React component or docs layout', async () => {
    await layout(tempDir, {
      'src/pages/Home.tsx': '',
      'src/pages/notes.md': '',
    })

    const { routes } = await detectRoutes(tempDir)

    expect(routes).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Astro
// ---------------------------------------------------------------------------
describe('astro', () => {
  it('derives from src/pages with the Astro underscore convention', async () => {
    await layout(tempDir, {
      'astro.config.mjs': 'export default {}',
      'src/pages/index.astro': '',
      'src/pages/blog/[slug].astro': '',
      'src/pages/docs/[...path].astro': '',
      'src/pages/guide.md': '',
      'src/pages/_draft.astro': '',
      'src/pages/_partials/nav.astro': '',
      'src/pages/util.ts': '',
    })

    const { routes } = await detectRoutes(tempDir)

    expect(patterns(routes).sort()).toEqual(['/', '/blog/[slug]', '/docs/[...path]', '/guide'])
    expect(routes.every((r) => r.framework === 'astro')).toBe(true)
    expect(routes.find((r) => r.pattern === '/docs/[...path]')?.dynamic).toBe(true)
  })

  it('disambiguates src/pages: astro marker → astro, next marker → next-pages, content shape as fallback', async () => {
    // (a) astro dependency marker
    await layout(tempDir, {
      'package.json': JSON.stringify({ dependencies: { astro: '^4.0.0' } }),
      'src/pages/index.astro': '',
    })
    expect((await detectRoutes(tempDir)).routes[0]?.framework).toBe('astro')
    await rm(tempDir, { recursive: true, force: true })

    // (b) next dependency marker
    tempDir = await mkdtemp(join(tmpdir(), 'equall-routes-'))
    await layout(tempDir, {
      'package.json': JSON.stringify({ dependencies: { next: '^15.0.0' } }),
      'src/pages/index.tsx': '',
    })
    expect((await detectRoutes(tempDir)).routes[0]?.framework).toBe('next-pages')
    await rm(tempDir, { recursive: true, force: true })

    // (c) no marker — an .astro file decides
    tempDir = await mkdtemp(join(tmpdir(), 'equall-routes-'))
    await layout(tempDir, { 'src/pages/index.astro': '' })
    expect((await detectRoutes(tempDir)).routes[0]?.framework).toBe('astro')
  })
})

// ---------------------------------------------------------------------------
// Coexistence & fallback
// ---------------------------------------------------------------------------
describe('mixed and fallback trees', () => {
  it('emits both app/ and pages/ during an incremental Next migration', async () => {
    await layout(tempDir, {
      'package.json': JSON.stringify({ dependencies: { next: '^15.0.0' } }),
      'app/dashboard/page.tsx': '',
      'pages/legacy.tsx': '',
    })

    const { routes } = await detectRoutes(tempDir)

    expect(routes).toEqual([
      { pattern: '/dashboard', file: 'app/dashboard/page.tsx', framework: 'next-app', dynamic: false },
      { pattern: '/legacy', file: 'pages/legacy.tsx', framework: 'next-pages', dynamic: false },
    ])
  })

  it('maps a plain-html tree: index collapses, non-index keeps its extension', async () => {
    await layout(tempDir, {
      'index.html': '',
      'about.html': '',
      'team/index.html': '',
    })

    const { routes } = await detectRoutes(tempDir)

    expect(patterns(routes).sort()).toEqual(['/', '/about.html', '/team'])
    expect(routes.every((r) => r.framework === 'html' && !r.dynamic)).toBe(true)
  })

  it('html is fallback-only: a Next project\'s stray html never becomes a route', async () => {
    await layout(tempDir, {
      'package.json': JSON.stringify({ dependencies: { next: '^15.0.0' } }),
      'app/page.tsx': '',
      'public/foo.html': '',
    })

    const { routes } = await detectRoutes(tempDir)

    expect(routes.every((r) => r.framework === 'next-app')).toBe(true)
    expect(patterns(routes)).toEqual(['/'])
  })
})

// ---------------------------------------------------------------------------
// Honest declaration — unsupported frameworks, empty trees, hygiene
// ---------------------------------------------------------------------------
describe('honest declaration', () => {
  it('declares SvelteKit instead of guessing', async () => {
    await layout(tempDir, {
      'svelte.config.js': 'export default {}',
      'src/routes/+page.svelte': '',
    })

    const { routes, diagnostics } = await detectRoutes(tempDir)

    expect(routes).toEqual([])
    expect(diagnostics.some((d) => d.includes('SvelteKit route mapping is not yet supported'))).toBe(true)
    // The unsupported-framework note explains the emptiness — no redundant zero-route note.
    expect(diagnostics.some((d) => d.includes('no supported file-based routing'))).toBe(false)
  })

  it('declares Nuxt and never misreads its pages/ as Next', async () => {
    await layout(tempDir, {
      'nuxt.config.ts': 'export default {}',
      'pages/index.vue': '',
      'pages/about.ts': '', // js-family bait — must not be mapped while Nuxt owns pages/
    })

    const { routes, diagnostics } = await detectRoutes(tempDir)

    expect(routes).toEqual([])
    expect(diagnostics.some((d) => d.includes('Nuxt route mapping is not yet supported'))).toBe(true)
  })

  it('says so when a scanned tree has no supported routing at all', async () => {
    const { routes, diagnostics } = await detectRoutes(tempDir)

    expect(routes).toEqual([])
    expect(diagnostics).toEqual(['[routes] no supported file-based routing detected (Next.js App/Pages Router, Astro, plain HTML).'])
  })

  it('never emits routes from gitignored or vendored trees', async () => {
    await layout(tempDir, {
      '.gitignore': 'drafts/\n',
      'index.html': '',
      'drafts/wip.html': '',
      'node_modules/pkg/demo/index.html': '',
    })

    const { routes } = await detectRoutes(tempDir)

    expect(patterns(routes)).toEqual(['/'])
  })

  it('keeps every diagnostic free of banned verdict words', async () => {
    await layout(tempDir, {
      'svelte.config.js': '',
      'src/routes/+page.svelte': '',
      'nuxt.config.ts': '',
      'app/@modal/x/page.tsx': '',
      'pages/api/x.ts': '',
    })

    const { diagnostics } = await detectRoutes(tempDir)

    expect(diagnostics.length).toBeGreaterThan(0)
    for (const diagnostic of diagnostics) {
      expect(diagnostic).not.toMatch(BANNED)
    }
  })
})

// ---------------------------------------------------------------------------
// Normalization contract
// ---------------------------------------------------------------------------
describe('normalization', () => {
  it('emits leading-slash POSIX patterns and POSIX file paths, sorted', async () => {
    await layout(tempDir, {
      'app/z/page.tsx': '',
      'app/a/page.tsx': '',
    })

    const { routes } = await detectRoutes(tempDir)

    expect(patterns(routes)).toEqual(['/a', '/z']) // deterministic order
    for (const route of routes) {
      expect(route.pattern.startsWith('/')).toBe(true)
      expect(route.pattern).not.toContain('\\')
      expect(route.file).not.toContain('\\')
    }
  })
})

// ---------------------------------------------------------------------------
// Pipeline integration (runScan / scanBuffer)
// ---------------------------------------------------------------------------
describe('runScan integration', () => {
  it('attaches routes on a disk scan', async () => {
    await layout(tempDir, { 'index.html': '<!DOCTYPE html><html lang="en"><head><title>t</title></head><body><main><h1>x</h1></main></body></html>' })

    const result = await runScan({ path: tempDir })

    expect(result.routes).toEqual([{ pattern: '/', file: 'index.html', framework: 'html', dynamic: false }])
  })

  it('still attaches routes on the zero-scannable-files early return (pure .js Pages Router)', async () => {
    await layout(tempDir, {
      'package.json': JSON.stringify({ dependencies: { next: '^15.0.0' } }),
      'pages/a.js': '',
    })

    const result = await runScan({ path: tempDir })

    expect(result.summary.files_scanned).toBe(0)
    expect(result.routes).toEqual([{ pattern: '/a', file: 'pages/a.js', framework: 'next-pages', dynamic: false }])
  })

  it('leaves routes absent on in-memory input, with the skip declared (tri-state)', async () => {
    const fromFiles = await runScan({ files: [{ path: 'x.html', content: '<img>' }] })
    const fromBuffer = await scanBuffer('<img>', 'x.html')

    for (const result of [fromFiles, fromBuffer]) {
      expect(result.routes).toBeUndefined()
      expect(result.diagnostics).toContain('[routes] skipped for in-memory input — no project tree to derive routes from.')
    }
  })
})
