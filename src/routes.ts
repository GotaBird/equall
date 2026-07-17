// Route detection from file-based routing conventions — the additive inventory behind
// ScanResult.routes. Derives URL patterns from file PATHS only: no crawling, no network,
// no rendering; the only file contents read are <root>/package.json (framework markers).
// Routes are inert metadata — never routed into the score, verdicts, or coverage.
//
// Supported conventions: Next.js App Router (app/**/page.*), Next.js Pages Router
// (pages/**), Astro (src/pages/**), and plain .html trees (fallback only — emitted when
// no framework routing and no framework marker was found, so a Next project's public/
// snapshots never become routes). SvelteKit and Nuxt are not supported: their markers
// produce an explicit diagnostic instead of a guess (routes are never silently omitted).
//
// Known limitations (accepted, not diagnosed): a custom Next `pageExtensions` and a
// custom Astro `srcDir` are not parsed; detection is anchored to the scanned root only
// (monorepo sub-apps: scan the package directory).

import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { globby } from 'globby'
import type { RouteFramework, RouteInfo } from './types.js'
import { DEFAULT_EXCLUDE } from './discover.js'

export interface RouteDetection {
  routes: RouteInfo[]
  diagnostics: string[]
}

// Framework markers — a cheap, local read (package.json deps + config-file existence).
interface FrameworkMarkers {
  next: boolean
  astro: boolean
  sveltekit: boolean
  nuxt: boolean
}

const PAGE_EXTENSIONS = 'js,jsx,ts,tsx'

async function pathExists(rootPath: string, ...names: string[]): Promise<boolean> {
  for (const name of names) {
    try {
      await stat(join(rootPath, name))
      return true
    } catch {
      // keep looking
    }
  }
  return false
}

async function detectMarkers(rootPath: string): Promise<FrameworkMarkers> {
  let deps: Record<string, unknown> = {}
  try {
    const pkg = JSON.parse(await readFile(join(rootPath, 'package.json'), 'utf-8'))
    deps = { ...pkg.dependencies, ...pkg.devDependencies }
  } catch {
    // No readable package.json — config files below still count as markers.
  }

  return {
    next: 'next' in deps || (await pathExists(rootPath, 'next.config.js', 'next.config.mjs', 'next.config.ts')),
    astro: 'astro' in deps || (await pathExists(rootPath, 'astro.config.js', 'astro.config.mjs', 'astro.config.cjs', 'astro.config.ts')),
    sveltekit: '@sveltejs/kit' in deps
      || ((await pathExists(rootPath, 'svelte.config.js', 'svelte.config.ts')) && (await pathExists(rootPath, 'src/routes'))),
    nuxt: 'nuxt' in deps || (await pathExists(rootPath, 'nuxt.config.js', 'nuxt.config.ts', 'nuxt.config.mjs')),
  }
}

// All route globs share the scan's hygiene: .gitignore honored, built/vendored trees
// excluded — a gitignored or built page never becomes a route.
async function globRoutes(rootPath: string, patterns: string[]): Promise<string[]> {
  return globby(patterns, {
    cwd: rootPath,
    ignore: DEFAULT_EXCLUDE,
    absolute: false,
    gitignore: true,
  })
}

function makeRoute(segments: string[], file: string, framework: RouteFramework): RouteInfo {
  const pattern = '/' + segments.join('/')
  return { pattern, file, framework, dynamic: pattern.includes('[') }
}

// --- Next.js App Router -----------------------------------------------------------------
// Only page.* files are routes: layout/loading/error/not-found/template never match, and
// route.ts is an API handler. Deliberate asymmetry with the Pages Router below: pages/404
// and pages/500 ARE emitted (Next serves them at the addressable URLs /404 and /500),
// while app/**/not-found.* is NOT (rendered by the router on error, no URL of its own).
function deriveAppRoutes(files: string[], base: string): { routes: RouteInfo[]; skipped: number } {
  const routes: RouteInfo[] = []
  let skipped = 0

  for (const file of files) {
    // Segments between the app base and the page.* filename.
    const segments = file.slice(base.length + 1).split('/').slice(0, -1)
    const kept: string[] = []
    let drop: 'silent' | 'declared' | null = null

    for (const segment of segments) {
      if (/^\(\.{1,3}\)/.test(segment) || segment.startsWith('@')) {
        // Intercepting ((.)photo) and parallel (@modal) segments have no standalone URL —
        // declared on diagnostics, never guessed.
        drop = 'declared'
        break
      }
      if (segment.startsWith('_')) {
        // Private folder — opted out of routing by convention.
        drop = 'silent'
        break
      }
      if (/^\(.+\)$/.test(segment)) continue // route group — organizational, not in the URL
      kept.push(segment)
    }

    if (drop === 'declared') skipped++
    if (drop) continue
    routes.push(makeRoute(kept, file, 'next-app'))
  }

  return { routes, skipped }
}

// --- Next.js Pages Router ---------------------------------------------------------------
function derivePagesRoutes(files: string[], base: string): { routes: RouteInfo[]; apiCount: number } {
  const routes: RouteInfo[] = []
  let apiCount = 0

  for (const file of files) {
    const relative = file.slice(base.length + 1)
    if (relative === 'api' || relative.startsWith('api/')) {
      apiCount++
      continue
    }

    const segments = relative.replace(/\.[^./]+$/, '').split('/')
    // _app, _document, _error and any other _-prefixed file are framework internals.
    if (segments[segments.length - 1].startsWith('_')) continue
    if (segments[segments.length - 1] === 'index') segments.pop()
    routes.push(makeRoute(segments, file, 'next-pages'))
  }

  return { routes, apiCount }
}

