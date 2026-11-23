# Normalized activity schema

Version 1. Implemented in `src/activity.mjs` (taxonomy, validation, summaries) and
`scripts/lib/activity-mappers.mjs` (GitHub payload → event).

## 1. Files

| File | Role | Committed |
|---|---|---|
| `data/activity-data.json` | Canonical recent event store (default 7 days) + coverage + workstreams + repository index | Yes |
| `data/activity-extended.json` | Older events (8–90 days), lazy-loaded by the browser | Yes |
| `data/generated/activity/repository-index.json` | Per-repository activity summary and open-work counts | Yes |
| `data/generated/activity/personal-contributions.json` | Contribution ids and summary for the configured identity | Yes |
| `data/generated/activity/history.json` | Daily counts, bounded to 730 days | Yes |
| `data/site-data.json` | Catalogue data plus a small activity summary | Yes |

The committed payloads are minified. `jq` or the Node helpers in `src/queries.mjs` are
the intended readers. There is no uncommitted "full evidence" file: the committed
records already carry the event id, type, timestamp, actor, URL, and provenance source.

## 2. Event record

Illustrative record from the published data shape:

```json
{
  "id": "github:pull_request:mgifford/drupal-core-lab#123:merged",
  "repository": "mgifford/drupal-core-lab",
  "timestamp": "2026-11-20T14:30:00.000Z",
  "eventType": "pull_request_merged",
  "category": "pull_request",
  "actor": "mgifford",
  "actorRole": "author",
  "automated": false,
  "automationReason": null,
  "title": "Add focus appearance checks",
  "summary": "Implements WCAG 2.2 SC 2.4.11 checks.",
  "url": "https://github.com/mgifford/drupal-core-lab/pull/123",
  "source": "github-rest-pulls",
  "retrievedAt": "2026-11-23T18:00:00.000Z",
  "workstreams": ["drupal-accessibility"],
  "pullRequestNumber": 123,
  "outcome": "completed",
  "substantive": true
}
```

Derived fields (`category`, `automationReason`, `outcome`, `substantive`) are
recomputed by `normalizeEvent` so a malformed or hand-edited file cannot silently
mislabel work. `groupKey` is derived when omitted (`deriveGroupKey`).

### Field notes

| Field | Meaning |
|---|---|
| `id` | Stable identifier. `github:commit:<repo>@<sha>`, `github:pull_request:<repo>#<n>:<action>`, `github:issue:<repo>#<n>:<action>:<iso>`, `github:release:<repo>@<tag>`, `github:repository_metadata:<repo>@<updatedAt>` |
| `timestamp` | When the event happened, UTC. For metadata diffs this is the repository's `updatedAt` and `timestampPrecision` is `observed-at`. |
| `eventType` | Exact source event, not a derived bucket. |
| `category` | One primary category for filtering. Categories may overlap conceptually; the raw `eventType` is always preserved. |
| `actor` / `actorRole` | GitHub login (or recorded commit email/name) and the role: author, committer, reviewer, commenter, merger, creator, system. |
| `automated` / `automationReason` | Whether the event is automation, and why (`bot_account`, `known_bot_account`, `generated_title`, `dependency_update`, `generated_data_commit`, `ci_workflow`, `unknown`). |
| `outcome` | `completed`, `in_progress`, `discussion`, `informational`. Prevents an opened PR from being counted as shipped. |
| `substantive` | `true`, `false`, or `null` (uncertain). Merge commits, generated data, dependency bumps, and metadata edits are `false`; a short commit message is `null`. |
| `source` | Which collection path produced the event (`github-rest-commits`, `github-rest-pulls`, `github-public-events`, `github-search`, …). |
| `workstreams` | Configured workstream ids. A project can have several. |
| `substantiveReason` | Not committed; derived by `assessSubstantive` when full records are assessed in-process. |

## 3. Event type taxonomy

| Event type | Category | Default outcome |
|---|---|---|
| `commit_pushed` | `code_development` | `in_progress` (merge commits are `false` substantively) |
| `pull_request_opened` | `pull_request` | `in_progress` |
| `pull_request_merged` | `pull_request` | `completed` |
| `pull_request_closed` | `pull_request` | `in_progress` (closed without merge) |
| `pull_request_review` | `pull_request` | `discussion` |
| `pull_request_review_comment` | `pull_request` | `discussion` |
| `issue_opened` | `issue` | `discussion` |
| `issue_commented` | `issue` | `discussion` |
| `issue_closed` | `issue` | `discussion` |
| `release_published` | `release` | `completed` |
| `deployment_succeeded` | `deployment` | `completed` |
| `deployment_failed` | `deployment` | `in_progress` |
| `workflow_run_failed` | `deployment` | `in_progress` |
| `repository_metadata_updated` | `repository_administration` | `informational` |
| `repository_created` | `repository_administration` | `informational` |

