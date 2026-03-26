import type { ScannerAdapter } from '../types.js'
import { AxeScanner } from './axe-scanner.js'
import { EslintJsxA11yScanner } from './eslint-jsx-a11y-scanner.js'

// Registry of all available scanner adapters
// Adding a new scanner = import + add to this array
const ALL_SCANNERS: ScannerAdapter[] = [
  new AxeScanner(),
  new EslintJsxA11yScanner(),
]

// Returns only scanners that are available (dependencies installed)
export async function getAvailableScanners(): Promise<ScannerAdapter[]> {
  const checks = await Promise.all(
    ALL_SCANNERS.map(async (scanner) => ({
      scanner,
      available: await scanner.isAvailable(),
    }))
  )

  return checks
    .filter((c) => c.available)
    .map((c) => c.scanner)
}

export { AxeScanner, EslintJsxA11yScanner }
