import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { globby } from 'globby'

export interface IgnoreEntry {
  file_path: string
  line: number
  type: 'file' | 'next-line'
  rule_id: string | null
  raw: string
}

const IGNORE_PATTERN = /equall-ignore-(next-line|file)(?:\s+(\S+))?/

// Scan all project files for equall-ignore comments
export async function findIgnores(rootPath: string): Promise<IgnoreEntry[]> {
  const paths = await globby(
    ['**/*.{html,htm,jsx,tsx,vue,svelte,astro}'],
    {
      cwd: rootPath,
      ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.next/**'],
      absolute: false,
      gitignore: true,
    }
  )

  const entries: IgnoreEntry[] = []

  for (const relativePath of paths) {
    const absolutePath = resolve(rootPath, relativePath)
    let content: string
    try {
      content = await readFile(absolutePath, 'utf-8')
    } catch {
      continue
    }

    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(IGNORE_PATTERN)
      if (!match) continue

      const type = match[1] as 'file' | 'next-line'
      // For equall-ignore-file, only valid in the first 5 lines
      if (type === 'file' && i >= 5) continue

      entries.push({
        file_path: relativePath,
        line: i + 1,
        type,
        rule_id: match[2] ?? null,
        raw: lines[i].trim(),
      })
    }
  }

  return entries.sort((a, b) => a.file_path.localeCompare(b.file_path) || a.line - b.line)
}

// Add equall-ignore-file at the top of a file
export async function addIgnoreFile(rootPath: string, filePath: string): Promise<{ file: string; comment: string } | null> {
  const absolutePath = resolve(rootPath, filePath)
  let content: string
  try {
    content = await readFile(absolutePath, 'utf-8')
  } catch {
    return null
  }

  // Check if already ignored
  const lines = content.split('\n')
  if (lines.slice(0, 5).some(l => l.includes('equall-ignore-file'))) {
    return null
  }

  const ext = filePath.split('.').pop()?.toLowerCase()
  let comment: string
  if (ext === 'html' || ext === 'htm') {
    comment = '<!-- equall-ignore-file -->'
  } else {
    comment = '// equall-ignore-file'
  }

  await writeFile(absolutePath, comment + '\n' + content, 'utf-8')
  return { file: filePath, comment }
}

// Remove an ignore comment by file path, or file:line
export async function removeIgnore(rootPath: string, target: string): Promise<{ removed: IgnoreEntry[], notFound: boolean }> {
  const ignores = await findIgnores(rootPath)

  // Parse target: "file.tsx:42" or "file.tsx"
  const colonIdx = target.lastIndexOf(':')
  let targetFile: string
  let targetLine: number | null = null

  if (colonIdx > 0) {
    const maybeLine = parseInt(target.slice(colonIdx + 1), 10)
    if (!isNaN(maybeLine)) {
      targetFile = target.slice(0, colonIdx)
      targetLine = maybeLine
    } else {
      targetFile = target
    }
  } else {
    targetFile = target
  }

  // Find matching ignores
  const matches = ignores.filter(e => {
    if (e.file_path !== targetFile) return false
    if (targetLine !== null) return e.line === targetLine
    return true
  })

  if (matches.length === 0) {
    return { removed: [], notFound: true }
  }

  // Group by file for batch editing
  const byFile = new Map<string, number[]>()
  for (const m of matches) {
    const lines = byFile.get(m.file_path) ?? []
    lines.push(m.line)
    byFile.set(m.file_path, lines)
  }

  for (const [filePath, lineNumbers] of byFile) {
    const absolutePath = resolve(rootPath, filePath)
    const content = await readFile(absolutePath, 'utf-8')
    const lines = content.split('\n')

    // Remove lines in reverse order to preserve indices
    const toRemove = new Set(lineNumbers.map(l => l - 1))
    const newLines = lines.filter((_, i) => !toRemove.has(i))

    await writeFile(absolutePath, newLines.join('\n'), 'utf-8')
  }

  return { removed: matches, notFound: false }
}

// Add an ignore comment above a specific line
export async function addIgnore(
  rootPath: string,
  target: string,
  ruleId?: string
): Promise<{ file: string; line: number; comment: string } | null> {
  // Parse target: "file.tsx:42"
  const colonIdx = target.lastIndexOf(':')
  if (colonIdx <= 0) return null

  const targetFile = target.slice(0, colonIdx)
  const targetLine = parseInt(target.slice(colonIdx + 1), 10)
  if (isNaN(targetLine) || targetLine < 1) return null

  const absolutePath = resolve(rootPath, targetFile)
  let content: string
  try {
    content = await readFile(absolutePath, 'utf-8')
  } catch {
    return null
  }

  const lines = content.split('\n')
  if (targetLine > lines.length) return null

  // Detect indentation from the target line
  const targetContent = lines[targetLine - 1]
  const indent = targetContent.match(/^(\s*)/)?.[1] ?? ''

  // Detect comment style from file extension
  const ext = targetFile.split('.').pop()?.toLowerCase()
  const ruleSuffix = ruleId ? ` ${ruleId}` : ''
  let comment: string

  if (ext === 'html' || ext === 'htm') {
    comment = `${indent}<!-- equall-ignore-next-line${ruleSuffix} -->`
  } else if (ext === 'jsx' || ext === 'tsx') {
    // Use JSX comment if the line looks like JSX (inside a return/render)
    const inJsx = targetContent.trimStart().startsWith('<') || targetContent.includes('>')
    comment = inJsx
      ? `${indent}{/* equall-ignore-next-line${ruleSuffix} */}`
      : `${indent}// equall-ignore-next-line${ruleSuffix}`
  } else {
    comment = `${indent}// equall-ignore-next-line${ruleSuffix}`
  }

  // Insert the comment above the target line
  lines.splice(targetLine - 1, 0, comment)
  await writeFile(absolutePath, lines.join('\n'), 'utf-8')

  return { file: targetFile, line: targetLine, comment }
}

// Remove all ignore comments from the project
export async function clearAllIgnores(rootPath: string): Promise<IgnoreEntry[]> {
  const ignores = await findIgnores(rootPath)
  if (ignores.length === 0) return []

  const byFile = new Map<string, number[]>()
  for (const entry of ignores) {
    const lines = byFile.get(entry.file_path) ?? []
    lines.push(entry.line)
    byFile.set(entry.file_path, lines)
  }

  for (const [filePath, lineNumbers] of byFile) {
    const absolutePath = resolve(rootPath, filePath)
    const content = await readFile(absolutePath, 'utf-8')
    const lines = content.split('\n')

    const toRemove = new Set(lineNumbers.map(l => l - 1))
    const newLines = lines.filter((_, i) => !toRemove.has(i))

    await writeFile(absolutePath, newLines.join('\n'), 'utf-8')
  }

  return ignores
}
