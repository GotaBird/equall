#!/usr/bin/env node

import { resolve, basename } from 'node:path'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Command } from 'commander'
import ora from 'ora'
import { runScan } from './scan.js'
import { printResult, printJson } from './output/terminal.js'
import { findIgnores, removeIgnore, clearAllIgnores, addIgnore, addIgnoreFile } from './ignores.js'
import type { WcagLevel } from './types.js'

const __dir = resolve(fileURLToPath(import.meta.url), '..')
const pkg = JSON.parse(readFileSync(resolve(__dir, '..', 'package.json'), 'utf-8'))

const program = new Command()

program
  .name('equall')
  .description('Open-source accessibility scoring — aggregates axe-core, eslint-plugin-jsx-a11y, and more.')
  .version(pkg.version)

program
  .command('scan')
  .description('Scan a project for accessibility issues')
  .argument('[path]', 'Path to project root', '.')
  .option('-l, --level <level>', 'WCAG conformance target: A, AA, or AAA', 'AA')
  .option('--include <patterns...>', 'Glob patterns to include')
  .option('--exclude <patterns...>', 'Glob patterns to exclude')
  .option('--json', 'Output results as JSON')
  .option('-i, --show-ignored', 'Show ignored issues in output')
  .option('--no-color', 'Disable colored output')
  .action(async (path: string, opts: { level: string; include?: string[]; exclude?: string[]; json?: boolean; showIgnored?: boolean }) => {
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
        printResult(result, { showIgnored: opts.showIgnored })
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
  .description('Add, list, or remove equall-ignore comments')
  .argument('[target]', 'File:line to ignore (e.g. src/Modal.tsx:89)')
  .argument('[rule-id]', 'Optional rule ID (e.g. jsx-a11y/alt-text)')
  .option('-p, --path <path>', 'Path to project root', '.')
  .option('--remove <target>', 'Remove ignore at file:line or all ignores in a file')
  .option('--clear', 'Remove all equall-ignore comments from the project')
  .option('--list', 'List all equall-ignore comments')
  .action(async (target: string | undefined, ruleId: string | undefined, opts: { path: string; remove?: string; clear?: boolean; list?: boolean }) => {
    const rootPath = resolve(opts.path)

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

    // Add an ignore
    if (target && target.includes(':')) {
      const result = await addIgnore(rootPath, target, ruleId)
      if (!result) {
        console.error(`\n  Could not add ignore at ${target}. Check that the file and line exist.\n`)
        process.exit(1)
      }
      console.log(`\n  ${GREEN}Added${RESET} ${result.file}:${result.line}`)
      console.log(`  ${DIM}${result.comment.trim()}${RESET}\n`)
      return
    }

    // Target looks like a file path without :line — add equall-ignore-file
    const isDirectory = target && existsSync(resolve(rootPath, target)) && statSync(resolve(rootPath, target)).isDirectory()
    if (target && !isDirectory && (target.includes('/') || target.match(/\.\w+$/))) {
      const result = await addIgnoreFile(rootPath, target)
      if (!result) {
        console.error(`\n  Could not ignore ${target}. File not found or already ignored.\n`)
        process.exit(1)
      }
      console.log(`\n  ${GREEN}Added${RESET} ${result.file}`)
      console.log(`  ${DIM}${result.comment}${RESET}\n`)
      return
    }

    // List all ignores (default, or --list, or bare path)
    const listPath = target ? resolve(target) : rootPath
    const ignores = await findIgnores(listPath)
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
