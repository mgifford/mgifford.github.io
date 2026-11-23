import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";

import { normalizeEvent } from "../src/activity.mjs";

const FILES = {
  repos: "data/generated/repos.json",
  changes: "data/generated/changes.json",
  screenshots: "data/generated/screenshots.json",
  siteData: "data/site-data.json",
  activityIndex: "data/generated/activity/repository-index.json",
  contributions: "data/generated/activity/personal-contributions.json",
  activityData: "data/activity-data.json",
  activityExtended: "data/activity-extended.json"
};

const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

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

function ensureSizeBudget(path, maxBytes) {
  if (!existsSync(path)) return;
  const size = statSync(path).size;
  if (size > maxBytes) {
    fail(
      `${path} is ${(size / 1024 / 1024).toFixed(2)} MB, above the ${(maxBytes / 1024 / 1024).toFixed(1)} MB budget. Reduce detail retention or payload scope.`
    );
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
    if (repo.pushedAt !== null && repo.pushedAt !== undefined) {
      ensureString(repo.pushedAt, `repos.repos[${index}].pushedAt`);
    }
  }
}

function validateChangesJson(data) {
  ensureString(data.owner, "changes.owner");
  ensureArray(data.added, "changes.added");
  ensureArray(data.deleted, "changes.deleted");
  ensureArray(data.archivedNow, "changes.archivedNow");
  ensureArray(data.unarchivedNow, "changes.unarchivedNow");
  if (data.updated !== undefined) ensureArray(data.updated, "changes.updated");

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

  for (const [index, repo] of data.repos.entries()) {
    ensureString(repo.name, `siteData.repos[${index}].name`);
    ensureString(repo.summary, `siteData.repos[${index}].summary`);
    ensureString(repo.cardTitle || repo.name, `siteData.repos[${index}].cardTitle`);
    ensureString(repo.cardSummary || repo.summary, `siteData.repos[${index}].cardSummary`);
    ensureString(repo.featuredNarrative || "", `siteData.repos[${index}].featuredNarrative`);

    if (repo.manualSortRank !== null && repo.manualSortRank !== undefined) {
      ensureNumber(repo.manualSortRank, `siteData.repos[${index}].manualSortRank`);
    }

    if (repo.visibility !== undefined && !["public", "hidden"].includes(repo.visibility)) {
      fail(`Expected siteData.repos[${index}].visibility to be public or hidden`);
    }
  }

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
  if (freshness.activityGeneratedAt !== null && freshness.activityGeneratedAt !== undefined) {
    ensureString(freshness.activityGeneratedAt, "siteData.freshness.activityGeneratedAt");
  }
  ensureNumber(freshness.repoCountDelta || 0, "siteData.freshness.repoCountDelta");

  if (data.activity?.available) {
    ensureString(data.activity.timezone, "siteData.activity.timezone");
    if (!data.activity.summary) fail("Expected siteData.activity.summary");
  }
}

function validateEvent(event, label) {
  if (!event || typeof event !== "object") fail(`Expected an event object at ${label}`);
  if (!REPOSITORY_PATTERN.test(event.repository || "")) {
    fail(`Invalid repository identifier at ${label}: ${event.repository}`);
  }
  if (!String(event.url || "").startsWith("https://github.com/")) {
    fail(`Event URL must point at GitHub evidence at ${label}: ${event.url}`);
  }
  try {
    normalizeEvent(event);
  } catch (error) {
    fail(`Invalid event at ${label}: ${error.message}`);
  }
}

function validateActivityCoverage(data, label) {
  if (!data.coverage || typeof data.coverage !== "object") fail(`Expected ${label}.coverage object`);
  ensureArray(data.coverage.sources, `${label}.coverage.sources`);
  ensureString(data.coverage.timezone, `${label}.coverage.timezone`);
  ensureNumber(data.coverage.lookbackDays, `${label}.coverage.lookbackDays`);
  if (!data.coverage.window?.start || !data.coverage.window?.end) {
    fail(`Expected ${label}.coverage.window start and end`);
  }
  for (const [index, source] of data.coverage.sources.entries()) {
    ensureString(source.id, `${label}.coverage.sources[${index}].id`);
    ensureString(source.status, `${label}.coverage.sources[${index}].status`);
    if (!["ok", "partial", "unavailable", "limited"].includes(source.status)) {
      fail(`Unexpected source status at ${label}.coverage.sources[${index}]: ${source.status}`);
    }
  }
}

