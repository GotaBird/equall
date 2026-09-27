import type { EquallIssue, Severity } from '../types.js'
import type { DiffScanResult } from '../diff-scan.js'
import { cleanMessage } from '../output/terminal.js'

// CI gate for the diff scan: which base to compare against, whether the change fails the
// check, and the GitHub Actions annotations that point at what it introduced. Pure functions,
// so the CLI stays a thin wrapper and every rule here is unit-tested.

export const SEVERITIES: readonly Severity[] = ['critical', 'serious', 'moderate', 'minor']

const RANK: Record<Severity, number> = { critical: 4, serious: 3, moderate: 2, minor: 1 }

export function isSeverity(value: string): value is Severity {
  return (SEVERITIES as readonly string[]).includes(value)
}

// The ref to diff against. An explicit value wins; `--diff` with no value reads the pull
// request's target branch from the CI environment. The branch is only known to the remote,
// so it is returned as `origin/<branch>` (the checkout must have fetched it).
export function resolveBaseRef(explicit: string | true, env: NodeJS.ProcessEnv = process.env): string {
  if (typeof explicit === 'string' && explicit.length > 0) return explicit
  const target =
    env.GITHUB_BASE_REF ||
    env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME ||
    env.SYSTEM_PULLREQUEST_TARGETBRANCH?.replace(/^refs\/heads\//, '')
  if (!target) {
    throw new Error(
      'No base to compare against. Pass one (--diff origin/main), or run in a pull request ' +
        'on GitHub Actions, GitLab CI or Azure Pipelines, where the target branch is detected.',
    )
  }
  return `origin/${target}`
}

// Counted violations the change introduced at or above the threshold. Review-only,
// best-practice and above-target findings are never in `new_issues`, so they never gate.
export function gatingIssues(result: DiffScanResult, failOn: Severity | null): EquallIssue[] {
  if (!failOn) return []
  return result.new_issues.filter((i) => RANK[i.severity] >= RANK[failOn])
}

// 1 when the change introduced a counted violation at or above --fail-on, 0 otherwise.
// Legacy debt and files that could not be statically tested never fail the check.
export function computeDiffExitCode(result: DiffScanResult, failOn: Severity | null): number {
  return gatingIssues(result, failOn).length > 0 ? 1 : 0
}

// GitHub Actions workflow-command escaping (see "Workflow commands for GitHub Actions"):
// data escapes %, CR and LF; property values also escape ':' and ','.
const escapeData = (s: string) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
const escapeProperty = (s: string) => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C')

function annotation(level: 'error' | 'warning' | 'notice', issue: EquallIssue, title: string): string {
  const props = [`file=${escapeProperty(issue.file_path)}`]
  if (issue.line != null) props.push(`line=${issue.line}`)
  if (issue.line != null && issue.column != null) props.push(`col=${issue.column}`)
  props.push(`title=${escapeProperty(title)}`)
  const criteria = issue.wcag_criteria.length > 0 ? ` (WCAG ${issue.wcag_criteria.join(', ')})` : ''
  const reason = issue.review_only && issue.review_reason ? ` ${issue.review_reason}` : ''
  return `::${level} ${props.join(',')}::${escapeData(`${issue.scanner_rule_id}: ${cleanMessage(issue.message)}${criteria}${reason}`)}`
}

// One annotation per finding the change introduced: counted ones at or above the gate are
// errors, counted ones below it warnings, and review-only / advisory ones notices. Legacy
// findings get none: they are debt, not something this change did.
export function formatAnnotations(result: DiffScanResult, failOn: Severity | null): string[] {
  const gating = new Set(gatingIssues(result, failOn))
  return [
    ...result.new_issues.map((i) =>
      gating.has(i)
        ? annotation('error', i, `Equall · new ${i.severity} accessibility violation`)
        : annotation('warning', i, `Equall · new ${i.severity} accessibility violation`),
    ),
    ...result.new_review_only.map((i) => annotation('notice', i, 'Equall · to review (not counted)')),
    ...result.new_advisory.map((i) => annotation('notice', i, 'Equall · advisory (not counted)')),
  ]
}
