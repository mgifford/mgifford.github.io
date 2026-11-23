# Data provenance and limitations

## 1. Public-only guarantee

The published dataset contains **public GitHub data only**. The collector:

- uses only unauthenticated-equivalent public endpoints (`/users/:owner/repos`,
  `/repos/:owner/:repo/...`, `/users/:owner/events/public`, `/search/...`);
- never calls `/notifications`, `/user`, private repository endpoints, or any endpoint
  that requires a token scope beyond public read;
- never writes tokens, headers, or authenticated response bodies to disk;
- omits Dependabot/security alerts, which are not public data;
- keeps the owner dashboard disabled. There is no private data path in the browser.

`GH_TOKEN` is used only to raise the public API rate limit and to read the public
`:owner` repository list. It is never exposed to GitHub Pages files or browser code.

## 2. Sources and endpoints

| Source id | Endpoint(s) | What is extracted | Bounds |
|---|---|---|---|
| `commits` | `/repos/:owner/:repo/commits?since=` | sha, author login/email, committer, message, dates | 2 pages / 200 commits per repo |
| `pull-requests` | `/repos/:owner/:repo/pulls?state=all&sort=updated`, plus `state=open` | number, title, body snippet, created/merged/closed, requested reviewers, comments | 1 page each |
| `issues` | `/repos/:owner/:repo/issues?state=all&since=` | number, title, body snippet, created/closed, labels, comments (PR rows filtered out) | 1 page |
| `issue-comments` | `/repos/:owner/:repo/issues/comments?since=` | comment id, author, body snippet, issue number | 1 page for up to 40 repositories |
| `releases` | `/repos/:owner/:repo/releases` | tag, name, body snippet, published date | 1 page |
| `workflows` | `/repos/:owner/:repo/actions/runs?branch=` | latest completed run, conclusion, name | 1 page for up to 30 repositories |
| `public-events` | `/users/:owner/events/public` | PR, review, issue, comment, release, create events | 3 pages / 300 events |
| `external-search` | `/search/issues?q=author:…` | authored issues/PRs outside owned repositories; merged PRs | 2 queries, 50 results each |
| `external-search-commits` | `/search/commits?q=author:…` | authored commits outside owned repositories | 1 query, 50 results |
| `repository-snapshot` | committed `repos.json` diff | `updatedAt`/`pushedAt` changes, description/topics/homepage/archived changes | local diff only |

## 3. Collection order and scope

1. Repository metadata is synced first (`sync-repos.mjs`), producing
   `repos.json` and `changes.json`.
2. Candidate repositories are selected from the catalogue: recent push or metadata
   update, curated/pinned, or open work. Archived repositories and forks are skipped
   by default. The cap is 120 repositories (configurable).
3. Detailed collection runs with concurrency 5 for candidates.
4. Public events and external search add work outside owned repositories.
5. Snapshot metadata events are derived from `changes.json`.
6. Events are merged with the previous committed payloads, pruned to the lookback,
   deduplicated, and split into the 7-day and older payloads.

Priority order for `commits`, `pull-requests`, and `issues` is newest first, which is
why page caps skew coverage toward the most recent activity.

## 4. Request budget and cost

- Hard budget: 1,200 requests per run (`collection.maxRequests`).
- Reserve: stop when the core rate limit has fewer than 25 requests left.
- Retries: up to two, with exponential backoff (and `Retry-After` when present).
- Search uses a separate quota; exhausting it does not stop core collection.
- ETag cache: `.cache/github` (restored by `actions/cache`) makes repeated weekly
  requests conditional. Cache files are never committed.
- Measured 2026-11-23: **579 requests**, **~55 seconds**, 97 candidate repositories.

A budget-starved or failed run does not overwrite good data: if no new events were
collected and previous data exists, the collector exits without writing.

## 5. Retention

| Data | Retention |
|---|---|
| Routine commit events | 30 days of detail (`ACTIVITY_FULL_COMMIT_DAYS`) |
| Pull requests, issues, comments, reviews, releases | full 90-day lookback |
| Daily rollups (`history.json`) | 730 days |
| Contribution ids | full lookback |
| Raw API responses | never stored |

Older commits are pruned first because they are the highest-volume, lowest-signal
records. The coverage record reports `fullCommitDetailDays` and
`prunedRoutineCommits`, and the UI repeats the limitation.

## 6. Known limitations

These are facts about the data source, not defects to hide:

1. **Public event feed truncation.** GitHub's public events API returns at most 300
   events and roughly 90 days. For push events it often omits the commit list; for PR
   events it returns only number/head/base. Coarse events are labelled with
   `payloadTruncated` and never presented as a specific change.
2. **Review coverage.** Reviews are collected from the public event feed. Review
   history beyond that window is not claimed.
3. **Metadata timestamps.** GitHub does not expose when a description, topic, or
   homepage changed. The event uses the repository `updatedAt` and is marked
   `timestampPrecision: "observed-at"`.
4. **Merge attribution.** The PR list endpoint does not include `merged_by`. A merged
   PR is attributed to its author with role `author`; `evidence.mergedByKnown` is
   false. Merging someone else's PR is only captured when the public event feed
   provides the actor.
5. **Renames and transfers.** Activity is keyed by `owner/repo`. A rename or transfer
   appears as an added repository and a deleted repository in `changes.json`; event
   history is not retroactively merged across the new name. This is disclosed rather
   than guessed.
6. **Deleted and private repositories.** A 404/410 is recorded as `not-found`/`gone`
   and skipped. Private repositories never enter the dataset.
7. **Page caps.** A busy repository can have more PRs, issues, or comments than one
   page. The source status is `partial` with reason `page-cap`.
8. **Forks and archived repositories.** Skipped by default; their activity is not
   represented unless configuration changes.
9. **Security alerts.** Dependabot and code-scanning alerts are not public and are
   explicitly listed as unavailable in the attention criteria.
10. **"Needs a response" is a judgement.** The dashboard reports open issue counts and
    recent discussion instead of asserting that a reply is required.
11. **No next actions are invented.** `getProjectContinuity` returns a recorded next
    action only when the latest event text contains one; otherwise it says none is
    recorded and links to the issue or PR.

## 7. Reproducing and verifying

```bash
# Full bounded collection (requires GH_TOKEN)
GH_TOKEN=… npm run sync:activity

# Rebuild the catalogue, activity pages, reports, and sitemap
npm run build:all

# Validate schema, provenance fields, contribution joins, and size budgets
npm run validate:data

# Tests, including DST, bots, dedupe, no-JS content, keyboard, and axe
npm test
```

To inspect a record:

```bash
node -e "const a=require('./data/activity-data.json'); console.log(a.events.slice(0,5))"
```

To verify the public boundary, search the generated data for credentials and for
non-GitHub URLs:

```bash
grep -RInE "ghp_|github_pat_|Bearer " data/activity-data.json data/activity-extended.json
node -e "const a=require('./data/activity-data.json'); console.log(a.events.filter(e=>!e.url.startsWith('https://github.com/')).length)"
```
