import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyCuration, applyScreenshots, suggestFeaturedRepos, readJson, readYaml } from "../scripts/build-site-data.mjs";

test("applyScreenshots maps successful captures by repo name", () => {
  const repos = [
    { name: "alpha", screenshot: "" },
    { name: "beta", screenshot: "" }
  ];
  const screenshots = {
    captures: [
      { repo: "alpha", ok: true, path: "src/assets/screenshots/alpha.png" },
      { repo: "beta", ok: false, path: "src/assets/screenshots/beta.png" }
    ]
  };

  const output = applyScreenshots(repos, screenshots);

  assert.equal(output[0].screenshot, "src/assets/screenshots/alpha.png");
  assert.equal(output[1].screenshot, "");
});

test("applyCuration uses featured and override values", () => {
  const repo = {
    name: "repo-one",
    description: "Base description",
    readme: { summary: "Readme summary" },
    screenshot: ""
  };

  const curation = {
    featured: [{ repo: "repo-one", theme: "Accessibility", highlight: "High impact" }],
    overrides: {
      "repo-one": {
        theme: "Web Platform",
        cardSummary: "Override card summary",
        featuredNarrative: "Longer featured story",
        cardTitle: "Custom repo card title",
        manualSortRank: 2,
        visibility: "public",
        screenshot: "src/assets/screenshots/override.png"
      }
    }
  };

  const out = applyCuration(repo, curation);

  assert.equal(out.featured, true);
  assert.equal(out.theme, "Web Platform");
  assert.equal(out.cardTitle, "Custom repo card title");
  assert.equal(out.cardSummary, "Override card summary");
  assert.equal(out.summary, "Override card summary");
  assert.equal(out.featuredNarrative, "Longer featured story");
  assert.equal(out.highlight, "Longer featured story");
  assert.equal(out.manualSortRank, 2);
  assert.equal(out.visibility, "public");
  assert.equal(out.screenshot, "src/assets/screenshots/override.png");
});

test("applyCuration falls back to general defaults", () => {
  const repo = {
    name: "repo-two",
    description: "Repo description",
    readme: null,
    screenshot: ""
  };

  const out = applyCuration(repo, {});

  assert.equal(out.featured, false);
  assert.equal(out.theme, "General");
  assert.equal(out.cardSummary, "Repo description");
  assert.equal(out.summary, "Repo description");
  assert.equal(out.cardTitle, "repo-two");
  assert.equal(out.featuredNarrative, "");
  assert.equal(out.manualSortRank, null);
  assert.equal(out.visibility, "public");
  assert.equal(out.hidden, false);
});

test("suggestFeaturedRepos ranks by stars and forks excluding manual featured", () => {
  const repos = [
    { name: "alpha", stars: 10, forksCount: 5, watchers: 3, archived: false },
    { name: "beta", stars: 30, forksCount: 1, watchers: 2, archived: false },
    { name: "gamma", stars: 8, forksCount: 20, watchers: 9, archived: false },
    { name: "delta", stars: 100, forksCount: 50, watchers: 20, archived: true }
  ];

  const curation = {
    featured: [{ repo: "beta" }],
    autoFeatured: { enabled: true, count: 2 }
  };

  const set = suggestFeaturedRepos(repos, curation);

  assert.equal(set.has("beta"), false);
  assert.equal(set.has("gamma"), true);
  assert.equal(set.has("alpha"), true);
});

test("applyCuration marks auto featured source", () => {
  const repo = {
    name: "repo-auto",
    description: "Auto featured description",
    readme: null,
    screenshot: ""
  };

  const out = applyCuration(repo, {}, new Set(["repo-auto"]));

  assert.equal(out.featured, true);
  assert.equal(out.featuredSource, "auto");
});

test("applyCuration supports forced hidden visibility", () => {
  const repo = {
    name: "repo-hidden",
    description: "Hidden repo",
    readme: null,
    screenshot: ""
  };

  const curation = {
    overrides: {
      "repo-hidden": {
        visibility: "hidden"
      }
    }
  };

  const out = applyCuration(repo, curation);

  assert.equal(out.visibility, "hidden");
  assert.equal(out.hidden, true);
});

// applyScreenshots – edge cases

test("applyScreenshots handles null/missing screenshots gracefully", () => {
  const repos = [{ name: "alpha", screenshot: "" }];
  const output = applyScreenshots(repos, null);
  assert.equal(output[0].screenshot, "");
});

test("applyScreenshots handles empty captures array", () => {
  const repos = [{ name: "alpha", screenshot: "" }];
  const output = applyScreenshots(repos, { captures: [] });
  assert.equal(output[0].screenshot, "");
});

test("applyScreenshots clears screenshot for repos not found in captures", () => {
  const repos = [
    { name: "alpha", screenshot: "" },
    { name: "gamma", screenshot: "existing/path.png" }
  ];
  const screenshots = {
    captures: [{ repo: "alpha", ok: true, path: "src/assets/screenshots/alpha.png" }]
  };
  const output = applyScreenshots(repos, screenshots);
  assert.equal(output[0].screenshot, "src/assets/screenshots/alpha.png");
  assert.equal(output[1].screenshot, "");
});

test("applyScreenshots preserves other repo fields", () => {
  const repos = [{ name: "alpha", screenshot: "", stars: 42, description: "test" }];
  const screenshots = {
    captures: [{ repo: "alpha", ok: true, path: "src/assets/screenshots/alpha.png" }]
  };
  const output = applyScreenshots(repos, screenshots);
  assert.equal(output[0].stars, 42);
  assert.equal(output[0].description, "test");
});

// applyCuration – additional cases

