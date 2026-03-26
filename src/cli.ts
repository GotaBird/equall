#!/usr/bin/env node

import { Command } from 'commander'
import { runScan } from './scan.js'
import { printResult, printJson } from './output/terminal.js'
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
  .option('--no-color', 'Disable colored output')
  .action(async (path: string, opts: { level: string; include?: string[]; exclude?: string[]; json?: boolean }) => {
    const level = opts.level.toUpperCase() as WcagLevel
    if (!['A', 'AA', 'AAA'].includes(level)) {
      console.error(`Invalid level "${opts.level}". Use A, AA, or AAA.`)
      process.exit(1)
    }

    const { resolve, basename } = await import('node:path')
    const displayName = basename(resolve(path))

    const ora = (await import('ora')).default
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
        printResult(result)
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

program.parse()
