# Change summary

## 1. What changed

### Activity engine (new)

| File | Purpose |
|---|---|
| `src/time.mjs` | IANA-timezone date ranges, DST-safe boundaries, local grouping, shareable range serialization |
| `src/activity.mjs` | taxonomy, event validation, actor/automation classification, substance and outcome rules, dedupe, grouping, summaries |
| `src/queries.mjs` | deterministic questions (`getRecentlyActiveProjects`, `getUserContributions`, `getProjectActivity`, `getOpenWork`, `getRecentMergedPullRequests`, `getWorkstreamActivity`, `getProjectsWithoutRecentHumanActivity`, `getProjectContinuity`, `getAttentionCandidates`, `buildActivityDigest`, `summarizeWorkstreams`) |
| `src/activity-filters.mjs` | URL filter state, saved questions, identity filtering |
| `src/render.mjs`, `src/views.mjs` | shared accessible rendering for static and browser views |
| `src/activity-app.js` | progressive filters, lazy extended payload, URL sync, status announcements |
| `scripts/lib/github-api.mjs` | bounded request client: budget, retries, pagination, ETag cache, typed failures |
| `scripts/lib/activity-mappers.mjs` | GitHub payload → normalized events, candidate selection, metadata diffing, pruning |
| `scripts/collect-activity.mjs` | collection orchestration and coverage reporting |
| `scripts/build-pages.mjs` | static pages, sitemap, weekly/monthly Markdown reports |
| `data/workstreams.yml` | timezone, collection limits, identities, seven workstreams, limitations |

### Activity data (new)

- `data/activity-data.json` — recent (7-day) browser payload, coverage, workstreams,
  repository index.
- `data/activity-extended.json` — older events, lazy-loaded.
- `data/generated/activity/repository-index.json` — per-project activity and open work.
- `data/generated/activity/personal-contributions.json` — contribution ids and summary.
- `data/generated/activity/history.json` — daily rollups, 730-day bound.

### Catalogue integration (changed)

- `scripts/sync-repos.mjs` records `updated` entries with timestamp changes and
  observable metadata diffs; the Markdown report explains `updatedAt`/`pushedAt`.
- `scripts/build-site-data.mjs` merges the activity summary into `site-data.json` and
  consumes the split payloads.
- `scripts/validate-generated-data.mjs` validates activity provenance, contribution
  joins, duplicate ids, source statuses, and size budgets.
- `.github/workflows/weekly-sync.yml` collects activity, builds pages/reports, commits
  **any** generated diff, and reports run metrics to the job summary.
- `.github/workflows/validate.yml` builds the static pages before tests.
- `package.json` adds `sync:activity`, `build:pages`, `build:all`; `sync:all` now runs
  the full pipeline.
- `index.html` adds the Project Atlas navigation and a link to Recent Activity.
- `src/styles.css` adds the activity layout, skip link, badges, tables, workstream
  cards, coverage disclosure, forced-colors and print rules, and WCAG 2.2 target-size
  fixes.
- `scripts/serve.mjs` serves `.mjs` with the correct MIME type.

### Documentation (new/changed)

- `docs/audit.md` — architecture assessment, coverage matrix, gap analysis,
  preserve/simplify/remove, UX structure.
- `docs/strategy.md` — direction, current-vs-proposed architecture, data flow,
  deterministic query layer, time semantics, cost, milestones.
- `docs/activity-schema.md` — event model, taxonomy, classification, dedupe, coverage,
  validation.
- `docs/data-provenance.md` — public-only guarantee, sources, budget, retention,
  limitations, reproduction.
- `docs/implementation-plan.md` — phases, acceptance tests, prioritized backlog, risks.
- `README.md`, `AGENTS.md`, `ACCESSIBILITY.md`, `SUSTAINABILITY.md` updated.

### Tests (new)

333 tests total (was 131), including:

- `tests/time.test.mjs` — DST transitions, week boundaries, rolling windows, custom
  ranges, inclusive ends, grouping, URL round-trips.
- `tests/activity.test.mjs` — taxonomy, bots, generated data, merge commits,
  opened-vs-merged outcomes, dedupe, grouping, filtering, summaries.
- `tests/queries.test.mjs` — project activity, contributions, workstreams, open work,
  continuity, attention candidates, unknown coverage.
- `tests/activity-filters.test.mjs` — URL state, combined filters, attribution,
  automation exclusion, options.
- `tests/render.test.mjs` — escaping, badges, captions/scopes, empty states, coverage.
- `tests/collect-activity.test.mjs` — pagination, retries, 304 cache, rate limits,
  missing repositories, mapping, snapshot diffs, pruning.
- `tests/pages.test.mjs` — static structure, unique ids, evidence links, no-JS content,
  filter behaviour, URL restore, automation toggle, custom range, anchors, keyboard.
- `tests/accessibility.test.mjs` — axe on the catalogue plus 4 activity pages in light
  and dark.

## 2. Measured result (2026-11-23)

| Metric | Value |
|---|---|
| Candidate repositories | 97 of 350 (archived and forks skipped) |
| API requests | 579 of 1,200 |
| Collection runtime | ~55 s |
| Events retained | 5,618 (3,874 human, 1,744 automated) |
| Projects with activity | 92 |
| Attributable contributions | 3,170 |
| External repositories represented | 9 |
| Recent payload | 1.1 MB raw / ~120 KB gzip |
| Extended payload | 3.0 MB raw / ~333 KB gzip (lazy) |
| Static activity page | 224 KB raw / ~25 KB gzip |
| Committed activity data | ~4.4 MB |

## 3. Omitted

- Private/authenticated data and owner mode.
- Dependabot/security alerts (not public).
- Historical review detail beyond the public event feed.
- Merge actor when the API does not provide it.
- AI-generated text in any scheduled output.
- Per-repository pages.
- Composite urgency scores.
- Documentation/research category inference without file-level evidence.

## 4. Deferred

- Review collection per pull request.
- Rename/transfer history mapping.
- Deployment status beyond workflow names.
- Optional, user-triggered AI summaries over verified evidence (requires a review and
  disclosure workflow first).
- Project-level SEO/accessibility audits of linked sites.
- A read-only API.
- Incremental per-repository cursors.

## 5. Review notes

- The catalogue contract is unchanged: `data/curation.yml` still controls featured
  projects, themes, titles, summaries, ordering, visibility, and screenshots.
- Generated pages (`activity.html`, `contributions.html`, `workstreams.html`,
  `reports.html`, `sitemap.xml`, `reports/activity/*.md`) are build output. Edit
  `src/views.mjs`, `src/render.mjs`, or `scripts/build-pages.mjs`, then run
  `npm run build:all`. Do not hand-edit them.
- Activity payloads are minified on purpose. Use `jq` or `src/queries.mjs`.
- Public/private boundary verified by tests and by the validator's GitHub-URL rule.
- Accessibility: axe passes for 5 pages × light/dark, no-JS content is present, and
  keyboard/target-size checks are covered.
