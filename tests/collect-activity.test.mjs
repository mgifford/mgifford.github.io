import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GitHubClient, appendPerPage, createRequestBudget, extractNextLink, parseLinkHeader } from "../scripts/lib/github-api.mjs";
import {
  buildCoverage,
  buildRepositoryWorkstreams,
  buildSnapshotMetadataEvents,
  compactText,
  describeSnapshotChanges,
  firstLine,
  mapCommitRecord,
  mapIssueCommentRecord,
  mapIssueRecord,
  mapPublicEventRecord,
  mapPullRequestRecord,
  mapReleaseRecord,
  mapSearchCommitRecord,
  mapSearchIssueRecord,
  mapWorkflowRunRecord,
  mergeAndPruneEvents,
  repositoryFromApiUrl,
  selectCandidates,
  workstreamsFor
} from "../scripts/lib/activity-mappers.mjs";

const RETRIEVED = "2026-11-23T19:00:00Z";
const LOOKBACK = "2026-08-25T00:00:00Z";

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body
  };
}

// ---------------------------------------------------------------------------
// HTTP helpers and budget
// ---------------------------------------------------------------------------

test("parseLinkHeader exposes rel targets and extractNextLink returns next", () => {
  const value =
    '<https://api.github.com/r?page=2>; rel="next", <https://api.github.com/r?page=5>; rel="last"';
  assert.equal(parseLinkHeader(value).next, "https://api.github.com/r?page=2");
  assert.equal(extractNextLink(value), "https://api.github.com/r?page=2");
  assert.equal(extractNextLink(null), null);
});

test("appendPerPage replaces an existing per_page value", () => {
  assert.equal(appendPerPage("https://api.github.com/x?per_page=10&a=1", 100), "https://api.github.com/x?per_page=100&a=1");
  assert.equal(appendPerPage("https://api.github.com/x", 50), "https://api.github.com/x?per_page=50");
});

test("request budget stops at its cap", () => {
  const budget = createRequestBudget({ maxRequests: 2 });
  assert.equal(budget.canRequest(), true);
  budget.record();
  budget.record();
  assert.equal(budget.canRequest(), false);
  assert.equal(budget.exhausted, true);
  assert.equal(budget.reason, "request-budget");
});

test("request budget stops when the rate-limit reserve is reached", () => {
  const budget = createRequestBudget({ maxRequests: 100, reserve: 25 });
  budget.noteRateLimit(new Headers({ "x-ratelimit-remaining": "10" }));
  assert.equal(budget.canRequest(), false);
  assert.equal(budget.reason, "rate-limit-reserve");
});

test("client refuses to call GitHub without a token", async () => {
  let called = false;
  const client = new GitHubClient({ fetchImpl: async () => ((called = true), jsonResponse(200, [])) });
  const result = await client.request("https://api.github.com/x");
  assert.equal(result.reason, "no-token");
  assert.equal(called, false);
});

test("client paginates with Link headers and reports completeness", async () => {
  const urls = [];
  const client = new GitHubClient({
    token: "t",
    fetchImpl: async (url) => {
      urls.push(url);
      if (url.includes("page=2")) return jsonResponse(200, [{ id: 3 }]);
      return jsonResponse(200, [{ id: 1 }, { id: 2 }], {
        link: '<https://api.github.com/x?per_page=100&page=2>; rel="next"'
      });
    }
  });

  const page = await client.paginate("https://api.github.com/x", { maxPages: 3 });
  assert.deepEqual(page.items.map((item) => item.id), [1, 2, 3]);
  assert.equal(page.pages, 2);
  assert.equal(page.complete, true);
  assert.equal(urls.length, 2);
});

test("client stops at the page cap and marks results incomplete", async () => {
  const client = new GitHubClient({
    token: "t",
    fetchImpl: async (url) =>
      jsonResponse(200, [{ id: url }], { link: `<https://api.github.com/x?page=${Number(new URL(url).searchParams.get("page") || 1) + 1}>; rel="next"` })
  });

  const page = await client.paginate("https://api.github.com/x", { maxPages: 2 });
  assert.equal(page.pages, 2);
  assert.equal(page.complete, false);
  assert.equal(page.reason, "page-cap");
});

