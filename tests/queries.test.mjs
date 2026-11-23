import test from "node:test";
import assert from "node:assert/strict";

import { normalizeEvent } from "../src/activity.mjs";
import { resolveDateRange } from "../src/time.mjs";
import {
  buildActivityDigest,
  getActivityByDay,
  getAttentionCandidates,
  getOpenWork,
  getProjectActivity,
  getProjectContinuity,
  getProjectsWithoutRecentHumanActivity,
  getRecentMergedPullRequests,
  getRecentlyActiveProjects,
  getUserContributions,
  getWorkstreamActivity,
  groupContributionsByRepository,
  groupContributionsByType,
  groupContributionsByWorkstream
} from "../src/queries.mjs";

const TZ = "America/Toronto";
const NOW = "2026-11-23T19:11:46Z";
const range = resolveDateRange("last_7_days", { now: NOW, timeZone: TZ });
const RETRIEVED = "2026-11-23T19:00:00Z";

function makeEvent(overrides = {}) {
  return normalizeEvent({
    id: overrides.id || `evt-${Math.random().toString(36).slice(2)}`,
    repository: "mgifford/drupal-core-lab",
    timestamp: "2026-11-20T14:30:00Z",
    eventType: "commit_pushed",
    actor: "mgifford",
    actorRole: "author",
    automated: false,
    title: "Improve landmark navigation tests",
    url: "https://github.com/mgifford/drupal-core-lab/commit/abc",
    source: "github-rest-commits",
    retrievedAt: RETRIEVED,
    ...overrides
  });
}

const humanCommit = makeEvent({ id: "c1" });
const botCommit = makeEvent({
  id: "c2",
  automated: true,
  automationReason: "bot_account",
  actor: "dependabot[bot]",
  title: "Bump axe-core from 4.9.0 to 4.10.0",
  url: "https://github.com/mgifford/drupal-core-lab/commit/def"
});
const otherHuman = makeEvent({
  id: "c3",
  actor: "someone-else",
  repository: "mgifford/open-scans",
  title: "Add scan comparison table",
  url: "https://github.com/mgifford/open-scans/commit/abc"
});
const mergedPr = makeEvent({
  id: "pr1",
  timestamp: "2026-11-21T15:00:00Z",
  eventType: "pull_request_merged",
  title: "Add WCAG 2.2 focus appearance checks",
  url: "https://github.com/mgifford/wcag-spine/pull/12",
  repository: "mgifford/wcag-spine"
});
const oldEvent = makeEvent({ id: "old", timestamp: "2026-06-01T00:00:00Z" });

// ---------------------------------------------------------------------------
// getRecentlyActiveProjects
// ---------------------------------------------------------------------------

test("getRecentlyActiveProjects returns only projects with in-range activity", () => {
  const projects = getRecentlyActiveProjects([humanCommit, botCommit, oldEvent], range);
  assert.deepEqual(projects.map((project) => project.repository), ["mgifford/drupal-core-lab"]);
  assert.equal(projects[0].eventCount, 2);
  assert.equal(projects[0].humanEventCount, 1);
});

test("getRecentlyActiveProjects can exclude automation-only projects", () => {
  const projects = getRecentlyActiveProjects([humanCommit, botCommit], range, { excludeAutomated: true });
  assert.equal(projects.length, 1);
  assert.equal(projects[0].humanEventCount, 1);

  const automationOnly = getRecentlyActiveProjects([botCommit], range, { excludeAutomated: true });
  assert.equal(automationOnly.length, 0);
});

test("getRecentlyActiveProjects exposes the latest evidence for each project", () => {
  const [project] = getRecentlyActiveProjects([humanCommit, botCommit], range);
  assert.equal(project.latest.eventType, "commit_pushed");
  assert.equal(project.latest.actor, "mgifford");
  assert.match(project.latest.url, /github\.com/);
});

test("getRecentlyActiveProjects sorts by most recent activity", () => {
  const newer = makeEvent({ id: "newer", timestamp: "2026-11-23T10:00:00Z", repository: "mgifford/newer" });
  const projects = getRecentlyActiveProjects([humanCommit, newer], range);
  assert.equal(projects[0].repository, "mgifford/newer");
});

// ---------------------------------------------------------------------------
// getUserContributions
// ---------------------------------------------------------------------------

test("getUserContributions only counts events the user performed", () => {
  const contributions = getUserContributions([humanCommit, otherHuman, botCommit], "mgifford", range);
  assert.equal(contributions.length, 1);
  assert.equal(contributions[0].id, "c1");
});

test("getUserContributions does not attribute unrelated activity in owned repositories", () => {
  const otherInOwnedRepo = makeEvent({
    id: "other-owned",
    actor: "contributor",
    title: "Fix typo in README",
    url: "https://github.com/mgifford/drupal-core-lab/commit/xyz"
  });
  const contributions = getUserContributions([otherInOwnedRepo], "mgifford", range);
  assert.equal(contributions.length, 0);
});