test("applyCuration falls back to readme summary when no description or cardSummary", () => {
  const repo = {
    name: "repo-three",
    description: "",
    readme: { summary: "README summary text" },
    screenshot: ""
  };

  const out = applyCuration(repo, {});
  assert.equal(out.cardSummary, "README summary text");
  assert.equal(out.summary, "README summary text");
});

test("applyCuration falls back to default message when no summary at all", () => {
  const repo = {
    name: "repo-empty",
    description: "",
    readme: null,
    screenshot: ""
  };

  const out = applyCuration(repo, {});
  assert.equal(out.cardSummary, "No summary available yet.");
});

test("applyCuration featuredNarrative from featured highlight when no override", () => {
  const repo = {
    name: "repo-highlight",
    description: "Some description",
    readme: null,
    screenshot: ""
  };

  const curation = {
    featured: [{ repo: "repo-highlight", theme: "Accessibility", highlight: "High impact highlight" }]
  };

  const out = applyCuration(repo, curation);
  assert.equal(out.featuredNarrative, "High impact highlight");
  assert.equal(out.highlight, "High impact highlight");
  assert.equal(out.featured, true);
  assert.equal(out.featuredSource, "manual");
});

test("applyCuration override screenshot takes precedence over repo screenshot", () => {
  const repo = {
    name: "repo-shot",
    description: "desc",
    readme: null,
    screenshot: "old/path.png"
  };

  const curation = {
    overrides: { "repo-shot": { screenshot: "new/override.png" } }
  };

  const out = applyCuration(repo, curation);
  assert.equal(out.screenshot, "new/override.png");
});

test("applyCuration uses repo screenshot when no override", () => {
  const repo = {
    name: "repo-shot2",
    description: "desc",
    readme: null,
    screenshot: "existing/screenshot.png"
  };

  const out = applyCuration(repo, {});
  assert.equal(out.screenshot, "existing/screenshot.png");
});

// suggestFeaturedRepos – additional cases

test("suggestFeaturedRepos returns empty set when autoFeatured is disabled", () => {
  const repos = [
    { name: "alpha", stars: 10, forksCount: 5, watchers: 3, archived: false },
    { name: "beta", stars: 30, forksCount: 1, watchers: 2, archived: false }
  ];

  const curation = { autoFeatured: { enabled: false, count: 3 } };
  const set = suggestFeaturedRepos(repos, curation);
  assert.equal(set.size, 0);
});

test("suggestFeaturedRepos returns empty set when count is zero", () => {
  const repos = [
    { name: "alpha", stars: 10, forksCount: 5, watchers: 3, archived: false }
  ];

  const curation = { autoFeatured: { enabled: true, count: 0 } };
  const set = suggestFeaturedRepos(repos, curation);
  assert.equal(set.size, 0);
});

test("suggestFeaturedRepos excludes archived repos", () => {
  const repos = [
    { name: "alpha", stars: 100, forksCount: 50, watchers: 20, archived: true },
    { name: "beta", stars: 5, forksCount: 1, watchers: 1, archived: false }
  ];

  const curation = { autoFeatured: { enabled: true, count: 3 } };
  const set = suggestFeaturedRepos(repos, curation);
  assert.equal(set.has("alpha"), false);
  assert.equal(set.has("beta"), true);
});

test("suggestFeaturedRepos respects count limit", () => {
  const repos = [
    { name: "a", stars: 10, forksCount: 0, watchers: 0, archived: false },
    { name: "b", stars: 8, forksCount: 0, watchers: 0, archived: false },
    { name: "c", stars: 6, forksCount: 0, watchers: 0, archived: false },
    { name: "d", stars: 4, forksCount: 0, watchers: 0, archived: false }
  ];

  const curation = { autoFeatured: { enabled: true, count: 2 } };
  const set = suggestFeaturedRepos(repos, curation);
  assert.equal(set.size, 2);
  assert.equal(set.has("a"), true);
  assert.equal(set.has("b"), true);
});

test("suggestFeaturedRepos uses watchers as tiebreaker", () => {
  const repos = [
    { name: "a", stars: 5, forksCount: 5, watchers: 1, archived: false },
    { name: "b", stars: 5, forksCount: 5, watchers: 10, archived: false }
  ];

  const curation = { autoFeatured: { enabled: true, count: 1 } };
  const set = suggestFeaturedRepos(repos, curation);
  assert.equal(set.has("b"), true);
  assert.equal(set.has("a"), false);
});

// readJson / readYaml

test("readJson returns fallback when file does not exist", async () => {
  const result = await readJson("/tmp/does-not-exist-xyz.json", { fallback: true });
  assert.deepEqual(result, { fallback: true });
});

test("readJson parses a valid JSON file", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "mgifford-test-"));
  t.after(() => rm(dir, { recursive: true }));
  const filePath = join(dir, "data.json");
  await writeFile(filePath, JSON.stringify({ hello: "world" }), "utf8");
  const result = await readJson(filePath);
  assert.deepEqual(result, { hello: "world" });
});

test("readYaml returns fallback when file does not exist", async () => {
  const result = await readYaml("/tmp/does-not-exist-xyz.yml", { fallback: true });
  assert.deepEqual(result, { fallback: true });
});

test("readYaml parses a valid YAML file", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "mgifford-test-"));
  t.after(() => rm(dir, { recursive: true }));
  const filePath = join(dir, "curation.yml");
  await writeFile(filePath, "featured:\n  - repo: test-repo\n", "utf8");
  const result = await readYaml(filePath);
  assert.deepEqual(result, { featured: [{ repo: "test-repo" }] });
});
