import test from "node:test";
import assert from "node:assert/strict";

import {
  CATEGORIES,
  EVENT_TYPES,
  assessSubstantive,
  buildRepositoryIndex,
  classifyActor,
  classifyCommit,
  dedupeEvents,
  deriveCategory,
  deriveOutcome,
  eventIds,
  filterEvents,
  groupEvents,
  isDependencyUpdateCommit,
  isGeneratedDataCommit,
  normalizeEvent,
  parseMergeCommit,
  slugify,
  sortEventsNewestFirst,
  summarizeEvents,
  summarizePeriod,
  summarizeRepository
} from "../src/activity.mjs";

const NOW = "2026-11-23T19:11:46.000Z";

function makeEvent(overrides = {}) {
  return normalizeEvent({
    id: "github:commit:mgifford/example@abc123",
    repository: "mgifford/example",
    timestamp: "2026-11-23T12:00:00Z",
    eventType: "commit_pushed",
    actor: "mgifford",
    actorRole: "author",
    automated: false,
    title: "Improve landmark navigation in the test evaluator",
    url: "https://github.com/mgifford/example/commit/abc123",
    source: "github-rest-commits",
    retrievedAt: NOW,
    ...overrides
  });
}

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------

test("every event type maps to a declared category", () => {
  for (const [type, definition] of Object.entries(EVENT_TYPES)) {
    assert.ok(CATEGORIES[definition.category], `${type} points at unknown category ${definition.category}`);
    assert.equal(deriveCategory(type), definition.category);
  }
});

test("deriveCategory returns null for unknown types", () => {
  assert.equal(deriveCategory("teleported"), null);
});

test("slugify produces stable anchors", () => {
  assert.equal(slugify("mgifford/Drupal Core Lab"), "mgifford-drupal-core-lab");
  assert.equal(slugify("  "), "");
});

// ---------------------------------------------------------------------------
// Bot and automation classification
// ---------------------------------------------------------------------------

test("classifyActor flags bot accounts by suffix, type, and known names", () => {
  assert.deepEqual(classifyActor("dependabot[bot]"), { login: "dependabot[bot]", automated: true, reason: "bot_account" });
  assert.deepEqual(classifyActor({ login: "release-bot", type: "Bot" }), {
    login: "release-bot",
    automated: true,
    reason: "bot_account"
  });
  assert.equal(classifyActor("github-actions").automated, true);
  assert.equal(classifyActor("renovate").automated, true);
  assert.equal(classifyActor("actions-user").automated, true);
});

test("classifyActor leaves human accounts alone", () => {
  for (const login of ["mgifford", "robotnik", "abbot", "a11y-bot-fan"]) {
    assert.equal(classifyActor(login).automated, false, `${login} should be treated as human`);
  }
  assert.equal(classifyActor("").automated, false);
  assert.equal(classifyActor(undefined).automated, false);
});

test("isDependencyUpdateCommit recognises routine dependency work", () => {
  assert.equal(isDependencyUpdateCommit("chore(deps): bump axios from 1.0.0 to 1.1.0"), true);
  assert.equal(isDependencyUpdateCommit("chore(deps-dev): bump jsdom"), true);
  assert.equal(isDependencyUpdateCommit("Bump lodash from 4.17.20 to 4.17.21"), true);
  assert.equal(isDependencyUpdateCommit("fix(deps): correct broken import"), false);
});

test("isGeneratedDataCommit recognises generated-data commits", () => {
  assert.equal(isGeneratedDataCommit("chore: weekly repo sync"), true);
  assert.equal(isGeneratedDataCommit("chore: monthly screenshot refresh"), true);
  assert.equal(isGeneratedDataCommit("Update generated site data"), true);
  assert.equal(isGeneratedDataCommit("docs: explain generated data policy"), false);
});

test("parseMergeCommit extracts a pull request number from merge commits", () => {
  assert.deepEqual(parseMergeCommit("Merge pull request #94 from mgifford/issue-2942404\n\nBody"), { number: 94 });
  assert.equal(parseMergeCommit("Merge branch 'main' into feature"), null);
});

