import test from "node:test";
import assert from "node:assert/strict";

import { applyCuration, applyScreenshots, suggestFeaturedRepos } from "../scripts/build-site-data.mjs";

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
        summary: "Override summary",
        screenshot: "src/assets/screenshots/override.png"
      }
    }
  };

  const out = applyCuration(repo, curation);

  assert.equal(out.featured, true);
  assert.equal(out.theme, "Web Platform");
  assert.equal(out.summary, "Override summary");
  assert.equal(out.highlight, "High impact");
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
  assert.equal(out.summary, "Repo description");
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
