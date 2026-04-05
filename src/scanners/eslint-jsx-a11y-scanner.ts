import { ESLint } from 'eslint'
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


export class EslintJsxA11yScanner implements ScannerAdapter {
  name = 'eslint-jsx-a11y'
  version = ''
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

    // Lint files in batches to avoid memory issues
    const filePaths = jsxFiles.map((f) => f.absolute_path)

    try {
      const results = await eslint.lintFiles(filePaths)

      for (const result of results) {
        const relativePath = jsxFiles.find(
          (f) => f.absolute_path === result.filePath
        )?.path ?? result.filePath

        for (const msg of result.messages) {
          if (!msg.ruleId || !msg.ruleId.startsWith('jsx-a11y/')) continue

          const wcagMapping = RULE_WCAG_MAP[msg.ruleId]
          const criteria = wcagMapping?.criteria ?? []
          const pour = wcagMapping?.pour ?? null

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
              html_snippet: null,
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
