import test from "node:test";
import assert from "node:assert/strict";

import { normalizeEvent } from "../src/activity.mjs";
import {
  DEFAULT_ACTIVITY_FILTERS,
  buildActivitySearch,
  buildFilterOptions,
  filterActivityEvents,
  filterUserContributions,
  isUserEvent,
  parseActivityFilters,
  resolveFiltersRange
} from "../src/activity-filters.mjs";

const TZ = "America/Toronto";
const NOW = "2026-11-23T19:11:46Z";

function makeEvent(overrides = {}) {
  return normalizeEvent({
    id: overrides.id || `evt-${Math.random().toString(36).slice(2)}`,
    repository: "mgifford/drupal-core-lab",
    timestamp: "2026-11-22T15:00:00Z",
    eventType: "commit_pushed",
    actor: "mgifford",
    actorRole: "author",
    automated: false,
    title: "Improve landmark tests",
    url: "https://github.com/mgifford/drupal-core-lab/commit/abc",
    source: "test",
    retrievedAt: NOW,
    ...overrides
  });
}

const workstreams = [
  { id: "drupal-accessibility", name: "Drupal", repositories: ["mgifford/drupal-core-lab"] },
  { id: "accessibility-testing", name: "Testing", repositories: ["mgifford/open-scans"] }
];

// ---------------------------------------------------------------------------
// URL state
// ---------------------------------------------------------------------------

test("parseActivityFilters defaults to a rolling seven-day window", () => {
  assert.deepEqual(parseActivityFilters(""), { ...DEFAULT_ACTIVITY_FILTERS });
  assert.equal(parseActivityFilters("?range=").range, "last_7_days");
});

test("parseActivityFilters reads every supported parameter", () => {
  const filters = parseActivityFilters(
    "?range=custom&from=2026-11-01&to=2026-11-10&workstream=drupal-accessibility&category=pull_request&repository=mgifford%2Fopen-scans&q=focus&automation=exclude"
  );
  assert.equal(filters.range, "custom");
  assert.equal(filters.from, "2026-11-01");
  assert.equal(filters.to, "2026-11-10");
  assert.equal(filters.workstream, "drupal-accessibility");
  assert.equal(filters.category, "pull_request");
  assert.equal(filters.repository, "mgifford/open-scans");
  assert.equal(filters.search, "focus");
  assert.equal(filters.excludeAutomated, true);
});

test("buildActivitySearch omits default values to keep URLs shareable and short", () => {
  assert.equal(buildActivitySearch(DEFAULT_ACTIVITY_FILTERS), "");
  assert.equal(buildActivitySearch({ ...DEFAULT_ACTIVITY_FILTERS, range: "this_week" }), "range=this_week");
});

test("buildActivitySearch round-trips through parseActivityFilters", () => {
  const filters = {
    ...DEFAULT_ACTIVITY_FILTERS,
    range: "custom",
    from: "2026-11-01",
    to: "2026-11-10",
    category: "release",
    workstream: "web-sustainability",
    repository: "mgifford/example",
    search: "energy",
    excludeAutomated: true
  };
  const parsed = parseActivityFilters(`?${buildActivitySearch(filters)}`);
  assert.deepEqual(parsed, filters);
});

// ---------------------------------------------------------------------------
// Range resolution and filtering
// ---------------------------------------------------------------------------

test("resolveFiltersRange honours custom dates and falls back safely", () => {
  const range = resolveFiltersRange(
    { ...DEFAULT_ACTIVITY_FILTERS, range: "custom", from: "2026-11-01", to: "2026-11-03" },
    { now: NOW, timeZone: TZ }
  );
  assert.equal(range.fromDate, "2026-11-01");
  assert.equal(range.toDate, "2026-11-03");

  const invalid = resolveFiltersRange(
    { ...DEFAULT_ACTIVITY_FILTERS, range: "custom", from: "nope" },
    { now: NOW, timeZone: TZ }
  );
  assert.equal(invalid.preset, "last_7_days");
});

test("filterActivityEvents applies the date range", () => {
  const old = makeEvent({ id: "old", timestamp: "2026-06-01T00:00:00Z" });
  const recent = makeEvent({ id: "recent" });
  const { events, range } = filterActivityEvents([old, recent], DEFAULT_ACTIVITY_FILTERS, {
    now: NOW,
    timeZone: TZ
  });
  assert.deepEqual(events.map((event) => event.id), ["recent"]);
  assert.equal(range.preset, "last_7_days");
});

