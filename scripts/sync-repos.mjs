import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";

const API_BASE = "https://api.github.com";
const OWNER = process.env.GH_OWNER || "mgifford";
const TOKEN = process.env.GH_TOKEN || "";
const README_SCAN_LIMIT_RAW = (process.env.README_SCAN_LIMIT || "all").toLowerCase();
const NOW = new Date().toISOString();

const OUTPUT_REPOS = "data/generated/repos.json";
const OUTPUT_CHANGES = "data/generated/changes.json";
const OUTPUT_REPORT = "reports/changes-latest.md";

export function parseLinkHeader(value) {
  if (!value) return {};
  return value.split(",").reduce((acc, chunk) => {
    const [urlPart, relPart] = chunk.split(";").map((part) => part.trim());
    const url = urlPart?.slice(1, -1);
    const relMatch = relPart?.match(/rel=\"(.*)\"/);
    if (url && relMatch) {
      acc[relMatch[1]] = url;
    }
    return acc;
  }, {});
}

async function fetchJson(url, accept = "application/vnd.github+json") {
  const headers = {
    Accept: accept,
    "User-Agent": "mgifford-repo-catalog-sync"
  };

  if (TOKEN) {
    headers.Authorization = `Bearer ${TOKEN}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API error (${response.status}) for ${url}: ${body.slice(0, 500)}`);
  }

  const linkHeader = parseLinkHeader(response.headers.get("link"));
  return {
    data: await response.json(),
    links: linkHeader
  };
}

async function fetchText(url, accept = "application/vnd.github.raw") {
  const headers = {
    Accept: accept,
    "User-Agent": "mgifford-repo-catalog-sync"
  };

  if (TOKEN) {
    headers.Authorization = `Bearer ${TOKEN}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API error (${response.status}) for ${url}: ${body.slice(0, 500)}`);
  }

  return response.text();
}

function resolveReadmeLimit(totalRepos) {
  if (README_SCAN_LIMIT_RAW === "all") return totalRepos;

  const parsed = Number.parseInt(README_SCAN_LIMIT_RAW, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return totalRepos;

  return Math.min(parsed, totalRepos);
}

async function fetchAllRepos(owner) {
  let nextUrl = `${API_BASE}/users/${owner}/repos?per_page=100&type=owner&sort=updated`;
  const repos = [];

  while (nextUrl) {
    const { data, links } = await fetchJson(nextUrl);
    repos.push(...data);
    nextUrl = links.next || "";
  }

  return repos;
}

export function readmeHeuristic(markdown) {
  if (!markdown || typeof markdown !== "string") {
    return {
      summary: "",
      score: 0,
      needsAttention: true,
      reasons: ["No README returned"]
    };
  }

  const withoutFrontmatter = markdown.startsWith("---")
    ? markdown.replace(/^---[\s\S]*?\n---\s*(\r?\n|$)/, "")
    : markdown;

  const cleaned = withoutFrontmatter
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s*\!\[[^\]]*\]\([^)]*\)\s*$/gm, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/[#>*_`~-]/g, "")
    .replace(/\r/g, "")
    .trim();

  const paragraphs = cleaned
    .split(/\n\s*\n/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const summary = paragraphs.find((line) => line.length > 45) || paragraphs[0] || "";
  let score = 0;
  const reasons = [];

  if (cleaned.length > 400) score += 2;
  else reasons.push("README is very short");

  if (summary.length > 70) score += 1;
  else reasons.push("No clear summary paragraph");

  if (!/todo|coming soon|tbd|lorem ipsum/i.test(cleaned)) {
    score += 1;
  } else {
    reasons.push("Contains placeholder language");
  }

  return {
    summary: summary.slice(0, 320),
    score,
    needsAttention: score <= 2,
    reasons
  };
}

async function fetchReadme(owner, repoName) {
  const url = `${API_BASE}/repos/${owner}/${repoName}/readme`;

  try {
    const markdown = await fetchText(url, "application/vnd.github.raw");
    return readmeHeuristic(markdown);
  } catch {
    return {
      summary: "",
      score: 0,
      needsAttention: true,
      reasons: ["README unavailable"]
    };
  }
}

async function withConcurrency(items, limit, worker) {
  const queue = [...items];
  const results = [];

  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) break;
      results.push(await worker(item));
    }
  });

  await Promise.all(workers);
  return results;
}

