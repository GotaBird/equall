import { describe, it, expect } from 'vitest'
import { mayHaveMarkupInComment, neutralizeCommentMarkup } from '../utils/js-comments.js'
import { extractHtml } from '../utils/html-extract.js'
import { scanBuffer } from '../scan.js'
import type { EquallIssue, ScanResult } from '../types.js'

// Text inside a JavaScript comment must never become an element of the markup handed to
// axe-core: `// no <img src> here` used to be reported as an image without alternative text.
// The fix touches the `<` inside comments and nothing else: where the markup starts and
// ends, and every finding on real markup (line, snippet, fingerprint), stay as they were.

const byRule = (r: ScanResult, rule: string) => r.issues.filter((i) => i.scanner_rule_id === rule)
const fromAxe = (i: EquallIssue) => i.scanner === 'axe-core' || (i.scanners ?? []).includes('axe-core')

// A labelled CSS dot, with a comment that names an <img> between `return (` and the element.
const DOT = (comment: string) => `export function Dot({ label }: { label: string }) {
    return (
        ${comment}
        <span className="dot" role="img" aria-label={label} />
    )
}
`

describe('neutralizeCommentMarkup', () => {
  it('replaces `<` inside line, block and JSX comments, and nothing else', () => {
    const source = `// one <img>\nconst a = 1 /* two\n<img> */\nconst b = <p>{/* three <img> */}text</p>\n`
    const out = neutralizeCommentMarkup(source, 'tsx')
    expect(out).toBe(`// one  img>\nconst a = 1 /* two\n img> */\nconst b = <p>{/* three  img> */}text</p>\n`)
    expect(out).toHaveLength(source.length)
  })

  it('keeps `<` wherever `//` and `/*` are not comments: strings, URLs in JSX text, template literals', () => {
    const source = [
      `const url = "https://example.test/a<b" // real <comment>`,
      'const t = `// not a comment <i> ${1} /* nor <b> this */`',
      `const el = <a href="https://example.test/b">see http://example.test/c // still <b>text</b></a>`,
      '',
    ].join('\n')
    const out = neutralizeCommentMarkup(source, 'tsx')
    expect(out).toBe(source.replace('// real <comment>', '// real  comment>'))
  })

  it('reads the syntax the lint scanner reads: top-level await, decorators, type syntax', () => {
    const source = `const data = await load() // top-level <img>
@sealed // decorator <img>
class Store<T extends object> {
  value?: T
}
export function View() {
  return (
    // inside <img>
    <div>ok</div>
  )
}
`
    const out = neutralizeCommentMarkup(source, 'tsx')
    expect(out).not.toContain('<img>')
    expect(out).toContain('class Store<T extends object>')
    expect(out).toContain('<div>ok</div>')
  })

  it('returns a file with no comment, or with no `<` in its comments, as the same string', () => {
    const plain = `export const A = () => <p>plain</p>\n`
    const harmless = `// nothing to see\nexport const B = () => <p>plain</p>\n`
    expect(neutralizeCommentMarkup(plain, 'jsx')).toBe(plain)
    expect(neutralizeCommentMarkup(harmless, 'jsx')).toBe(harmless)
  })

  it('leaves a file the parser cannot read as written', () => {
    const source = `export function Broken() {\n  return (\n    // an <img src>\n    <div>\n`
    expect(neutralizeCommentMarkup(source, 'tsx')).toBe(source)
  })
})

