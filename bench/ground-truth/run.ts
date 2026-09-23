// Ground-truth reliability benchmark for the equall engine.
//
// Scans every case under ./cases through the PUBLIC API (`scanBuffer`, in-memory input,
// level AA), compares the findings to the human labels in ./labels.json and writes
// ./results.json + ./REPORT.md.
//
//   npx tsx bench/ground-truth/run.ts
//
// This script never modifies engine code. The only non-public import is `extractHtml`,
// used purely as a diagnostic to show what markup axe was handed for each case.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { EquallIssue, ScanResult } from '../../src/index.js'
import { extractHtml } from '../../src/utils/html-extract.js'
import { fileTypeForPath } from '../../src/discover.js'

const HERE = dirname(fileURLToPath(import.meta.url))

// Target: the built package (dist/, what npm users run) by default; `--src` scans through the
// TypeScript sources instead. The two differ in one way that matters: dist bundles its own
// axe-core copy, while src shares the node_modules axe-core singleton with
// eslint-plugin-jsx-a11y (see REPORT.md, "src vs dist").
const TARGET = process.argv.includes('--src') ? 'src' : 'dist'
const api: { scanBuffer: (c: string, f: string, o?: Record<string, unknown>) => Promise<ScanResult> } =
  TARGET === 'src' ? await import('../../src/index.js') : await import('../../dist/index.js' as string)
const scanBuffer = api.scanBuffer
const OUT_SUFFIX = TARGET === 'src' ? '.src' : ''
const CASES_DIR = join(HERE, 'cases')

// ---------------------------------------------------------------------------
// Defect catalogue: what a correct engine should report for each planted defect.
// Matching is by rule id (either engine). `scanners` lists which engines have a rule
// for it — used for per-scanner recall.
// ---------------------------------------------------------------------------
interface Defect { wcag: string[]; rules: string[] }
const DEFECTS: Record<string, Defect> = {
  'img-alt': { wcag: ['1.1.1'], rules: ['image-alt', 'jsx-a11y/alt-text'] },
  'button-name': { wcag: ['4.1.2'], rules: ['button-name'] },
  'control-label': { wcag: ['4.1.2', '1.3.1', '3.3.2'], rules: ['label', 'jsx-a11y/label-has-associated-control'] },
  'select-name': { wcag: ['4.1.2'], rules: ['select-name'] },
  'html-lang': { wcag: ['3.1.1'], rules: ['html-has-lang', 'jsx-a11y/html-has-lang'] },
  'doc-title': { wcag: ['2.4.2'], rules: ['document-title'] },
  'aria-attr-name': { wcag: ['4.1.2'], rules: ['aria-valid-attr', 'jsx-a11y/aria-props'] },
  'aria-attr-value': { wcag: ['4.1.2'], rules: ['aria-valid-attr-value', 'jsx-a11y/aria-proptypes'] },
  'positive-tabindex': { wcag: ['2.4.3'], rules: ['tabindex', 'jsx-a11y/tabindex-no-positive'] },
  'link-name': { wcag: ['2.4.4', '4.1.2'], rules: ['link-name', 'jsx-a11y/anchor-has-content'] },
  'frame-title': { wcag: ['4.1.2'], rules: ['frame-title', 'jsx-a11y/iframe-has-title'] },
  'role-invalid': { wcag: ['4.1.2'], rules: ['aria-roles', 'jsx-a11y/aria-role'] },
  'aria-hidden-focus': { wcag: ['4.1.2'], rules: ['aria-hidden-focus'] },
  'role-required-attr': { wcag: ['4.1.2'], rules: ['aria-required-attr', 'jsx-a11y/role-has-required-aria-props'] },
  'input-image-alt': { wcag: ['1.1.1'], rules: ['input-image-alt'] },
  'viewport-zoom': { wcag: ['1.4.4'], rules: ['meta-viewport'] },
  'list-structure': { wcag: ['1.3.1'], rules: ['list', 'listitem'] },
  'marquee': { wcag: ['2.2.2'], rules: ['marquee', 'jsx-a11y/no-distracting-elements'] },
  'keyboard-static-click': {
    wcag: ['2.1.1'],
    rules: ['jsx-a11y/click-events-have-key-events', 'jsx-a11y/no-static-element-interactions'],
  },
}

// Which engine owns a rule id (all jsx-a11y ids are prefixed; the other two are known ids).
function scannerOfRule(rule: string): string {
  if (rule.startsWith('jsx-a11y/')) return 'eslint-jsx-a11y'
  if (rule === 'aria-invalid-no-message') return 'error-identification'
  if (rule === 'reading-level-high') return 'readability'
  return 'axe-core'
}

