# Technical strategy: Project Atlas

## 1. Direction

Evolve the curated repository catalogue into **Project Atlas: Open-Source Work,
Activity, and Knowledge** without replacing the catalogue.

The catalogue answers *what does this project do?* The activity layer answers *what
changed, who did it, what is still open, and where did I leave off?* Both are static,
public, and cheap to operate.

Three principles drive the design:

1. **Evidence over inference.** Every activity row links to a commit, pull request,
   issue, review, release, workflow run, or repository metadata change. Nothing is
   derived from a repository name or description.
2. **Deterministic before generative.** Date ranges, filters, grouping, and reports are
   plain functions. An LLM is not required to use the dashboard and is not part of the
   scheduled pipeline.
3. **Separate activity from accomplishment.** An opened PR is in progress. A merged PR
   is completed work but not a deployment. A bot bump is neither. These distinctions
   are schema fields, not editorial judgement applied later.

## 2. Current vs proposed architecture

| Concern | Current | Proposed |
|---|---|---|
| Project data | `repos.json` → `site-data.json` | Unchanged; catalogue contract preserved |
| Activity data | none | Normalized event index from GitHub REST + public events + search |
| Date filtering | none (sort by `updatedAt`/`pushedAt`) | Explicit presets + custom range, America/Toronto, DST-safe |
| Personal work | none | Actor-attributed contributions, including external repositories |
| Automation | heuristic title filter in owner mode only | Actor + message + title classification with reasons |
| Grouping | one theme per project | Configurable workstreams; many-to-many |
| Reports | repository add/delete/archive only | Weekly + monthly activity, completed/in-progress/discussion split |
| Rendering | client-only cards | Static activity HTML + progressive filtering |
| Workflow commit rule | add/delete/archive counts only | any generated diff, including metadata and pushes |
| Tests | 131 | 333, including DST, bots, dedupe, pagination, no-JS, axe |

## 3. Data flow

```text
GitHub REST (public)
  /users/:owner/repos                     repository metadata
  /repos/:owner/:repo/commits             commits in lookback
  /repos/:owner/:repo/pulls               PR opened/merged/closed
  /repos/:owner/:repo/pulls?state=open    accurate open-work counts
  /repos/:owner/:repo/issues              issues (PRs filtered out)
  /repos/:owner/:repo/issues/comments     discussion evidence
  /repos/:owner/:repo/releases            releases
  /repos/:owner/:repo/actions/runs        latest workflow result
  /users/:owner/events/public             public contribution events
  /search/issues, /search/commits         work outside owned repositories
        │
        ▼
scripts/lib/activity-mappers.mjs   normalization, attribution, automation, dedupe
scripts/collect-activity.mjs       bounded collection + coverage disclosure
        │
        ├─ data/activity-data.json            7-day browser payload + coverage + index
        ├─ data/activity-extended.json        8–90 day events (lazy-loaded)
        ├─ data/generated/activity/repository-index.json
        ├─ data/generated/activity/personal-contributions.json
        └─ data/generated/activity/history.json   daily rollups (bounded)
        │
        ▼
scripts/build-site-data.mjs    catalogue + activity summary → data/site-data.json
scripts/build-pages.mjs        static activity.html, contributions.html,
                               workstreams.html, reports.html, sitemap.xml,
                               reports/activity/latest-week.md, latest-month.md
        │
        ▼
src/views.mjs + src/render.mjs   one rendering implementation for static and browser
src/activity-app.js              progressive filters and URL state
```

## 4. Deterministic query layer

`src/queries.mjs` exposes the questions as functions:

```text
getRecentlyActiveProjects(events, range)
getUserContributions(events, username, range, { aliases })
getProjectActivity(events, repository, range)
getOpenWork(repositoryIndexRow)
getRecentMergedPullRequests(events, range)
getWorkstreamActivity(events, workstreamId, range)
getProjectsWithoutRecentHumanActivity(index, days)
getProjectContinuity(events, repositoryIndexRow)
getAttentionCandidates(repositoryIndex, options)
getActivityByDay(events, timeZone)
buildActivityDigest(events, range)
```

They are pure and shared by the static build, the browser, and the reports. A future
read-only API or conversational interface can call the same functions; it does not
need a second data model.

## 5. Time semantics

| Preset | Definition (in the configured time zone) |
|---|---|
| Today | local 00:00 → now |
| Yesterday | previous local 00:00 → 23:59:59.999 |
| This week | Monday 00:00 → now |
| Last week | previous Monday 00:00 → Sunday 23:59:59.999 |
| Last 7 / 14 / 30 / 90 days | rolling N × 24 hours ending now |
| Custom | local 00:00 of `from` → 23:59:59.999 of `to` |

`America/Toronto` is the default. Boundaries are computed with the IANA database, not
by adding hours to UTC, so a week containing a DST transition is 167 or 169 hours long
and still starts on Monday. Rolling windows intentionally remain exactly N × 24 hours.

`updatedAt` and `pushedAt` are never treated as event timestamps. When only a metadata
timestamp is available it is labelled `observed-at` because GitHub does not expose the
exact edit time.

## 6. Cost and operations

Measured on 2026-11-23 for 97 candidate repositories over a 90-day lookback:

| Metric | Value |
|---|---|
| API requests | 579 of a 1,200 budget |
| Runtime | about 55 seconds |
| Events retained | 5,618 (3,874 human, 1,744 automated) |
| Projects with activity | 92 |
| Browser payload (7 days) | 1.1 MB raw / ~120 KB gzip |
| Extended payload (8–90 days) | 3.0 MB raw / ~333 KB gzip, loaded on demand |
| Static activity page | 224 KB raw / ~25 KB gzip |
| Committed activity data | ~4.4 MB |

Design choices that keep this bounded:

- weekly schedule, not daily;
- candidate repositories only (recent pushes, curated, open work);
- one page per collection type, with explicit page caps;
- ETag cache for conditional requests across runs;
- 30-day detail retention for routine commits; 90 days for PRs, issues, reviews,
  releases;
- no LLM inference in any scheduled job.

## 7. Milestones

| Phase | Deliverable | Status |
|---|---|---|
| 1 | Audit, schema, strategy, provenance, plan | Complete |
| 2 | "Updated this week" with date ranges, shareable URLs, static HTML | Complete |
| 3 | Normalized activity index with dedupe, attribution, automation | Complete |
| 4 | My Contributions, including external repositories | Complete |
| 5 | Workstreams and project timelines | Complete |
| 6 | Deterministic weekly/monthly reports | Complete |
| 7 | Optional AI summaries over verified evidence | Deferred (deliberately) |

See `docs/implementation-plan.md` for the prioritized backlog.