// The check that decides whether a file is parsed at all. It may say yes too often (a parse
// for nothing); it must never say no for a file whose comment holds a `<`, and it must stay
// fast on any input, since in-memory scans receive text nobody has vetted.
describe('mayHaveMarkupInComment', () => {
  it('says yes for every form of comment that holds a `<`', () => {
    const yes = [
      '// a <b>',
      'x = 1 // a <b>',
      'x = 1 // a <b>\r\ny = 2',
      'const a = 1\n// last line, no newline <b>',
      '/* <b> */',
      '/** <b> */',
      '/**<*/',
      '/*/ < */',
      '/* first line\n   second <b> line\n*/',
      '/* one */ /* two <b> */',
      '<p>{/* <b> */}</p>',
      '<input /* was <input> */ type="text" />',
      '/* line  <b> */',
    ]
    for (const text of yes) expect(mayHaveMarkupInComment(text), JSON.stringify(text)).toBe(true)
  })

  it('says no when no comment form can hold a `<`', () => {
    const no = [
      '',
      'const a = <p>plain</p>',
      '<p>a</p> // trailing, tag before the comment',
      '<p>a</p>\n// next line has the tag\n<p>b</p>',
      '<p>a</p> /* closed before the tag */ <p>b</p>',
      '/* never closed <b>',
      'const glob = "src/**/*.tsx"\nconst el = <p>x</p>',
    ]
    for (const text of no) expect(mayHaveMarkupInComment(text), JSON.stringify(text)).toBe(false)
  })

  it('agrees with the pattern it replaces on generated inputs', () => {
    // The reference is the direct statement of the condition; it is too slow to ship
    // (it retries from every `<`), which is why the shipped check is a forward scan.
    const reference = /\/\/[^\n]*<|\/\*(?:(?!\*\/)[\s\S])*?<(?:(?!\*\/)[\s\S])*?\*\//
    const pieces = ['//', '/*', '*/', '<', '\n', 'a', ' ', '/', '*']
    let seed = 7
    const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff)
    for (let n = 0; n < 3000; n++) {
      let text = ''
      for (let k = next() % 12; k >= 0; k--) text += pieces[next() % pieces.length]
      expect(mayHaveMarkupInComment(text), JSON.stringify(text)).toBe(reference.test(text))
    }
  })

  it('stays fast on inputs that defeat a backtracking pattern', () => {
    // Ordinary code: route paths ending in `/*`, in a file with JSX and no block comment.
    const routes = Array.from({ length: 6000 }, (_, n) => `<Route path="/section${n}/*" element={<Section${n} />} />`).join('\n')
    // Adversarial: thousands of comment openers, each followed by a `<`, never closed.
    const openers = '/* < '.repeat(60000)
    const started = performance.now()
    expect(mayHaveMarkupInComment(routes)).toBe(false)
    expect(mayHaveMarkupInComment(openers)).toBe(false)
    expect(mayHaveMarkupInComment('// x\n'.repeat(60000) + '<p/>')).toBe(false)
    expect(performance.now() - started).toBeLessThan(500)
  })
})

describe('extractHtml on jsx/tsx', () => {
  it('a tag named in a comment does not reach the markup; the comment text stays', () => {
    const html = extractHtml(DOT('// a CSS dot, no image resource to put in an <img src>'), 'tsx')
    expect(html).not.toContain('<img')
    expect(html).toContain('no image resource to put in an  img src>')
    expect(html).toContain('<span')
    expect(html).toContain('role="img"')
  })

  it('comments do not move where the markup starts or ends', () => {
    // A comment after a `)` keeps that `)` from closing the region early: the markup after
    // it is still extracted, up to the real closing tag.
    const handler = extractHtml(
      `export function A() {\n  return (\n    <form>\n      <button onClick={() => {\n        track(1) // record the click\n      }}>Go</button>\n      <input type="text" />\n    </form>\n  )\n}\n`,
      'tsx'
    )
    expect(handler.startsWith('<form>')).toBe(true)
    expect(handler).toContain('<input type="text" />')
    expect(handler.endsWith('</form>')).toBe(true)

    const map = extractHtml(
      `export function B() {\n  return (\n    <ul>\n      {items.map((i) => (\n        <li key={i}>{i}</li>\n      )) /* one row per item */}\n      <li><input type="text" /></li>\n    </ul>\n  )\n}\n`,
      'tsx'
    )
    expect(map.startsWith('<ul>')).toBe(true)
    expect(map).toContain('<input type="text" />')
    expect(map.endsWith('</ul>')).toBe(true)

    // Known limit, unchanged: a commented-out `return (` above the real one is still the
    // region the extraction picks. Its tag no longer becomes an element.
    const commentedReturn = extractHtml(
      `export function C() {\n  // old: return (<Spinner />)\n  return (\n    <main>\n      <input type="text" />\n    </main>\n  )\n}\n`,
      'tsx'
    )
    expect(commentedReturn).toBe(' Spinner />')
  })
})

