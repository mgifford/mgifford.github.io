import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_TIME_ZONE,
  RANGE_PRESETS,
  formatAge,
  formatLocalDateKey,
  formatLocalDateTime,
  getTimeZoneOffsetMs,
  getZonedParts,
  groupByZonedDay,
  isWithinRange,
  normalizePreset,
  parseRangeFromUrl,
  rangeToSearchParams,
  resolveDateRange,
  startOfZonedDay,
  startOfZonedWeek,
  zonedDateTimeToUtc
} from "../src/time.mjs";

const TZ = DEFAULT_TIME_ZONE;

// Monday 23 November 2026, 14:11 Toronto (EST, UTC-5).
const MONDAY_AFTERNOON = "2026-11-23T19:11:46Z";

// ---------------------------------------------------------------------------
// Zone conversion and DST
// ---------------------------------------------------------------------------

test("default reporting time zone is America/Toronto", () => {
  assert.equal(TZ, "America/Toronto");
});

test("zonedDateTimeToUtc resolves standard time (EST, UTC-5)", () => {
  const instant = zonedDateTimeToUtc({ year: 2026, month: 11, day: 23, hour: 14, minute: 11 }, TZ);
  assert.equal(instant.toISOString(), "2026-11-23T19:11:00.000Z");
});

test("zonedDateTimeToUtc resolves daylight time (EDT, UTC-4)", () => {
  const instant = zonedDateTimeToUtc({ year: 2026, month: 7, day: 1, hour: 12 }, TZ);
  assert.equal(instant.toISOString(), "2026-07-01T16:00:00.000Z");
});

test("startOfZonedDay uses the pre-transition offset on the spring-forward day", () => {
  // DST begins 2026-03-08 at 02:00 local (05:00Z).
  assert.equal(startOfZonedDay("2026-03-08T15:00:00Z", TZ).toISOString(), "2026-03-08T05:00:00.000Z");
  // The next local midnight is already EDT (UTC-4).
  assert.equal(startOfZonedDay("2026-03-09T15:00:00Z", TZ).toISOString(), "2026-03-09T04:00:00.000Z");
});

test("startOfZonedDay uses the post-transition offset on the fall-back day", () => {
  // DST ends 2026-11-01 at 02:00 local.
  assert.equal(startOfZonedDay("2026-11-01T15:00:00Z", TZ).toISOString(), "2026-11-01T04:00:00.000Z");
  assert.equal(startOfZonedDay("2026-11-02T15:00:00Z", TZ).toISOString(), "2026-11-02T05:00:00.000Z");
});

test("getTimeZoneOffsetMs returns -5h in winter and -4h in summer", () => {
  assert.equal(getTimeZoneOffsetMs("2026-01-15T12:00:00Z", TZ), -5 * 3600_000);
  assert.equal(getTimeZoneOffsetMs("2026-07-15T12:00:00Z", TZ), -4 * 3600_000);
});