test("filterActivityEvents filters by workstream configuration and event tags", () => {
  const tagged = makeEvent({ id: "tagged", workstreams: ["accessibility-testing"] });
  const untagged = makeEvent({ id: "untagged", repository: "mgifford/other" });
  const { events } = filterActivityEvents([tagged, untagged], { ...DEFAULT_ACTIVITY_FILTERS, workstream: "accessibility-testing" }, {
    now: NOW,
    timeZone: TZ,
    workstreams
  });
  assert.deepEqual(events.map((event) => event.id), ["tagged"]);
});

test("filterActivityEvents combines category, repository, search, and automation", () => {
  const release = makeEvent({
    id: "release",
    eventType: "release_published",
    repository: "mgifford/wcag-spine",
    title: "v1.2.0 accessibility fixes",
    url: "https://github.com/mgifford/wcag-spine/releases/tag/v1.2.0"
  });
  const bot = makeEvent({
    id: "bot",
    automated: true,
    automationReason: "bot_account",
    actor: "dependabot[bot]",
    title: "Bump axe-core"
  });
  const filters = {
    ...DEFAULT_ACTIVITY_FILTERS,
    category: "release",
    repository: "mgifford/wcag-spine",
    search: "accessibility"
  };
  assert.deepEqual(
    filterActivityEvents([release, bot], filters, { now: NOW, timeZone: TZ }).events.map((event) => event.id),
    ["release"]
  );

  const excluded = filterActivityEvents([release, bot], { ...DEFAULT_ACTIVITY_FILTERS, excludeAutomated: true }, {
    now: NOW,
    timeZone: TZ
  });
  assert.deepEqual(excluded.events.map((event) => event.id), ["release"]);
});

test("filterActivityEvents returns an explicit empty result rather than throwing", () => {
  assert.deepEqual(filterActivityEvents([], DEFAULT_ACTIVITY_FILTERS, { now: NOW, timeZone: TZ }).events, []);
  assert.deepEqual(filterActivityEvents(undefined, DEFAULT_ACTIVITY_FILTERS, { now: NOW, timeZone: TZ }).events, []);
});

// ---------------------------------------------------------------------------
// Identity and contributions
// ---------------------------------------------------------------------------

test("isUserEvent matches configured aliases case-insensitively", () => {
  const identity = { login: "mgifford", aliases: ["Mike Gifford"] };
  assert.equal(isUserEvent({ actor: "mgifford" }, identity), true);
  assert.equal(isUserEvent({ actor: "mike gifford" }, identity), true);
  assert.equal(isUserEvent({ actor: "someone-else" }, identity), false);
  assert.equal(isUserEvent({}, identity), false);
});

test("filterUserContributions excludes other people and automation", () => {
  const mine = makeEvent({ id: "mine" });
  const other = makeEvent({ id: "other", actor: "contributor" });
  const bot = makeEvent({ id: "bot", automated: true, automationReason: "bot_account" });
  const { contributions } = filterUserContributions([mine, other, bot], { login: "mgifford", aliases: [] }, DEFAULT_ACTIVITY_FILTERS, {
    now: NOW,
    timeZone: TZ
  });
  assert.deepEqual(contributions.map((event) => event.id), ["mine"]);
});

test("filterUserContributions can include automated activity when asked", () => {
  const botMine = makeEvent({
    id: "bot-mine",
    actor: "mgifford",
    automated: true,
    automationReason: "generated_data_commit",
    title: "chore: weekly repo sync"
  });
  const { contributions } = filterUserContributions(
    [botMine],
    { login: "mgifford", aliases: [] },
    DEFAULT_ACTIVITY_FILTERS,
    { now: NOW, timeZone: TZ, includeAutomated: true }
  );
  assert.equal(contributions.length, 1);
});

test("filterUserContributions does not attribute unrelated activity in owned repositories", () => {
  const other = makeEvent({ id: "other", actor: "colleague", repository: "mgifford/drupal-core-lab" });
  const { contributions } = filterUserContributions([other], { login: "mgifford", aliases: [] }, DEFAULT_ACTIVITY_FILTERS, {
    now: NOW,
    timeZone: TZ
  });
  assert.equal(contributions.length, 0);
});

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

test("buildFilterOptions produces sorted categories, repositories, and workstreams", () => {
  const options = buildFilterOptions(
    [
      makeEvent({
        id: "a",
        eventType: "issue_opened",
        repository: "mgifford/b",
        url: "https://github.com/mgifford/b/issues/1"
      }),
      makeEvent({ id: "b", repository: "mgifford/a" })
    ],
    workstreams,
    [{ repository: "mgifford/c" }]
  );
  assert.deepEqual(options.categories, ["code_development", "issue"]);
  assert.deepEqual(options.repositories, ["mgifford/a", "mgifford/b", "mgifford/c"]);
  assert.deepEqual(options.workstreams.map((workstream) => workstream.id), ["drupal-accessibility", "accessibility-testing"]);
});