test("classifyCommit treats Dependabot and generated-data commits as automated", () => {
  const dependabot = classifyCommit({ author: "dependabot[bot]", message: "Bump axios from 1.0.0 to 1.1.0" });
  assert.equal(dependabot.automated, true);
  assert.equal(dependabot.automationReason, "bot_account");

  const generated = classifyCommit({ author: "mgifford", message: "chore: weekly repo sync" });
  assert.equal(generated.automated, true);
  assert.equal(generated.automationReason, "generated_data_commit");
  assert.equal(generated.generatedData, true);

  const human = classifyCommit({ author: "mgifford", message: "Add keyboard trap regression test" });
  assert.equal(human.automated, false);
  assert.equal(human.automationReason, null);
});

test("classifyCommit links merge commits to their pull request", () => {
  const result = classifyCommit({ author: "mgifford", message: "Merge pull request #12 from mgifford/fix" });
  assert.equal(result.mergeCommit, true);
  assert.equal(result.mergePullRequest, 12);
});

// ---------------------------------------------------------------------------
// Event normalization and substance
// ---------------------------------------------------------------------------

test("normalizeEvent rejects missing required fields", () => {
  assert.throws(() => normalizeEvent({ id: "x" }), /missing required field "repository"/);
});

test("normalizeEvent rejects unknown event types and bad timestamps", () => {
  assert.throws(() => normalizeEvent({ ...makeEvent(), eventType: "invented" }), /Unknown event type/);
  const base = {
    id: "x",
    repository: "mgifford/example",
    timestamp: "not-a-date",
    eventType: "commit_pushed",
    actor: "mgifford",
    actorRole: "author",
    title: "t",
    url: "https://github.com/mgifford/example/commit/x",
    source: "test",
    retrievedAt: NOW
  };
  assert.throws(() => normalizeEvent(base), /Invalid event timestamp/);
});

test("normalizeEvent requires an HTTP source URL", () => {
  assert.throws(
    () => normalizeEvent({ ...makeEvent(), url: "javascript:alert(1)" }),
    /non-HTTP source URL/
  );
});

test("normalizeEvent recomputes derived fields from raw evidence", () => {
  const event = makeEvent({ automated: true, automationReason: "bot_account" });
  assert.equal(event.category, "code_development");
  assert.equal(event.outcome, "informational", "automated work is never reported as progress");
  assert.equal(event.substantive, false);
  assert.equal(event.substantiveReason, "Automated activity, not human project work.");
});

test("snapshot events are frozen so downstream code cannot rewrite evidence", () => {
  const event = makeEvent();
  assert.equal(Object.isFrozen(event), true);
});

test("an opened pull request is not treated as completed work", () => {
  const opened = makeEvent({
    id: "github:pull_request:mgifford/example#5:opened",
    eventType: "pull_request_opened",
    actorRole: "author",
    title: "Draft: new evaluation harness",
    url: "https://github.com/mgifford/example/pull/5"
  });
  assert.equal(opened.outcome, "in_progress");
  assert.equal(opened.substantive, true);
});

test("a merged pull request is completed but a closed one is not", () => {
  const merged = makeEvent({
    id: "github:pull_request:mgifford/example#6:merged",
    eventType: "pull_request_merged",
    actorRole: "author",
    title: "Add ARIA live region tests",
    url: "https://github.com/mgifford/example/pull/6"
  });
  assert.equal(merged.outcome, "completed");

  const closed = makeEvent({
    id: "github:pull_request:mgifford/example#7:closed",
    eventType: "pull_request_closed",
    actorRole: "author",
    title: "Superseded approach",
    url: "https://github.com/mgifford/example/pull/7"
  });
  assert.equal(closed.outcome, "in_progress");
});

test("merge commits are not counted as substantive development", () => {
  const event = makeEvent({ title: "Merge pull request #94 from mgifford/issue-2942404", mergeCommit: true });
  assert.equal(event.substantive, false);
  assert.match(event.substantiveReason, /Merge commit/);
});

test("repository metadata changes are administrivia, not development", () => {
  const event = makeEvent({
    id: "github:repository_metadata:mgifford/example@2026-11-23T12:00:00Z",
    eventType: "repository_metadata_updated",
    actorRole: "system",
    title: "Repository metadata updated",
    url: "https://github.com/mgifford/example",
    timestampPrecision: "observed-at",
    derived: true
  });
  assert.equal(event.category, "repository_administration");
  assert.equal(event.substantive, false);
  assert.equal(event.outcome, "informational");
});

test("short commit messages are reported as uncertain rather than substantive", () => {
  const event = makeEvent({ title: "wip" });
  assert.equal(event.substantive, null);
  assert.match(event.substantiveReason, /too short/);
});