// --- Astro --------------------------------------------------------------------------------
function deriveAstroRoutes(files: string[], base: string): RouteInfo[] {
  const routes: RouteInfo[] = []

  for (const file of files) {
    const segments = file.slice(base.length + 1).replace(/\.[^./]+$/, '').split('/')
    // Astro convention: _-prefixed files AND directories are excluded from routing.
    if (segments.some((segment) => segment.startsWith('_'))) continue
    if (segments[segments.length - 1] === 'index') segments.pop()
    routes.push(makeRoute(segments, file, 'astro'))
  }

  return routes
}

// --- Plain HTML (fallback only) -----------------------------------------------------------
function deriveHtmlRoutes(files: string[]): RouteInfo[] {
  return files.map((file) => {
    const segments = file.split('/')
    const basename = segments[segments.length - 1]
    if (/^index\.html?$/i.test(basename)) {
      segments.pop() // index.html collapses to its directory
    }
    // Non-index files keep the extension: /about.html is the only URL guaranteed to be
    // served — clean-URL rewrites are host config the file tree can't show.
    return makeRoute(segments, file, 'html')
  })
}

// Detect file-based routes under rootPath. Pure derivation — safe to run on any tree;
// an unrecognized project yields { routes: [], diagnostics: [why] }.
export async function detectRoutes(rootPath: string): Promise<RouteDetection> {
  const routes: RouteInfo[] = []
  const diagnostics: string[] = []
  const markers = await detectMarkers(rootPath)

  if (markers.sveltekit) {
    diagnostics.push('[routes] SvelteKit routing detected (src/routes/) — SvelteKit route mapping is not yet supported; its routes are not listed.')
  }
  if (markers.nuxt) {
    diagnostics.push('[routes] Nuxt routing detected — Nuxt route mapping is not yet supported; its routes are not listed.')
  }

  // 1. App Router — page.* is distinctive enough that no marker is required. Root app/
  // wins over src/app when both exist (Next's own precedence).
  let appBase = 'app'
  let appFiles = await globRoutes(rootPath, [`app/**/page.{${PAGE_EXTENSIONS},mdx}`])
  if (appFiles.length === 0) {
    appBase = 'src/app'
    appFiles = await globRoutes(rootPath, [`src/app/**/page.{${PAGE_EXTENSIONS},mdx}`])
  }
  const app = deriveAppRoutes(appFiles, appBase)
  routes.push(...app.routes)
  if (app.skipped > 0) {
    diagnostics.push(`[routes] ${app.skipped} page file(s) under Next.js parallel/intercepting segments (@slot, (.)…) have no standalone URL and are not listed.`)
  }

  // 2. Root pages/ — Nuxt also routes from pages/, so a Nuxt marker means the diagnostic
  // above already covers it; never map it as Next.
  let apiCount = 0
  if (!markers.nuxt) {
    const pagesFiles = await globRoutes(rootPath, [`pages/**/*.{${PAGE_EXTENSIONS}}`])
    const pages = derivePagesRoutes(pagesFiles, 'pages')
    routes.push(...pages.routes)
    apiCount += pages.apiCount
  }

  // 3. src/pages/ — the Next-vs-Astro collision: markers decide; without one, the content
  // shape does (any Astro-family file → Astro, else js-family → Pages Router).
  if (await pathExists(rootPath, 'src/pages')) {
    let flavor: 'astro' | 'next-pages' | null = null
    if (markers.astro) flavor = 'astro'
    else if (markers.next) flavor = 'next-pages'
    else if ((await globRoutes(rootPath, ['src/pages/**/*.{astro,md,mdx}'])).length > 0) flavor = 'astro'
    else if ((await globRoutes(rootPath, [`src/pages/**/*.{${PAGE_EXTENSIONS}}`])).length > 0) flavor = 'next-pages'

    if (flavor === 'astro') {
      const astroFiles = await globRoutes(rootPath, ['src/pages/**/*.{astro,md,mdx,html}'])
      routes.push(...deriveAstroRoutes(astroFiles, 'src/pages'))
    } else if (flavor === 'next-pages') {
      const srcPagesFiles = await globRoutes(rootPath, [`src/pages/**/*.{${PAGE_EXTENSIONS}}`])
      const srcPages = derivePagesRoutes(srcPagesFiles, 'src/pages')
      routes.push(...srcPages.routes)
      apiCount += srcPages.apiCount
    }
  }

  if (apiCount > 0) {
    diagnostics.push(`[routes] ${apiCount} file(s) under pages/api/ are API endpoints, not pages — not listed as routes.`)
  }

  // 4. Plain-HTML fallback — only when nothing above matched AND no framework marker
  // fired, so framework repos' stray .html (public/, exports) never pollutes the routes.
  const anyMarker = markers.next || markers.astro || markers.sveltekit || markers.nuxt
  if (routes.length === 0 && !anyMarker) {
    const htmlFiles = await globRoutes(rootPath, ['**/*.{html,htm}'])
    routes.push(...deriveHtmlRoutes(htmlFiles))
  }

  // Tree scanned, zero routes: say so — unless an unsupported-framework diagnostic above
  // already explains the emptiness.
  if (routes.length === 0 && !markers.sveltekit && !markers.nuxt) {
    diagnostics.push('[routes] no supported file-based routing detected (Next.js App/Pages Router, Astro, plain HTML).')
  }

  routes.sort((a, b) => a.pattern.localeCompare(b.pattern) || a.file.localeCompare(b.file))
  return { routes, diagnostics }
}