export function mapRepo(repo, readme) {
  return {
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    url: repo.html_url,
    description: repo.description || "",
    language: repo.language || "Unknown",
    topics: Array.isArray(repo.topics) ? repo.topics : [],
    homepage: repo.homepage || "",
    hasPages: Boolean(repo.has_pages),
    archived: Boolean(repo.archived),
    fork: Boolean(repo.fork),
    visibility: repo.visibility || "public",
    stars: repo.stargazers_count || 0,
    forksCount: repo.forks_count || 0,
    watchers: repo.watchers_count || 0,
    openIssues: repo.open_issues_count || 0,
    createdAt: repo.created_at,
    updatedAt: repo.updated_at,
    pushedAt: repo.pushed_at,
    defaultBranch: repo.default_branch || "main",
    readme
  };
}

export function buildChanges(previousRepos, currentRepos) {
  const prevMap = new Map(previousRepos.map((repo) => [repo.fullName, repo]));
  const currentMap = new Map(currentRepos.map((repo) => [repo.fullName, repo]));

  const added = currentRepos
    .filter((repo) => !prevMap.has(repo.fullName))
    .map((repo) => repo.fullName)
    .sort();

  const deleted = previousRepos
    .filter((repo) => !currentMap.has(repo.fullName))
    .map((repo) => repo.fullName)
    .sort();

  const archivedNow = currentRepos
    .filter((repo) => repo.archived && prevMap.has(repo.fullName) && !prevMap.get(repo.fullName).archived)
    .map((repo) => repo.fullName)
    .sort();

  const unarchivedNow = currentRepos
    .filter((repo) => !repo.archived && prevMap.has(repo.fullName) && prevMap.get(repo.fullName).archived)
    .map((repo) => repo.fullName)
    .sort();

  return {
    generatedAt: NOW,
    owner: OWNER,
    counts: {
      previous: previousRepos.length,
      current: currentRepos.length,
      added: added.length,
      deleted: deleted.length,
      archivedNow: archivedNow.length,
      unarchivedNow: unarchivedNow.length
    },
    added,
    deleted,
    archivedNow,
    unarchivedNow
  };
}

async function loadPreviousRepos() {
  if (!existsSync(OUTPUT_REPOS)) {
    return [];
  }

  const raw = await readFile(OUTPUT_REPOS, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.repos) ? parsed.repos : [];
}

async function ensureParent(path) {
  await mkdir(dirname(path), { recursive: true });
}

async function writeJson(path, value) {
  await ensureParent(path);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeMarkdownReport(changes) {
  const lines = [
    "# Repository Sync Report",
    "",
    `Generated: ${changes.generatedAt}`,
    `Owner: ${changes.owner}`,
    "",
    `- Previous repos: ${changes.counts.previous}`,
    `- Current repos: ${changes.counts.current}`,
    `- Added: ${changes.counts.added}`,
    `- Deleted: ${changes.counts.deleted}`,
    `- Newly archived: ${changes.counts.archivedNow}`,
    `- Unarchived: ${changes.counts.unarchivedNow}`,
    ""
  ];

  const sections = [
    ["Added", changes.added],
    ["Deleted", changes.deleted],
    ["Newly archived", changes.archivedNow],
    ["Unarchived", changes.unarchivedNow]
  ];

  for (const [title, entries] of sections) {
    lines.push(`## ${title}`);
    lines.push("");
    if (!entries.length) {
      lines.push("- None");
    } else {
      lines.push(...entries.map((entry) => `- ${entry}`));
    }
    lines.push("");
  }

  await ensureParent(OUTPUT_REPORT);
  await writeFile(OUTPUT_REPORT, lines.join("\n"), "utf8");
}

export async function main() {
  console.log(`Syncing repositories for ${OWNER}...`);
  const previousRepos = await loadPreviousRepos();
  const repos = await fetchAllRepos(OWNER);

  const sortedRepos = repos.sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0));
  const readmeScanLimit = resolveReadmeLimit(sortedRepos.length);
  const readmeTargets = sortedRepos.slice(0, readmeScanLimit);

  console.log(`Scanning README quality for ${readmeTargets.length} repos (limit ${readmeScanLimit})...`);
  const readmeByName = new Map();

  await withConcurrency(readmeTargets, 8, async (repo) => {
    const result = await fetchReadme(OWNER, repo.name);
    readmeByName.set(repo.name, {
      ...result,
      scannedAt: NOW
    });
  });

  const currentRepos = sortedRepos.map((repo) => mapRepo(repo, readmeByName.get(repo.name) || null));
  const changes = buildChanges(previousRepos, currentRepos);

  await writeJson(OUTPUT_REPOS, {
    generatedAt: NOW,
    owner: OWNER,
    repoCount: currentRepos.length,
    readmeScanLimit: readmeScanLimit,
    repos: currentRepos
  });

  await writeJson(OUTPUT_CHANGES, changes);
  await writeMarkdownReport(changes);

  console.log(`Done. Repositories synced: ${currentRepos.length}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