test("assessSubstantive flags releases and reviews as substantive", () => {
  assert.equal(assessSubstantive(makeEvent({ eventType: "release_published", actorRole: "author" })).substantive, true);
  assert.equal(
    assessSubstantive(makeEvent({ eventType: "pull_request_review", actorRole: "reviewer" })).substantive,
    true
  );
});

test("deriveOutcome distinguishes discussion from shipping", () => {
  assert.equal(deriveOutcome({ eventType: "issue_commented", automated: false }), "discussion");
  assert.equal(deriveOutcome({ eventType: "release_published", automated: false }), "completed");
  assert.equal(deriveOutcome({ eventType: "repository_metadata_updated", automated: false }), "informational");
});

// ---------------------------------------------------------------------------
// Deduplication and grouping
// ---------------------------------------------------------------------------

test("dedupeEvents removes duplicate ids", () => {
  const a = makeEvent({ id: "same" });
  const b = makeEvent({ id: "same", title: "Preferred title" });
  const deduped = dedupeEvents([a, b]);
  assert.equal(deduped.length, 1);
});

test("a merge commit and its merged pull request collapse into one work group", () => {
  const groupKey = "pr:mgifford/example#94";
  const merge = makeEvent({
    id: "github:commit:mgifford/example@merge-sha",
    title: "Merge pull request #94 from mgifford/issue-2942404",
    mergeCommit: true,
    groupKey
  });
  const pr = makeEvent({
    id: "github:pull_request:mgifford/example#94:merged",
    eventType: "pull_request_merged",
    title: "Start accessibility evaluation with interdiffs",
    actorRole: "author",
    url: "https://github.com/mgifford/example/pull/94",
    groupKey
  });

  const groups = groupEvents([merge, pr]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].representative.eventType, "pull_request_merged");
  assert.equal(groups[0].count, 2);
  assert.equal(groups[0].automated, false);
});

test("groupEvents keeps unrelated events separate", () => {
  const groups = groupEvents([makeEvent({ id: "a" }), makeEvent({ id: "b" })]);
  assert.equal(groups.length, 2);
});

test("groupEvents marks a group automated only when every event is automated", () => {
  const key = "pr:mgifford/example#1";
  const botCommit = makeEvent({ id: "a", automated: true, automationReason: "bot_account", groupKey: key });
  const humanPr = makeEvent({
    id: "b",
    eventType: "pull_request_merged",
    groupKey: key,
    url: "https://github.com/mgifford/example/pull/1"
  });
  assert.equal(groupEvents([botCommit, humanPr])[0].automated, false);
});

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

test("filterEvents excludes automation when asked", () => {
  const human = makeEvent({ id: "h" });
  const bot = makeEvent({ id: "b", automated: true, automationReason: "bot_account" });
  assert.deepEqual(filterEvents([human, bot], { excludeAutomated: true }).map((event) => event.id), ["h"]);
  assert.deepEqual(filterEvents([human, bot], { automated: true }).map((event) => event.id), ["b"]);
});

test("filterEvents combines repository, category, workstream, and search", () => {
  const a = makeEvent({ id: "a", workstreams: ["drupal-accessibility"] });
  const b = makeEvent({
    id: "b",
    repository: "mgifford/other",
    eventType: "issue_commented",
    actorRole: "commenter",
    workstreams: ["government-monitoring"],
    url: "https://github.com/mgifford/other/issues/3"
  });

  assert.equal(filterEvents([a, b], { repository: "mgifford/other" }).length, 1);
  assert.equal(filterEvents([a, b], { category: "issue" }).length, 1);
  assert.equal(filterEvents([a, b], { workstream: "drupal-accessibility" }).length, 1);
  assert.equal(filterEvents([a, b], { search: "other" }).length, 1);
  assert.equal(filterEvents([a, b], { search: "zzz" }).length, 0);
});

test("filterEvents respects an explicit range", () => {
  const old = makeEvent({ id: "old", timestamp: "2026-01-01T00:00:00Z" });
  const recent = makeEvent({ id: "recent", timestamp: "2026-11-22T00:00:00Z" });
  const range = { startMs: Date.parse("2026-11-16T00:00:00Z"), endMs: Date.parse("2026-11-23T23:59:59Z") };
  assert.deepEqual(filterEvents([old, recent], { range }).map((event) => event.id), ["recent"]);
});

