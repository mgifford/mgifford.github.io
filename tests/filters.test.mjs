import test from "node:test";
import assert from "node:assert/strict";

import {
  manualRankValue,
  parseFiltersFromUrl,
  buildFilterSearch,
  sortRepos,
  filterRepos,
  applyPublicScope
} from "../src/filters.mjs";

// ---------------------------------------------------------------------------
// manualRankValue
// ---------------------------------------------------------------------------

test("manualRankValue returns the rank when explicitly set", () => {
  assert.equal(manualRankValue({ manualSortRank: 1 }), 1);
  assert.equal(manualRankValue({ manualSortRank: 0 }), 0);
  assert.equal(manualRankValue({ manualSortRank: 99 }), 99);
});

test("manualRankValue returns Infinity for repos without a rank", () => {
  assert.equal(manualRankValue({}), Number.POSITIVE_INFINITY);
  assert.equal(manualRankValue({ manualSortRank: null }), Number.POSITIVE_INFINITY);
  assert.equal(manualRankValue({ manualSortRank: undefined }), Number.POSITIVE_INFINITY);
  assert.equal(manualRankValue({ manualSortRank: NaN }), Number.POSITIVE_INFINITY);
});

// ---------------------------------------------------------------------------
// parseFiltersFromUrl
// ---------------------------------------------------------------------------

test("parseFiltersFromUrl parses sort param", () => {
  const result = parseFiltersFromUrl("?sort=updated");
  assert.equal(result.sortBy, "updated");
});

test("parseFiltersFromUrl parses all supported params", () => {
  const result = parseFiltersFromUrl("?q=accessibility&sort=pushed&theme=Web%20Platform&scope=all&archived=show&issues=open");
  assert.equal(result.search, "accessibility");
  assert.equal(result.sortBy, "pushed");
  assert.equal(result.theme, "Web Platform");
  assert.equal(result.publicScope, "all");
  assert.equal(result.archivedMode, "show");
  assert.equal(result.hasOpenIssues, true);
});

test("parseFiltersFromUrl returns empty object when no params present", () => {
  assert.deepEqual(parseFiltersFromUrl(""), {});
  assert.deepEqual(parseFiltersFromUrl("?"), {});
});

test("parseFiltersFromUrl issues=open sets hasOpenIssues true", () => {
  assert.equal(parseFiltersFromUrl("?issues=open").hasOpenIssues, true);
});

test("parseFiltersFromUrl issues with any other value sets hasOpenIssues false", () => {
  assert.equal(parseFiltersFromUrl("?issues=closed").hasOpenIssues, false);
  assert.equal(parseFiltersFromUrl("?issues=").hasOpenIssues, false);
});

test("parseFiltersFromUrl falls back to empty string for blank q", () => {
  assert.equal(parseFiltersFromUrl("?q=").search, "");
});

test("parseFiltersFromUrl falls back to 'all' for blank theme", () => {
  assert.equal(parseFiltersFromUrl("?theme=").theme, "all");
});

test("parseFiltersFromUrl falls back to 'created' for blank sort", () => {
  assert.equal(parseFiltersFromUrl("?sort=").sortBy, "created");
});

// ---------------------------------------------------------------------------
// buildFilterSearch (URL serialisation)
// ---------------------------------------------------------------------------

const defaultFilters = {
  search: "",
  theme: "all",
  sortBy: "created",
  archivedMode: "hide",
  publicScope: "curated",
  hasOpenIssues: false
};

test("buildFilterSearch produces empty string for all-default filters", () => {
  assert.equal(buildFilterSearch("", defaultFilters), "");
});

test("buildFilterSearch includes sort when non-default", () => {
  const result = buildFilterSearch("", { ...defaultFilters, sortBy: "updated" });
  assert.ok(result.includes("sort=updated"), `Expected sort=updated in: ${result}`);
});

test("buildFilterSearch omits sort=created (default)", () => {
  const result = buildFilterSearch("", { ...defaultFilters, sortBy: "created" });
  assert.ok(!result.includes("sort="), `Should not include sort= in: ${result}`);
});

test("buildFilterSearch includes sort=stars when explicitly set", () => {
  const result = buildFilterSearch("", { ...defaultFilters, sortBy: "stars" });
  assert.ok(result.includes("sort=stars"), `Expected sort=stars in: ${result}`);
});

