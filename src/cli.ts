#!/usr/bin/env node

import { resolve, basename } from 'node:path'
import { Command } from 'commander'
import ora from 'ora'
import { runScan } from './scan.js'
import { printResult, printJson } from './output/terminal.js'
import { findIgnores, removeIgnore, clearAllIgnores, addIgnore } from './ignores.js'
import type { WcagLevel } from './types.js'

const program = new Command()

program
  .name('equall')
  .description('Open-source accessibility scoring — aggregates axe-core, eslint-plugin-jsx-a11y, and more.')
  .version('0.1.0')

program
  .command('scan')
  .description('Scan a project for accessibility issues')
  .argument('[path]', 'Path to project root', '.')
  .option('-l, --level <level>', 'WCAG conformance target: A, AA, or AAA', 'AA')
  .option('--include <patterns...>', 'Glob patterns to include')
  .option('--exclude <patterns...>', 'Glob patterns to exclude')
  .option('--json', 'Output results as JSON')
  .option('--verbose', 'Show ignored issues and extra details')
  .option('--no-color', 'Disable colored output')
  .action(async (path: string, opts: { level: string; include?: string[]; exclude?: string[]; json?: boolean; verbose?: boolean }) => {
    const level = opts.level.toUpperCase() as WcagLevel
    if (!['A', 'AA', 'AAA'].includes(level)) {
      console.error(`Invalid level "${opts.level}". Use A, AA, or AAA.`)
      process.exit(1)
    }

    const displayName = basename(resolve(path))

    const spinner = opts.json
      ? null
      : ora({ text: `Scanning ${displayName}`, indent: 2 }).start()

    try {
      const result = await runScan({
        path,
        level,
        include: opts.include,
        exclude: opts.exclude,
      })

      spinner?.stop()

      if (result.summary.files_scanned === 0) {
        if (opts.json) {
          printJson(result)
        } else {
          console.log('\n  No scannable files found (.html, .jsx, .tsx, .vue, .svelte, .astro)')
          console.log('  Check the path or use --include to specify patterns.\n')
        }
        process.exit(0)
      }

      if (opts.json) {
        printJson(result)
      } else {
        printResult(result, { verbose: opts.verbose })
      }

      // Exit code based on score
      if (result.score < 50) process.exit(1)
    } catch (error) {
      spinner?.stop()
      const msg = error instanceof Error ? error.message : String(error)
      console.error(`\n  Error: ${msg}\n`)
      process.exit(2)
    }
  })

const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'

program
  .command('ignore')
  .description('Add an equall-ignore comment above a specific line')
  .argument('<target>', 'File and line to ignore (e.g. components/Modal.tsx:89)')
  .argument('[rule-id]', 'Optional rule ID to ignore (e.g. jsx-a11y/alt-text)')
  .option('-p, --path <path>', 'Path to project root', '.')
  .action(async (target: string, ruleId: string | undefined, opts: { path: string }) => {
    const rootPath = resolve(opts.path)

    const result = await addIgnore(rootPath, target, ruleId)
    if (!result) {
      console.error(`\n  Could not add ignore at ${target}. Check that the file and line exist.\n`)
      process.exit(1)
    }

    console.log(`\n  ${GREEN}Added${RESET} ${result.file}:${result.line}`)
    console.log(`  ${DIM}${result.comment.trim()}${RESET}\n`)
  })

program
  .command('ignores')
  .description('List and manage equall-ignore comments')
  .argument('[path]', 'Path to project root', '.')
  .option('--remove <target>', 'Remove ignore at file:line or all ignores in a file')
  .option('--clear', 'Remove all equall-ignore comments from the project')
  .action(async (path: string, opts: { remove?: string; clear?: boolean }) => {
    const rootPath = resolve(path)

    if (opts.clear) {
      const removed = await clearAllIgnores(rootPath)
      if (removed.length === 0) {
        console.log('\n  No equall-ignore comments found.\n')
      } else {
        console.log(`\n  ${GREEN}Removed ${removed.length} ignore comment${removed.length > 1 ? 's' : ''}${RESET}\n`)
      }
      return
    }

    if (opts.remove) {
      const { removed, notFound } = await removeIgnore(rootPath, opts.remove)
      if (notFound) {
        console.error(`\n  No equall-ignore found at ${opts.remove}\n`)
        process.exit(1)
      }
      for (const entry of removed) {
        const location = entry.type === 'file' ? '' : `:${entry.line}`
        console.log(`  ${GREEN}Removed${RESET} ${entry.file_path}${location}  ${DIM}${entry.raw}${RESET}`)
      }
      console.log()
      return
    }

    // Default: list all ignores
    const ignores = await findIgnores(rootPath)
    if (ignores.length === 0) {
      console.log('\n  No equall-ignore comments found.\n')
      return
    }

    console.log(`\n  ${BOLD}${ignores.length} ignore${ignores.length > 1 ? 's' : ''}${RESET}\n`)
    for (const entry of ignores) {
      const location = `:${entry.line}`
      const type = entry.type === 'file'
        ? `${YELLOW}equall-ignore-file${RESET}`
        : `equall-ignore-next-line`
      const rule = entry.rule_id ? `  ${DIM}${entry.rule_id}${RESET}` : `  ${DIM}(all rules)${RESET}`
      console.log(`  ${entry.file_path}${location}${' '.repeat(Math.max(1, 40 - entry.file_path.length - location.length))}${type}${rule}`)
    }
    console.log()
  })

program.parse()