test("nonexistent spring-forward wall time resolves to a valid instant", () => {
  // 02:30 does not exist on 2026-03-08; it should land at/after 03:00 EDT.
  const instant = zonedDateTimeToUtc({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, TZ);
  assert.equal(instant.toISOString(), "2026-03-08T07:30:00.000Z");
});

test("getZonedParts reports the local weekday", () => {
  assert.equal(getZonedParts(MONDAY_AFTERNOON, TZ).weekday, 1);
  assert.equal(getZonedParts("2026-11-22T19:00:00Z", TZ).weekday, 0);
});

test("formatLocalDateKey shifts across UTC midnight correctly", () => {
  // 02:00Z on 24 November is still 21:00 on 23 November in Toronto.
  assert.equal(formatLocalDateKey("2026-11-24T02:00:00Z", TZ), "2026-11-23");
  assert.equal(formatLocalDateKey("2026-11-24T05:00:00Z", TZ), "2026-11-24");
});

test("formatLocalDateTime is stable and includes the local clock time", () => {
  assert.equal(formatLocalDateTime(MONDAY_AFTERNOON, TZ), "23 November 2026, 14:11");
});

// ---------------------------------------------------------------------------
// Preset normalization
// ---------------------------------------------------------------------------

test("normalizePreset accepts canonical presets and aliases", () => {
  assert.equal(normalizePreset("this_week"), "this_week");
  assert.equal(normalizePreset("week"), "this_week");
  assert.equal(normalizePreset("LAST-WEEK"), "last_week");
  assert.equal(normalizePreset("7d"), "last_7_days");
  assert.equal(normalizePreset("nonsense"), null);
  assert.equal(normalizePreset(""), null);
});

test("RANGE_PRESETS contains every UI preset exactly once", () => {
  assert.deepEqual([...RANGE_PRESETS], [
    "today",
    "yesterday",
    "this_week",
    "last_week",
    "last_7_days",
    "last_14_days",
    "last_30_days",
    "last_90_days",
    "custom"
  ]);
});

// ---------------------------------------------------------------------------
// Date range boundaries
// ---------------------------------------------------------------------------

test("today starts at local midnight and ends at now", () => {
  const range = resolveDateRange("today", { now: MONDAY_AFTERNOON, timeZone: TZ });
  assert.equal(range.start, "2026-11-23T05:00:00.000Z");
  assert.equal(range.end, "2026-11-23T19:11:46.000Z");
});

test("yesterday is the preceding completed local day", () => {
  const range = resolveDateRange("yesterday", { now: MONDAY_AFTERNOON, timeZone: TZ });
  assert.equal(range.start, "2026-11-22T05:00:00.000Z");
  assert.equal(range.end, "2026-11-23T04:59:59.999Z");
});

test("this week starts Monday 00:00 local", () => {
  const range = resolveDateRange("this_week", { now: MONDAY_AFTERNOON, timeZone: TZ });
  assert.equal(range.start, "2026-11-23T05:00:00.000Z");
  assert.equal(range.end, new Date(MONDAY_AFTERNOON).toISOString());
});

test("startOfZonedWeek returns the previous Monday on a Sunday", () => {
  // Sunday 22 November 2026.
  const monday = startOfZonedWeek("2026-11-22T20:00:00Z", TZ);
  assert.equal(monday.toISOString(), "2026-11-16T05:00:00.000Z");
});

test("last week is the preceding Monday through Sunday, not a rolling 7 days", () => {
  const range = resolveDateRange("last_week", { now: MONDAY_AFTERNOON, timeZone: TZ });
  assert.equal(range.start, "2026-11-16T05:00:00.000Z");
  assert.equal(range.end, "2026-11-23T04:59:59.999Z");
});

test("last week spans a DST transition without assuming 168 hours", () => {
  // Tuesday 10 March 2026; clocks moved forward on Sunday 8 March.
  const range = resolveDateRange("last_week", { now: "2026-03-10T15:00:00Z", timeZone: TZ });
  assert.equal(range.start, "2026-03-02T05:00:00.000Z"); // EST
  assert.equal(range.end, "2026-03-09T03:59:59.999Z"); // EDT
  const hours = (range.endMs - range.startMs) / 3600_000;
  assert.ok(hours > 166 && hours < 168, `expected a 167-hour last week, got ${hours}`);
});

test("this week also spans a DST transition correctly", () => {
  const range = resolveDateRange("this_week", { now: "2026-03-10T15:00:00Z", timeZone: TZ });
  assert.equal(range.start, "2026-03-09T04:00:00.000Z");
});

test("last 7 days is a rolling 168-hour window", () => {
  const range = resolveDateRange("last_7_days", { now: MONDAY_AFTERNOON, timeZone: TZ });
  assert.equal(range.endMs - range.startMs, 7 * 24 * 3600_000);
  assert.equal(range.rolling, true);
});

test("rolling windows keep their duration across a DST transition", () => {
  const range = resolveDateRange("last_7_days", { now: "2026-03-10T15:00:00Z", timeZone: TZ });
  assert.equal(range.endMs - range.startMs, 7 * 24 * 3600_000);
});

test("last 14, 30 and 90 day presets use the expected day counts", () => {
  for (const [preset, days] of [
    ["last_14_days", 14],
    ["last_30_days", 30],
    ["last_90_days", 90]
  ]) {
    const range = resolveDateRange(preset, { now: MONDAY_AFTERNOON, timeZone: TZ });
    assert.equal((range.endMs - range.startMs) / 86_400_000, days);
  }
});

test("custom range is inclusive of the final local day", () => {
  const range = resolveDateRange("custom", {
    now: "2026-12-01T12:00:00Z",
    timeZone: TZ,
    from: "2026-11-01",
    to: "2026-11-03"
  });
  assert.equal(range.start, "2026-11-01T04:00:00.000Z"); // EDT
  assert.equal(range.end, "2026-11-04T04:59:59.999Z"); // EST
});

test("custom range swaps reversed dates instead of returning an empty window", () => {
  const range = resolveDateRange("custom", {
    now: "2026-12-01T12:00:00Z",
    timeZone: TZ,
    from: "2026-11-05",
    to: "2026-11-01"
  });
  assert.ok(range.startMs < range.endMs);
  assert.equal(formatLocalDateKey(range.startMs, TZ), "2026-11-01");
  assert.equal(formatLocalDateKey(range.endMs, TZ), "2026-11-05");
});

test("invalid custom input falls back to the default rolling window", () => {
  const range = resolveDateRange("custom", { now: MONDAY_AFTERNOON, timeZone: TZ, from: "not-a-date" });
  assert.equal(range.preset, "last_7_days");
});

test("unknown preset falls back to last 7 days", () => {
  const range = resolveDateRange("sometime", { now: MONDAY_AFTERNOON, timeZone: TZ });
  assert.equal(range.preset, "last_7_days");
});

test("invalid time zone is rejected rather than silently using UTC", () => {
  assert.throws(() => resolveDateRange("today", { now: MONDAY_AFTERNOON, timeZone: "Mars/Olympus" }), /Unknown time zone/);
});

test("range exposes local start and end date keys for shareable URLs", () => {
  const range = resolveDateRange("last_week", { now: MONDAY_AFTERNOON, timeZone: TZ });
  assert.equal(range.fromDate, "2026-11-16");
  assert.equal(range.toDate, "2026-11-22");
});

test("range summary states the resolved times and time zone", () => {
  const range = resolveDateRange("this_week", { now: MONDAY_AFTERNOON, timeZone: TZ });
  assert.match(range.summary, /23 November 2026, 00:00/);
  assert.match(range.summary, /\(America\/Toronto\)/);
});

// ---------------------------------------------------------------------------
// Range membership
// ---------------------------------------------------------------------------

test("isWithinRange includes both boundary instants", () => {
  const range = resolveDateRange("last_7_days", { now: MONDAY_AFTERNOON, timeZone: TZ });
  assert.equal(isWithinRange(range.start, range), true);
  assert.equal(isWithinRange(range.end, range), true);
  assert.equal(isWithinRange(new Date(range.startMs - 1).toISOString(), range), false);
  assert.equal(isWithinRange(new Date(range.endMs + 1).toISOString(), range), false);
  assert.equal(isWithinRange(null, range), false);
  assert.equal(isWithinRange("not-a-date", range), false);
});

// ---------------------------------------------------------------------------
// Grouping, URL state, formatting
// ---------------------------------------------------------------------------

test("groupByZonedDay groups by local date and orders newest first", () => {
  const records = [
    { id: "a", timestamp: "2026-11-23T18:00:00Z" },
    { id: "b", timestamp: "2026-11-23T06:00:00Z" },
    { id: "c", timestamp: "2026-11-22T22:00:00Z" }
  ];
  const groups = groupByZonedDay(records, TZ);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].dateKey, "2026-11-23");
  assert.deepEqual(groups[0].records.map((r) => r.id), ["a", "b"]);
  assert.equal(groups[1].dateKey, "2026-11-22");
  assert.equal(groups[1].weekday, "Sunday");
});

