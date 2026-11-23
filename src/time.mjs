/**
 * Timezone-aware date range utilities.
 *
 * The site reports activity in a configured IANA time zone (default
 * America/Toronto). All persisted timestamps stay in UTC; only presentation
 * and range boundaries are localized.
 *
 * Pure module with no dependencies so it can run in Node (data pipeline,
 * tests, reports) and in the browser (filters).
 */

export const DEFAULT_TIME_ZONE = "America/Toronto";

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/** Ordered range presets exposed in the UI and shareable URLs. */
export const RANGE_PRESETS = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "last_7_days",
  "last_14_days",
  "last_30_days",
  "last_90_days",
  "custom"
];

export const RANGE_LABELS = {
  today: "Today",
  yesterday: "Yesterday",
  this_week: "This week",
  last_week: "Last week",
  last_7_days: "Last 7 days",
  last_14_days: "Last 14 days",
  last_30_days: "Last 30 days",
  last_90_days: "Last 90 days",
  custom: "Custom range"
};

/** Short aliases accepted in URLs and query strings. */
const PRESET_ALIASES = {
  week: "this_week",
  thisweek: "this_week",
  "this-week": "this_week",
  lastweek: "last_week",
  "last-week": "last_week",
  "7d": "last_7_days",
  "14d": "last_14_days",
  "30d": "last_30_days",
  "90d": "last_90_days"
};

const partsFormatters = new Map();

/** Returns true when the runtime accepts the IANA time zone identifier. */
export function isValidTimeZone(timeZone) {
  if (!timeZone || typeof timeZone !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

function getPartsFormatter(timeZone) {
  let formatter = partsFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    partsFormatters.set(timeZone, formatter);
  }
  return formatter;
}

function toDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Invalid date value: ${String(value)}`);
  }
  return date;
}

/**
 * Returns the wall-clock parts of an instant in a time zone.
 *
 * @param {Date|string|number} value
 * @param {string} [timeZone]
 * @returns {{year:number,month:number,day:number,hour:number,minute:number,second:number,weekday:number}}
 */
export function getZonedParts(value, timeZone = DEFAULT_TIME_ZONE) {
  const date = toDate(value);
  const parts = getPartsFormatter(timeZone).formatToParts(date);
  const lookup = {};
  for (const part of parts) {
    if (part.type !== "literal") lookup[part.type] = part.value;
  }

  const year = Number(lookup.year);
  const month = Number(lookup.month);
  const day = Number(lookup.day);
  const hour = Number(lookup.hour);
  const minute = Number(lookup.minute);
  const second = Number(lookup.second);

  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  };
}

/**
 * Difference in milliseconds between the zone's wall clock and UTC at an
 * instant. Positive east of UTC (e.g. +3600000 for Europe/Paris in winter).
 */
export function getTimeZoneOffsetMs(value, timeZone = DEFAULT_TIME_ZONE) {
  const date = toDate(value);
  const parts = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const truncated = Math.floor(date.getTime() / 1000) * 1000;
  return asUtc - truncated;
}

/**
 * Converts a wall-clock date-time in a time zone to a UTC instant.
 *
 * Uses two correction passes so that ranges spanning a daylight-saving
 * transition resolve to the correct offset. Nonexistent wall times (spring
 * forward) resolve to the first valid instant after the gap; ambiguous times
 * (fall back) resolve to the earlier occurrence, matching Temporal's
 * "compatible" disambiguation.
 *
 * @param {{year:number,month:number,day:number,hour?:number,minute?:number,second?:number}} parts
 * @param {string} [timeZone]
 * @returns {Date}
 */
export function zonedDateTimeToUtc(parts, timeZone = DEFAULT_TIME_ZONE) {
  const { year, month, day, hour = 0, minute = 0, second = 0 } = parts;
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);

  let instant = wall - getTimeZoneOffsetMs(new Date(wall), timeZone);
  for (let pass = 0; pass < 2; pass += 1) {
    const corrected = wall - getTimeZoneOffsetMs(new Date(instant), timeZone);
    if (corrected === instant) break;
    instant = corrected;
  }
  return new Date(instant);
}

/** First instant of the local day containing `value`. */
export function startOfZonedDay(value, timeZone = DEFAULT_TIME_ZONE) {
  const { year, month, day } = getZonedParts(value, timeZone);
  return zonedDateTimeToUtc({ year, month, day }, timeZone);
}

/** Last millisecond of the local day containing `value`. */
export function endOfZonedDay(value, timeZone = DEFAULT_TIME_ZONE) {
  return new Date(startOfZonedDay(value, timeZone).getTime() + MS_PER_DAY - 1);
}

/**
 * First instant of the ISO week (Monday 00:00 local time) containing `value`.
 */
export function startOfZonedWeek(value, timeZone = DEFAULT_TIME_ZONE) {
  const parts = getZonedParts(value, timeZone);
  const daysSinceMonday = (parts.weekday + 6) % 7;
  const mondayUtcMidnight = Date.UTC(parts.year, parts.month - 1, parts.day) - daysSinceMonday * MS_PER_DAY;
  const monday = new Date(mondayUtcMidnight);
  return zonedDateTimeToUtc(
    { year: monday.getUTCFullYear(), month: monday.getUTCMonth() + 1, day: monday.getUTCDate() },
    timeZone
  );
}

/** Normalizes preset aliases, returning null when unknown. */
export function normalizePreset(preset) {
  if (!preset) return null;
  const key = String(preset).trim().toLowerCase();
  if (RANGE_PRESETS.includes(key)) return key;
  if (PRESET_ALIASES[key]) return PRESET_ALIASES[key];
  return null;
}

function startOfZonedDayFromIso(isoDate, timeZone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() + 1 !== month ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return zonedDateTimeToUtc({ year, month, day }, timeZone);
}

function formatZoned(value, timeZone, options) {
  return new Intl.DateTimeFormat("en-GB", { timeZone, ...options }).format(toDate(value));
}

/** Formats a timestamp as `YYYY-MM-DD` in the reporting time zone. */
export function formatLocalDateKey(value, timeZone = DEFAULT_TIME_ZONE) {
  const parts = getZonedParts(value, timeZone);
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${parts.year}-${month}-${day}`;
}