// File types each engine accepts (mirrors the adapters' fileTypes — read from source,
// restated here so the benchmark can tell "engine could not see this file" from "missed").
const SCANNER_TYPES: Record<string, string[]> = {
  'axe-core': ['html', 'jsx', 'tsx', 'vue', 'astro', 'svelte'],
  'eslint-jsx-a11y': ['jsx', 'tsx', 'astro'],
  'readability': ['html', 'vue', 'astro'],
  'error-identification': ['html', 'vue', 'svelte', 'astro'],
}

// Cause taxonomy for false positives. The first six are the headline buckets; the
// sub-causes are folded into "other" in the headline table and broken out below it.
const HEADLINE_CAUSES = ['props-spread', 'map-children', 'dynamic-attr', 'custom-component', 'classname'] as const
const CAUSE_LABEL: Record<string, string> = {
  'props-spread': 'Props spread ({...props}, v-bind="$attrs")',
  'map-children': 'Children from .map() / children prop',
  'dynamic-attr': 'Stripped dynamic attribute (href={x}, aria-checked={x}, id={x}...)',
  'custom-component': 'Custom component read as an unknown HTML tag',
  'classname': 'className residue (cn()/clsx/template literal leaking into markup)',
  'other': 'Other',
  'extraction': 'Other: regex extraction picked the wrong/truncated block',
  'jsx-attr-name': 'Other: JSX attribute name not translated to HTML (htmlFor -> for)',
  'framework-binding': 'Other: framework binding syntax not understood (Vue :attr)',
  'framework-injected': 'Other: framework injects it at build time (Next metadata -> <title>)',
  'over-mapped-rule': 'Other: lint rule mapped to a WCAG SC it does not certainly fail',
  'aaa-at-aa': 'Other: AAA criterion reported on an AA scan',
  'i18n': 'Other: i18n text via t()',
  'conditional': 'Other: conditional rendering',
  'dedup': 'Other: dedup key collision',
  'axe-incomplete': 'axe returned "needs review" (incomplete) and the engine discards those',
}

// Rules whose WCAG mapping in the engine asserts more than the rule proves: they flag
// advice (prefer native tag, avoid autofocus, "picture" in alt, redundant role="list",
// href="#") that is not by itself a failure of the mapped success criterion. A false
// positive from one of these is attributed to the mapping, whatever the case's trap.
const INTRINSIC_CAUSE: Record<string, string> = {
  'jsx-a11y/prefer-tag-over-role': 'over-mapped-rule',
  'jsx-a11y/no-autofocus': 'over-mapped-rule',
  'jsx-a11y/img-redundant-alt': 'over-mapped-rule',
  'jsx-a11y/anchor-is-valid': 'over-mapped-rule',
  'jsx-a11y/no-redundant-roles': 'over-mapped-rule',
  'reading-level-high': 'aaa-at-aa',
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------
type Kind = 'violation' | 'clean' | 'indeterminate'
interface ExpectSpec { defect: string; count?: number }
interface Label {
  kind: Kind
  expect?: (string | ExpectSpec)[]
  acceptable?: string[]
  cause?: string
  fp_causes?: Record<string, string>
  note?: string
}
const labels: { cases: Record<string, Label> } = JSON.parse(readFileSync(join(HERE, 'labels.json'), 'utf8'))

function listFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...listFiles(p))
    else out.push(p)
  }
  return out
}

