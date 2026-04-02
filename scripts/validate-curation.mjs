import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import yaml from "js-yaml";

const CURATION_PATH = "data/curation.yml";
const GENERATED_REPOS_PATH = "data/generated/repos.json";

function fail(message) {
  throw new Error(message);
}

async function readYaml(path) {
  if (!existsSync(path)) fail(`Missing required file: ${path}`);
  return yaml.load(await readFile(path, "utf8")) || {};
}

async function readJson(path) {
  if (!existsSync(path)) fail(`Missing required file: ${path}`);
  return JSON.parse(await readFile(path, "utf8"));
}

async function main() {
  const curation = await readYaml(CURATION_PATH);
  const reposData = await readJson(GENERATED_REPOS_PATH);

  const repoNames = new Set((reposData.repos || []).map((repo) => repo.name));
  const unknownFeatured = (curation.featured || [])
    .map((item) => item.repo)
    .filter((name) => !repoNames.has(name));

  const unknownOverrides = Object.keys(curation.overrides || {}).filter((name) => !repoNames.has(name));

  if (unknownFeatured.length || unknownOverrides.length) {
    const parts = [];
    if (unknownFeatured.length) {
      parts.push(`Unknown featured repos: ${unknownFeatured.join(", ")}`);
    }
    if (unknownOverrides.length) {
      parts.push(`Unknown override repos: ${unknownOverrides.join(", ")}`);
    }
    fail(parts.join(" | "));
  }

  const overrideErrors = [];
  const allowedVisibility = new Set(["public", "hidden"]);

  for (const [name, override] of Object.entries(curation.overrides || {})) {
    if (!override || typeof override !== "object") continue;

    if (override.visibility !== undefined && !allowedVisibility.has(override.visibility)) {
      overrideErrors.push(`${name}: visibility must be one of public|hidden`);
    }

    if (override.manualSortRank !== undefined && !Number.isFinite(override.manualSortRank)) {
      overrideErrors.push(`${name}: manualSortRank must be a finite number`);
    }

    const stringFields = ["theme", "summary", "cardTitle", "cardSummary", "featuredNarrative", "screenshot"];
    for (const field of stringFields) {
      if (override[field] !== undefined && typeof override[field] !== "string") {
        overrideErrors.push(`${name}: ${field} must be a string`);
      }
    }

    if (override.hidden !== undefined && typeof override.hidden !== "boolean") {
      overrideErrors.push(`${name}: hidden must be a boolean`);
    }
  }

  if (overrideErrors.length) {
    fail(`Invalid curation overrides: ${overrideErrors.join(" | ")}`);
  }

  console.log("Curation validation passed.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