describe('scan: HTML-like text in a comment is not a finding', () => {
  it('reports no image-alt for `<img src>` named in a line comment (tsx)', async () => {
    const result = await scanBuffer(DOT('// a CSS dot, no image resource to put in an <img src>'), 'src/Dot.tsx')
    expect(byRule(result, 'image-alt')).toEqual([])
    // The labelled role="img" element itself is fine for axe: no axe finding at all.
    expect(result.issues.filter((i) => i.scanner === 'axe-core' && !i.review_only)).toEqual([])
  }, 30000)

  it('the file scores and identifies its findings as the same file without the tag text', async () => {
    const withTag = await scanBuffer(DOT('// a CSS dot, no image resource to put in an <img src>'), 'src/Dot.tsx')
    const without = await scanBuffer(DOT('// a CSS dot, no image resource'), 'src/Dot.tsx')
    expect(withTag.score).toBe(without.score)
    expect(withTag.issues.map((i) => i.fingerprint)).toEqual(without.issues.map((i) => i.fingerprint))
  }, 30000)

  it('covers block comments and JSX comments, in .jsx too', async () => {
    const block = await scanBuffer(
      `export function A() {\n  return (\n    /* was: <img src="a.png"> */\n    <p>Text</p>\n  )\n}\n`,
      'A.jsx'
    )
    const jsx = await scanBuffer(
      `export function B() {\n  return (\n    <div>\n      {/* <img src="b.png"> */}\n      <p>Text</p>\n    </div>\n  )\n}\n`,
      'B.jsx'
    )
    expect(byRule(block, 'image-alt')).toEqual([])
    expect(byRule(jsx, 'image-alt')).toEqual([])
  }, 30000)

  it('a real image next to a comment naming one is still seen by axe, once, on its own line', async () => {
    const result = await scanBuffer(
      `export function Hero() {
  return (
    <div>
      {/* the hero <img src="hero.png"> must stay */}
      <img src="hero.png" />
    </div>
  )
}
`,
      'Hero.tsx'
    )
    const missingAlt = result.issues.filter((i) => i.wcag_criteria.includes('1.1.1'))
    // One image, one finding: the lint and axe findings merge because axe sees one <img>.
    expect(missingAlt).toHaveLength(1)
    expect(missingAlt[0].line).toBe(5)
    expect(missingAlt[0].scanners).toEqual(expect.arrayContaining(['eslint-jsx-a11y', 'axe-core']))
  }, 30000)
})