test("client retries transient failures and then succeeds", async () => {
  let attempts = 0;
  const client = new GitHubClient({
    token: "t",
    retryBaseMs: 1,
    fetchImpl: async () => {
      attempts += 1;
      return attempts === 1 ? jsonResponse(500, null) : jsonResponse(200, { ok: true });
    }
  });
  const result = await client.request("https://api.github.com/x");
  assert.equal(result.ok, true);
  assert.equal(result.data.ok, true);
  assert.equal(client.stats.retries, 1);
});

test("client reports missing repositories as not-found instead of throwing", async () => {
  const client = new GitHubClient({ token: "t", fetchImpl: async () => jsonResponse(404, null) });
  const result = await client.request("https://api.github.com/repos/mgifford/gone");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "not-found");
});

test("client stops on an exhausted rate limit", async () => {
  const client = new GitHubClient({
    token: "t",
    fetchImpl: async () => jsonResponse(403, { message: "rate limited" }, { "x-ratelimit-remaining": "0" })
  });
  const result = await client.request("https://api.github.com/x");
  assert.equal(result.reason, "rate-limit");
  assert.equal(client.budget.exhausted, true);
});

test("client uses ETag cache and treats 304 as a cache hit", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "atlas-cache-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  let ifNoneMatch = null;
  const fetchImpl = async (url, options) => {
    ifNoneMatch = options.headers["If-None-Match"] || null;
    return jsonResponse(304, null);
  };

  const writer = new GitHubClient({
    token: "t",
    cacheDir: dir,
    fetchImpl: async () => jsonResponse(200, { value: 42 }, { etag: 'W/"abc"' })
  });
  await writer.request("https://api.github.com/x");

  const reader = new GitHubClient({ token: "t", cacheDir: dir, fetchImpl });
  const result = await reader.request("https://api.github.com/x");
  assert.equal(ifNoneMatch, 'W/"abc"');
  assert.equal(result.ok, true);
  assert.equal(result.notModified, true);
  assert.deepEqual(result.data, { value: 42 });
  assert.equal(reader.stats.notModified, 1);
});

// ---------------------------------------------------------------------------
// Candidate selection
// ---------------------------------------------------------------------------

const repo = (overrides) => ({
  name: "example",
  fullName: "mgifford/example",
  url: "https://github.com/mgifford/example",
  archived: false,
  fork: false,
  openIssues: 0,
  pushedAt: "2026-11-20T00:00:00Z",
  updatedAt: "2026-11-20T00:00:00Z",
  ...overrides
});

test("selectCandidates prioritises curated repositories then recency", () => {
  const result = selectCandidates(
    [
      repo({ fullName: "mgifford/old-but-curated", name: "old-but-curated", pushedAt: "2026-09-01T00:00:00Z" }),
      repo({ fullName: "mgifford/new", name: "new", pushedAt: "2026-11-22T00:00:00Z" }),
      repo({ fullName: "mgifford/stale", name: "stale", pushedAt: "2020-01-01T00:00:00Z", updatedAt: "2020-01-01T00:00:00Z" })
    ],
    { lookbackStart: LOOKBACK, priorityNames: new Set(["mgifford/old-but-curated"]) }
  );

  assert.equal(result.candidates[0].fullName, "mgifford/old-but-curated");
  assert.deepEqual(result.candidates.map((candidate) => candidate.fullName), [
    "mgifford/old-but-curated",
    "mgifford/new"
  ]);
});

test("selectCandidates skips archived and forked repositories by default", () => {
  const result = selectCandidates(
    [
      repo({ fullName: "mgifford/archived", archived: true }),
      repo({ fullName: "mgifford/forked", fork: true }),
      repo({ fullName: "mgifford/active" })
    ],
    { lookbackStart: LOOKBACK }
  );
  assert.deepEqual(result.candidates.map((candidate) => candidate.fullName), ["mgifford/active"]);
  assert.equal(result.skipped.archived, 1);
  assert.equal(result.skipped.fork, 1);
});

