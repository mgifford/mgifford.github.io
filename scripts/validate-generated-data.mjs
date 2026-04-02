import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const FILES = {
  repos: "data/generated/repos.json",
  changes: "data/generated/changes.json",
  screenshots: "data/generated/screenshots.json",
  siteData: "data/site-data.json"
};

function fail(message) {
  throw new Error(message);
}

async function readJson(path) {
  if (!existsSync(path)) {
    fail(`Missing required file: ${path}`);
  }
  return JSON.parse(await readFile(path, "utf8"));
}

function ensureNumber(value, label) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    fail(`Expected number for ${label}`);
  }
}

function ensureString(value, label) {
  if (typeof value !== "string") {
    fail(`Expected string for ${label}`);
  }
}

function ensureArray(value, label) {
  if (!Array.isArray(value)) {
    fail(`Expected array for ${label}`);
  }
}

function validateReposJson(data) {
  ensureString(data.owner, "repos.owner");
  ensureArray(data.repos, "repos.repos");

  for (const [index, repo] of data.repos.entries()) {
    ensureString(repo.name, `repos.repos[${index}].name`);
    ensureString(repo.fullName, `repos.repos[${index}].fullName`);
    ensureString(repo.url, `repos.repos[${index}].url`);
    ensureNumber(repo.stars, `repos.repos[${index}].stars`);
    ensureNumber(repo.watchers, `repos.repos[${index}].watchers`);
    ensureNumber(repo.openIssues, `repos.repos[${index}].openIssues`);
    if (repo.forksCount !== undefined) {
      ensureNumber(repo.forksCount, `repos.repos[${index}].forksCount`);
    }
    ensureString(repo.updatedAt, `repos.repos[${index}].updatedAt`);
  }
}

function validateChangesJson(data) {
  ensureString(data.owner, "changes.owner");
  ensureArray(data.added, "changes.added");
  ensureArray(data.deleted, "changes.deleted");
  ensureArray(data.archivedNow, "changes.archivedNow");
  ensureArray(data.unarchivedNow, "changes.unarchivedNow");

  const counts = data.counts || {};
  ensureNumber(counts.previous, "changes.counts.previous");
  ensureNumber(counts.current, "changes.counts.current");
  ensureNumber(counts.added, "changes.counts.added");
  ensureNumber(counts.deleted, "changes.counts.deleted");
  ensureNumber(counts.archivedNow, "changes.counts.archivedNow");
  ensureNumber(counts.unarchivedNow, "changes.counts.unarchivedNow");
}

function validateScreenshotsJson(data) {
  ensureArray(data.captures, "screenshots.captures");
}

function validateSiteDataJson(data) {
  ensureString(data.owner, "siteData.owner");
  ensureArray(data.repos, "siteData.repos");

  const freshness = data.freshness || {};
  if (freshness.repoSnapshotGeneratedAt !== null && typeof freshness.repoSnapshotGeneratedAt !== "string") {
    fail("Expected siteData.freshness.repoSnapshotGeneratedAt to be string or null");
  }
  if (freshness.changesGeneratedAt !== null && typeof freshness.changesGeneratedAt !== "string") {
    fail("Expected siteData.freshness.changesGeneratedAt to be string or null");
  }
  if (freshness.screenshotsGeneratedAt !== null && typeof freshness.screenshotsGeneratedAt !== "string") {
    fail("Expected siteData.freshness.screenshotsGeneratedAt to be string or null");
  }
  ensureNumber(freshness.repoCountDelta || 0, "siteData.freshness.repoCountDelta");
}

async function main() {
  const repos = await readJson(FILES.repos);
  const changes = await readJson(FILES.changes);
  const screenshots = await readJson(FILES.screenshots);
  const siteData = await readJson(FILES.siteData);

  validateReposJson(repos);
  validateChangesJson(changes);
  validateScreenshotsJson(screenshots);
  validateSiteDataJson(siteData);

  console.log("Generated data schema checks passed.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
