import { readFile } from 'node:fs/promises'
import { resolve, relative, extname } from 'node:path'
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
  const { globby } = await import('globby')

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
      const ext = extname(relativePath).toLowerCase()
      const type: FileType = EXT_MAP[ext] ?? 'other'

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
