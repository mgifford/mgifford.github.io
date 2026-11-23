import test from "node:test";
import assert from "node:assert/strict";

import { normalizeEvent } from "../src/activity.mjs";
import {
  escapeAttribute,
  escapeHtml,
  externalLink,
  renderActivityByDay,
  renderActivityItem,
  renderContributions,
  renderCoverage,
  renderEmptyState,
  renderEventBadges,
  renderProjectTable,
  renderSavedQuestions,
  renderTypeCountTable,
  renderWorkstreamCards
} from "../src/render.mjs";

const TZ = "America/Toronto";

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
    retrievedAt: "2026-11-23T19:00:00Z",
    ...overrides
  });
}

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

test("escapeHtml neutralises every HTML metacharacter", () => {
  assert.equal(escapeHtml('<script>alert("x")</script>'), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  assert.equal(escapeHtml("Tom & Jerry's"), "Tom &amp; Jerry&#39;s");
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeAttribute('a"b'), "a&quot;b");
});

test("externalLink escapes URLs and announces the new tab", () => {
  const html = externalLink("https://github.com/x/y/commit/1", 'Title <img src=x onerror="alert(1)">');
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noreferrer noopener"/);
  assert.match(html, /opens in a new tab/);
  assert.ok(!html.includes("<img"));
  assert.match(html, /Title &lt;img/);
});

// ---------------------------------------------------------------------------
// Activity items and status badges
// ---------------------------------------------------------------------------

test("automated events are labelled in text, not colour alone", () => {
  const event = makeEvent({ automated: true, automationReason: "bot_account", actor: "dependabot[bot]" });
  const badges = renderEventBadges(event);
  assert.match(badges, /Automated/);
  assert.match(badges, /Commit pushed/);
});

test("completed, in-progress, discussion, and uncertain states are distinct", () => {
  const completed = makeEvent({ eventType: "pull_request_merged", url: "https://github.com/mgifford/x/pull/1" });
  assert.match(renderEventBadges(completed), /Completed/);

  const progress = makeEvent({ eventType: "pull_request_opened", url: "https://github.com/mgifford/x/pull/2" });
  assert.match(renderEventBadges(progress), /In progress/);

  const discussion = makeEvent({
    eventType: "issue_commented",
    actorRole: "commenter",
    url: "https://github.com/mgifford/x/issues/3"
  });
  assert.match(renderEventBadges(discussion), /Discussion/);

  const uncertain = makeEvent({ title: "wip" });
  assert.match(renderEventBadges(uncertain), /Uncertain attribution/);
});

test("observed-at metadata events are marked as approximate", () => {
  const event = makeEvent({
    id: "meta",
    eventType: "repository_metadata_updated",
    actorRole: "system",
    title: "Description changed",
    url: "https://github.com/mgifford/x",
    timestampPrecision: "observed-at"
  });
  assert.match(renderEventBadges(event), /Observed date/);
});

test("renderActivityItem shows the time, actor role, category, and evidence link", () => {
  const html = renderActivityItem(makeEvent(), { timeZone: TZ });
  assert.match(html, /<time datetime="2026-11-22T15:00:00.000Z">10:00<\/time>/);
  assert.match(html, /Author/);
  assert.match(html, /Code development/);
  assert.match(html, /href="https:\/\/github\.com\/mgifford\/drupal-core-lab\/commit\/abc"/);
});

test("renderActivityItem escapes a malicious title", () => {
  const html = renderActivityItem(makeEvent({ title: '<img src=x onerror="alert(1)">' }), { timeZone: TZ });
  assert.ok(!html.includes("<img"));
  assert.match(html, /&lt;img/);
});

// ---------------------------------------------------------------------------
// Grouping and empty states
// ---------------------------------------------------------------------------

test("renderActivityByDay groups by local date with unique heading ids", () => {
  const html = renderActivityByDay(
    [makeEvent({ id: "a" }), makeEvent({ id: "b", timestamp: "2026-11-21T15:00:00Z" })],
    { timeZone: TZ, idPrefix: "activity-day" }
  );
  assert.match(html, /id="activity-day-2026-11-22"/);
  assert.match(html, /id="activity-day-2026-11-21"/);
  assert.equal((html.match(/<section/g) || []).length, 2);
  assert.equal((html.match(/<ol/g) || []).length, 2);
});

