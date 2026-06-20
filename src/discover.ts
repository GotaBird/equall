import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { normalize as posixNormalize } from 'node:path/posix'
import { globby } from 'globby'
import type { FileEntry, FileType, ScanOptions } from './types.js'

// Map file extensions to our FileType
const EXT_MAP: Record<string, FileType> = {
  '.html': 'html',
  '.htm': 'html',
  '.jsx': 'jsx',
  '.tsx': 'tsx',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.astro': 'astro',
}

// Resolve a file path to our FileType from its extension. Shared by disk discovery
// and the in-memory input path so both classify files identically.
export function fileTypeForPath(filePath: string): FileType {
  return EXT_MAP[extname(filePath).toLowerCase()] ?? 'other'
}

// Sanitize a caller-supplied path from in-memory input (T1.1). Buffer paths are
// untrusted: they must stay relative to a virtual root, never escape it via
// traversal, and never be absolute. Returns a clean POSIX relative path or throws.
export function sanitizeVirtualPath(rawPath: string): string {
  const cleaned = rawPath.replace(/\\/g, '/').trim()
  if (!cleaned) throw new Error('Empty file path in buffer input')

  // Drop any Windows drive prefix and leading slashes so the path can't be absolute.
  const relative = cleaned.replace(/^[a-zA-Z]:/, '').replace(/^\/+/, '')
  const normalized = posixNormalize(relative).replace(/^\.\//, '')

  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`Unsafe file path (path traversal): ${rawPath}`)
  }
  return normalized
}

// Default patterns for web project files
const DEFAULT_INCLUDE = [
  '**/*.html',
  '**/*.htm',
  '**/*.jsx',
  '**/*.tsx',
  '**/*.vue',
  '**/*.svelte',
  '**/*.astro',
]

const DEFAULT_EXCLUDE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/coverage/**',
  '**/*.min.*',
  '**/*.test.*',
  '**/*.spec.*',
  '**/__tests__/**',
  '**/*.stories.*',
  '**/storybook-static/**',
]

export async function discoverFiles(
  rootPath: string,
  options: ScanOptions
): Promise<FileEntry[]> {
  const includePatterns = options.include_patterns.length > 0
    ? options.include_patterns
    : DEFAULT_INCLUDE

  const excludePatterns = [
    ...DEFAULT_EXCLUDE,
    ...options.exclude_patterns,
  ]

  const paths = await globby(includePatterns, {
    cwd: rootPath,
    ignore: excludePatterns,
    absolute: false,
    gitignore: true,
  })

  const files: FileEntry[] = []

  for (const relativePath of paths) {
    const absolutePath = resolve(rootPath, relativePath)
    try {
      const content = await readFile(absolutePath, 'utf-8')
      const type = fileTypeForPath(relativePath)

      files.push({
        path: relativePath,
        absolute_path: absolutePath,
        content,
        type,
      })
    } catch {
      // Skip unreadable files
    }
  }

  return files
}