test("selectCandidates caps the list and reports how many were dropped", () => {
  const repos = Array.from({ length: 5 }, (_, index) =>
    repo({ fullName: `mgifford/r${index}`, name: `r${index}`, pushedAt: `2026-11-2${index}T00:00:00Z` })
  );
  const result = selectCandidates(repos, { lookbackStart: LOOKBACK, maxRepositories: 2 });
  assert.equal(result.candidates.length, 2);
  assert.equal(result.capped, 3);
});

// ---------------------------------------------------------------------------
// Commit / PR / issue / release / workflow mapping
// ---------------------------------------------------------------------------

const restCommit = {
  sha: "abc123",
  commit: {
    message: "Add landmark navigation tests\n\nLonger body",
    author: { name: "Mike Gifford", email: "mike@example.com", date: "2026-11-20T14:30:00Z" },
    committer: { name: "GitHub", email: "noreply@github.com", date: "2026-11-20T14:31:00Z" }
  },
  author: { login: "mgifford", type: "User" },
  committer: { login: "web-flow", type: "User" }
};

test("mapCommitRecord preserves evidence and normalizes the actor", () => {
  const event = mapCommitRecord("mgifford/example", restCommit, {
    retrievedAt: RETRIEVED,
    workstreams: ["drupal-accessibility"],
    lookbackStart: LOOKBACK
  });
  assert.equal(event.id, "github:commit:mgifford/example@abc123");
  assert.equal(event.actor, "mgifford");
  assert.equal(event.actorRole, "author");
  assert.equal(event.automated, false);
  assert.equal(event.title, "Add landmark navigation tests");
  assert.equal(event.timestamp, "2026-11-20T14:31:00.000Z");
  assert.equal(event.evidence.committer, "web-flow");
  assert.deepEqual(event.workstreams, ["drupal-accessibility"]);
});

test("mapCommitRecord links merge commits to their pull request group", () => {
  const mergeCommit = {
    ...restCommit,
    sha: "merge123",
    commit: {
      ...restCommit.commit,
      message: "Merge pull request #94 from mgifford/issue-2942404\n\nStart evaluation",
      committer: { name: "GitHub", email: "noreply@github.com", date: "2026-11-23T13:10:26Z" }
    }
  };
  const event = mapCommitRecord("mgifford/drupal-core-lab", mergeCommit, { retrievedAt: RETRIEVED });
  assert.equal(event.groupKey, "pr:mgifford/drupal-core-lab#94");
  assert.equal(event.mergeCommit, true);
  assert.equal(event.substantive, false);
});

test("mapCommitRecord classifies Dependabot commits as automated", () => {
  const dependabot = {
    ...restCommit,
    sha: "dep1",
    author: { login: "dependabot[bot]", type: "Bot" },
    commit: { ...restCommit.commit, message: "Bump axe-core from 4.9.0 to 4.10.0" }
  };
  const event = mapCommitRecord("mgifford/example", dependabot, { retrievedAt: RETRIEVED });
  assert.equal(event.automated, true);
  assert.equal(event.substantive, false);
});

test("compactText and firstLine keep evidence small and readable", () => {
  assert.equal(firstLine("  hello  \n\nworld"), "hello");
  assert.equal(firstLine(""), "");
  assert.ok(compactText("x".repeat(900)).length <= 600);
});

const restPull = {
  number: 12,
  html_url: "https://github.com/mgifford/wcag-spine/pull/12",
  title: "Add focus appearance checks",
  body: "Implements WCAG 2.2 SC 2.4.11 checks.",
  state: "closed",
  draft: false,
  created_at: "2026-11-20T10:00:00Z",
  updated_at: "2026-11-21T10:00:00Z",
  closed_at: "2026-11-21T10:00:00Z",
  merged_at: "2026-11-21T10:00:00Z",
  user: { login: "mgifford", type: "User" },
  comments: 3,
  review_comments: 2,
  requested_reviewers: [],
  base: { ref: "main" },
  head: { ref: "focus" }
};