test("buildFilterSearch includes q when search is set", () => {
  const result = buildFilterSearch("", { ...defaultFilters, search: "accessibility" });
  assert.ok(result.includes("q=accessibility"), `Expected q=accessibility in: ${result}`);
});

test("buildFilterSearch includes theme when not 'all'", () => {
  const result = buildFilterSearch("", { ...defaultFilters, theme: "Web Platform" });
  assert.ok(result.includes("theme=Web+Platform") || result.includes("theme=Web%20Platform"), `Expected theme in: ${result}`);
});

test("buildFilterSearch includes issues=open when hasOpenIssues", () => {
  const result = buildFilterSearch("", { ...defaultFilters, hasOpenIssues: true });
  assert.ok(result.includes("issues=open"), `Expected issues=open in: ${result}`);
});

test("buildFilterSearch includes scope in public mode when not curated", () => {
  const result = buildFilterSearch("", { ...defaultFilters, publicScope: "all" }, { ownerMode: false });
  assert.ok(result.includes("scope=all"), `Expected scope=all in: ${result}`);
});

test("buildFilterSearch omits scope in owner mode", () => {
  const result = buildFilterSearch("", { ...defaultFilters, publicScope: "all" }, { ownerMode: true });
  assert.ok(!result.includes("scope="), `Should not include scope= in owner mode: ${result}`);
});

test("buildFilterSearch includes archived in owner mode when not 'hide'", () => {
  const result = buildFilterSearch("", { ...defaultFilters, archivedMode: "show" }, { ownerMode: true });
  assert.ok(result.includes("archived=show"), `Expected archived=show in: ${result}`);
});

test("buildFilterSearch omits archived in public mode", () => {
  const result = buildFilterSearch("", { ...defaultFilters, archivedMode: "show" }, { ownerMode: false });
  assert.ok(!result.includes("archived="), `Should not include archived= in public mode: ${result}`);
});

test("buildFilterSearch round-trips: parse then build produces same params", () => {
  const search = "?sort=updated&q=a11y&issues=open";
  const filters = { ...defaultFilters, ...parseFiltersFromUrl(search) };
  const rebuilt = buildFilterSearch("", filters);
  const params = new URLSearchParams(rebuilt);
  assert.equal(params.get("sort"), "updated");
  assert.equal(params.get("q"), "a11y");
  assert.equal(params.get("issues"), "open");
});

// ---------------------------------------------------------------------------
// filterRepos
// ---------------------------------------------------------------------------

const makeRepo = (overrides = {}) => ({
  name: "repo",
  summary: "",
  language: "JavaScript",
  theme: "Web",
  topics: [],
  archived: false,
  openIssues: 0,
  ...overrides
});

const baseFilters = {
  search: "",
  theme: "all",
  archivedMode: "hide",
  hasOpenIssues: false
};

test("filterRepos returns all repos when no filter is active", () => {
  const repos = [makeRepo({ name: "a" }), makeRepo({ name: "b" })];
  assert.equal(filterRepos(repos, baseFilters).length, 2);
});

test("filterRepos hides archived repos when archivedMode is 'hide'", () => {
  const repos = [makeRepo({ name: "live" }), makeRepo({ name: "old", archived: true })];
  const result = filterRepos(repos, { ...baseFilters, archivedMode: "hide" });
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "live");
});

test("filterRepos shows only archived repos when archivedMode is 'only'", () => {
  const repos = [makeRepo({ name: "live" }), makeRepo({ name: "old", archived: true })];
  const result = filterRepos(repos, { ...baseFilters, archivedMode: "only" });
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "old");
});

test("filterRepos shows all repos (including archived) when archivedMode is 'show'", () => {
  const repos = [makeRepo({ name: "live" }), makeRepo({ name: "old", archived: true })];
  const result = filterRepos(repos, { ...baseFilters, archivedMode: "show" });
  assert.equal(result.length, 2);
});

test("filterRepos filters by theme", () => {
  const repos = [makeRepo({ name: "a", theme: "Web" }), makeRepo({ name: "b", theme: "Accessibility" })];
  const result = filterRepos(repos, { ...baseFilters, theme: "Accessibility" });
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "b");
});

test("filterRepos theme 'all' returns all themes", () => {
  const repos = [makeRepo({ theme: "Web" }), makeRepo({ theme: "Accessibility" })];
  assert.equal(filterRepos(repos, { ...baseFilters, theme: "all" }).length, 2);
});

