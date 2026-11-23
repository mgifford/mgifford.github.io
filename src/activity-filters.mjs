/**
 * Activity filter state, URL serialization, and user attribution helpers.
 *
 * Shared by the static build (for saved-question links and default state) and
 * the browser enhancement. Pure and dependency-free.
 */

import { filterEvents } from "./activity.mjs";
import { isWithinRange, normalizePreset, parseRangeFromUrl, rangeToSearchParams, resolveDateRange } from "./time.mjs";

export const RANGE_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "this_week", label: "This week (Monday to now)" },
  { value: "last_week", label: "Last week (Monday to Sunday)" },
  { value: "last_7_days", label: "Last 7 days (rolling)" },
  { value: "last_14_days", label: "Last 14 days" },
  { value: "last_30_days", label: "Last 30 days" },
  { value: "last_90_days", label: "Last 90 days" },
  { value: "custom", label: "Custom range" }
];

export const SAVED_QUESTIONS = [
  { label: "What changed this week?", href: "activity.html?range=this_week" },
  { label: "What changed in the last 7 days?", href: "activity.html?range=last_7_days" },
  { label: "Which projects had pull request activity this week?", href: "activity.html?range=this_week&category=pull_request" },
  { label: "What have I worked on recently?", href: "contributions.html?range=last_7_days" },
  { label: "Where did I leave off?", href: "activity.html?range=last_30_days#project-timelines-heading" },
  { label: "What was released this month?", href: "activity.html?range=last_30_days&category=release" },
  { label: "What changed over 90 days?", href: "activity.html?range=last_90_days" }
];

export const DEFAULT_ACTIVITY_FILTERS = Object.freeze({
  range: "last_7_days",
  from: "",
  to: "",
  workstream: "all",
  category: "all",
  repository: "all",
  search: "",
  excludeAutomated: false
});

/** Parses filter state from a URL search string. */
export function parseActivityFilters(search) {
  const params = new URLSearchParams(search || "");
  const range = parseRangeFromUrl(params);
  const category = params.get("category") || "all";
  const workstream = params.get("workstream") || "all";
  const repository = params.get("repository") || "all";

  return {
    ...DEFAULT_ACTIVITY_FILTERS,
    range: range.preset,
    from: range.from,
    to: range.to,
    workstream: workstream || "all",
    category: category || "all",
    repository: repository || "all",
    search: params.get("q") || "",
    excludeAutomated: params.get("automation") === "exclude"
  };
}

/** Serializes filter state into a shareable query string (defaults omitted). */
export function buildActivitySearch(filters) {
  const params = new URLSearchParams();
  const state = { ...DEFAULT_ACTIVITY_FILTERS, ...(filters || {}) };

  const preset = normalizePreset(state.range) || "last_7_days";
  if (preset === "custom") {
    params.set("range", "custom");
    if (state.from) params.set("from", state.from);
    if (state.to) params.set("to", state.to);
  } else if (preset !== "last_7_days") {
    params.set("range", preset);
  }

  if (state.workstream && state.workstream !== "all") params.set("workstream", state.workstream);
  if (state.category && state.category !== "all") params.set("category", state.category);
  if (state.repository && state.repository !== "all") params.set("repository", state.repository);
  if (state.search) params.set("q", state.search);
  if (state.excludeAutomated) params.set("automation", "exclude");

  return params.toString();
}

/** Resolves the range for a filter state, using the current time for relative presets. */
export function resolveFiltersRange(filters, { now = new Date(), timeZone } = {}) {
  const state = { ...DEFAULT_ACTIVITY_FILTERS, ...(filters || {}) };
  return resolveDateRange(state.range, { now, timeZone, from: state.from, to: state.to });
}

/**
 * Applies all activity filters.
 *
 * @param {object[]} events
 * @param {object} filters
 * @param {{now?:Date|string|number, timeZone?:string, workstreams?:object[]}} [options]
 * @returns {{events:object[], range:object}}
 */
export function filterActivityEvents(events, filters, options = {}) {
  const { now = new Date(), timeZone = "America/Toronto", workstreams = [] } = options;
  const state = { ...DEFAULT_ACTIVITY_FILTERS, ...(filters || {}) };
  const range = resolveFiltersRange(state, { now, timeZone });
  const workstreamRepositories = new Set();
  if (state.workstream !== "all") {
    const workstream = workstreams.find((entry) => entry.id === state.workstream);
    for (const repository of workstream?.repositories || []) workstreamRepositories.add(repository);
  }

  let scoped = (events || []).filter((event) => isWithinRange(event.timestamp, range));

  if (state.workstream !== "all") {
    scoped = scoped.filter(
      (event) =>
        (event.workstreams || []).includes(state.workstream) || workstreamRepositories.has(event.repository)
    );
  }

  const filtered = filterEvents(scoped, {
    category: state.category,
    repository: state.repository,
    search: state.search,
    excludeAutomated: state.excludeAutomated
  });

  return { events: filtered, range };
}

/** True when an event is attributable to the configured public identity. */
export function isUserEvent(event, identity) {
  if (!identity || !event?.actor) return false;
  const identities = [identity.login, ...(identity.aliases || [])].filter(Boolean).map((value) => String(value).toLowerCase());
  return identities.includes(String(event.actor).toLowerCase());
}

/**
 * Public contributions attributable to the user. Repository activity by other
 * people is never included, and automation is excluded unless requested.
 */
export function filterUserContributions(events, identity, filters, options = {}) {
  const { includeAutomated = false } = options;
  const { events: scoped, range } = filterActivityEvents(events, filters, options);
  return {
    range,
    contributions: scoped.filter((event) => isUserEvent(event, identity) && (includeAutomated || !event.automated))
  };
}

/** Builds filter option lists from the data. */
export function buildFilterOptions(events, workstreams = [], repositoryIndex = []) {
  const categories = [...new Set((events || []).map((event) => event.category).filter(Boolean))].sort();
  const repositories = [
    ...new Set([
      ...(repositoryIndex || []).map((row) => row.repository),
      ...(events || []).map((event) => event.repository)
    ])
  ].sort();
  return {
    categories,
    repositories,
    workstreams: (workstreams || []).map((workstream) => ({ id: workstream.id, name: workstream.name }))
  };
}

/** Re-export for callers that only need URL range parsing. */
export { rangeToSearchParams };
