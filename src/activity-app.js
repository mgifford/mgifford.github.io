/**
 * Progressive enhancement for Project Atlas activity pages.
 *
 * The pages already contain a complete static snapshot. This script adds
 * date-range filtering, shareable URLs, and live re-rendering. If anything
 * fails, the static content and its evidence links remain usable.
 */

import { CATEGORIES } from "./activity.mjs";
import {
  DEFAULT_ACTIVITY_FILTERS,
  buildActivitySearch,
  buildFilterOptions,
  filterActivityEvents,
  parseActivityFilters,
  resolveFiltersRange
} from "./activity-filters.mjs";
import { labelForCategory } from "./render.mjs";
import { renderActivityView, renderContributionsView } from "./views.mjs";

const DATA_PATH = "data/activity-data.json";
const THEME_KEY = "mgiffordRepoCatalogTheme";

const results = document.querySelector("#atlas-results");
const form = document.querySelector("#atlas-filters");
const statusRegion = document.querySelector("#atlas-status");
const view = results?.dataset.view || "activity";

const els = form
  ? {
      range: form.querySelector("#f-range"),
      from: form.querySelector("#f-from"),
      to: form.querySelector("#f-to"),
      workstream: form.querySelector("#f-workstream"),
      category: form.querySelector("#f-category"),
      repository: form.querySelector("#f-repository"),
      search: form.querySelector("#f-search"),
      excludeAutomated: form.querySelector("#f-exclude-automated"),
      reset: form.querySelector("[data-reset-link]")
    }
  : {};

let data = null;
let filters = { ...DEFAULT_ACTIVITY_FILTERS };
let searchTimer = null;
let extendedLoading = null;
let renderToken = 0;
let extendedLoaded = false;