// Findings that only axe-core reports (an input without a label), in files whose comments
// sit where they could shift the extracted region. Each must still be reported, on its line.
describe('scan: comments do not hide or move real findings', () => {
  const label = (r: ScanResult) => byRule(r, 'label').filter(fromAxe)

  it('after a trailing comment inside an inline handler', async () => {
    const result = await scanBuffer(
      `export function A({ x }: { x: number }) {
  return (
    <form>
      <button
        onClick={() => {
          track(x) // record the click
        }}
      >
        Go
      </button>
      <input type="text" />
    </form>
  )
}
`,
      'src/A.tsx'
    )
    expect(label(result)).toHaveLength(1)
    expect(label(result)[0].line).toBe(11)
  }, 30000)

  it('after a block comment that follows a closing parenthesis', async () => {
    const result = await scanBuffer(
      `export function E({ items }: { items: string[] }) {
  return (
    <ul>
      {items.map((i) => (
        <li key={i}>{i}</li>
      )) /* one row per item */}
      <li><input type="text" /></li>
    </ul>
  )
}
`,
      'src/E.tsx'
    )
    expect(label(result)).toHaveLength(1)
    expect(label(result)[0].line).toBe(7)
  }, 30000)

  // Seven shapes where a comment sits next to the parentheses the extraction relies on.
  // Each must give exactly what it gave before comments were neutralized: the same finding
  // with the same line and fingerprint, or, for the four the extraction has never read
  // fully (known limits, unchanged here), still no finding.
  const BOUNDARY_CASES: { name: string; source: string; expected: [line: number, fingerprint: string] | null }[] = [
    {
      name: 'a trailing comment inside an inline handler',
      source: `export function A({ x }: { x: number }) {
  return (
    <form>
      <button
        onClick={() => {
          track(x) // record the click
        }}
      >
        Go
      </button>
      <input type="text" />
    </form>
  )
}
`,
      expected: [11, '5d44719cb839e5d6'],
    },
    {
      name: 'a block comment after the closing parenthesis of a map',
      source: `export function E({ items }: { items: string[] }) {
  return (
    <div>
      {items.map((i) => (
        <p key={i}>{i}</p>
      )) /* one row per item */}
      <input type="text" />
    </div>
  )
}
`,
      expected: [7, '410aaa105afec914'],
    },
    {
      name: 'a block comment after the closing parenthesis of a condition',
      source: `export function H({ ok }: { ok: boolean }) {
  return (
    <div>
      {ok && (
        <p>fine</p>
      ) /* shown when ok */}
      <input type="text" />
    </div>
  )
}
`,
      expected: [7, 'dc99e89b9642500a'],
    },
    {
      name: 'a line comment after the closing parenthesis of the return (known limit)',
      source: `export function B() {
  return (
    <div>
      <input type="text" />
    </div>
  ) // end of B
}
`,
      expected: null,
    },
    {
      name: 'a parenthesis inside a JSX comment that ends on the next line (known limit)',
      source: `export function C() {
  return (
    <div>
      {/* legacy block (see docs)
      */}
      <input type="text" />
    </div>
  )
}
`,
      expected: null,
    },
    {
      name: 'a parenthesis inside a line comment between attributes (known limit)',
      source: `export function C2() {
  return (
    <div
      // wrapper (layout only)
      className="w"
    >
      <input type="text" />
    </div>
  )
}
`,
      expected: null,
    },
    {
      name: 'a commented-out return above the real one (known limit)',
      source: `export function G({ a }: { a: boolean }) {
  // old: return (<Spinner />)
  return (
    <div>
      <input type="text" />
    </div>
  )
}
`,
      expected: null,
    },
  ]

  const FILE_NAMES = ['A_handler', 'E_map', 'H_cond', 'B_trailing', 'C_parenComment', 'C2_lineParen', 'G_commentedReturn']
  BOUNDARY_CASES.forEach(({ name, source, expected }, index) => {
    it(`boundary unchanged: ${name}`, async () => {
      const result = await scanBuffer(source, `src/${FILE_NAMES[index]}.tsx`)
      const found = result.issues.filter((i) => i.scanner === 'axe-core').map((i) => [i.scanner_rule_id, i.line, i.fingerprint])
      expect(found).toEqual(expected ? [['label', ...expected]] : [])
    }, 30000)
  })

  it('an element that contains a JSX comment keeps its finding', async () => {
    const withComment = await scanBuffer(
      `export function S() {\n  return (\n    <form>\n      <select>{/* options come later */}</select>\n    </form>\n  )\n}\n`,
      'src/S.tsx'
    )
    const selectName = byRule(withComment, 'select-name')
    expect(selectName).toHaveLength(1)
    expect(selectName[0].line).toBe(4)
    // The comment text is part of the element's snippet, so it is part of its identity:
    // it must reach the fingerprint unchanged.
    expect(selectName[0].html_snippet).toContain('options come later')
  }, 30000)
})