/** Human date, e.g. "23 November 2026". */
export function formatLocalDate(value, timeZone = DEFAULT_TIME_ZONE) {
  return formatZoned(value, timeZone, { day: "numeric", month: "long", year: "numeric" });
}

/** Human date and time, e.g. "23 November 2026, 14:30". */
export function formatLocalDateTime(value, timeZone = DEFAULT_TIME_ZONE, { withZone = false } = {}) {
  // Compose date and time separately so the output is locale-stable
  // ("23 November 2026, 14:11" rather than "... at 14:11").
  const base = `${formatLocalDate(value, timeZone)}, ${formatLocalTime(value, timeZone)}`;
  return withZone ? `${base} (${timeZone})` : base;
}

/** Short date used in tables, e.g. "23 Nov 2026". */
export function formatShortDate(value, timeZone = DEFAULT_TIME_ZONE) {
  return formatZoned(value, timeZone, { day: "2-digit", month: "short", year: "numeric" });
}

/** Short time, e.g. "14:30". */
export function formatLocalTime(value, timeZone = DEFAULT_TIME_ZONE) {
  return formatZoned(value, timeZone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

/** Weekday name, e.g. "Monday". */
export function formatWeekday(value, timeZone = DEFAULT_TIME_ZONE) {
  return formatZoned(value, timeZone, { weekday: "long" });
}

function clampToNow(endMs, nowMs) {
  return Math.min(endMs, nowMs);
}

/**
 * Resolves a named preset (or custom range) into an explicit UTC range.
 *
 * Definitions (all in `timeZone`):
 * - today: local midnight to now.
 * - yesterday: previous local midnight to its last millisecond.
 * - this_week: Monday 00:00 to now.
 * - last_week: previous Monday 00:00 to Sunday 23:59:59.999.
 * - last_7_days / last_14_days / last_30_days / last_90_days: rolling
 *   windows of exactly N×24 hours ending now.
 * - custom: local midnight of `from` to the last millisecond of `to`.
 *
 * @param {string} preset
 * @param {{now?: Date|string|number, timeZone?: string, from?: string, to?: string}} [options]
 * @returns {{preset:string,timeZone:string,start:string,end:string,startMs:number,endMs:number,label:string,summary:string,rolling:boolean,days:number,fromDate:string,toDate:string,disclosure:string}}
 */
export function resolveDateRange(preset, options = {}) {
  const timeZone = options.timeZone || DEFAULT_TIME_ZONE;
  if (!isValidTimeZone(timeZone)) {
    throw new RangeError(`Unknown time zone: ${timeZone}`);
  }

  const normalized = normalizePreset(preset) || "last_7_days";
  const now = toDate(options.now ?? new Date());
  const nowMs = now.getTime();

  let startMs;
  let endMs;
  let rolling = false;
  let days = 0;

  switch (normalized) {
    case "today": {
      startMs = startOfZonedDay(now, timeZone).getTime();
      endMs = clampToNow(nowMs, nowMs);
      days = 1;
      break;
    }
    case "yesterday": {
      const todayStart = startOfZonedDay(now, timeZone).getTime();
      const yesterdayStart = startOfZonedDay(new Date(todayStart - MS_PER_HOUR), timeZone).getTime();
      startMs = yesterdayStart;
      endMs = todayStart - 1;
      days = 1;
      break;
    }
    case "this_week": {
      startMs = startOfZonedWeek(now, timeZone).getTime();
      endMs = nowMs;
      days = Math.floor((endMs - startMs) / MS_PER_DAY) + 1;
      break;
    }
    case "last_week": {
      const thisWeekStart = startOfZonedWeek(now, timeZone).getTime();
      const lastWeekStart = startOfZonedWeek(new Date(thisWeekStart - MS_PER_HOUR), timeZone).getTime();
      startMs = lastWeekStart;
      endMs = thisWeekStart - 1;
      days = 7;
      break;
    }
    case "custom": {
      const from = startOfZonedDayFromIso(options.from, timeZone);
      const toStart = startOfZonedDayFromIso(options.to, timeZone) ?? from;
      if (!from) {
        // Invalid custom input falls back to the default preset rather than
        // inventing a range the user did not ask for.
        return resolveDateRange("last_7_days", { now, timeZone });
      }
      startMs = from.getTime();
      endMs = toStart.getTime() + MS_PER_DAY - 1;
      if (endMs < startMs) {
        [startMs, endMs] = [endMs, startMs];
      }
      days = Math.floor((endMs - startMs) / MS_PER_DAY) + 1;
      break;
    }
    default: {
      const windowDays = Number(normalized.replace("last_", "").replace("_days", ""));
      const boundedDays = Number.isFinite(windowDays) && windowDays > 0 ? windowDays : 7;
      startMs = nowMs - boundedDays * MS_PER_DAY;
      endMs = nowMs;
      rolling = true;
      days = boundedDays;
      break;
    }
  }

  const label = RANGE_LABELS[normalized] || RANGE_LABELS.last_7_days;
  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(endMs).toISOString();

  return {
    preset: normalized,
    timeZone,
    start: startIso,
    end: endIso,
    startMs,
    endMs,
    label,
    summary: `${formatLocalDateTime(startMs, timeZone)} – ${formatLocalDateTime(endMs, timeZone)} (${timeZone})`,
    rolling,
    days,
    fromDate: formatLocalDateKey(startMs, timeZone),
    toDate: formatLocalDateKey(endMs, timeZone),
    disclosure: rolling
      ? `Rolling ${days * 24}-hour window ending ${formatLocalDateTime(endMs, timeZone)} (${timeZone}).`
      : `${label} in ${timeZone}: ${formatLocalDateTime(startMs, timeZone)} – ${formatLocalDateTime(endMs, timeZone)}.`
  };
}

/** True when an ISO timestamp falls inside the inclusive range. */
export function isWithinRange(value, range) {
  if (!value) return false;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return false;
  return time >= range.startMs && time <= range.endMs;
}

/** Filters a list of records that expose a `timestamp` field. */
export function filterByRange(records, range) {
  return (records || []).filter((record) => isWithinRange(record.timestamp, range));
}

/**
 * Groups records by their local calendar date, newest day first.
 * Returns `[{ dateKey, dateLabel, timestamp, records }]`.
 */
export function groupByZonedDay(records, timeZone = DEFAULT_TIME_ZONE) {
  const groups = new Map();
  for (const record of records || []) {
    const time = new Date(record.timestamp).getTime();
    if (Number.isNaN(time)) continue;
    const dateKey = formatLocalDateKey(time, timeZone);
    if (!groups.has(dateKey)) {
      groups.set(dateKey, {
        dateKey,
        timestamp: startOfZonedDay(time, timeZone).toISOString(),
        dateLabel: formatLocalDate(time, timeZone),
        weekday: formatWeekday(time, timeZone),
        records: []
      });
    }
    groups.get(dateKey).records.push(record);
  }

  return [...groups.values()]
    .sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1))
    .map((group) => ({
      ...group,
      records: group.records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    }));
}