test("getUserContributions respects configured commit identity aliases", () => {
  const commitByEmail = makeEvent({ id: "email-commit", actor: "Mike Gifford" });
  const none = getUserContributions([commitByEmail], "mgifford", range);
  assert.equal(none.length, 0);
  const withAlias = getUserContributions([commitByEmail], "mgifford", range, { aliases: ["Mike Gifford"] });
  assert.equal(withAlias.length, 1);
});

test("getUserContributions excludes automation by default but can include it", () => {
  const botAuthored = makeEvent({
    id: "bot-authored",
    actor: "mgifford",
    automated: true,
    automationReason: "generated_data_commit",
    title: "chore: weekly repo sync"
  });
  assert.equal(getUserContributions([botAuthored], "mgifford", range).length, 0);
  assert.equal(getUserContributions([botAuthored], "mgifford", range, { includeAutomation: true }).length, 1);
});

test("getUserContributions filters by role", () => {
  const review = makeEvent({
    id: "review",
    eventType: "pull_request_review",
    actorRole: "reviewer",
    actor: "mgifford",
    url: "https://github.com/mgifford/wcag-spine/pull/9"
  });
  assert.equal(getUserContributions([review], "mgifford", range, { roles: ["reviewer"] }).length, 1);
  assert.equal(getUserContributions([review], "mgifford", range, { roles: ["author"] }).length, 0);
});

test("getUserContributions ignores events outside the range", () => {
  assert.equal(getUserContributions([oldEvent], "mgifford", range).length, 0);
});

// ---------------------------------------------------------------------------
// Contribution grouping
// ---------------------------------------------------------------------------

test("groupContributionsByRepository groups and counts", () => {
  const groups = groupContributionsByRepository([humanCommit, mergedPr]);
  assert.equal(groups.length, 2);
  assert.ok(groups.every((group) => group.count === 1 && group.lastAt));
});

test("groupContributionsByWorkstream duplicates multi-workstream contributions", () => {
  const multi = makeEvent({ id: "multi", workstreams: ["drupal-accessibility", "open-standards"] });
  const groups = groupContributionsByWorkstream([multi]);
  assert.deepEqual(groups.map((group) => group.workstream).sort(), ["drupal-accessibility", "open-standards"]);
});

test("groupContributionsByType counts event types", () => {
  const groups = groupContributionsByType([humanCommit, mergedPr]);
  assert.deepEqual(groups.map((group) => group.eventType).sort(), ["commit_pushed", "pull_request_merged"]);
});

// ---------------------------------------------------------------------------
// Project activity and open work
// ---------------------------------------------------------------------------

test("getProjectActivity returns a range-scoped timeline with day groups", () => {
  const activity = getProjectActivity(
    [humanCommit, botCommit, oldEvent, otherHuman],
    "mgifford/drupal-core-lab",
    range
  );
  assert.equal(activity.events.length, 2);
  assert.equal(activity.groups.length, 2);
  assert.ok(activity.days.length >= 1);
});

test("getProjectActivity can hide automation", () => {
  const activity = getProjectActivity([humanCommit, botCommit], "mgifford/drupal-core-lab", range, {
    includeAutomated: false
  });
  assert.equal(activity.events.length, 1);
  assert.equal(activity.events[0].id, "c1");
});

test("getOpenWork reports explicit criteria without an urgency score", () => {
  const openWork = getOpenWork({
    repository: "mgifford/drupal-core-lab",
    openIssues: 6,
    openPullRequests: 2,
    awaitingReview: 1,
    failingWorkflows: 0,
    archived: false
  });
  assert.equal(openWork.needingReview, true);
  assert.equal(openWork.criteria.length, 5);
  assert.ok(!("score" in openWork));
  assert.match(openWork.note, /not a priority score/i);
});

test("getOpenWork accepts openIssuesRaw and surfaces README quality as a candidate", () => {
  const openWork = getOpenWork({
    repository: "mgifford/drupal-core-lab",
    openIssuesRaw: 7,
    readmeNeedsAttention: true
  });
  assert.equal(openWork.criteria.find((criterion) => criterion.id === "open_issues").count, 7);
  const readme = openWork.criteria.find((criterion) => criterion.id === "readme_quality");
  assert.equal(readme.count, 1);
  assert.match(readme.basis, /Review before treating this as a defect/);
});

test("getOpenWork treats an archived repository as having no active work", () => {
  const openWork = getOpenWork({ repository: "mgifford/old", archived: true, openIssues: 3 });
  assert.equal(openWork.archived, true);
  assert.equal(openWork.criteria.find((criterion) => criterion.id === "open_issues").count, 3);
});

test("getRecentMergedPullRequests deduplicates merge groups", () => {
  const groupKey = "pr:mgifford/wcag-spine#12";
  const mergeCommit = makeEvent({
    id: "merge-sha",
    repository: "mgifford/wcag-spine",
    title: "Merge pull request #12 from mgifford/focus",
    mergeCommit: true,
    groupKey
  });
  const pr = makeEvent({ ...mergedPr, id: "pr-merged", groupKey });
  const merged = getRecentMergedPullRequests([mergeCommit, pr], range);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].eventType, "pull_request_merged");
});

