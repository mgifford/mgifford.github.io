# Implementation plan

## 1. Status by phase

| Phase | Scope | Status |
|---|---|---|
| 1 | Audit, architecture comparison, schema, collection plan, UX structure | Complete (`docs/audit.md`, `docs/strategy.md`, this file) |
| 2 | "Which projects were updated this week?" — date ranges, `updatedAt` vs `pushedAt`, shareable URLs, static HTML | Complete |
| 3 | Normalized activity index — commits, PRs, issues, comments, releases, workflows, dedupe, attribution, automation | Complete |
| 4 | My Contributions, including repositories outside the account | Complete |
| 5 | Workstreams and project timelines | Complete |
| 6 | Deterministic weekly/monthly reports | Complete |
| 7 | Optional AI summaries over verified evidence | Deferred by design |

## 2. Acceptance tests

### Initial: "Which projects have been updated this week?"

A visitor opens `activity.html` (no JavaScript) and sees:

- the resolved range (`Last 7 days: 16 November 2026, 14:32 – 23 November 2026,
  14:32 (America/Toronto)`) and its definition;
- a projects table with last activity, latest evidence (commit/PR/issue/release
  link), last human activity, and human/total counts;
- activity grouped by local date, with actor, role, category, automation badge, and
  source link;
- per-project timelines and open-work signals;
- coverage and limitations.

**Met.** `tests/pages.test.mjs` asserts the static content, evidence links, and
no-JS visibility; axe covers light and dark.

### Second: "What has `mgifford` worked on over the last seven days?"

`contributions.html` lists only events whose actor matches the configured login or a
configured commit identity. Activity by other people in maintained repositories is
excluded. Automated generated-data commits and scanner issues are labelled and
excluded by default. Roles (author, committer, reviewer, commenter, merger) are shown.

**Met.** `tests/activity-filters.test.mjs` covers attribution, aliases, other-actor
exclusion, automation exclusion, and roles.

### Third: "Select a project and understand its recent activity, open work, and links"

Project table links jump to a per-project timeline with:

- most recent human activity;
- recent events with evidence links;
- open PR / review / issue / workflow signals with explicit bases;
- coverage notes for the bounded collection.

**Met**, with the limitation that issues/PRs beyond one page and reviews beyond the
public event feed are not claimed.

## 3. Prioritized backlog

### P0 — keep the current guarantees

- Keep the weekly run under the request budget and under 2 minutes.
- Keep the committed activity data under the size budgets in
  `validate-generated-data.mjs`.
- Keep axe, no-JS, and keyboard tests green.
- Keep metadata and push changes committed every run.

### P1 — evidence depth (next)

1. **Reviews for high-value repositories.** Fetch reviews for the top N open/merged PRs
   (`/pulls/:n/reviews`) so review work is not limited to the public event feed.
2. **Rename/transfer continuity.** Add a configured alias map (`old/name → new/name`)
   so event history survives repository renames and transfers.
3. **Issue response candidates with a stated rule.** Add a "recent human comment with
   no subsequent maintainer reply" query, labelled as a candidate rather than a demand.
4. **Deployment coverage.** Collect the latest Pages deployment per repository with a
   GitHub Pages build, not just workflow runs whose names look like deploys.
5. **Incremental per-repository cursors.** Persist the last successful `since`/updated
   cursor per repository to reduce page-cap losses on very active projects.

### P2 — explanation and discoverability

6. **Optional AI summaries.** User-triggered only, over a bounded retrieved evidence
   set, with inline source references, explicit date ranges, a work-performed vs
   work-completed distinction, and a human review step before publication. No cron
   job. The deterministic reports remain the default.
7. **Project-level SEO and accessibility checks.** Reuse the existing README quality
   signal and add optional checks for title, metadata, sitemap, and JS-only content on
   linked project sites.
8. **Attention refinement.** Add dependency-alert ingestion through an owner-only
   workflow (never the public dataset) if a private view is later approved.
9. **Read-only API.** Expose the deterministic query functions over a static JSON
   contract or a small read-only endpoint if a consumer appears.

### P3 — scale and polish

10. Split the workstream configuration into a separate file if it outgrows
    `data/workstreams.yml`.
11. Add a compressed columnar encoding only if the event payload grows beyond the
    current budget.
12. Add structured data (`ItemList`, `Dataset`) to the activity pages after validating
    that it does not misrepresent the collection.

## 4. What was deliberately not done

- No natural-language interface. The deterministic filters answer the six saved
  questions without a model.
- No private owner dashboard. The public dataset remains public-only.
- No daily job. Weekly is sufficient for the questions asked and keeps API and compute
  cost low.
- No per-repository HTML pages. Project timelines live on one activity page with
  anchors, avoiding thin duplicate pages.
- No composite "urgency score". Attention items are explicit criteria with a stated
  basis.
- No inferred next steps. `getProjectContinuity` only surfaces a next action recorded
  in the source text.

## 5. Risks and mitigations

| Risk | Mitigation |
|---|---|
| API rate limits or outages | 1,200-request budget, reserve, retries, conditional cache, no-overwrite guard, coverage disclosure |
| Public event feed truncation | Coarse events labelled; search API supplements external work |
| Page caps hide older open work | Source status `partial` with `page-cap`; open PRs fetched separately |
| Data drifts from committed pages | `npm run build:all` in validation; page tests assert structure and evidence |
| Payload growth | 30-day commit detail, minified payloads, size budgets, lazy extended payload |
| Attribution errors | Actor matching by login/configured identity only; roles and uncertainty labels; tests |
| Accessibility regressions | axe across 5 pages × light/dark; no-JS tests; keyboard tests; target-size fix |
