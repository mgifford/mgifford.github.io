import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { parseLinkHeader, readmeHeuristic, buildChanges, mapRepo, writeMarkdownReport } from "../scripts/sync-repos.mjs";

test("parseLinkHeader parses rel links", () => {
  const header = '<https://api.github.com/foo?page=2>; rel="next", <https://api.github.com/foo?page=9>; rel="last"';
  const parsed = parseLinkHeader(header);

  assert.equal(parsed.next, "https://api.github.com/foo?page=2");
  assert.equal(parsed.last, "https://api.github.com/foo?page=9");
});

test("readmeHeuristic flags missing README", () => {
  const result = readmeHeuristic("");

  assert.equal(result.needsAttention, true);
  assert.equal(result.score, 0);
  assert.ok(result.reasons.includes("No README returned"));
});

test("readmeHeuristic extracts summary and positive score", () => {
  const markdown = `# Project\n\nThis repository provides a stable and well documented catalog workflow for repository data and curation.\n\n## Usage\n\nRun scripts for sync and build.`;
  const result = readmeHeuristic(markdown);

  assert.equal(result.needsAttention, true);
  assert.ok(result.score >= 1);
  assert.match(result.summary, /stable and well documented catalog workflow/i);
});

test("buildChanges computes added/deleted/archive transitions", () => {
  const previous = [
    { fullName: "owner/a", archived: false },
    { fullName: "owner/b", archived: false },
    { fullName: "owner/c", archived: true }
  ];
  const current = [
    { fullName: "owner/a", archived: true },
    { fullName: "owner/c", archived: false },
    { fullName: "owner/d", archived: false }
  ];

  const changes = buildChanges(previous, current);

  assert.deepEqual(changes.added, ["owner/d"]);
  assert.deepEqual(changes.deleted, ["owner/b"]);
  assert.deepEqual(changes.archivedNow, ["owner/a"]);
  assert.deepEqual(changes.unarchivedNow, ["owner/c"]);
});

test("mapRepo normalizes a GitHub API repo shape", () => {
  const mapped = mapRepo(
    {
      id: 1,
      name: "repo",
      full_name: "owner/repo",
      html_url: "https://github.com/owner/repo",
      description: null,
      language: null,
      topics: null,
      homepage: "",
      has_pages: false,
      archived: false,
      fork: false,
      visibility: "public",
      stargazers_count: 3,
      watchers_count: 4,
      open_issues_count: 5,
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-02T00:00:00Z",
      pushed_at: "2025-01-03T00:00:00Z",
      default_branch: "main"
    },
    null
  );

  assert.equal(mapped.fullName, "owner/repo");
  assert.equal(mapped.language, "Unknown");
  assert.deepEqual(mapped.topics, []);
  assert.equal(mapped.stars, 3);
});

// parseLinkHeader – edge cases

test("parseLinkHeader returns empty object for null input", () => {
  assert.deepEqual(parseLinkHeader(null), {});
});

test("parseLinkHeader returns empty object for empty string", () => {
  assert.deepEqual(parseLinkHeader(""), {});
});

test("parseLinkHeader handles only a last rel", () => {
  const header = '<https://api.github.com/foo?page=5>; rel="last"';
  const parsed = parseLinkHeader(header);
  assert.equal(parsed.last, "https://api.github.com/foo?page=5");
  assert.equal(parsed.next, undefined);
});

test("parseLinkHeader handles prev and next rels together", () => {
  const header = '<https://api.github.com/foo?page=1>; rel="prev", <https://api.github.com/foo?page=3>; rel="next"';
  const parsed = parseLinkHeader(header);
  assert.equal(parsed.prev, "https://api.github.com/foo?page=1");
  assert.equal(parsed.next, "https://api.github.com/foo?page=3");
});

// readmeHeuristic – additional cases

test("readmeHeuristic detects placeholder language", () => {
  const markdown = `# Project\n\nTODO: write this later. Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.`;
  const result = readmeHeuristic(markdown);
  assert.ok(result.reasons.some((r) => /placeholder/i.test(r)));
});

test("readmeHeuristic gives full score for comprehensive README", () => {
  const longBody = "This project provides a robust and fully-documented workflow for managing repository catalog data with automatic synchronization and curation.".repeat(4);
  const markdown = `# Project\n\n${longBody}\n\n## Usage\n\nMore content here with extra details and instructions to make the README comprehensive.`;
  const result = readmeHeuristic(markdown);
  assert.equal(result.score, 4);
  assert.equal(result.needsAttention, false);
});

test("readmeHeuristic treats non-string input like missing README", () => {
  const result = readmeHeuristic(42);
  assert.equal(result.score, 0);
  assert.equal(result.needsAttention, true);
  assert.ok(result.reasons.includes("No README returned"));
});

test("readmeHeuristic short README has low score and flags short", () => {
  const result = readmeHeuristic("# Hi\n\nJust a tiny note.");
  assert.ok(result.score <= 2);
  assert.ok(result.reasons.includes("README is very short"));
});

test("readmeHeuristic strips YAML frontmatter before extracting summary", () => {
  const markdown = `---\ntitle: My Project\ndescription: badge noise\n---\n\n# My Project\n\nThis is the actual meaningful description of the project that should appear as the summary.`;
  const result = readmeHeuristic(markdown);
  assert.match(result.summary, /actual meaningful description/i);
  assert.ok(!result.summary.includes("---"));
});