test("rangeToSearchParams round-trips through parseRangeFromUrl", () => {
  const range = resolveDateRange("custom", {
    now: MONDAY_AFTERNOON,
    timeZone: TZ,
    from: "2026-11-01",
    to: "2026-11-10"
  });
  const params = rangeToSearchParams(range);
  assert.deepEqual(params, { range: "custom", from: "2026-11-01", to: "2026-11-10" });
  const parsed = parseRangeFromUrl(new URLSearchParams(params));
  assert.deepEqual(parsed, { preset: "custom", from: "2026-11-01", to: "2026-11-10" });
});

test("parseRangeFromUrl defaults to last 7 days and accepts aliases", () => {
  assert.equal(parseRangeFromUrl("").preset, "last_7_days");
  assert.equal(parseRangeFromUrl("?range=week").preset, "this_week");
  assert.equal(parseRangeFromUrl("?range=").preset, "last_7_days");
});

test("formatAge describes elapsed time without precision theatre", () => {
  assert.equal(formatAge(30_000), "1 minutes");
  assert.equal(formatAge(3 * 3600_000), "3 hours");
  assert.equal(formatAge(2 * 86_400_000), "2 days");
  assert.equal(formatAge(90 * 86_400_000), "3 months");
  assert.equal(formatAge(-1), "unknown");
});