// ---------------------------------------------------------------------------
// Workstreams
// ---------------------------------------------------------------------------

test("getWorkstreamActivity resolves workstreams from repository configuration", () => {
  const result = getWorkstreamActivity(
    [humanCommit, otherHuman],
    "drupal-accessibility",
    range,
    { repositoryWorkstreams: { "mgifford/drupal-core-lab": ["drupal-accessibility"] } }
  );
  assert.equal(result.events.length, 1);
  assert.equal(result.summary.total, 1);
});

test("getWorkstreamActivity honours per-event workstreams", () => {
  const tagged = makeEvent({ id: "tagged", workstreams: ["web-sustainability"] });
  const result = getWorkstreamActivity([tagged, humanCommit], "web-sustainability", range);
  assert.equal(result.events.length, 1);
});

// ---------------------------------------------------------------------------
// Continuity and attention
// ---------------------------------------------------------------------------

test("getProjectsWithoutRecentHumanActivity distinguishes unknown coverage from staleness", () => {
  const unknown = getProjectsWithoutRecentHumanActivity(
    [{ repository: "mgifford/no-events", lastHumanActivityAt: null }],
    30,
    { now: NOW }
  );
  assert.equal(unknown[0].coverage, "unknown");

  const stale = getProjectsWithoutRecentHumanActivity(
    [{ repository: "mgifford/stale", lastHumanActivityAt: "2026-01-01T00:00:00Z" }],
    30,
    { now: NOW }
  );
  assert.equal(stale[0].coverage, "collected");
  assert.ok(stale[0].idleDays > 300);
});

test("getProjectsWithoutRecentHumanActivity skips recently active and archived projects", () => {
  const rows = [
    { repository: "mgifford/active", lastHumanActivityAt: "2026-11-22T00:00:00Z" },
    { repository: "mgifford/archived", lastHumanActivityAt: "2020-01-01T00:00:00Z", archived: true }
  ];
  const result = getProjectsWithoutRecentHumanActivity(rows, 30, { now: NOW });
  assert.equal(result.length, 0);
});

test("getProjectContinuity reports that no next action is recorded", () => {
  const continuity = getProjectContinuity(
    [humanCommit],
    { repository: "mgifford/drupal-core-lab", openIssues: 2, openPullRequests: 1 },
    { range, timeZone: TZ }
  );
  assert.equal(continuity.lastHumanActivity.id, "c1");
  assert.equal(continuity.nextAction.text, null);
  assert.match(continuity.nextAction.basis, /No next action is recorded/);
});

test("getProjectContinuity surfaces an explicitly recorded next action", () => {
  const withNext = makeEvent({
    id: "next",
    eventType: "issue_commented",
    actorRole: "commenter",
    summary: "Next step: re-run the axe scan after the landmark fix lands.",
    url: "https://github.com/mgifford/drupal-core-lab/issues/2"
  });
  const continuity = getProjectContinuity(
    [withNext],
    { repository: "mgifford/drupal-core-lab" },
    { range, timeZone: TZ }
  );
  assert.match(continuity.nextAction.text, /Next step/);
  assert.equal(continuity.nextAction.source, "https://github.com/mgifford/drupal-core-lab/issues/2");
});

test("getAttentionCandidates uses explainable criteria and names unavailable signals", () => {
  const candidates = getAttentionCandidates(
    [
      {
        repository: "mgifford/drupal-core-lab",
        repositoryUrl: "https://github.com/mgifford/drupal-core-lab",
        awaitingReview: 2,
        openPullRequests: 1,
        failingWorkflows: 1,
        lastHumanActivityAt: "2026-11-22T00:00:00Z"
      }
    ],
    { now: NOW, readmeAttention: new Map([["mgifford/drupal-core-lab", true]]) }
  );

  const kinds = candidates.items.map((item) => item.kind);
  assert.ok(kinds.includes("review_requested"));
  assert.ok(kinds.includes("failing_workflow"));
  assert.ok(kinds.includes("readme_quality"));
  assert.ok(candidates.unavailable.some((entry) => entry.id === "security_alerts"));
  assert.ok(candidates.items.every((item) => item.basis));
});

test("getActivityByDay totals human and automated activity per local day", () => {
  const days = getActivityByDay([humanCommit, botCommit, mergedPr], TZ);
  assert.equal(days.length, 2);
  const total = days.reduce((sum, day) => sum + day.total, 0);
  assert.equal(total, 3);
  const botDay = days.find((day) => day.dateKey === "2026-11-20");
  assert.equal(botDay.human, 1);
  assert.equal(botDay.automated, 1);
});

test("buildActivityDigest combines summary, days, projects, and merged work", () => {
  const digest = buildActivityDigest([humanCommit, botCommit, mergedPr, oldEvent], range, { timeZone: TZ });
  assert.equal(digest.summary.total, 3);
  assert.equal(digest.projects.length, 2);
  assert.equal(digest.mergedPullRequests.length, 1);
  assert.ok(digest.byDay.length >= 1);
});