test("mapPullRequestRecord emits opened and merged events sharing a group", () => {
  const events = mapPullRequestRecord("mgifford/wcag-spine", restPull, {
    retrievedAt: RETRIEVED,
    lookbackStart: LOOKBACK
  });
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((event) => event.eventType), ["pull_request_opened", "pull_request_merged"]);
  assert.equal(events[0].groupKey, events[1].groupKey);
  assert.equal(events[1].outcome, "completed");
  assert.equal(events[1].evidence.comments, 3);
});

test("mapPullRequestRecord emits only activity inside the lookback window", () => {
  const oldPr = { ...restPull, created_at: "2026-01-01T00:00:00Z", merged_at: "2026-11-21T10:00:00Z" };
  const events = mapPullRequestRecord("mgifford/wcag-spine", oldPr, {
    retrievedAt: RETRIEVED,
    lookbackStart: LOOKBACK
  });
  assert.deepEqual(events.map((event) => event.eventType), ["pull_request_merged"]);
});

test("mapPullRequestRecord distinguishes closed-without-merge", () => {
  const closed = { ...restPull, merged_at: null, closed_at: "2026-11-22T10:00:00Z" };
  const events = mapPullRequestRecord("mgifford/wcag-spine", closed, {
    retrievedAt: RETRIEVED,
    lookbackStart: LOOKBACK
  });
  assert.equal(events.at(-1).eventType, "pull_request_closed");
  assert.equal(events.at(-1).outcome, "in_progress");
});

test("mapPullRequestRecord tolerates missing optional fields", () => {
  const minimal = { number: 1, html_url: "https://github.com/mgifford/x/pull/1", title: "minimal", created_at: "2026-11-20T00:00:00Z", user: null };
  const events = mapPullRequestRecord("mgifford/x", minimal, { retrievedAt: RETRIEVED, lookbackStart: LOOKBACK });
  assert.equal(events.length, 1);
  assert.equal(events[0].actor, "unknown");
});

const restIssue = {
  number: 7,
  html_url: "https://github.com/mgifford/drupal-core-lab/issues/7",
  title: "Investigate focus loss in off-canvas tray",
  body: "Reproduced in Safari 18.",
  state: "open",
  created_at: "2026-11-19T09:00:00Z",
  closed_at: null,
  comments: 4,
  labels: [{ name: "accessibility" }, "needs-triage"],
  user: { login: "mgifford", type: "User" }
};

test("mapIssueRecord ignores pull requests returned by the issues endpoint", () => {
  const asPr = { ...restIssue, pull_request: { url: "x" } };
  assert.deepEqual(mapIssueRecord("mgifford/drupal-core-lab", asPr, { retrievedAt: RETRIEVED }), []);
});

