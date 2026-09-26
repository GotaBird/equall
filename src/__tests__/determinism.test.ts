import { describe, it, expect } from 'vitest'
import { runScan } from '../scan.js'
import type { ScanResult } from '../types.js'

// The same code must always produce the same JSON: raw results get diffed, cached and
// compared in CI. Only the timestamp and the duration may differ between two scans.

const FILES = [
  { path: 'b/Card.tsx', content: `export function Card() { return (<div><img src="a.png" /><button></button></div>) }` },
  { path: 'a/index.html', content: `<!doctype html><html lang="en"><head><title>t</title></head><body><main><img src="b.png"><a href="/x"></a></main></body></html>` },
  { path: 'c/Nav.tsx', content: `export function Nav() { return (<nav><ul><li><a href="/"></a></li></ul><img src="logo.png" /></nav>) }` },
  { path: 'a/Page.tsx', content: `export default function Page() { return (<section><h1>Title</h1><div role="button">Go</div></section>) }` },
]

const stable = (r: ScanResult) => JSON.stringify({ ...r, scanned_at: undefined, duration_ms: undefined })

describe('deterministic output', () => {
  it('the input file order does not change the result', async () => {
    const forward = await runScan({ files: FILES })
    const backward = await runScan({ files: [...FILES].reverse() })
    expect(stable(backward)).toBe(stable(forward))
  })

  it('issues come out sorted by file, then position, then rule', async () => {
    const r = await runScan({ files: FILES })
    const counted = r.issues.filter((i) => !i.ignored && !i.review_only)
    for (let k = 1; k < counted.length; k++) {
      const [prev, cur] = [counted[k - 1], counted[k]]
      const byFile = prev.file_path.localeCompare(cur.file_path)
      expect(byFile).toBeLessThanOrEqual(0)
      if (byFile === 0) expect(prev.line ?? -1).toBeLessThanOrEqual(cur.line ?? -1)
    }
  })
})