const caseFiles = listFiles(CASES_DIR).map((p) => relative(CASES_DIR, p).split('\\').join('/')).sort()
const unlabeled = caseFiles.filter((f) => !labels.cases[f])
const orphanLabels = Object.keys(labels.cases).filter((k) => !caseFiles.includes(k))
if (unlabeled.length || orphanLabels.length) {
  console.error('Label/corpus mismatch', { unlabeled, orphanLabels })
  process.exit(1)
}
for (const [k, l] of Object.entries(labels.cases)) {
  for (const e of l.expect ?? []) {
    const id = typeof e === 'string' ? e : e.defect
    if (!DEFECTS[id]) throw new Error(`${k}: unknown defect ${id}`)
  }
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------
type Verdict = 'TP' | 'FP' | 'duplicate' | 'acceptable'
interface JudgedIssue {
  verdict: Verdict
  defect?: string
  cause?: string
  rule: string
  scanner: string
  scanners?: string[]
  wcag: string[]
  best_practice: boolean
  severity: string
  line: number | null
  snippet: string | null
  message: string
}
interface Miss {
  defect: string
  missing: number
  rules: string[]
  eligible_scanners: string[]
  cause?: string
  // What the engine's own honest-coverage report said about the defect's criteria on this
  // file (auto = "genuinely tested"). A miss on an `auto` criterion is a silent miss.
  coverage_status: Record<string, string>
}
interface CaseResult {
  file: string
  type: string
  kind: Kind
  cause?: string
  note?: string
  issues: JudgedIssue[]
  misses: Miss[]
  per_scanner_detection: Record<string, { expected: number; detected: number }>
  reclassified: { rule: string; count: number }[]
  warnings: string[]
  extracted_html_for_axe: string
}

function eligibleScannersFor(defect: Defect, type: string): string[] {
  const s = new Set(defect.rules.map(scannerOfRule))
  return [...s].filter((name) => SCANNER_TYPES[name]?.includes(type))
}

async function evaluate(file: string, label: Label): Promise<CaseResult> {
  const content = readFileSync(join(CASES_DIR, file), 'utf8')
  const type = fileTypeForPath(file)

  // Capture the engine's console warnings (scanner skips) per case.
  const warnings: string[] = []
  const origWarn = console.warn
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ').trim()) }
  let result
  try {
    result = await scanBuffer(content, file, { level: 'AA' })
  } finally {
    console.warn = origWarn
  }
  for (const d of result.diagnostics ?? []) if (!d.startsWith('[routes]')) warnings.push(d)

  const active = result.issues.filter((i: EquallIssue) => !i.ignored)
  const remaining = new Set(active)
  const judged: JudgedIssue[] = []
  const misses: Miss[] = []
  const perScanner: Record<string, { expected: number; detected: number }> = {}

  const toJudged = (i: EquallIssue, verdict: Verdict, extra: Partial<JudgedIssue> = {}): JudgedIssue => ({
    verdict,
    rule: i.scanner_rule_id,
    scanner: i.scanner,
    scanners: (i as EquallIssue & { scanners?: string[] }).scanners,
    wcag: i.wcag_criteria,
    best_practice: i.wcag_criteria.length === 0,
    severity: i.severity,
    line: i.line,
    snippet: i.html_snippet,
    message: i.message,
    ...extra,
  })

  for (const e of label.expect ?? []) {
    const spec: ExpectSpec = typeof e === 'string' ? { defect: e } : e
    const defect = DEFECTS[spec.defect]
    const want = spec.count ?? 1
    const matches = active.filter((i) => remaining.has(i) && defect.rules.includes(i.scanner_rule_id))
    matches.forEach((m, idx) => {
      remaining.delete(m)
      judged.push(toJudged(m, idx < want ? 'TP' : 'duplicate', { defect: spec.defect }))
    })
    if (matches.length < want) {
      misses.push({
        defect: spec.defect,
        missing: want - matches.length,
        rules: defect.rules,
        eligible_scanners: eligibleScannersFor(defect, type),
        cause: label.cause,
        coverage_status: Object.fromEntries(
          defect.wcag.map((c) => [c, result.coverage?.criteria.find((x) => x.criterion === c)?.status ?? 'absent'])
        ),
      })
    }
    // Per-scanner detection: did THIS engine report the defect (directly or merged-credit)?
    for (const s of eligibleScannersFor(defect, type)) {
      perScanner[s] ??= { expected: 0, detected: 0 }
      perScanner[s].expected += want
      const byThis = matches.filter((m) => {
        const credited = (m as EquallIssue & { scanners?: string[] }).scanners ?? [m.scanner]
        return credited.includes(s)
      }).length
      perScanner[s].detected += Math.min(want, byThis)
    }
  }

  for (const i of remaining) {
    if (label.acceptable?.includes(i.scanner_rule_id)) {
      judged.push(toJudged(i, 'acceptable'))
    } else if (i.wcag_level === 'AAA') {
      // Beyond the AA target: the engine lists it but scopes it out of the score
      // (isBeyondTarget in scoring). Advisory, not counted as right or wrong.
      judged.push(toJudged(i, 'acceptable', { cause: 'aaa-advisory' }))
    } else {
      const cause = label.fp_causes?.[i.scanner_rule_id] ?? INTRINSIC_CAUSE[i.scanner_rule_id] ?? label.cause ?? 'other'
      judged.push(toJudged(i, 'FP', { cause }))
    }
  }

  let extracted = ''
  try { extracted = extractHtml(content, type) } catch (err) { extracted = `<<extractHtml threw: ${String(err)}>>` }

  return {
    file,
    type,
    kind: label.kind,
    cause: label.cause,
    note: label.note,
    issues: judged,
    misses,
    per_scanner_detection: perScanner,
    reclassified: (result.coverage?.reclassified ?? []).map((r) => ({ rule: r.rule_id, count: r.count })),
    warnings,
    extracted_html_for_axe: extracted,
  }
}

// ---------------------------------------------------------------------------
// Aggregation + report
// ---------------------------------------------------------------------------
const pct = (n: number, d: number) => (d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(0)}%`)
const esc = (s: string | null | undefined) =>
  (s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').replace(/`/g, "'").slice(0, 160)

