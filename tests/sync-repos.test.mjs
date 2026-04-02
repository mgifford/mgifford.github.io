import test from "node:test";
import assert from "node:assert/strict";

import { parseLinkHeader, readmeHeuristic, buildChanges, mapRepo } from "../scripts/sync-repos.mjs";

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