test("filterRepos filters repos with open issues", () => {
  const repos = [makeRepo({ name: "has-issues", openIssues: 3 }), makeRepo({ name: "no-issues", openIssues: 0 })];
  const result = filterRepos(repos, { ...baseFilters, hasOpenIssues: true });
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "has-issues");
});

test("filterRepos search matches repo name (case-insensitive)", () => {
  const repos = [makeRepo({ name: "CivicTech" }), makeRepo({ name: "devtools" })];
  const result = filterRepos(repos, { ...baseFilters, search: "civic" });
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "CivicTech");
});

test("filterRepos search matches summary", () => {
  const repos = [makeRepo({ name: "a", summary: "Accessibility scanner" }), makeRepo({ name: "b", summary: "Nothing" })];
  const result = filterRepos(repos, { ...baseFilters, search: "scanner" });
  assert.equal(result.length, 1);
});

test("filterRepos search matches language", () => {
  const repos = [makeRepo({ name: "a", language: "Python" }), makeRepo({ name: "b", language: "Go" })];
  const result = filterRepos(repos, { ...baseFilters, search: "python" });
  assert.equal(result.length, 1);
});

test("filterRepos search matches topics", () => {
  const repos = [makeRepo({ name: "a", topics: ["a11y", "html"] }), makeRepo({ name: "b", topics: ["backend"] })];
  const result = filterRepos(repos, { ...baseFilters, search: "a11y" });
  assert.equal(result.length, 1);
});

test("filterRepos returns empty array when nothing matches", () => {
  const repos = [makeRepo({ name: "a" }), makeRepo({ name: "b" })];
  const result = filterRepos(repos, { ...baseFilters, search: "zzznomatch" });
  assert.equal(result.length, 0);
});

test("filterRepos with empty search treats whitespace-only as no query", () => {
  const repos = [makeRepo({ name: "a" }), makeRepo({ name: "b" })];
  const result = filterRepos(repos, { ...baseFilters, search: "   " });
  assert.equal(result.length, 2);
});

test("filterRepos combines theme and search filters", () => {
  const repos = [
    makeRepo({ name: "civic-web", theme: "Civic", summary: "civic tech" }),
    makeRepo({ name: "a11y-web", theme: "Web", summary: "accessibility" }),
    makeRepo({ name: "civic-a11y", theme: "Civic", summary: "accessibility for civic" })
  ];
  const result = filterRepos(repos, { ...baseFilters, theme: "Civic", search: "accessibility" });
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "civic-a11y");
});

// ---------------------------------------------------------------------------
// sortRepos
// ---------------------------------------------------------------------------

const makeRepoForSort = (name, overrides = {}) => ({
  name,
  stars: 0,
  watchers: 0,
  updatedAt: "2020-01-01T00:00:00Z",
  pushedAt: "2020-01-01T00:00:00Z",
  ...overrides
});

test("sortRepos sorts by stars descending (default)", () => {
  const repos = [makeRepoForSort("a", { stars: 10 }), makeRepoForSort("b", { stars: 100 }), makeRepoForSort("c", { stars: 5 })];
  const result = sortRepos(repos, "stars");
  assert.equal(result[0].name, "b");
  assert.equal(result[1].name, "a");
  assert.equal(result[2].name, "c");
});

test("sortRepos sorts by watchers descending", () => {
  const repos = [makeRepoForSort("a", { watchers: 1 }), makeRepoForSort("b", { watchers: 50 })];
  const result = sortRepos(repos, "watchers");
  assert.equal(result[0].name, "b");
});

test("sortRepos sorts by updatedAt descending", () => {
  const repos = [
    makeRepoForSort("old", { updatedAt: "2020-01-01T00:00:00Z" }),
    makeRepoForSort("new", { updatedAt: "2024-06-01T00:00:00Z" })
  ];
  const result = sortRepos(repos, "updated");
  assert.equal(result[0].name, "new");
});

test("sortRepos sorts by createdAt descending", () => {
  const repos = [
    makeRepoForSort("old", { createdAt: "2015-01-01T00:00:00Z" }),
    makeRepoForSort("new", { createdAt: "2025-06-01T00:00:00Z" })
  ];
  const result = sortRepos(repos, "created");
  assert.equal(result[0].name, "new");
  assert.equal(result[1].name, "old");
});

test("sortRepos sorts by pushedAt descending", () => {
  const repos = [
    makeRepoForSort("old", { pushedAt: "2019-01-01T00:00:00Z" }),
    makeRepoForSort("new", { pushedAt: "2024-01-01T00:00:00Z" })
  ];
  const result = sortRepos(repos, "pushed");
  assert.equal(result[0].name, "new");
});