test("mapIssueRecord maps an opened issue with label evidence", () => {
  const events = mapIssueRecord("mgifford/drupal-core-lab", restIssue, {
    retrievedAt: RETRIEVED,
    lookbackStart: LOOKBACK
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, "issue_opened");
  assert.equal(events[0].groupKey, "issue:mgifford/drupal-core-lab#7");
  assert.deepEqual(events[0].evidence.labels, ["accessibility", "needs-triage"]);
});

test("mapIssueCommentRecord maps the commenter and issue number", () => {
  const comment = {
    id: 99,
    html_url: "https://github.com/mgifford/drupal-core-lab/issues/7#issuecomment-99",
    issue_url: "https://api.github.com/repos/mgifford/drupal-core-lab/issues/7",
    body: "Confirmed. Next step: retest after the fix.",
    created_at: "2026-11-22T11:00:00Z",
    user: { login: "mgifford", type: "User" }
  };
  const event = mapIssueCommentRecord("mgifford/drupal-core-lab", comment, {
    retrievedAt: RETRIEVED,
    workstreams: ["drupal-accessibility"]
  });
  assert.equal(event.eventType, "issue_commented");
  assert.equal(event.actorRole, "commenter");
  assert.equal(event.evidence.issueNumber, 7);
});

test("mapReleaseRecord maps a published release and rejects drafts outside the window", () => {
  const release = {
    tag_name: "v1.2.0",
    name: "Accessibility fixes",
    body: "Fixes focus order.",
    html_url: "https://github.com/mgifford/wcag-spine/releases/tag/v1.2.0",
    published_at: "2026-11-21T12:00:00Z",
    author: { login: "mgifford", type: "User" },
    prerelease: false,
    draft: false
  };
  const event = mapReleaseRecord("mgifford/wcag-spine", release, { retrievedAt: RETRIEVED, lookbackStart: LOOKBACK });
  assert.equal(event.eventType, "release_published");
  assert.equal(event.outcome, "completed");
  assert.equal(event.evidence.tag, "v1.2.0");

  const old = { ...release, published_at: "2025-01-01T00:00:00Z" };
  assert.equal(mapReleaseRecord("mgifford/wcag-spine", old, { retrievedAt: RETRIEVED, lookbackStart: LOOKBACK }), null);
});

test("mapWorkflowRunRecord only surfaces failures and deployment successes", () => {
  const failedRun = {
    id: 5,
    status: "completed",
    conclusion: "failure",
    name: "CI",
    html_url: "https://github.com/mgifford/x/actions/runs/5",
    created_at: "2026-11-22T00:00:00Z",
    updated_at: "2026-11-22T00:10:00Z",
    head_branch: "main",
    event: "push",
    actor: { login: "mgifford" }
  };
  assert.equal(
    mapWorkflowRunRecord("mgifford/x", failedRun, { retrievedAt: RETRIEVED, lookbackStart: LOOKBACK }),
    null,
    "failures are opt-in per repository"
  );
  const failure = mapWorkflowRunRecord("mgifford/x", failedRun, {
    retrievedAt: RETRIEVED,
    lookbackStart: LOOKBACK,
    includeWorkflowFailures: true
  });
  assert.equal(failure.eventType, "workflow_run_failed");
  assert.equal(failure.automated, true);

  const successTest = mapWorkflowRunRecord(
    "mgifford/x",
    { ...failedRun, conclusion: "success", name: "CI" },
    { retrievedAt: RETRIEVED, lookbackStart: LOOKBACK }
  );
  assert.equal(successTest, null, "successful test runs are not deployments");

  const deploy = mapWorkflowRunRecord(
    "mgifford/x",
    { ...failedRun, conclusion: "success", name: "Deploy to Pages" },
    { retrievedAt: RETRIEVED, lookbackStart: LOOKBACK }
  );
  assert.equal(deploy.eventType, "deployment_succeeded");
});

// ---------------------------------------------------------------------------
// Public events
// ---------------------------------------------------------------------------

function publicEvent(type, payload, overrides = {}) {
  return {
    id: "evt",
    type,
    created_at: "2026-11-22T12:00:00Z",
    actor: { login: "mgifford", type: "User" },
    repo: { name: "mgifford/drupal-core-lab" },
    payload,
    ...overrides
  };
}

test("mapPublicEventRecord maps every commit in a push", () => {
  const events = mapPublicEventRecord(
    publicEvent("PushEvent", {
      commits: [
        { sha: "a1", message: "Add test", author: { name: "Mike Gifford", email: "mike@example.com" } },
        { sha: "a2", message: "Fix test", author: { name: "Mike Gifford", email: "mike@example.com" } }
      ]
    }),
    { retrievedAt: RETRIEVED }
  );
  assert.equal(events.length, 2);
  assert.equal(events[0].actorRole, "committer");
  assert.equal(events[0].evidence.pushedBy, "mgifford");
});

test("mapPublicEventRecord records a merged PR by a non-author as merger", () => {
  const [event] = mapPublicEventRecord(
    publicEvent("PullRequestEvent", {
      action: "closed",
      pull_request: {
        number: 3,
        html_url: "https://github.com/drupal/drupal/pull/3",
        title: "Fix focus",
        merged_at: "2026-11-22T12:00:00Z",
        user: { login: "someone-else" }
      }
    }, { repo: { name: "drupal/drupal" } }),
    { retrievedAt: RETRIEVED, workstreams: ["drupal-accessibility"] }
  );
  assert.equal(event.eventType, "pull_request_merged");
  assert.equal(event.actorRole, "merger");
  assert.deepEqual(event.workstreams, ["drupal-accessibility"]);
});

test("mapPublicEventRecord maps reviews with their state", () => {
  const [event] = mapPublicEventRecord(
    publicEvent("PullRequestReviewEvent", {
      review: { id: 55, state: "approved", body: "Looks good", user: { login: "mgifford" }, html_url: "https://github.com/x/y/pull/9#pullrequestreview-55" },
      pull_request: { number: 9, title: "Improve landmarks", html_url: "https://github.com/x/y/pull/9" }
    }, { repo: { name: "mgifford/wcag-spine" } }),
    { retrievedAt: RETRIEVED }
  );
  assert.equal(event.eventType, "pull_request_review");
  assert.equal(event.actorRole, "reviewer");
  assert.equal(event.evidence.reviewState, "approved");
});

test("mapPublicEventRecord ignores events with no work signal", () => {
  assert.deepEqual(mapPublicEventRecord(publicEvent("WatchEvent", {}), { retrievedAt: RETRIEVED }), []);
  assert.deepEqual(mapPublicEventRecord(publicEvent("ForkEvent", {}), { retrievedAt: RETRIEVED }), []);
});

test("mapPublicEventRecord maps repository creation but not branch creation", () => {
  const created = mapPublicEventRecord(publicEvent("CreateEvent", { ref_type: "repository" }), { retrievedAt: RETRIEVED });
  assert.equal(created.length, 1);
  assert.equal(created[0].eventType, "repository_created");
  assert.deepEqual(mapPublicEventRecord(publicEvent("CreateEvent", { ref_type: "branch" }), { retrievedAt: RETRIEVED }), []);
});

// ---------------------------------------------------------------------------
// External contributions
// ---------------------------------------------------------------------------

test("mapSearchIssueRecord marks contributions outside owned repositories", () => {
  const event = mapSearchIssueRecord(
    {
      number: 21,
      html_url: "https://github.com/drupal/drupal/pull/21",
      repository_url: "https://api.github.com/repos/drupal/drupal",
      title: "Fix focus order",
      body: "Upstream fix",
      state: "closed",
      created_at: "2026-10-01T00:00:00Z",
      closed_at: "2026-11-20T00:00:00Z",
      pull_request: { merged_at: "2026-11-20T00:00:00Z" },
      user: { login: "mgifford", type: "User" }
    },
    { retrievedAt: RETRIEVED, owner: "mgifford" }
  );
  assert.equal(event.repository, "drupal/drupal");
  assert.equal(event.eventType, "pull_request_merged");
  assert.equal(event.evidence.external, true);
});

test("mapSearchCommitRecord maps external commits", () => {
  const event = mapSearchCommitRecord(
    {
      sha: "ext1",
      repository: { full_name: "drupal/drupal" },
      commit: {
        message: "Fix landmark duplication",
        author: { name: "Mike Gifford", email: "mike@example.com", date: "2026-11-20T00:00:00Z" },
        committer: { date: "2026-11-20T00:00:00Z" }
      },
      author: { login: "mgifford", type: "User" }
    },
    { retrievedAt: RETRIEVED, owner: "mgifford" }
  );
  assert.equal(event.repository, "drupal/drupal");
  assert.equal(event.evidence.external, true);
});

test("repositoryFromApiUrl extracts owner/repo", () => {
  assert.equal(repositoryFromApiUrl("https://api.github.com/repos/mgifford/x"), "mgifford/x");
  assert.equal(repositoryFromApiUrl("https://example.com/x"), "");
});

// ---------------------------------------------------------------------------
// Snapshot metadata diffing
// ---------------------------------------------------------------------------

test("buildSnapshotMetadataEvents records metadata-only changes", () => {
  const previous = [{ fullName: "mgifford/x", description: "Old", updatedAt: "2026-11-01T00:00:00Z", pushedAt: "2026-11-01T00:00:00Z" }];
  const current = [
    { fullName: "mgifford/x", name: "x", description: "New description", updatedAt: "2026-11-20T00:00:00Z", pushedAt: "2026-11-01T00:00:00Z", url: "https://github.com/mgifford/x" }
  ];
  const events = buildSnapshotMetadataEvents(previous, current, {
    retrievedAt: RETRIEVED,
    owner: "mgifford",
    repositoryWorkstreams: new Map([["mgifford/x", ["drupal-accessibility"]]]),
    lookbackStart: LOOKBACK
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, "repository_metadata_updated");
  assert.equal(events[0].title, "Description changed");
  assert.equal(events[0].substantive, false);
  assert.equal(events[0].timestampPrecision, "observed-at");
});

test("buildSnapshotMetadataEvents does not emit when nothing observable changed", () => {
  const previous = [{ fullName: "mgifford/x", description: "Same", topics: [], updatedAt: "2026-11-01T00:00:00Z" }];
  const current = [{ fullName: "mgifford/x", description: "Same", topics: [], updatedAt: "2026-11-20T00:00:00Z" }];
  assert.deepEqual(buildSnapshotMetadataEvents(previous, current, { retrievedAt: RETRIEVED, lookbackStart: LOOKBACK }), []);
});

test("describeSnapshotChanges reports archiving and topic changes", () => {
  const changes = describeSnapshotChanges(
    { archived: false, description: "a", topics: ["one"], hasPages: false },
    { archived: true, description: "a", topics: ["one", "two"], hasPages: true }
  );
  assert.deepEqual(changes, ["Repository archived", "Topics changed", "GitHub Pages availability changed"]);
});

// ---------------------------------------------------------------------------
// Merge, prune, workstreams, coverage
// ---------------------------------------------------------------------------

test("mergeAndPruneEvents deduplicates by id and keeps the freshest payload", () => {
  const base = mapCommitRecord("mgifford/x", restCommit, { retrievedAt: RETRIEVED });
  const stale = { ...base, title: "Stale title" };
  const result = mergeAndPruneEvents([stale], [base], { lookbackStart: LOOKBACK });
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].title, "Add landmark navigation tests");
});

