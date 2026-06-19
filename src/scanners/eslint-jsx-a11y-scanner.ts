import { ESLint, type Linter } from 'eslint'
import jsxA11yModule from 'eslint-plugin-jsx-a11y'
import * as tsParser from '@typescript-eslint/parser'
import { createRequire } from 'node:module'
import type {
  ScannerAdapter,
  ScanContext,
  EquallIssue,
  Severity,
  PourPrinciple,
  WcagLevel,
  FileType,
} from '../types.js'

const jsxA11y = (jsxA11yModule as any).default ?? jsxA11yModule

// Mapping eslint-plugin-jsx-a11y rules → WCAG criteria + POUR
// Source: https://github.com/jsx-eslint/eslint-plugin-jsx-a11y#supported-rules
const RULE_WCAG_MAP: Record<string, { criteria: string[]; pour: PourPrinciple }> = {
  'jsx-a11y/alt-text':                    { criteria: ['1.1.1'], pour: 'perceivable' },
  'jsx-a11y/anchor-has-content':          { criteria: ['2.4.4', '4.1.2'], pour: 'operable' },
  'jsx-a11y/anchor-is-valid':             { criteria: ['2.4.4'], pour: 'operable' },
  'jsx-a11y/aria-activedescendant-has-tabindex': { criteria: ['4.1.2'], pour: 'robust' },
  'jsx-a11y/aria-props':                  { criteria: ['4.1.2'], pour: 'robust' },
  'jsx-a11y/aria-proptypes':              { criteria: ['4.1.2'], pour: 'robust' },
  'jsx-a11y/aria-role':                   { criteria: ['4.1.2'], pour: 'robust' },
  'jsx-a11y/aria-unsupported-elements':   { criteria: ['4.1.2'], pour: 'robust' },
  'jsx-a11y/autocomplete-valid':          { criteria: ['1.3.5'], pour: 'perceivable' },
  'jsx-a11y/click-events-have-key-events': { criteria: ['2.1.1'], pour: 'operable' },
  'jsx-a11y/heading-has-content':         { criteria: ['2.4.6'], pour: 'operable' },
  'jsx-a11y/html-has-lang':               { criteria: ['3.1.1'], pour: 'understandable' },
  'jsx-a11y/iframe-has-title':            { criteria: ['2.4.1', '4.1.2'], pour: 'operable' },
  'jsx-a11y/img-redundant-alt':           { criteria: ['1.1.1'], pour: 'perceivable' },
  'jsx-a11y/interactive-supports-focus':   { criteria: ['2.1.1', '2.4.7'], pour: 'operable' },
  'jsx-a11y/label-has-associated-control': { criteria: ['1.3.1', '3.3.2'], pour: 'perceivable' },
  'jsx-a11y/lang':                        { criteria: ['3.1.2'], pour: 'understandable' },
  'jsx-a11y/media-has-caption':           { criteria: ['1.2.2', '1.2.3'], pour: 'perceivable' },
  'jsx-a11y/mouse-events-have-key-events': { criteria: ['2.1.1'], pour: 'operable' },
  'jsx-a11y/no-access-key':               { criteria: ['2.1.1'], pour: 'operable' },
  'jsx-a11y/no-autofocus':                { criteria: ['2.4.3'], pour: 'operable' },
  'jsx-a11y/no-distracting-elements':     { criteria: ['2.3.1'], pour: 'operable' },
  'jsx-a11y/no-interactive-element-to-noninteractive-role': { criteria: ['4.1.2'], pour: 'robust' },
  'jsx-a11y/no-noninteractive-element-interactions': { criteria: ['2.1.1'], pour: 'operable' },
  'jsx-a11y/no-noninteractive-element-to-interactive-role': { criteria: ['4.1.2'], pour: 'robust' },
  'jsx-a11y/no-noninteractive-tabindex':  { criteria: ['2.4.3'], pour: 'operable' },
  'jsx-a11y/no-redundant-roles':          { criteria: ['4.1.2'], pour: 'robust' },
  'jsx-a11y/no-static-element-interactions': { criteria: ['2.1.1'], pour: 'operable' },
  'jsx-a11y/prefer-tag-over-role':        { criteria: ['4.1.2'], pour: 'robust' },
  'jsx-a11y/role-has-required-aria-props': { criteria: ['4.1.2'], pour: 'robust' },
  'jsx-a11y/role-supports-aria-props':    { criteria: ['4.1.2'], pour: 'robust' },
  'jsx-a11y/scope':                       { criteria: ['1.3.1'], pour: 'perceivable' },
  'jsx-a11y/tabindex-no-positive':        { criteria: ['2.4.3'], pour: 'operable' },
}

// Map ESLint severity to Equall severity
function mapSeverity(eslintSeverity: number): Severity {
  switch (eslintSeverity) {
    case 2: return 'serious'     // error
    case 1: return 'moderate'    // warning
    default: return 'minor'
  }
}

// AA criteria in our RULE_WCAG_MAP — all others are Level A
const AA_CRITERIA = new Set(['1.3.5', '2.4.6', '2.4.7', '3.1.2', '3.3.2'])

