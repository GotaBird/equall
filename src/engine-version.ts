import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Single source of truth for the engine (package) version, resolved at runtime
// from the shipped package.json. Works from both the built module (dist/*.js →
// ../package.json) and dev (src/*.ts → ../package.json) because the file sits one
// directory below the package root in both layouts. Mirrors cli.ts's own read so
// the CLI `--version` and the stamped ScanResult.engine_version never diverge.
const pkgPath = resolve(fileURLToPath(import.meta.url), '..', '..', 'package.json')

export const ENGINE_VERSION: string = JSON.parse(readFileSync(pkgPath, 'utf-8')).version