test("sortEventsNewestFirst does not mutate the input array", () => {
  const events = [makeEvent({ id: "older", timestamp: "2026-01-01T00:00:00Z" }), makeEvent({ id: "newer" })];
  const before = events.map((event) => event.id);
  sortEventsNewestFirst(events);
  assert.deepEqual(events.map((event) => event.id), before);
});

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

test("summarizeEvents separates human from automated activity", () => {
  const events = [
    makeEvent({ id: "human" }),
    makeEvent({ id: "bot", automated: true, automationReason: "bot_account" }),
    makeEvent({ id: "bot2", automated: true, automationReason: "generated_data_commit" })
  ];
  const summary = summarizeEvents(events);
  assert.equal(summary.total, 3);
  assert.equal(summary.human, 1);
  assert.equal(summary.automated, 2);
  assert.equal(summary.automationShare, 67);
  assert.deepEqual(summary.humanRepositories, ["mgifford/example"]);
});

test("summarizeEvents counts outcomes without double counting completed work", () => {
  const events = [
    makeEvent({ id: "merged", eventType: "pull_request_merged", url: "https://github.com/mgifford/example/pull/1" }),
    makeEvent({ id: "opened", eventType: "pull_request_opened", url: "https://github.com/mgifford/example/pull/2" }),
    makeEvent({ id: "issue", eventType: "issue_commented", actorRole: "commenter", url: "https://github.com/mgifford/example/issues/3" })
  ];
  const summary = summarizeEvents(events);
  assert.equal(summary.completed, 1);
  assert.equal(summary.inProgress, 1);
  assert.equal(summary.discussion, 1);
});

test("summarizeRepository reports last human activity separately from any activity", () => {
  const bot = makeEvent({
    id: "bot",
    automated: true,
    automationReason: "bot_account",
    timestamp: "2026-11-23T18:00:00Z"
  });
  const human = makeEvent({ id: "human", timestamp: "2026-11-20T09:00:00Z" });

  const summary = summarizeRepository("mgifford/example", [bot, human]);
  assert.equal(summary.lastActivityAt, "2026-11-23T18:00:00.000Z");
  assert.equal(summary.lastHumanActivityAt, "2026-11-20T09:00:00.000Z");
  assert.equal(summary.automationOnly, false);
});

test("summarizeRepository flags automation-only repositories", () => {
  const bot = makeEvent({ id: "bot", automated: true, automationReason: "bot_account" });
  const summary = summarizeRepository("mgifford/example", [bot]);
  assert.equal(summary.automationOnly, true);
  assert.equal(summary.lastHumanActivityAt, null);
});

test("buildRepositoryIndex merges open-work counts from repository records", () => {
  const index = buildRepositoryIndex(
    [makeEvent({ id: "e" })],
    [{ fullName: "mgifford/example", url: "https://github.com/mgifford/example", openIssues: 4, openPullRequests: 2, archived: false }]
  );
  assert.equal(index.length, 1);
  assert.equal(index[0].openIssues, 4);
  assert.equal(index[0].openPullRequests, 2);
  assert.equal(index[0].eventCount, 1);
});

test("summarizePeriod groups completed, in-progress, discussion, and automation evidence", () => {
  const events = [
    makeEvent({ id: "merged", eventType: "pull_request_merged", url: "https://github.com/mgifford/example/pull/1", title: "Ship it" }),
    makeEvent({ id: "opened", eventType: "pull_request_opened", url: "https://github.com/mgifford/example/pull/2", title: "Draft it" }),
    makeEvent({ id: "review", eventType: "pull_request_review", actorRole: "reviewer", url: "https://github.com/mgifford/example/pull/3", title: "Reviewed it" }),
    makeEvent({ id: "bot", automated: true, automationReason: "bot_account" })
  ];
  const period = summarizePeriod(events);
  assert.equal(period.completedWork.length, 1);
  assert.equal(period.inProgressWork.length, 1);
  assert.equal(period.discussions.length, 1);
  assert.equal(period.automation.length, 1);
  assert.equal(period.projects.length, 1);
});

test("eventIds are stable and source-specific", () => {
  assert.equal(eventIds.commit("mgifford/a", "abc"), "github:commit:mgifford/a@abc");
  assert.equal(eventIds.pullRequest("mgifford/a", 4, "merged"), "github:pull_request:mgifford/a#4:merged");
  assert.equal(eventIds.release("mgifford/a", "v1.0.0"), "github:release:mgifford/a@v1.0.0");
});