async function main() {
  const t0 = Date.now()
  const results: CaseResult[] = []
  for (const file of caseFiles) results.push(await evaluate(file, labels.cases[file]))
  const seconds = ((Date.now() - t0) / 1000).toFixed(1)

  const all = results.flatMap((r) => r.issues.map((i) => ({ ...i, file: r.file, kind: r.kind, type: r.type })))
  const TP = all.filter((i) => i.verdict === 'TP')
  const FP = all.filter((i) => i.verdict === 'FP')
  const FPw = FP.filter((i) => !i.best_practice)
  const FPbp = FP.filter((i) => i.best_practice)
  const DUP = all.filter((i) => i.verdict === 'duplicate')
  const ACC = all.filter((i) => i.verdict === 'acceptable')
  const FNn = results.reduce((a, r) => a + r.misses.reduce((b, m) => b + m.missing, 0), 0)
  const expectedTotal = TP.length + FNn

  const byKind = (k: Kind) => results.filter((r) => r.kind === k)
  const withFP = (rs: CaseResult[]) => rs.filter((r) => r.issues.some((i) => i.verdict === 'FP'))
  const withFPw = (rs: CaseResult[]) => rs.filter((r) => r.issues.some((i) => i.verdict === 'FP' && !i.best_practice))
  const fpCount = (rs: CaseResult[]) => rs.reduce((a, r) => a + r.issues.filter((i) => i.verdict === 'FP').length, 0)

  const violationCases = byKind('violation')
  const cleanCases = byKind('clean')
  const indetCases = byKind('indeterminate')
  const fullyRight = results.filter((r) => r.misses.length === 0 && !r.issues.some((i) => i.verdict === 'FP'))

  // Per-rule table
  const ruleStats = new Map<string, { scanner: string; tp: number; fp: number; dup: number; acc: number; bp: boolean; fpCases: Set<string> }>()
  for (const i of all) {
    const s = ruleStats.get(i.rule) ?? { scanner: i.scanner, tp: 0, fp: 0, dup: 0, acc: 0, bp: i.best_practice, fpCases: new Set() }
    if (i.verdict === 'TP') s.tp++
    if (i.verdict === 'FP') { s.fp++; s.fpCases.add(i.file) }
    if (i.verdict === 'duplicate') s.dup++
    if (i.verdict === 'acceptable') s.acc++
    ruleStats.set(i.rule, s)
  }
  // Per-defect recall
  const defectStats = new Map<string, { expected: number; found: number; missedIn: string[] }>()
  for (const r of results) {
    const lab = labels.cases[r.file]
    for (const e of lab.expect ?? []) {
      const spec = typeof e === 'string' ? { defect: e, count: 1 } : { count: 1, ...e }
      const d = defectStats.get(spec.defect) ?? { expected: 0, found: 0, missedIn: [] }
      d.expected += spec.count
      const miss = r.misses.find((m) => m.defect === spec.defect)
      d.found += spec.count - (miss?.missing ?? 0)
      if (miss) d.missedIn.push(r.file)
      defectStats.set(spec.defect, d)
    }
  }
  // Per-scanner
  const scannerNames = ['axe-core', 'eslint-jsx-a11y', 'readability', 'error-identification']
  const scannerStats = scannerNames.map((name) => {
    const tp = TP.filter((i) => (i.scanners ?? [i.scanner]).includes(name)).length
    const fp = FP.filter((i) => i.scanner === name).length
    const fpw = FPw.filter((i) => i.scanner === name).length
    let expected = 0
    let detected = 0
    for (const r of results) {
      const d = r.per_scanner_detection[name]
      if (d) { expected += d.expected; detected += d.detected }
    }
    return { name, tp, fp, fpw, expected, detected, missed: expected - detected }
  })
  // FP by cause
  const causeCounts = new Map<string, { issues: number; cases: Set<string> }>()
  for (const i of FP) {
    const c = i.cause ?? 'other'
    const e = causeCounts.get(c) ?? { issues: 0, cases: new Set() }
    e.issues++
    e.cases.add(i.file)
    causeCounts.set(c, e)
  }
  const headlineCause = (c: string) => ((HEADLINE_CAUSES as readonly string[]).includes(c) ? c : 'other')

  // ---------------- results.json ----------------
  const summary = {
    generated_at: new Date().toISOString(),
    engine_version: JSON.parse(readFileSync(join(HERE, '../../package.json'), 'utf8')).version,
    target: TARGET,
    scan_level: 'AA',
    runtime_seconds: Number(seconds),
    cases: { total: results.length, violation: violationCases.length, clean: cleanCases.length, indeterminate: indetCases.length },
    findings: { total: all.length, tp: TP.length, fp: FP.length, fp_wcag: FPw.length, fp_best_practice: FPbp.length, duplicate: DUP.length, acceptable: ACC.length },
    expected_defects: expectedTotal,
    false_negatives: FNn,
    precision_all: TP.length / (TP.length + FP.length || 1),
    precision_wcag_only: TP.length / (TP.length + FPw.length || 1),
    recall: TP.length / (expectedTotal || 1),
    cases_with_fp: {
      clean: withFP(cleanCases).length,
      indeterminate: withFP(indetCases).length,
      violation: withFP(violationCases).length,
    },
    cases_fully_correct: fullyRight.length,
  }
  writeFileSync(join(HERE, `results${OUT_SUFFIX}.json`), JSON.stringify({ summary, cases: results }, null, 2) + '\n')

  // ---------------- REPORT.md ----------------
  const L: string[] = []
  const p = (s = '') => L.push(s)
  p('# Equall engine: ground-truth reliability report')
  p()
  p(`Generated by \`npx tsx bench/ground-truth/run.ts${TARGET === 'src' ? ' --src' : ''}\` against equall-cli v${summary.engine_version}, loaded from \`${TARGET}/\`${TARGET === 'dist' ? ' (the built package npm users run; run `npm run build` first)' : ' (TypeScript sources, as `npm run scan` and the test suite load it)'}, in-memory \`scanBuffer\`, level AA. ${results.length} hand-labelled cases, ${seconds}s. Raw data: \`results${OUT_SUFFIX}.json\`.`)
  p()
  p('## Headline (plain language)')
  p()
  p(`- **When the engine reports a problem, it is real ${pct(TP.length, TP.length + FP.length)} of the time** (${TP.length} real out of ${TP.length + FP.length} reports that were either right or wrong). Counting only WCAG-mapped reports (excluding "best-practice" advice): ${pct(TP.length, TP.length + FPw.length)}.`)
  p(`- **Of the ${expectedTotal} real, statically-certain defects planted in the corpus, it found ${TP.length} (${pct(TP.length, expectedTotal)}) and missed ${FNn}.**`)
  p(`- **On ${indetCases.length} files where no violation can honestly be proven from the source (props spread, .map(), dynamic attributes, custom components...), it raised at least one false alarm on ${withFP(indetCases).length} (${pct(withFP(indetCases).length, indetCases.length)})**, ${fpCount(indetCases)} false findings in total (${withFPw(indetCases).length} files with a WCAG-mapped false finding).`)
  p(`- **On ${cleanCases.length} files that are correct, it raised at least one false alarm on ${withFP(cleanCases).length} (${pct(withFP(cleanCases).length, cleanCases.length)})**, ${fpCount(cleanCases)} false findings in total.`)
  p(`- On the ${violationCases.length} files with a planted defect, ${withFP(violationCases).length} also received an unrelated false finding.`)
  const fpUnambiguous = FP.filter((i) => i.kind !== 'indeterminate').length
  p(`- **The noise is concentrated in real-world component code.** Leaving out the indeterminate files, reports are real ${pct(TP.length, TP.length + fpUnambiguous)} of the time (${TP.length} real vs ${fpUnambiguous} false). The overall rate above therefore depends on how much component-pattern code the corpus contains (here ${indetCases.length} of ${results.length} files, on purpose).`)
  const sevCount = (s: string) => FP.filter((i) => i.severity === s).length
  p(`- **False findings are not low-severity noise:** ${sevCount('critical')} are "critical" and ${sevCount('serious')} "serious" (of ${FP.length}). Every one of them lowers the score.`)
  p(`- ${DUP.length} extra reports were the same defect reported a second time by another rule/engine (not wrong, but inflates counts and the score).`)
  p(`- Overall, the engine's output was exactly right (every planted defect found, nothing false) on ${fullyRight.length} of ${results.length} files (${pct(fullyRight.length, results.length)}).`)
  p()
  p('Breakdown by file type:')
  p()
  p('| Type | Cases | Planted defects found | False findings | Files with a false finding |')
  p('|---|---|---|---|---|')
  for (const t of ['html', 'tsx', 'astro', 'vue', 'svelte']) {
    const rs = results.filter((r) => r.type === t)
    if (!rs.length) continue
    const exp = rs.reduce((a, r) => a + r.issues.filter((i) => i.verdict === 'TP').length + r.misses.reduce((b, m) => b + m.missing, 0), 0)
    const found = rs.reduce((a, r) => a + r.issues.filter((i) => i.verdict === 'TP').length, 0)
    p(`| ${t} | ${rs.length} | ${found}/${exp} | ${fpCount(rs)} | ${withFP(rs).length}/${rs.length} |`)
  }
  p()
  p('## Where false findings come from')
  p()
  p('Each false finding is attributed to the static-analysis trap the case exercises (label `cause`, overridable per rule with `fp_causes`).')
  p()
  p('| Cause | False findings | Files |')
  p('|---|---|---|')
  const headlineAgg = new Map<string, { issues: number; cases: Set<string> }>()
  for (const [c, v] of causeCounts) {
    const h = headlineCause(c)
    const e = headlineAgg.get(h) ?? { issues: 0, cases: new Set() }
    e.issues += v.issues
    v.cases.forEach((x) => e.cases.add(x))
    headlineAgg.set(h, e)
  }
  for (const c of [...HEADLINE_CAUSES, 'other']) {
    const v = headlineAgg.get(c)
    p(`| ${CAUSE_LABEL[c]} | ${v?.issues ?? 0} | ${v?.cases.size ?? 0} |`)
  }
  p()
  const otherSub = [...causeCounts].filter(([c]) => headlineCause(c) === 'other').sort((a, b) => b[1].issues - a[1].issues)
  if (otherSub.length) {
    p('"Other", broken down:')
    p()
    p('| Sub-cause | False findings | Files |')
    p('|---|---|---|')
    for (const [c, v] of otherSub) p(`| ${CAUSE_LABEL[c] ?? c} | ${v.issues} | ${v.cases.size} |`)
    p()
  }
  p('## Per rule')
  p()
  p('TP = matched a planted defect. FP = no such defect exists. Dup = second report of an already-counted defect. "BP" = axe best-practice (no WCAG criterion).')
  p()
  p('| Rule | Engine | TP | FP | Dup | Precision | FP files |')
  p('|---|---|---|---|---|---|---|')
  for (const [rule, s] of [...ruleStats].sort((a, b) => b[1].fp - a[1].fp || b[1].tp - a[1].tp)) {
    p(`| \`${rule}\`${s.bp ? ' (BP)' : ''} | ${s.scanner} | ${s.tp} | ${s.fp} | ${s.dup} | ${pct(s.tp, s.tp + s.fp)} | ${s.fpCases.size} |`)
  }
  p()
  p('## Per planted defect (recall)')
  p()
  p('| Defect | Expected | Found | Recall | Missed in |')
  p('|---|---|---|---|---|')
  for (const [d, s] of [...defectStats].sort((a, b) => (a[1].found / a[1].expected) - (b[1].found / b[1].expected))) {
    p(`| ${d} | ${s.expected} | ${s.found} | ${pct(s.found, s.expected)} | ${s.missedIn.join(', ')} |`)
  }
  p()
  p('## Per engine')
  p()
  p('"Could detect" counts planted defects this engine has a rule for AND whose file type it accepts. Detected includes credit from a cross-engine merge.')
  p()
  p('| Engine | TP credited | FP (all) | FP (WCAG-mapped) | Could detect | Detected | Engine recall |')
  p('|---|---|---|---|---|---|---|')
  for (const s of scannerStats) p(`| ${s.name} | ${s.tp} | ${s.fp} | ${s.fpw} | ${s.expected} | ${s.detected} | ${pct(s.detected, s.expected)} |`)
  p()
  // Defects axe should have seen but did not, hidden because eslint caught them.
  const masked = results.filter((r) => {
    const d = r.per_scanner_detection['axe-core']
    return d && d.detected < d.expected && r.misses.length === 0
  })
  if (masked.length) {
    p('### Axe misses hidden by eslint')
    p()
    p('Planted defects axe-core had a rule for but did not report (so the combined result looks right only because eslint-jsx-a11y also caught it). The markup axe was handed shows why:')
    p()
    p('| Case | Markup axe was handed (extracted from the source) |')
    p('|---|---|')
    for (const r of masked) p(`| ${r.file} | \`${esc(r.extracted_html_for_axe.replace(/\s+/g, ' '))}\` |`)
    p()
  }
  p('## Every wrong result')
  p()
  p('### False positives')
  p()
  p('| Case | Kind | Rule | WCAG | Cause | Snippet the engine reported |')
  p('|---|---|---|---|---|---|')
  for (const i of FP) {
    p(`| ${i.file} | ${i.kind} | \`${i.rule}\` | ${i.wcag.join(',') || 'BP'} | ${i.cause} | \`${esc(i.snippet)}\` |`)
  }
  p()
  p('### False negatives (missed planted defects)')
  p()
  p('"Engine coverage said" is the engine\'s own honest-coverage status for the defect\'s criteria on that file. `auto` means the engine told the user the criterion was genuinely tested: a miss there is silent.')
  p()
  p('| Case | Defect | Engines that could have caught it | Cause | Engine coverage said |')
  p('|---|---|---|---|---|')
  for (const r of results) {
    for (const m of r.misses) {
      const cov = Object.entries(m.coverage_status).map(([c, s]) => `${c}: ${s}`).join(', ')
      p(`| ${r.file} | ${m.defect}${m.missing > 1 ? ` (x${m.missing})` : ''} | ${m.eligible_scanners.join(', ')} | ${m.cause ?? ''} | ${cov} |`)
    }
  }
  p()
  p('### Duplicate reports (same defect, reported again)')
  p()
  p('| Case | Defect | Rule | Engine | Snippet |')
  p('|---|---|---|---|---|')
  for (const i of DUP) p(`| ${i.file} | ${i.defect} | \`${i.rule}\` | ${i.scanner} | \`${esc(i.snippet)}\` |`)
  p()
  const warnCases = results.filter((r) => r.warnings.length)
  if (warnCases.length) {
    p('### Engine warnings emitted during the run')
    p()
    for (const r of warnCases) for (const w of r.warnings) p(`- ${r.file}: ${esc(w)}`)
    p()
  }
  // src vs dist: the same engine code gives different answers depending on how it is loaded.
  const otherPath = join(HERE, TARGET === 'dist' ? 'results.src.json' : 'results.json')
  let other: { summary: { target: string }; cases: CaseResult[] } | null = null
  try { other = JSON.parse(readFileSync(otherPath, 'utf8')) } catch { other = null }
  if (other && other.summary.target !== TARGET) {
    const sig = (r: CaseResult) => r.issues.map((i) => `${i.rule}:${i.verdict}`).sort().join(', ') || '(nothing)'
    const diffs = results
      .map((r) => ({ r, o: other!.cases.find((c) => c.file === r.file) }))
      .filter(({ r, o }) => o && sig(r) !== sig(o))
    p(`## ${TARGET} vs ${other.summary.target}: same code, different answers`)
    p()
    p(`Cases whose findings differ between this run (${TARGET}) and the last \`${other.summary.target}\` run (${otherPath.split('/').pop()}). ${diffs.length} of ${results.length} differ.`)
    p()
    if (diffs.length) {
      p(`| Case | ${TARGET} | ${other.summary.target} | ${other.summary.target} warnings |`)
      p('|---|---|---|---|')
      for (const { r, o } of diffs) p(`| ${r.file} | ${sig(r)} | ${sig(o!)} | ${esc(o!.warnings.join(' / '))} |`)
      p()
    }
  }
  p('## Engine behaviours behind these numbers (code references at v0.2.3)')
  p()
  p('Observed on this corpus, then traced to the code. Line numbers refer to the commit measured.')
  p()
  p('1. **JSX/TSX extraction is a regex that takes the first `return (` block and stops at the first `)` followed by `;`, a newline or `}`** (`src/utils/html-extract.ts:49`). A helper that returns `( … )` earlier in the file, a second component, or any `onClick={() => fn(x)}` truncates or replaces what axe sees. Nothing reports that the markup was cut.')
  p('2. **JSX is handed to an HTML parser as if it were HTML.** Attribute names are not translated (`htmlFor` stays `htmlfor`, so every React label association is invisible to axe and yields a `label` violation), and PascalCase components are lowercased into native elements (`<Button>` -> `<button>`, `<Input>` -> `<input>`, `<Select>` -> `<select>`, `<Label>` -> `<label>`), which axe then judges as empty native controls. JS text such as `{items.map((x) => (` stays as a text node inside `<ul>`/`<dl>`, which fails `list`/`definition-list`.')
  p('3. **Dynamic attributes are stripped, except alt/aria-label/title/aria-labelledby** (`src/utils/html-extract.ts:13`, `:23-35`). Stripping `href` turns `<a href={url} aria-label>` into a non-link where aria-label is prohibited; stripping `aria-checked` makes `role="radio"` miss a required attribute; stripping `id`/`htmlFor` breaks label association. Multi-line `className={cn(…)}` is not matched by the one-level brace pattern, so Tailwind tokens (`aria-invalid:border-destructive`) reach axe as attributes (`aria-valid-attr`, critical).')
  p('4. **Vue `:attr` / `v-bind` and nested `<template>` are not handled** (`src/utils/html-extract.ts:7` only matches `attr={…}`; `:42` stops at the first `</template>`). `:alt="x"` reads as a missing alt; content after a nested `<template v-if>` is dropped.')
  p('5. **eslint-jsx-a11y issues are split into one issue per WCAG level** (`src/scanners/eslint-jsx-a11y-scanner.ts:210-234`). `label-has-associated-control` (1.3.1 A + 3.3.2 AA) therefore always produces two issues for one finding. jsx-a11y rules also run on `.astro`, where the HTML attribute is `for`, not `htmlFor`: a correct Astro label is flagged (twice).')
  p('6. **The dedup key does not include the rule id and uses the first 80 characters of the snippet** (`src/scan.ts:305-327`, key at `:318`), although the comment at `:148-150` says "same file + same rule + same line". Two distinct elements whose markup starts identically (common with utility classes) collapse into one issue; two different rules on the same element with the same criteria collapse too.')
  p('7. **axe "incomplete" (needs review) results are discarded** (`src/scanners/axe-scanner.ts:191`, `resultTypes: ["violations"]`). In jsdom `aria-hidden-focus` comes back incomplete, so a focusable `aria-hidden` button is never reported, while the coverage report marks 4.1.2 `auto`.')
  p('8. **Coverage `auto` means "a scanner accepting this file type ran", not "this file was actually analysed"** (`src/coverage.ts:20-21`). When axe skipped a file (crash), or saw a truncated fragment, the criteria are still reported as genuinely tested. Every miss in this run happened on an `auto` criterion.')
  p('9. **Scanner failures go to `console.warn`, not to `ScanResult.diagnostics`** (`src/scanners/axe-scanner.ts:151-155`), contradicting `src/scan.ts:78-81` / `:217` ("returned on the result, never written to the host\'s stderr"). An MCP or library consumer never learns a file was skipped.')
  p('10. **Loaded from source (`tsx`: `npm run scan`, the vitest suite), axe-core is a singleton shared with eslint-plugin-jsx-a11y**, whose `autocomplete-valid` rule calls `axe.runVirtualRule`, which resets `axe._selectorData`. The two scanners run concurrently (`src/scan.ts:117`), so any JSX/Astro file with `autoComplete="…"` can make axe throw and skip the whole file. The built `dist/` bundles its own axe-core copy (`tsup.config.ts:21`) and does not show this; the "src vs dist" section above measures it.')
  p('11. **No `tabindex` pair in the cross-engine equivalence table** (`src/rules/equivalence.ts:38-77`): a literal positive tabindex in JSX is counted twice (axe `tabindex` + `jsx-a11y/tabindex-no-positive`).')
  p()
  p('## Method and limits')
  p()
  p('- Each case is scanned alone with `scanBuffer(content, path, { level: "AA" })`; issues marked `ignored` are excluded (none of the cases use ignore comments).')
  p('- Matching is by rule id against a defect catalogue (`DEFECTS` in run.ts). A report matching no planted defect is a false positive unless the label lists it as `acceptable` (defensible secondary finding).')
  p('- `indeterminate` cases: correctness depends on runtime or on the caller. The honest static answer is "no violation / not verifiable", so every reported violation there counts as a false positive of the static approach.')
  p('- Page-level rules the engine itself reclassifies on fragments (region, landmark-*, html-has-lang on fragments...) never appear as issues and are not counted either way.')
  p('- The corpus is small and hand-written; see the caveats in the maintainer summary. Per-rule numbers resting on 1-3 cases are anecdotes, not rates.')
  p()
  writeFileSync(join(HERE, `REPORT${OUT_SUFFIX}.md`), L.join('\n'))

  console.log(JSON.stringify(summary, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
