import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import yaml from "js-yaml";

const INPUT_REPOS = "data/generated/repos.json";
const INPUT_CHANGES = "data/generated/changes.json";
const INPUT_SCREENSHOTS = "data/generated/screenshots.json";
const INPUT_CURATION = "data/curation.yml";
const OUTPUT_SITE_DATA = "data/site-data.json";

/**
 * Map of GitHub topic slugs to curated theme names.
 * Used to infer a theme when no explicit override or featured entry provides one.
 */
const TOPIC_THEME_MAP = {
  // Accessibility
  a11y: "Accessibility",
  accessibility: "Accessibility",
  wcag: "Accessibility",
  aria: "Accessibility",
  "screen-reader": "Accessibility",
  "color-contrast": "Accessibility",
  "digital-accessibility": "Accessibility",
  "web-accessibility": "Accessibility",
  "accessible-design": "Accessibility",
  "assistive-technology": "Accessibility",
  // Civic Tech
  "civic-tech": "Civic Tech",
  government: "Civic Tech",
  "open-government": "Civic Tech",
  "open-data": "Civic Tech",
  "public-sector": "Civic Tech",
  "digital-government": "Civic Tech",
  policy: "Civic Tech",
  "public-interest": "Civic Tech",
  // AI and Automation
  ai: "AI and Automation",
  "artificial-intelligence": "AI and Automation",
  "machine-learning": "AI and Automation",
  automation: "AI and Automation",
  chatgpt: "AI and Automation",
  llm: "AI and Automation",
  "large-language-model": "AI and Automation",
  "generative-ai": "AI and Automation",
  nlp: "AI and Automation",
  "natural-language-processing": "AI and Automation",
  // Web Platform
  web: "Web Platform",
  frontend: "Web Platform",
  html: "Web Platform",
  css: "Web Platform",
  "static-site": "Web Platform",
  "github-pages": "Web Platform",
  "web-components": "Web Platform",
  javascript: "Web Platform",
  // Data and Research
  data: "Data and Research",
  analytics: "Data and Research",
  research: "Data and Research",
  "data-visualization": "Data and Research",
  datasets: "Data and Research",
  reporting: "Data and Research",
  // Personalization
  personalization: "Personalization",
  "user-preferences": "Personalization",
  "adaptive-design": "Personalization"
};

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

/**
 * Infers a curated theme name from a repo's GitHub topic slugs.
 * Returns the first matching theme (ordered by TOPIC_THEME_MAP declaration priority),
 * or null if no topic matches.
 *
 * @param {string[]} topics
 * @returns {string|null}
 */
export function inferThemeFromTopics(topics) {
  if (!Array.isArray(topics)) return null;
  for (const topic of topics) {
    const theme = TOPIC_THEME_MAP[topic];
    if (theme) return theme;
  }
  return null;
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

export function applyCuration(repo, curation, autoFeaturedNames = new Set(), pinnedRepoNames = new Set()) {
  const override = curation.overrides?.[repo.name] || {};
  const manualFeatured = (curation.featured || []).find((item) => item.repo === repo.name);
  const pinnedFeatured = !manualFeatured && pinnedRepoNames.has(repo.name);
  const autoFeatured = !manualFeatured && !pinnedFeatured && autoFeaturedNames.has(repo.name);
  const featured = manualFeatured || (pinnedFeatured ? { repo: repo.name } : null) || (autoFeatured ? { repo: repo.name } : null);

  const theme = override.theme || featured?.theme || inferThemeFromTopics(repo.topics) || "General";
  const cardSummary =
    override.cardSummary ||
    override.summary ||
    repo.readme?.summary ||
    repo.description ||
    "No summary available yet.";
  const featuredNarrative = override.featuredNarrative || featured?.highlight || "";
  const manualSortRank = Number.isFinite(override.manualSortRank) ? Number(override.manualSortRank) : null;
  const visibility = override.visibility === "hidden" ? "hidden" : "public";
  const hidden = visibility === "hidden" ? true : Boolean(override.hidden);

  return {
    ...repo,
    hidden,
    visibility,
    featured: Boolean(featured),
    featuredSource: manualFeatured ? "manual" : pinnedFeatured ? "pinned" : autoFeatured ? "auto" : "none",
    manualSortRank,
    theme,
    cardTitle: override.cardTitle || repo.name,
    cardSummary,
    summary: cardSummary,
    featuredNarrative,
    highlight: featuredNarrative,
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

  const pinnedRepoNames = new Set(Array.isArray(repoData.pinnedRepos) ? repoData.pinnedRepos : []);

  const withScreens = applyScreenshots(repoData.repos || [], screenshots);
  const autoFeaturedNames = suggestFeaturedRepos(withScreens, curation);
  const curatedRepos = withScreens
    .map((repo) => applyCuration(repo, curation, autoFeaturedNames, pinnedRepoNames))
    .filter((repo) => !repo.hidden);

  const themes = [...new Set(curatedRepos.map((repo) => repo.theme).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  const summary = {
    total: curatedRepos.length,
    archived: curatedRepos.filter((repo) => repo.archived).length,
    featured: curatedRepos.filter((repo) => repo.featured).length,
    readmeNeedsAttention: curatedRepos.filter((repo) => repo.readme?.needsAttention).length,
    withAiDisclosure: curatedRepos.filter((repo) => repo.readme?.hasAiDisclosure).length,
    withAgentsMd: curatedRepos.filter((repo) => repo.aiQuality?.hasAgentsMd).length,
    withCopilotInstructions: curatedRepos.filter((repo) => repo.aiQuality?.hasCopilotInstructions).length
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