Additional categories exist for documentation, research, and automated maintenance
(`CATEGORIES` in `src/activity.mjs`). They are declared but not yet inferred, because
inferring them from paths or topics would require evidence this pipeline does not
collect. This is deliberate: an unclassified event is better than a guessed one.

## 4. Classification rules

### Actors

- `[bot]` suffix or API `type: "Bot"` → automated (`bot_account`).
- Known system accounts (Dependabot, Renovate, github-actions, actions-user, …) →
  automated (`known_bot_account`).
- Conservative `bot-` / `-bot` name pattern → automated (`bot_name_pattern`). Logins
  such as `a11y-bot-fan` remain human.
- Everything else is treated as human.

### Commits

- Dependency-update messages (`chore(deps):`, `Bump x from…`) → automated.
- Generated-data messages (`chore: weekly repo sync`, `Update generated site data`) →
  automated (`generated_data_commit`), but `docs:` / `feat:` / `fix:` messages that
  merely mention generated data remain human.
- `Merge pull request #N` → merge commit; substantively `false` and grouped with the
  PR so a merge is not counted twice.
- Short messages (< 6 characters) → `substantive: null` ("uncertain").

### Issues and pull requests

- A bot author is automated.
- Titles used by scheduled scanners (`SCAN:`, `[scan]`, `[automated]`,
  `Automated:`, `Nightly:`, `Issue status:`) are automated with reason
  `generated_title`, even when created under a human account.
- A merged PR is `completed`; a closed unmerged PR is `in_progress`.

### Workflows

- The latest completed run on the default branch is inspected for a bounded set of
  repositories.
- Failures are recorded as `workflow_run_failed` / `deployment_failed`.
- Successful runs are only recorded as deployments when the workflow name matches
  deploy/pages/publish/release.

## 5. Deduplication and grouping

- Duplicate ids are removed; the record with the higher event priority is kept.
- A merge commit and the PR merge share `pr:<repo>#<n>`, so `groupEvents` collapses
  them into one work item. Reports count the group once.
- `getRecentMergedPullRequests` deduplicates by group.
- The same PR can legitimately produce `opened` and `merged` events; they share a
  group and are not counted as two accomplishments.

## 6. Coverage record

Every payload carries `coverage`:

```json
{
  "generatedAt": "2026-11-23T20:08:03.742Z",
  "timezone": "America/Toronto",
  "lookbackDays": 90,
  "window": { "start": "2026-08-25T…", "end": "2026-11-23T…" },
  "scope": {
    "catalogRepositories": 350,
    "consideredRepositories": 97,
    "collectedRepositories": 97,
    "skippedArchived": 116,
    "skippedForks": 93,
    "fullCommitDetailDays": 30,
    "prunedRoutineCommits": 1421,
    "droppedByCap": 0
  },
  "sources": [
    { "id": "commits", "label": "Commit history (owned repositories)", "status": "partial", "requests": 115, "records": 4117, "reasons": ["page-cap"] }
  ],
  "limitations": ["…"],
  "requests": { "used": 579, "budgetMax": 1200, "exhausted": false, "notModified": 0 }
}
```

Source status values: `ok`, `partial`, `unavailable`, `limited`. The UI renders the
table and the limitations list on every activity page. Missing data is never presented
as inactivity.

## 7. Validation

`npm run validate:data` checks:

- required files, schema version, timezone, generatedAt;
- every event has id, repository, timestamp, URL, and provenance source;
- URLs point at `https://github.com/…` evidence;
- repository identifiers match `owner/repo`;
- no duplicate ids within a payload;
- contribution ids exist in the activity payloads;
- source status values are known;
- payload size budgets (activity 3 MB, extended 8 MB, contributions 2 MB).

`normalizeEvent` in `src/activity.mjs` is the single source of truth for event
validity and derived fields. `tests/activity.test.mjs`, `tests/time.test.mjs`,
`tests/queries.test.mjs`, and `tests/collect-activity.test.mjs` cover the mapping and
classification rules.