test("mergeAndPruneEvents drops events outside the window and enforces a cap", () => {
  const old = mapCommitRecord(
    "mgifford/x",
    { ...restCommit, sha: "old", commit: { ...restCommit.commit, committer: { date: "2026-01-01T00:00:00Z" } } },
    { retrievedAt: RETRIEVED }
  );
  const fresh = mapCommitRecord("mgifford/x", { ...restCommit, sha: "fresh" }, { retrievedAt: RETRIEVED });

  const result = mergeAndPruneEvents([old, fresh], [], { lookbackStart: LOOKBACK });
  assert.equal(result.events.length, 1);
  assert.equal(result.droppedOutOfWindow, 1);

  const capped = mergeAndPruneEvents([], [fresh], { lookbackStart: LOOKBACK, maxEvents: 0 });
  assert.equal(capped.events.length, 0);
  assert.equal(capped.droppedByCap, 1);
});

test("buildRepositoryWorkstreams supports membership in several workstreams", () => {
  const map = buildRepositoryWorkstreams({
    workstreams: [
      { id: "drupal-accessibility", repositories: ["mgifford/drupal-core-lab"] },
      { id: "design-systems", repositories: ["mgifford/drupal-core-lab", "mgifford/design-system-lab"] }
    ]
  });
  assert.deepEqual(workstreamsFor("mgifford/drupal-core-lab", map), ["drupal-accessibility", "design-systems"]);
  assert.deepEqual(workstreamsFor("mgifford/unknown", map), []);
});

test("buildCoverage records scope, sources, and request budget", () => {
  const coverage = buildCoverage({
    generatedAt: RETRIEVED,
    lookbackDays: 90,
    windowStart: LOOKBACK,
    windowEnd: RETRIEVED,
    timezone: "America/Toronto",
    scope: { collectedRepositories: 10 },
    sources: [{ id: "commits", status: "ok" }],
    limitations: ["Public events are limited to 90 days."],
    budget: { maxRequests: 800, used: 42, exhausted: false, reason: null },
    stats: { requests: 42, notModified: 3 }
  });
  assert.equal(coverage.requests.used, 42);
  assert.equal(coverage.requests.notModified, 3);
  assert.equal(coverage.limitations.length, 1);
});