test("sortRepos sorts by name alphabetically", () => {
  const repos = [makeRepoForSort("zebra"), makeRepoForSort("apple"), makeRepoForSort("mango")];
  const result = sortRepos(repos, "name");
  assert.equal(result[0].name, "apple");
  assert.equal(result[1].name, "mango");
  assert.equal(result[2].name, "zebra");
});

test("sortRepos with stars mode respects manualSortRank", () => {
  const repos = [
    makeRepoForSort("low-rank", { stars: 1000, manualSortRank: 99 }),
    makeRepoForSort("high-rank", { stars: 1, manualSortRank: 1 })
  ];
  const result = sortRepos(repos, "stars");
  assert.equal(result[0].name, "high-rank", "lower manualSortRank should come first");
});

test("sortRepos with created mode respects manualSortRank", () => {
  const repos = [
    makeRepoForSort("low-rank", { createdAt: "2025-01-01T00:00:00Z", manualSortRank: 99 }),
    makeRepoForSort("high-rank", { createdAt: "2015-01-01T00:00:00Z", manualSortRank: 1 })
  ];
  const result = sortRepos(repos, "created");
  assert.equal(result[0].name, "high-rank", "manualSortRank should override createdAt in default sort");
});

test("sortRepos with updated mode ignores manualSortRank so ?sort=updated is fully respected", () => {
  const repos = [
    makeRepoForSort("ranked-old", { updatedAt: "2019-01-01T00:00:00Z", manualSortRank: 1 }),
    makeRepoForSort("unranked-new", { updatedAt: "2024-06-01T00:00:00Z" })
  ];
  const result = sortRepos(repos, "updated");
  assert.equal(result[0].name, "unranked-new", "most recently updated should come first regardless of manualSortRank");
});

test("sortRepos with pushed mode ignores manualSortRank", () => {
  const repos = [
    makeRepoForSort("ranked-old", { pushedAt: "2019-01-01T00:00:00Z", manualSortRank: 1 }),
    makeRepoForSort("unranked-new", { pushedAt: "2024-06-01T00:00:00Z" })
  ];
  const result = sortRepos(repos, "pushed");
  assert.equal(result[0].name, "unranked-new");
});

test("sortRepos with name mode ignores manualSortRank", () => {
  const repos = [
    makeRepoForSort("zebra", { manualSortRank: 1 }),
    makeRepoForSort("apple", {})
  ];
  const result = sortRepos(repos, "name");
  assert.equal(result[0].name, "apple", "name sort should not be overridden by manualSortRank");
});

test("sortRepos with watchers mode ignores manualSortRank", () => {
  const repos = [
    makeRepoForSort("ranked-low-watchers", { watchers: 1, manualSortRank: 1 }),
    makeRepoForSort("unranked-high-watchers", { watchers: 500 })
  ];
  const result = sortRepos(repos, "watchers");
  assert.equal(result[0].name, "unranked-high-watchers");
});

test("sortRepos does not mutate original array", () => {
  const repos = [makeRepoForSort("b", { stars: 10 }), makeRepoForSort("a", { stars: 100 })];
  const original = [...repos];
  sortRepos(repos, "stars");
  assert.deepEqual(repos.map((r) => r.name), original.map((r) => r.name));
});

test("sortRepos in owner mode with actionRepoNames bubbles action repos to top", () => {
  const repos = [
    makeRepoForSort("normal", { stars: 1000 }),
    makeRepoForSort("needs-attention", { stars: 1 })
  ];
  const result = sortRepos(repos, "stars", { ownerMode: true, actionRepoNames: new Set(["needs-attention"]) });
  assert.equal(result[0].name, "needs-attention");
});

test("sortRepos without owner mode ignores actionRepoNames", () => {
  const repos = [
    makeRepoForSort("normal", { stars: 1000 }),
    makeRepoForSort("needs-attention", { stars: 1 })
  ];
  const result = sortRepos(repos, "stars", { ownerMode: false, actionRepoNames: new Set(["needs-attention"]) });
  assert.equal(result[0].name, "normal");
});

test("sortRepos returns empty array for empty input", () => {
  assert.deepEqual(sortRepos([], "stars"), []);
});

// ---------------------------------------------------------------------------
// applyPublicScope
// ---------------------------------------------------------------------------

const makeRepoForScope = (name, overrides = {}) => ({ name, featured: false, ...overrides });