test("renderActivityByDay returns an accessible empty state with a hint", () => {
  const html = renderActivityByDay([], { timeZone: TZ, emptyMessage: "Nothing here.", emptyHint: "Try wider." });
  assert.match(html, /Nothing here\./);
  assert.match(html, /Try wider\./);
  assert.match(html, /class="empty-state"/);
});

test("renderEmptyState escapes its message", () => {
  assert.match(renderEmptyState("<b>x</b>"), /&lt;b&gt;x&lt;\/b&gt;/);
});

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

test("renderProjectTable uses a caption and scoped headers", () => {
  const html = renderProjectTable(
    [
      {
        repository: "mgifford/drupal-core-lab",
        latest: {
          url: "https://github.com/mgifford/drupal-core-lab/commit/abc",
          title: "Improve landmark tests",
          eventType: "commit_pushed"
        },
        lastActivityAt: "2026-11-22T15:00:00Z",
        lastHumanActivityAt: "2026-11-22T15:00:00Z",
        humanEventCount: 3,
        eventCount: 5
      }
    ],
    { timeZone: TZ }
  );
  assert.match(html, /<caption>/);
  assert.match(html, /<th scope="col">Project<\/th>/);
  assert.match(html, /<th scope="row">/);
  assert.match(html, /#repo-mgifford-drupal-core-lab/);
});

test("renderProjectTable signals automation-only projects", () => {
  const html = renderProjectTable(
    [
      {
        repository: "mgifford/example",
        latest: { url: "https://github.com/mgifford/example/commit/a", title: "Bump", eventType: "commit_pushed" },
        lastActivityAt: "2026-11-22T15:00:00Z",
        lastHumanActivityAt: null,
        humanEventCount: 0,
        eventCount: 1
      }
    ],
    { timeZone: TZ }
  );
  assert.match(html, /automation only/);
});

test("renderTypeCountTable labels known event types", () => {
  const html = renderTypeCountTable({ pull_request_merged: 2, issue_opened: 1 });
  assert.match(html, /Pull request merged/);
  assert.match(html, /Issue opened/);
  assert.match(html, /<caption>/);
});

// ---------------------------------------------------------------------------
// Contributions and workstreams
// ---------------------------------------------------------------------------

test("renderContributions groups by date and repository", () => {
  const html = renderContributions([makeEvent(), makeEvent({ id: "second" })], { timeZone: TZ });
  assert.match(html, /Sunday, 22 November 2026/);
  assert.match(html, /mgifford\/drupal-core-lab/);
  assert.equal((html.match(/class="contribution-repo"/g) || []).length, 1);
});

test("renderWorkstreamCards lists counts and in-page links", () => {
  const html = renderWorkstreamCards(
    [
      {
        id: "drupal-accessibility",
        name: "Drupal accessibility and quality",
        description: "Drupal accessibility evaluation.",
        humanEventCount: 4,
        activeRepositories: ["mgifford/drupal-core-lab"],
        lastActivityAt: "2026-11-22T15:00:00Z"
      }
    ],
    { timeZone: TZ }
  );
  assert.match(html, /href="#workstream-drupal-accessibility"/);
  assert.match(html, /4<\/strong> human events/);
});

// ---------------------------------------------------------------------------
// Coverage disclosure
// ---------------------------------------------------------------------------

test("renderCoverage discloses incomplete sources, requests, and limitations", () => {
  const html = renderCoverage({
    timezone: TZ,
    lookbackDays: 90,
    window: { start: "2026-08-25T00:00:00Z", end: "2026-11-23T19:00:00Z" },
    requests: { used: 79, budgetMax: 800, exhausted: false },
    sources: [
      { id: "commits", label: "Commit history", status: "partial", records: 100, note: "Two pages per repo.", reasons: ["page-cap"] },
      { id: "issues", label: "Issues", status: "ok", records: 12, note: "" }
    ],
    limitations: ["Public events are limited to roughly 90 days."]
  });
  assert.match(html, /Data coverage and limitations/);
  assert.match(html, /1 source reported incomplete or unavailable/);
  assert.match(html, /page-cap/);
  assert.match(html, /79 of 800/);
  assert.match(html, /Public events are limited/);
});

test("renderSavedQuestions emits real links", () => {
  const html = renderSavedQuestions([{ label: "What changed this week?", href: "activity.html?range=this_week" }]);
  assert.match(html, /href="activity\.html\?range=this_week"/);
  assert.match(html, /What changed this week\?/);
});
