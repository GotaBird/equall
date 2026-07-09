# The Equall Score — Philosophy Charter

> **Status:** governing document for all score work. Every change to the scoring model, its
> inputs, its aggregation, or its display must comply with the invariants below, or explicitly
> amend this charter first (see *Amending this charter*).
> **Version:** 1.1 · 2026-07-09 · arbitrated by the maintainer.
> This file is the canonical home of the charter — agents and contributors load it from here.

## What the score is — and is not

The Equall score is a **trend instrument**. It answers one question: *is this codebase's
accessibility getting better or worse?* It is not a grade, not a conformance claim, and it
carries no legal meaning. The absolute layer of an Equall report is the **per-criterion
conformance table** (`criterion_conformance`): binary, WCAG-aligned, honest about what
automation could and could not verify. The score exists so that progress between two scans is
visible as one number moving — nothing more.

This split is deliberate. A single number cannot be both an alarm and a thermometer: asked to
alarm, it gets gamed; asked to trend, it hides emergencies. Equall gives each job to a different
instrument and keeps them sealed from each other.

## The invariants

### 1 · Trend, not grade

The score answers "better or worse?", never "compliant?". Conformance verdicts are the absolute
layer; the score never appears in a legal or conformance context, and its every display carries
trend framing ("a trend, not a grade").

### 2 · Alarm ≠ thermometer

Critical findings live in the conformance verdicts and, where displayed alongside the score, in
a **separate worst-case indicator** (e.g. "score 78 · ⚠ critical failure present"; later: a
*worst page* KPI). They are never blended into the average — a blended number both dilutes the
alarm and distorts the trend.

### 3 · The formula is a function of failures only

File count never appears in the formula; the penalty is a function of the deduplicated issue
multiset only. Opportunities (the elements a criterion applies to — images, controls, links,
headings, …) inform reporting context and page-level normalization (planned), never the
repo-level number.
*Why:* code-quality risk is statistical and averages honestly; accessibility harm is per
encounter — one blocking failure blocks a person regardless of the clean code around it. Code
debt averages; inaccessibility is encountered. A density with opportunities in the denominator
is padding-gameable (verified in simulation: 20 clean form controls raised a score by ~15
points); the encounter framing survives by keeping opportunities as context, not divisor.
Consequences: inert files or elements cannot dilute the score; a single-buffer scan
(`scanBuffer`, the API/MCP path) is not structurally penalized; the user-facing aggregation unit
is the page/journey (the unit people experience), never the file (the unit developers edit).

### 4 · Four testable properties

Every candidate scoring model must pass, on a fixed dogfood corpus and in the regression suite:

| Property | Test |
| -- | -- |
| **Fix-sensitivity** | Resolving any single issue strictly moves the number. |
| **Padding-resistance** | Adding inert files/elements/engines never raises the number. |
| **Mono-file fairness** | `scanBuffer` scans are not structurally penalized. |
| **Continuity** | `score_model` is versioned; deltas are computed and displayed only between identical model versions and comparable scan bases. |

These are acceptance criteria, not aspirations: each has a named test in the suite.

### 5 · Compound signals advise, they never score

Multi-signal heuristics (alt-quality flags, future confidence rules) live in the advisory layer
(`confidence_flags`). A heuristic can inform a human or an agent; it can never silently move the
score or a verdict. Only deterministic, rule-mapped findings score.
*Why:* a heuristic inside an audit-adjacent number is a liability — advisory signals keep their
value only while they carry no authority.

### 6 · No per-repo weight customization

There is no `.equall/score-rules.json`. Code-health tools can offer tunable weights because code
health is an *internal practice* — your code, your standards. The Equall score lives in a
*regulatory context* (WAD / EN 301 549): a measure adjacent to regulation must be the same for
everyone, or it measures nothing. Two organisations' trends must be produced by the same closed,
versioned ruleset. The controlled equivalent of customization is **ignore-with-inventory**: an
ignored issue leaves the failing sets but never leaves the report.

### 7 · Human attestation never moves the automated score

Manual/attested verdicts (planned) update conformance — that is their purpose. The score's
inputs are sealed to machine findings; its basis is always "automated" and labeled as such on
every surface. An auditor can trust the number precisely because no human can touch it, and
re-running the scan reproduces it.

### 8 · Calibration is empirical

No formula or weighting change ships on argument alone. Candidates are simulated on the dogfood
corpus, scored against the four properties, compared for continuity, and arbitrated by the
maintainer. Every adopted change bumps `score_model` and explains the movement in the CHANGELOG.

## Division of labour (summary table)

| Question | Instrument | Nature |
| -- | -- | -- |
| What must I fix? | Violations (issues) | Actionable list |
| Is this criterion met? | `criterion_conformance` | Absolute, WCAG-aligned, legal-adjacent |
| What couldn't automation see? | Coverage + "needs a human" | Honesty layer |
| Might this be a problem? | `confidence_flags` | Advisory, never scores |
| Better or worse than last scan? | **The score** | Trend, automated basis only |
| Where is it worst? | Worst-case indicator / worst page | Alarm, separate from the average |

## Amending this charter

Any score-touching change that cannot satisfy an invariant must stop and propose an amendment
here — with the evidence that motivated it — before implementation. Amendments are arbitrated by
the maintainer and recorded in this file's version history. Silence is not an amendment.

## Version history

* **1.1** (2026-07-09) — invariant 3 amended from "the denominator is opportunities, never
  files" to "the formula is a function of failures only". Motivation: simulation showed a pure
  opportunity-density model is structurally padding-gameable (raising the opportunity count with
  failures fixed raises the score), while fairness to large pages forbids the opposite
  monotonicity — the only shape satisfying both is a penalty independent of opportunities.
  Opportunities move to the reporting layer. Adopted together with scoring model 2 (rank-damped
  severity summing; see CHANGELOG).
* **1.0** (2026-07-09) — initial charter, invariants 1–8. Motivated by two verified integrity
  defects in scoring model 1: file-count padding raised the score, and the per-criterion cap
  made fixes invisible inside saturated criteria.

## References

* Tornhill, A. & Borg, M. — *Code Red: The Business Impact of Code Quality* (ICSE TechDebt
  2022) — [arxiv.org/abs/2203.04374](http://arxiv.org/abs/2203.04374)
