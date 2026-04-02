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

  console.log("Curation validation passed.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
