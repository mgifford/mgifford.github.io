# Phase 1 audit: current architecture and gaps

Date: 2026-11-23
Scope: the repository as cloned from `mgifford/mgifford.github.io` (master, 350 catalogue
repositories). No production configuration was changed to perform the audit.

## 1. What exists today

### Runtime shape

```text
GitHub Actions (weekly)
  sync-repos.mjs ──> data/generated/repos.json
                    data/generated/changes.json
                    reports/changes-latest.md
  capture-pages-screenshots.mjs ──> data/generated/screenshots.json + PNGs
  build-site-data.mjs ──> data/site-data.json

GitHub Pages (static)
  index.html + src/app.js
    fetch data/site-data.json
    render every project card in the browser
    filters: search, theme, sort, scope, archived, open issues
    owner mode: disabled
```

### Files that matter

| Area | File | Notes |
|---|---|---|
| Catalogue UI | `index.html`, `src/app.js`, `src/filters.mjs`, `src/styles.css` | Client-rendered cards; no project content in the initial HTML |
| Curation | `data/curation.yml` | Featured projects, themes, titles, summaries, ordering |
| Repository sync | `scripts/sync-repos.mjs` | REST `/users/:owner/repos`, README fetch, AGENTS.md probe, GraphQL pinned repos |
| Merged data | `scripts/build-site-data.mjs` | Curation + screenshots + repo metadata → `data/site-data.json` |
| Screenshots | `scripts/capture-pages-screenshots.mjs` | Playwright capture, bounded by `MAX_SCREENSHOTS` |
| Automation | `.github/workflows/weekly-sync.yml`, `monthly-screenshots.yml`, `validate.yml` | Weekly Monday 06:15 UTC, monthly screenshots, PR validation |
| Tests | `tests/*.test.mjs` | `node:test`; 131 tests before this work, including 4 Playwright + axe scans |
| Policy | `ACCESSIBILITY.md`, `SUSTAINABILITY.md`, `AGENTS.md` | WCAG 2.2 AA target, static-first, no AI cron jobs |

### Data sources available

| Source | Endpoint | Used for | Cost |
|---|---|---|---|
| Owned repositories | `GET /users/:owner/repos` | identity, topics, stars, `updatedAt`, `pushedAt` | 4 requests for 350 repos |
| README | `GET /repos/:owner/:repo/readme` | summary, quality heuristic, AI disclosure | 1/repo |
| Governance files | `GET /repos/:owner/:repo/contents/:path` | AGENTS.md, Copilot instructions | 2/repo |
| Pinned repositories | GraphQL `pinnedItems` | featured defaults | 1 |
| Screenshots | Playwright | card previews | bounded |

## 2. Gap analysis against the target questions

| Question | Answerable before? | Why |
|---|---|---|
| Which projects were updated this week? | **No, reliably** | Only `updatedAt`/`pushedAt` exist. `updatedAt` conflates pushes and metadata edits; `pushedAt` misses metadata work. No date-range filter. The weekly commit condition discarded metadata-only changes, so committed timestamps went stale. |
| Which projects have I personally worked on? | No | No actor attribution. Repository activity is not personal work. |
| What did I accomplish in the last seven days? | No | No PR merges, reviews, releases, or evidence links. |
| Where did I leave off in project X? | No | Only the latest repository timestamp. |
| Which PRs are awaiting review? | No (public) | Owner mode is disabled and requires OAuth. |
| Which workflows fail? | No | Actions API never queried. |
| Which repositories are bot-driven? | No | No automation classification. |
| Which issues were discussed but unresolved? | No | No issue/comment events. |
| Which workstreams progressed? | Partially | Curated themes exist, but a project belongs to one theme and themes are not workstreams. |
| What is inactive? | Partially | Sort by `updatedAt`/`pushedAt` only; no human-vs-automation distinction. |

### Root cause of the "updated this week" failure

Three independent problems compounded:

1. **Semantics.** `updatedAt` is GitHub's repository record timestamp (pushes *and*
   metadata edits); `pushedAt` is the last code push. The UI exposed both but did not
   explain the difference, and never filtered by either.
2. **Retention.** `weekly-sync.yml` committed only when repositories were added,
   deleted, archived, or unarchived. A week of ordinary pushes and description edits
   produced no commit, so `repos.json` in the deployed site kept older timestamps.
3. **No event evidence.** Even a correct timestamp identifies *when* something moved,
   not *what* changed or *who* changed it. There were no commit, PR, issue, or release
   records to link to.

## 3. What to preserve, simplify, and remove

### Preserve

- The curated catalogue, `data/curation.yml`, and all card presentation overrides.
- The static GitHub Pages model and the weekly/monthly workflow cadence.
- `src/filters.mjs` pure-function style and its tests.
- The existing accessibility guardrails (skip-free keyboard operation, axe in CI,
  light/dark/forced-colors support).
- The public/private boundary: owner mode stays disabled and no token enters the
  browser.

### Simplify

- Split the repository sync condition from the activity refresh condition.
- Make activity views consume precomputed evidence instead of inferring from summary
  records.
- Keep one rendering implementation (`src/views.mjs`) for static HTML and browser
  updates so the two cannot drift.

### Remove / avoid

- Do **not** build activity from repository summary diffs (the brief explicitly rules
  this out, and it cannot distinguish a README edit from a force-push).
- Do **not** resurrect owner mode or add an authenticated private dashboard in this
  iteration.
- Do **not** add a database, server, or daily LLM job.
- Do **not** create one HTML page per repository; that produces thin duplicates and
  harms discoverability.

## 4. UX structure chosen

```text
Projects (existing index.html)
Recent Activity
  - resolved date range and its definition
  - human vs automated counts
  - projects table (latest evidence link per project)
  - activity by local date
  - per-project timelines (top 10 active projects, open-work signals)
  - coverage and limitations (always visible)
My Contributions
  - attribution rules and configured identities
  - counts by type and repository
  - contributions by date and repository, with role labels
Workstreams
  - configured workstream cards
  - per-workstream recent activity and configured repositories
Reports
  - last completed week and rolling 30 days
  - completed/merged evidence, in-progress work, discussions, automation
  - links to Markdown reports
```

Navigation is plain links. The static pages contain the default seven-day answer in
the initial HTML; interactive filters are added only after the enhancement script
succeeds, so a JavaScript failure never exposes broken controls.

## 5. Audit conclusion

The existing system is a well-curated catalogue with a solid static pipeline and good
test hygiene. The missing layer is **evidence**: a normalized, timezone-correct,
actor-aware activity index. Extending the same Node pipeline and GitHub Actions is
sufficient; no new service or runtime is required.