function setStatus(message) {
  if (statusRegion) statusRegion.textContent = message;
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

function getCurrentTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function applyTheme(theme, persist = true) {
  document.documentElement.setAttribute("data-theme", theme);
  if (persist) window.localStorage.setItem(THEME_KEY, theme);
  const toggle = document.querySelector("#theme-toggle");
  if (toggle) {
    const next = theme === "dark" ? "light" : "dark";
    toggle.setAttribute("aria-label", `Switch to ${next} mode`);
    toggle.setAttribute("title", `Switch to ${next} mode`);
    toggle.setAttribute("aria-pressed", String(theme === "dark"));
  }
}

function initTheme() {
  applyTheme(getCurrentTheme(), false);
  document.querySelector("#theme-toggle")?.addEventListener("click", () => {
    applyTheme(getCurrentTheme() === "dark" ? "light" : "dark", true);
  });
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function addOption(select, value, label, selected = false) {
  if (!select) return;
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  if (selected) option.selected = true;
  select.append(option);
}

function populateOptions() {
  const options = buildFilterOptions(data.events, data.workstreams, data.repositoryIndex);

  if (els.category) {
    // Keep the taxonomy order stable and readable.
    const preferred = Object.keys(CATEGORIES).filter((category) => options.categories.includes(category));
    const rest = options.categories.filter((category) => !preferred.includes(category));
    els.category.replaceChildren();
    addOption(els.category, "all", "All activity types");
    for (const category of [...preferred, ...rest]) addOption(els.category, category, labelForCategory(category));
  }
  for (const workstream of options.workstreams) {
    addOption(els.workstream, workstream.id, workstream.name);
  }
  for (const repository of options.repositories) {
    addOption(els.repository, repository, repository);
  }
}

function readForm() {
  return {
    range: els.range?.value || "last_7_days",
    from: els.from?.value || "",
    to: els.to?.value || "",
    workstream: els.workstream?.value || "all",
    category: els.category?.value || "all",
    repository: els.repository?.value || "all",
    search: els.search?.value || "",
    excludeAutomated: Boolean(els.excludeAutomated?.checked)
  };
}

function selectValue(select, value) {
  if (!select) return "all";
  const exists = [...select.options].some((option) => option.value === value);
  return exists ? value : "all";
}

function writeForm(next) {
  if (!form) return;
  if (els.range) els.range.value = next.range;
  if (els.from) els.from.value = next.from || "";
  if (els.to) els.to.value = next.to || "";
  if (els.workstream) els.workstream.value = selectValue(els.workstream, next.workstream);
  if (els.category) els.category.value = selectValue(els.category, next.category);
  if (els.repository) els.repository.value = selectValue(els.repository, next.repository);
  if (els.search) els.search.value = next.search || "";
  if (els.excludeAutomated) els.excludeAutomated.checked = Boolean(next.excludeAutomated);
  syncCustomRangeVisibility();
}

function syncCustomRangeVisibility() {
  const custom = els.range?.value === "custom";
  for (const field of form?.querySelectorAll("[data-custom-range]") || []) {
    field.hidden = !custom;
  }
  if (els.from) els.from.required = custom;
  if (els.to) els.to.required = custom;
}

function syncUrl() {
  const query = buildActivitySearch(filters);
  const hash = window.location.hash || "";
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${hash}`;
  if (`${window.location.pathname}${window.location.search}${hash}` !== nextUrl) {
    window.history.replaceState(null, "", nextUrl);
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Loads older events on demand so the initial page transfer stays small.
 * Ranges that start before the shipped window need the extended payload.
 */
async function ensureEventsForRange(range) {
  if (!data?.extendedAvailable || !data.extendedPath || extendedLoaded) return;
  if (!data.window?.start) return;
  if (range.startMs >= new Date(data.window.start).getTime()) return;

  if (!extendedLoading) {
    setStatus("Loading older activity…");
    extendedLoading = fetch(data.extendedPath, { headers: { Accept: "application/json" } })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((extended) => {
        const byId = new Map(data.events.map((event) => [event.id, event]));
        for (const event of extended.events || []) {
          if (!byId.has(event.id)) byId.set(event.id, event);
        }
        data.events = [...byId.values()].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        extendedLoaded = true;
      })
      .catch((error) => {
        console.error(error);
        setStatus("Older activity could not be loaded. Showing only the most recent seven days.");
      })
      .finally(() => {
        extendedLoading = null;
      });
  }

  await extendedLoading;
}

async function render() {
  if (!data || !results) return;
  const token = ++renderToken;
  const options = { now: new Date(), timeZone: data.timezone, workstreams: data.workstreams || [] };
  const range = resolveFiltersRange(filters, { now: options.now, timeZone: options.timeZone });

  if (range.startMs < new Date(data.window?.start || 0).getTime()) {
    await ensureEventsForRange(range);
  }
  if (token !== renderToken) return;

  const { events } = filterActivityEvents(data.events, filters, options);

  try {
    const html =
      view === "contributions"
        ? renderContributionsView({
            events,
            coverage: data.coverage,
            range,
            timeZone: data.timezone,
            identity: data.identity
          })
        : renderActivityView({
            events,
            repositoryIndex: data.repositoryIndex || [],
            coverage: data.coverage,
            range,
            timeZone: data.timezone
          });

    results.innerHTML = html;
    syncUrl();

    const automationNote = filters.excludeAutomated ? " Routine automation is excluded." : "";
    const label = view === "contributions" ? "attributable contributions" : "events";
    setStatus(`Showing ${events.length} ${label}. ${range.summary}.${automationNote}`);
  } catch (error) {
    console.error(error);
    setStatus("The interactive view could not be updated. The static snapshot remains available.");
  }
}

function updateFiltersFromForm() {
  filters = readForm();
  syncCustomRangeVisibility();
  render();
}

function initialiseForm() {
  if (!form) return;
  for (const category of Object.keys(CATEGORIES)) {
    addOption(els.category, category, labelForCategory(category));
  }

  writeForm(filters);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    updateFiltersFromForm();
  });
  for (const control of [els.range, els.category, els.workstream, els.repository, els.excludeAutomated]) {
    control?.addEventListener("change", () => {
      if (control === els.range) syncCustomRangeVisibility();
      updateFiltersFromForm();
    });
  }
  els.search?.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(updateFiltersFromForm, 250);
  });
}

async function init() {
  initTheme();

  if (!form || !results || view === "reports") return;

  try {
    const response = await fetch(DATA_PATH, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json();
  } catch (error) {
    console.error(error);
    setStatus("Activity data could not be loaded. The static snapshot above is still available and links to the original evidence.");
    return;
  }

  filters = { ...DEFAULT_ACTIVITY_FILTERS, ...parseActivityFilters(window.location.search) };

  populateOptions();
  initialiseForm();
  writeForm(filters);
  document.documentElement.classList.add("atlas-js");
  render();
}

init();
