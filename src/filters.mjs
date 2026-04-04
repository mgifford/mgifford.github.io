/**
 * Pure filter and sort logic extracted from app.js for testability.
 *
 * All functions here are stateless: they receive their dependencies as
 * arguments and return new values without mutating global state.
 */

/**
 * Returns the numeric sort rank for a repo.
 * Repos without an explicit rank are treated as lowest priority (Infinity).
 *
 * @param {{ manualSortRank?: number }} repo
 * @returns {number}
 */
export function manualRankValue(repo) {
  return Number.isFinite(repo.manualSortRank) ? repo.manualSortRank : Number.POSITIVE_INFINITY;
}

/**
 * Parses filter state from a URL search string.
 *
 * @param {string} search  e.g. "?sort=updated&q=accessibility"
 * @returns {Partial<FilterState>}
 */
export function parseFiltersFromUrl(search) {
  const params = new URLSearchParams(search);
  const next = {};

  if (params.has("q")) next.search = params.get("q") || "";
  if (params.has("theme")) next.theme = params.get("theme") || "all";
  if (params.has("sort")) next.sortBy = params.get("sort") || "stars";
  if (params.has("scope")) next.publicScope = params.get("scope") || "curated";
  if (params.has("archived")) next.archivedMode = params.get("archived") || "hide";
  if (params.has("issues")) next.hasOpenIssues = params.get("issues") === "open";

  return next;
}

/**
 * Builds a URL search string that reflects the current filter state.
 * Non-default values are included; defaults are omitted to keep the URL clean.
 *
 * @param {string} existingSearch  Current URL search string (mutated into a new one)
 * @param {FilterState} filters
 * @param {{ ownerMode?: boolean }} [opts]
 * @returns {string}  New search string (may be empty)
 */
export function buildFilterSearch(existingSearch, filters, opts = {}) {
  const { ownerMode = false } = opts;
  const params = new URLSearchParams(existingSearch);

  if (filters.search) params.set("q", filters.search);
  else params.delete("q");

  if (filters.theme && filters.theme !== "all") params.set("theme", filters.theme);
  else params.delete("theme");

  if (filters.sortBy && filters.sortBy !== "stars") params.set("sort", filters.sortBy);
  else params.delete("sort");

  if (!ownerMode && filters.publicScope && filters.publicScope !== "curated") {
    params.set("scope", filters.publicScope);
  } else {
    params.delete("scope");
  }

  if (ownerMode && filters.archivedMode && filters.archivedMode !== "hide") {
    params.set("archived", filters.archivedMode);
  } else {
    params.delete("archived");
  }

  if (filters.hasOpenIssues) params.set("issues", "open");
  else params.delete("issues");

  return params.toString();
}

/**
 * Sorts a list of repos according to the given mode.
 *
 * Manual sort ranks only apply for the default `stars` sort so that
 * user-selected sorts like `updated` or `pushed` are fully respected.
 *
 * @param {object[]} repos
 * @param {string}   mode  "stars" | "watchers" | "updated" | "pushed" | "name"
 * @param {{ ownerMode?: boolean, actionRepoNames?: Set<string> }} [opts]
 * @returns {object[]}  New array, original is not mutated
 */
export function sortRepos(repos, mode, opts = {}) {
  const { ownerMode = false, actionRepoNames = new Set() } = opts;
  const sorted = [...repos];

  sorted.sort((a, b) => {
    // In owner mode, repos with open action items bubble to the top
    if (ownerMode && actionRepoNames.size > 0) {
      const aIsActive = actionRepoNames.has(a.name.toLowerCase());
      const bIsActive = actionRepoNames.has(b.name.toLowerCase());
      if (aIsActive !== bIsActive) return aIsActive ? -1 : 1;
    }

    // Manual rank only applies for the default stars sort so user-chosen
    // sorts like "updated" or "pushed" are fully respected.
    if (mode === "stars" || mode === null || mode === undefined) {
      const aRank = manualRankValue(a);
      const bRank = manualRankValue(b);
      if (aRank !== bRank) return aRank - bRank;
    }

    if (mode === "name") return a.name.localeCompare(b.name);
    if (mode === "pushed") return new Date(b.pushedAt || 0) - new Date(a.pushedAt || 0);
    if (mode === "updated") return new Date(b.updatedAt) - new Date(a.updatedAt);
    if (mode === "watchers") return (b.watchers || 0) - (a.watchers || 0);
    return (b.stars || 0) - (a.stars || 0);
  });

  return sorted;
}

/**
 * Filters a list of repos according to the current filter state.
 *
 * @param {object[]} repos
 * @param {FilterState} filters
 * @returns {object[]}
 */
export function filterRepos(repos, filters) {
  const q = (filters.search || "").trim().toLowerCase();

  return repos.filter((repo) => {
    if (filters.theme !== "all" && repo.theme !== filters.theme) return false;

    if (filters.archivedMode === "hide" && repo.archived) return false;
    if (filters.archivedMode === "only" && !repo.archived) return false;

    if (filters.hasOpenIssues && !(repo.openIssues > 0)) return false;

    if (!q) return true;

    const haystack = [repo.name, repo.summary, repo.language, repo.theme, ...(repo.topics || [])]
      .join(" ")
      .toLowerCase();

    return haystack.includes(q);
  });
}

/**
 * Applies the public curated scope cap and optional featured-first ordering.
 *
 * When the sort is the default "stars" sort, featured repos are pinned to the
 * top so they remain prominent. For any other user-selected sort the order is
 * left untouched so the sort is fully respected.
 *
 * @param {object[]} sortedRepos
 * @param {{ ownerMode?: boolean, publicScope?: string, sortBy?: string, curatedMax?: number }} [opts]
 * @returns {object[]}
 */
export function applyPublicScope(sortedRepos, opts = {}) {
  const { ownerMode = false, publicScope = "curated", sortBy = "stars", curatedMax = 60 } = opts;

  if (ownerMode || publicScope === "all") {
    return sortedRepos;
  }

  if (sortBy === "stars") {
    const featured = sortedRepos.filter((repo) => repo.featured);
    const featuredSet = new Set(featured.map((repo) => repo.name));
    const nonFeatured = sortedRepos.filter((repo) => !featuredSet.has(repo.name));
    return [...featured, ...nonFeatured].slice(0, curatedMax);
  }

  return sortedRepos.slice(0, curatedMax);
}
