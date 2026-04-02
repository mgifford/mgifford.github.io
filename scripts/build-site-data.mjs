import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import yaml from "js-yaml";

const INPUT_REPOS = "data/generated/repos.json";
const INPUT_CHANGES = "data/generated/changes.json";
const INPUT_SCREENSHOTS = "data/generated/screenshots.json";
const INPUT_CURATION = "data/curation.yml";
const OUTPUT_SITE_DATA = "data/site-data.json";

export async function readJson(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(await readFile(path, "utf8"));
}

export async function readYaml(path, fallback = {}) {
  if (!existsSync(path)) return fallback;
  return yaml.load(await readFile(path, "utf8")) || fallback;
}

export async function ensureParent(path) {
  await mkdir(dirname(path), { recursive: true });
}

export function suggestFeaturedRepos(repos, curation) {
  const manualFeaturedNames = new Set((curation.featured || []).map((item) => item.repo));
  const autoConfig = curation.autoFeatured || {};
  const enabled = autoConfig.enabled !== false;
  const count = Number.isFinite(autoConfig.count) ? Math.max(0, autoConfig.count) : 6;

  if (!enabled || count === 0) {
    return new Set();
  }

  const ranked = [...repos]
    .filter((repo) => !repo.archived && !manualFeaturedNames.has(repo.name))
    .sort((a, b) => {
      const scoreA = (a.stars || 0) * 3 + (a.forksCount || 0) * 2;
      const scoreB = (b.stars || 0) * 3 + (b.forksCount || 0) * 2;
      if (scoreB !== scoreA) return scoreB - scoreA;
      return (b.watchers || 0) - (a.watchers || 0);
    })
    .slice(0, count);

  return new Set(ranked.map((repo) => repo.name));
}

export function applyCuration(repo, curation, autoFeaturedNames = new Set()) {
  const override = curation.overrides?.[repo.name] || {};
  const manualFeatured = (curation.featured || []).find((item) => item.repo === repo.name);
  const autoFeatured = autoFeaturedNames.has(repo.name);
  const featured = manualFeatured || (autoFeatured ? { repo: repo.name } : null);

  const theme = override.theme || featured?.theme || "General";
  const summary = override.summary || repo.readme?.summary || repo.description || "No summary available yet.";

  return {
    ...repo,
    hidden: Boolean(override.hidden),
    featured: Boolean(featured),
    featuredSource: manualFeatured ? "manual" : autoFeatured ? "auto" : "none",
    theme,
    summary,
    highlight: featured?.highlight || "",
    screenshot: override.screenshot || repo.screenshot || ""
  };
}

export function applyScreenshots(repos, screenshots) {
  const map = new Map((screenshots?.captures || []).filter((item) => item.ok).map((item) => [item.repo, item.path]));
  return repos.map((repo) => ({
    ...repo,
    screenshot: map.get(repo.name) || ""
  }));
}

export async function main() {
  const repoData = await readJson(INPUT_REPOS, { repos: [], generatedAt: null, owner: "mgifford" });
  const changes = await readJson(INPUT_CHANGES, null);
  const screenshots = await readJson(INPUT_SCREENSHOTS, { captures: [] });
  const curation = await readYaml(INPUT_CURATION, {});

  const withScreens = applyScreenshots(repoData.repos || [], screenshots);
  const autoFeaturedNames = suggestFeaturedRepos(withScreens, curation);
  const curatedRepos = withScreens
    .map((repo) => applyCuration(repo, curation, autoFeaturedNames))
    .filter((repo) => !repo.hidden);

  const themes = [...new Set(curatedRepos.map((repo) => repo.theme).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  const summary = {
    total: curatedRepos.length,
    archived: curatedRepos.filter((repo) => repo.archived).length,
    featured: curatedRepos.filter((repo) => repo.featured).length,
    readmeNeedsAttention: curatedRepos.filter((repo) => repo.readme?.needsAttention).length
  };

  const result = {
    generatedAt: new Date().toISOString(),
    sourceGeneratedAt: repoData.generatedAt,
    owner: repoData.owner || "mgifford",
    sortingDefaults: curation.sortingDefaults || {
      public: "stars",
      owner: "updated"
    },
    displayDefaults: curation.displayDefaults || {
      publicScope: "curated",
      publicCuratedMax: 60
    },
    themes,
    summary,
    freshness: {
      repoSnapshotGeneratedAt: repoData.generatedAt || null,
      changesGeneratedAt: changes?.generatedAt || null,
      screenshotsGeneratedAt: screenshots?.generatedAt || null,
      repoCountDelta: (changes?.counts?.current || 0) - (changes?.counts?.previous || 0)
    },
    changes,
    repos: curatedRepos
  };

  await ensureParent(OUTPUT_SITE_DATA);
  await writeFile(OUTPUT_SITE_DATA, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  console.log(`Site data written to ${OUTPUT_SITE_DATA} with ${curatedRepos.length} repos.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