test("readmeHeuristic strips HTML tags such as img badge lines", () => {
  const markdown = `<img src="https://www.gnu.org/licenses/agpl3.0"> <img src="https://github.com/org/repo/actions/workflows/deploy.yml">\n\n# My Project\n\nThis is the actual project description that should be shown as the summary text.`;
  const result = readmeHeuristic(markdown);
  assert.ok(!result.summary.includes("<img"), "summary should not contain <img tags");
  assert.match(result.summary, /actual project description/i);
});

// mapRepo – additional cases

test("mapRepo preserves provided description and topics", () => {
  const mapped = mapRepo(
    {
      id: 2,
      name: "lib",
      full_name: "owner/lib",
      html_url: "https://github.com/owner/lib",
      description: "A useful library",
      language: "Python",
      topics: ["python", "library"],
      homepage: "https://example.com",
      has_pages: true,
      archived: true,
      fork: true,
      visibility: "private",
      stargazers_count: 0,
      watchers_count: 1,
      open_issues_count: 2,
      forks_count: 3,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-06-01T00:00:00Z",
      pushed_at: "2024-06-15T00:00:00Z",
      default_branch: "develop"
    },
    { summary: "readme summary", score: 3, needsAttention: false, reasons: [] }
  );

  assert.equal(mapped.description, "A useful library");
  assert.equal(mapped.language, "Python");
  assert.deepEqual(mapped.topics, ["python", "library"]);
  assert.equal(mapped.homepage, "https://example.com");
  assert.equal(mapped.hasPages, true);
  assert.equal(mapped.archived, true);
  assert.equal(mapped.fork, true);
  assert.equal(mapped.visibility, "private");
  assert.equal(mapped.forksCount, 3);
  assert.equal(mapped.defaultBranch, "develop");
  assert.deepEqual(mapped.readme, { summary: "readme summary", score: 3, needsAttention: false, reasons: [] });
});

// buildChanges – edge cases

test("buildChanges handles empty previous and current", () => {
  const changes = buildChanges([], []);
  assert.deepEqual(changes.added, []);
  assert.deepEqual(changes.deleted, []);
  assert.deepEqual(changes.archivedNow, []);
  assert.deepEqual(changes.unarchivedNow, []);
  assert.equal(changes.counts.previous, 0);
  assert.equal(changes.counts.current, 0);
});

test("buildChanges handles all repos deleted", () => {
  const previous = [
    { fullName: "owner/a", archived: false },
    { fullName: "owner/b", archived: false }
  ];
  const changes = buildChanges(previous, []);
  assert.deepEqual(changes.deleted, ["owner/a", "owner/b"]);
  assert.deepEqual(changes.added, []);
  assert.equal(changes.counts.deleted, 2);
  assert.equal(changes.counts.current, 0);
});

test("buildChanges handles all repos added", () => {
  const current = [
    { fullName: "owner/x", archived: false },
    { fullName: "owner/y", archived: false }
  ];
  const changes = buildChanges([], current);
  assert.deepEqual(changes.added, ["owner/x", "owner/y"]);
  assert.deepEqual(changes.deleted, []);
  assert.equal(changes.counts.added, 2);
  assert.equal(changes.counts.previous, 0);
});

test("buildChanges counts match array lengths", () => {
  const previous = [{ fullName: "owner/a", archived: false }];
  const current = [
    { fullName: "owner/a", archived: true },
    { fullName: "owner/b", archived: false }
  ];
  const changes = buildChanges(previous, current);
  assert.equal(changes.counts.added, changes.added.length);
  assert.equal(changes.counts.deleted, changes.deleted.length);
  assert.equal(changes.counts.archivedNow, changes.archivedNow.length);
  assert.equal(changes.counts.unarchivedNow, changes.unarchivedNow.length);
  assert.equal(changes.counts.previous, previous.length);
  assert.equal(changes.counts.current, current.length);
});

// writeMarkdownReport

test("writeMarkdownReport writes a readable markdown file", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "mgifford-test-"));
  t.after(() => rm(dir, { recursive: true }));

  // writeMarkdownReport writes to a fixed path, so we verify indirectly via the return value
  const changes = {
    generatedAt: "2025-01-01T00:00:00Z",
    owner: "testowner",
    counts: { previous: 2, current: 3, added: 1, deleted: 0, archivedNow: 1, unarchivedNow: 0 },
    added: ["testowner/new-repo"],
    deleted: [],
    archivedNow: ["testowner/old-repo"],
    unarchivedNow: []
  };

  // writeMarkdownReport returns undefined but we verify it doesn't throw
  await assert.doesNotReject(() => writeMarkdownReport(changes));

  // Verify the actual report file was written with expected content
  const content = await readFile("reports/changes-latest.md", "utf8");
  assert.ok(content.includes("# Repository Sync Report"));
  assert.ok(content.includes("testowner"));
  assert.ok(content.includes("testowner/new-repo"));
  assert.ok(content.includes("testowner/old-repo"));
  assert.ok(content.includes("## Added"));
  assert.ok(content.includes("## Deleted"));
  assert.ok(content.includes("- None"));
});