test("applyPublicScope returns all repos in owner mode", () => {
  const repos = Array.from({ length: 100 }, (_, i) => makeRepoForScope(`repo-${i}`));
  const result = applyPublicScope(repos, { ownerMode: true, publicScope: "curated", sortBy: "stars", curatedMax: 60 });
  assert.equal(result.length, 100);
});

test("applyPublicScope returns all repos when publicScope is 'all'", () => {
  const repos = Array.from({ length: 100 }, (_, i) => makeRepoForScope(`repo-${i}`));
  const result = applyPublicScope(repos, { ownerMode: false, publicScope: "all", sortBy: "stars", curatedMax: 60 });
  assert.equal(result.length, 100);
});

test("applyPublicScope caps to curatedMax in curated mode", () => {
  const repos = Array.from({ length: 100 }, (_, i) => makeRepoForScope(`repo-${i}`));
  const result = applyPublicScope(repos, { ownerMode: false, publicScope: "curated", sortBy: "stars", curatedMax: 60 });
  assert.equal(result.length, 60);
});

test("applyPublicScope pins featured repos first when sortBy is 'stars'", () => {
  const repos = [
    makeRepoForScope("non-featured-a"),
    makeRepoForScope("non-featured-b"),
    makeRepoForScope("featured-one", { featured: true }),
    makeRepoForScope("featured-two", { featured: true })
  ];
  const result = applyPublicScope(repos, { ownerMode: false, publicScope: "curated", sortBy: "stars", curatedMax: 60 });
  assert.ok(result[0].featured, "First repo should be featured");
  assert.ok(result[1].featured, "Second repo should be featured");
});

test("applyPublicScope pins featured repos first when sortBy is 'created'", () => {
  const repos = [
    makeRepoForScope("non-featured-a"),
    makeRepoForScope("non-featured-b"),
    makeRepoForScope("featured-one", { featured: true }),
    makeRepoForScope("featured-two", { featured: true })
  ];
  const result = applyPublicScope(repos, { ownerMode: false, publicScope: "curated", sortBy: "created", curatedMax: 60 });
  assert.ok(result[0].featured, "First repo should be featured with sort=created");
  assert.ok(result[1].featured, "Second repo should be featured with sort=created");
});

test("applyPublicScope does NOT pin featured repos for ?sort=updated", () => {
  // Simulate sortRepos having already sorted by updatedAt — the applyPublicScope
  // should keep that order and not reorder featured repos to the top.
  const repos = [
    makeRepoForScope("non-featured-recent"),
    makeRepoForScope("featured-old", { featured: true })
  ];
  const result = applyPublicScope(repos, { ownerMode: false, publicScope: "curated", sortBy: "updated", curatedMax: 60 });
  assert.equal(result[0].name, "non-featured-recent", "sort=updated should not reorder featured repos to top");
  assert.equal(result[1].name, "featured-old");
});

test("applyPublicScope does NOT pin featured repos for ?sort=pushed", () => {
  const repos = [
    makeRepoForScope("non-featured-recent"),
    makeRepoForScope("featured-old", { featured: true })
  ];
  const result = applyPublicScope(repos, { ownerMode: false, publicScope: "curated", sortBy: "pushed", curatedMax: 60 });
  assert.equal(result[0].name, "non-featured-recent");
});

test("applyPublicScope does NOT pin featured repos for ?sort=name", () => {
  const repos = [
    makeRepoForScope("banana"),
    makeRepoForScope("apple", { featured: true })
  ];
  const result = applyPublicScope(repos, { ownerMode: false, publicScope: "curated", sortBy: "name", curatedMax: 60 });
  // apple should come first only if sort=name was already applied by sortRepos;
  // applyPublicScope itself should preserve whatever order is given
  assert.equal(result[0].name, "banana", "applyPublicScope should not reorder when sortBy is not stars");
});

test("applyPublicScope returns fewer than curatedMax when fewer repos exist", () => {
  const repos = [makeRepoForScope("a"), makeRepoForScope("b")];
  const result = applyPublicScope(repos, { ownerMode: false, publicScope: "curated", sortBy: "stars", curatedMax: 60 });
  assert.equal(result.length, 2);
});

test("applyPublicScope defaults: no options object", () => {
  const repos = Array.from({ length: 5 }, (_, i) => makeRepoForScope(`repo-${i}`));
  const result = applyPublicScope(repos);
  assert.equal(result.length, 5);
});