function validateRepositoryIndexJson(data) {
  ensureArray(data.repositories, "activityIndex.repositories");
  for (const [index, row] of data.repositories.entries()) {
    ensureString(row.repository, `activityIndex.repositories[${index}].repository`);
    ensureString(row.repositoryUrl, `activityIndex.repositories[${index}].repositoryUrl`);
    if (row.lastHumanActivityAt !== null && typeof row.lastHumanActivityAt !== "string") {
      fail(`Expected string or null for activityIndex.repositories[${index}].lastHumanActivityAt`);
    }
    if (row.repository.includes(" ") || !REPOSITORY_PATTERN.test(row.repository)) {
      fail(`Invalid repository identifier in activity index: ${row.repository}`);
    }
  }
}

function validateContributionsJson(data, knownEventIds) {
  ensureString(data.user, "contributions.user");
  ensureArray(data.identity ?? data.identities, "contributions.identity");

  if (Array.isArray(data.contributionIds)) {
    for (const [index, id] of data.contributionIds.entries()) {
      ensureString(id, `contributions.contributionIds[${index}]`);
      if (knownEventIds && !knownEventIds.has(id)) {
        fail(`Contribution ${id} is not present in the activity payloads`);
      }
    }
    if (new Set(data.contributionIds).size !== data.contributionIds.length) {
      fail("contributions.contributionIds contains duplicates");
    }
    if (data.summary?.total !== undefined && data.summary.total !== data.contributionIds.length) {
      fail(
        `contributions.summary.total (${data.summary.total}) does not match contributionIds length (${data.contributionIds.length})`
      );
    }
    return;
  }

  // Backwards-compatible shape: full contribution records.
  ensureArray(data.contributions, "contributions.contributions");
  for (const [index, event] of data.contributions.entries()) {
    validateEvent(event, `contributions.contributions[${index}]`);
  }
}

function validateActivityPayloadJson(data, label, { requireCoverage = false } = {}) {
  ensureNumber(data.schemaVersion, `${label}.schemaVersion`);
  ensureString(data.timezone, `${label}.timezone`);
  ensureString(data.generatedAt, `${label}.generatedAt`);
  ensureArray(data.events, `${label}.events`);

  for (const [index, event] of data.events.entries()) {
    if (!event?.id || !event.repository || !event.timestamp) {
      fail(`Invalid compact event at ${label}.events[${index}]`);
    }
    if (!REPOSITORY_PATTERN.test(event.repository)) {
      fail(`Invalid repository at ${label}.events[${index}]: ${event.repository}`);
    }
    if (!String(event.url || "").startsWith("https://github.com/")) {
      fail(`Event URL must point at GitHub evidence at ${label}.events[${index}]`);
    }
    if (!event.source) fail(`Missing provenance source at ${label}.events[${index}]`);
    if (!Number.isFinite(new Date(event.timestamp).getTime())) {
      fail(`Invalid timestamp at ${label}.events[${index}]`);
    }
  }

  const ids = new Set();
  for (const event of data.events) {
    if (ids.has(event.id)) fail(`Duplicate event id in ${label}: ${event.id}`);
    ids.add(event.id);
  }

  if (requireCoverage) {
    validateActivityCoverage(data, label);
    if (!data.window?.start || !data.window?.end) fail(`Expected ${label}.window start and end`);
    ensureArray(data.workstreams, `${label}.workstreams`);
    ensureArray(data.repositoryIndex, `${label}.repositoryIndex`);
    if (data.events.length > 4000) fail(`${label} event count is unexpectedly large: ${data.events.length}`);
  }

  return ids;
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

  const activityIndex = await readJson(FILES.activityIndex);
  const contributions = await readJson(FILES.contributions);
  const activityData = await readJson(FILES.activityData);
  const activityExtended = await readJson(FILES.activityExtended);

  const recentIds = validateActivityPayloadJson(activityData, "activityData", { requireCoverage: true });
  const olderIds = validateActivityPayloadJson(activityExtended, "activityExtended");
  const allIds = new Set([...recentIds, ...olderIds]);

  validateRepositoryIndexJson(activityIndex);
  validateContributionsJson(contributions, allIds);

  ensureSizeBudget(FILES.activityData, 3 * 1024 * 1024);
  ensureSizeBudget(FILES.activityExtended, 8 * 1024 * 1024);
  ensureSizeBudget(FILES.contributions, 2 * 1024 * 1024);
  ensureSizeBudget(FILES.activityIndex, 2 * 1024 * 1024);

  console.log(
    `Generated data schema checks passed (${activityData.events.length} recent + ${activityExtended.events.length} older events, ${
      contributions.contributionIds?.length ?? contributions.contributions?.length ?? 0
    } contributions).`
  );
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