// Slice the offending source token out of the file, using the message's reported
// span (line/column → endLine/endColumn). The text is what gives the issue a stable
// fingerprint (BUR-106); the positions are only used here to find it, never stored.
function extractTokenContext(content: string, msg: Linter.LintMessage): string | null {
  if (!msg.line) return null
  const lines = content.split('\n')
  if (msg.line < 1 || msg.line > lines.length) return null

  const startLine = msg.line
  const endLine = msg.endLine ?? msg.line
  const startCol = (msg.column ?? 1) - 1
  const endCol = (msg.endColumn ?? (lines[endLine - 1]?.length ?? 0) + 1) - 1

  let raw: string
  if (endLine === startLine) {
    raw = lines[startLine - 1].slice(startCol, endCol)
  } else {
    const parts = [lines[startLine - 1].slice(startCol)]
    for (let i = startLine; i < endLine - 1; i++) parts.push(lines[i])
    parts.push((lines[endLine - 1] ?? '').slice(0, endCol))
    raw = parts.join(' ')
  }

  const trimmed = raw.trim()
  return trimmed ? trimmed.slice(0, 200) : null
}


export class EslintJsxA11yScanner implements ScannerAdapter {
  name = 'eslint-jsx-a11y'
  version = ''
  fileTypes: FileType[] = ['jsx', 'tsx']
  coveredCriteria = [
    '1.1.1', '1.2.2', '1.2.3', '1.3.1', '1.3.5',
    '2.1.1', '2.3.1', '2.4.1', '2.4.3', '2.4.4', '2.4.6', '2.4.7',
    '3.1.1', '3.1.2', '3.3.2',
    '4.1.2',
  ]

  async isAvailable(): Promise<boolean> {
    return true
  }

  async scan(context: ScanContext): Promise<EquallIssue[]> {
    // Read version from the plugin's package.json (meta.version is unreliable)
    try {
      const req = createRequire(import.meta.url)
      const pluginPkg = req('eslint-plugin-jsx-a11y/package.json')
      this.version = pluginPkg.version ?? 'unknown'
    } catch {
      this.version = jsxA11y?.meta?.version ?? 'unknown'
    }

    // Only scan JSX/TSX files
    const jsxFiles = context.files.filter((f) => f.type === 'jsx' || f.type === 'tsx')
    if (jsxFiles.length === 0) return []

    // Build flat config with jsx-a11y recommended rules
    const eslint = new ESLint({
      overrideConfigFile: true,
      overrideConfig: [
        {
          files: ['**/*.{jsx,tsx,js,ts}'],
          plugins: {
            'jsx-a11y': jsxA11y,
          },
          rules: Object.fromEntries(
            Object.keys(RULE_WCAG_MAP).map((rule) => [rule, 'error'])
          ),
          languageOptions: {
            parser: tsParser.default ?? tsParser,
            parserOptions: {
              ecmaFeatures: { jsx: true },
            },
          },
        },
      ],
      cwd: context.root_path,
    })

    const allIssues: EquallIssue[] = []

    try {
      // Disk mode: lintFiles reads from the filesystem (unchanged behavior).
      // In-memory mode (T1.1): buffers don't exist on disk, so lint the content
      // directly via lintText. warnIgnored:false stops a virtual path that looks
      // ignored from being silently skipped (the false-negative trap); the filePath
      // keeps a real extension so the flat config still parses it as JSX/TSX.
      let results: ESLint.LintResult[]
      if (context.in_memory) {
        const perFile = await Promise.all(
          jsxFiles.map((f) =>
            eslint.lintText(f.content, { filePath: f.absolute_path, warnIgnored: false })
          )
        )
        results = perFile.flat()
      } else {
        results = await eslint.lintFiles(jsxFiles.map((f) => f.absolute_path))
      }

      for (const result of results) {
        const fileEntry = jsxFiles.find((f) => f.absolute_path === result.filePath)
        const relativePath = fileEntry?.path ?? result.filePath

        for (const msg of result.messages) {
          if (!msg.ruleId || !msg.ruleId.startsWith('jsx-a11y/')) continue

          const wcagMapping = RULE_WCAG_MAP[msg.ruleId]
          const criteria = wcagMapping?.criteria ?? []
          const pour = wcagMapping?.pour ?? null

          // Capture the offending source token so the issue gets a stable identity
          // (BUR-106). We use line/column only to *locate* the token at scan time —
          // the fingerprint hashes the token text, not its position, so a reformat
          // that moves the line keeps the identity stable.
          const tokenContext = fileEntry ? extractTokenContext(fileEntry.content, msg) : null

          // Split criteria by WCAG level so each issue has a single level
          const aCriteria = criteria.filter(c => !AA_CRITERIA.has(c))
          const aaCriteria = criteria.filter(c => AA_CRITERIA.has(c))
          const groups: { criteria: string[]; level: WcagLevel }[] = []
          if (aCriteria.length > 0) groups.push({ criteria: aCriteria, level: 'A' })
          if (aaCriteria.length > 0) groups.push({ criteria: aaCriteria, level: 'AA' })
          if (groups.length === 0) groups.push({ criteria, level: 'A' })

          for (const group of groups) {
            allIssues.push({
              scanner: 'eslint-jsx-a11y',
              scanner_rule_id: msg.ruleId,
              wcag_criteria: group.criteria,
              wcag_level: group.level,
              pour,
              file_path: relativePath,
              line: msg.line ?? null,
              column: msg.column ?? null,
              html_snippet: tokenContext,
              severity: mapSeverity(msg.severity),
              message: `${msg.message} (${msg.ruleId})`,
              help_url: `https://github.com/jsx-eslint/eslint-plugin-jsx-a11y/blob/main/docs/rules/${msg.ruleId.replace('jsx-a11y/', '')}.md`,
              suggestion: msg.fix ? 'Auto-fixable' : null,
            })
          }
        }
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      console.warn(`  [eslint-jsx-a11y] Scan failed: ${errMsg.slice(0, 120)}`)
    }

    return allIssues
  }
}