/** Serializes range inputs for shareable URLs. */
export function rangeToSearchParams(range) {
  if (!range) return {};
  if (range.preset === "custom") {
    return { range: "custom", from: range.fromDate, to: range.toDate };
  }
  return { range: range.preset };
}

/**
 * Parses range inputs from a URLSearchParams, query string, or plain object.
 * Returns `{ preset, from, to, timeZone? }`.
 */
export function parseRangeFromUrl(input) {
  const params =
    input instanceof URLSearchParams
      ? input
      : typeof input === "string"
        ? new URLSearchParams(input)
        : new URLSearchParams(input || {});

  const rawPreset = params.get("range") || params.get("preset") || "";
  const preset = normalizePreset(rawPreset) || (params.has("from") || params.has("to") ? "custom" : "last_7_days");
  return {
    preset,
    from: params.get("from") || "",
    to: params.get("to") || ""
  };
}

/** Formats a duration in ms as a compact human string (e.g. "3 days"). */
export function formatAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "unknown";
  const hours = Math.floor(ms / MS_PER_HOUR);
  if (hours < 1) return `${Math.max(1, Math.floor(ms / MS_PER_MINUTE))} minutes`;
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  if (days < 60) return `${days} day${days === 1 ? "" : "s"}`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"}`;
}

/** Exposed for tests; not part of the public API. */
export const __testing = { MS_PER_DAY, MS_PER_HOUR, startOfZonedDayFromIso };
