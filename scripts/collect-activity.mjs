#!/usr/bin/env node
/**
 * Collect bounded, public GitHub activity for Project Atlas.
 *
 * Design constraints (see docs/activity-schema.md and README.md):
 * - public data only; no private repositories, notifications, or tokens in output
 * - bounded lookback, repository count, and API-request budget
 * - overlapping refresh window for late-arriving or edited events
 * - explicit coverage reporting when a source is unavailable or incomplete
 *
 * Usage:
 *   GH_TOKEN=... node scripts/collect-activity.mjs
 *
 * Environment:
 *   GH_TOKEN / GITHUB_TOKEN       required for collection
 *   ACTIVITY_NOW                  ISO timestamp override (reproducible runs)
 *   ACTIVITY_LOOKBACK_DAYS        override config lookback
 *   ACTIVITY_MAX_REPOS            override config repository cap
 *   ACTIVITY_MAX_REQUESTS         override config request cap
 *   ACTIVITY_MAX_EVENTS           retained event cap (default 4000)
 *   ACTIVITY_CACHE_DIR            ETag cache directory (default .cache/github)
 *   ACTIVITY_OFFLINE              "1" to validate/build without network
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import yaml from "js-yaml";

import { dedupeEvents, summarizeEvents } from "../src/activity.mjs";
import { summarizeWorkstreams } from "../src/queries.mjs";
import { createRequestBudget, GitHubClient, isAvailabilityFailure } from "./lib/github-api.mjs";
import {
  buildCoverage,
  buildMetadataEventsFromChangeLog,
  buildRepositoryWorkstreams,
  mapCommitRecord,
  mapIssueCommentRecord,
  mapIssueRecord,
  mapPublicEventRecord,
  mapPullRequestRecord,
  mapReleaseRecord,
  mapSearchCommitRecord,
  mapSearchIssueRecord,
  mapWorkflowRunRecord,
  mergeAndPruneEvents,
  selectCandidates,
  workstreamsFor
} from "./lib/activity-mappers.mjs";

const CONFIG_PATH = "data/workstreams.yml";
const REPOS_PATH = "data/generated/repos.json";
const CHANGES_PATH = "data/generated/changes.json";
const ACTIVITY_DIR = "data/generated/activity";

const OUTPUT_ACTIVITY_DATA = "data/activity-data.json";
const OUTPUT_ACTIVITY_EXTENDED = "data/activity-extended.json";
const OUTPUT_INDEX = `${ACTIVITY_DIR}/repository-index.json`;
const OUTPUT_CONTRIBUTIONS = `${ACTIVITY_DIR}/personal-contributions.json`;
const OUTPUT_HISTORY = `${ACTIVITY_DIR}/history.json`;

const API_BASE = "https://api.github.com";
const HISTORY_MAX_DAYS = 730;

function envInt(name, fallback) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function readYaml(path, fallback) {
  if (!existsSync(path)) return fallback;
  return yaml.load(await readFile(path, "utf8")) || fallback;
}

async function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(path, value, { pretty = true } = {}) {
  await mkdir(dirname(path), { recursive: true });
  const body = pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
  await writeFile(path, `${body}\n`, "utf8");
}

/** Runs async tasks with a fixed concurrency limit. */
async function mapWithConcurrency(items, limit, worker) {
  const queue = [...items];
  const results = [];
  const workers = Array.from({ length: Math.max(1, Math.min(limit, queue.length || 1)) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item === undefined) break;
      results.push(await worker(item));
    }
  });
  await Promise.all(workers);
  return results;
}

/** Aggregates per-source availability into a disclosure record. */
export function summarizeSource(name, label, observations) {
  const rows = observations || [];
  const failures = rows.filter((row) => row.reason && isAvailabilityFailure(row.reason));
  const records = rows.reduce((sum, row) => sum + (row.records || 0), 0);
  const requests = rows.reduce((sum, row) => sum + (row.requests || 0), 0);
  const reasons = [...new Set(failures.map((row) => row.reason))];

  let status = "ok";
  if (records === 0 && failures.length > 0) status = "unavailable";
  else if (failures.length > 0) status = "partial";

  return {
    id: name,
    label,
    status,
    requests,
    records,
    failures: failures.length,
    reasons
  };
}

/**
 * Collects one repository's detailed activity. Never throws: a failure in one
 * repository must not abort the whole run.
 */
async function collectRepository(client, candidate, context) {
  const { retrievedAt, lookbackStart, workstreams, login, limits } = context;
  const fullName = candidate.fullName;
  const events = [];
  const observations = [];
  const openWork = { openPullRequests: 0, awaitingReview: 0, issuesSeen: 0 };
  const workstreamIds = workstreamsFor(fullName, workstreams);
  const options = { retrievedAt, lookbackStart, workstreams: workstreamIds };

  const record = (source, result, extra = {}) => {
    observations.push({
      repository: fullName,
      source,
      requests: result?.pages || 1,
      records: extra.records || 0,
      reason: extra.reason || (result && result.ok === false ? result.reason : null)
    });
  };

  // Commits (bounded to two pages / 200 commits).
  if (client.budget.canRequest()) {
    const result = await client.paginate(
      `${API_BASE}/repos/${fullName}/commits?since=${encodeURIComponent(lookbackStart)}`,
      { maxPages: 2 }
    );
    let mapped = 0;
    for (const commit of result.items) {
      const event = mapCommitRecord(fullName, commit, options);
      if (event) {
        events.push(event);
        mapped += 1;
      }
    }
    record("commits", result, { records: mapped, reason: result.complete ? null : result.reason });
  }

  // Pull requests: sorted by update, one page. Enough to answer open work and
  // recent merges for most repositories; incompleteness is disclosed.
  let prItems = [];
  if (client.budget.canRequest()) {
    const result = await client.paginate(`${API_BASE}/repos/${fullName}/pulls?state=all&sort=updated&direction=desc`, {
      maxPages: 1
    });
    prItems = result.items.filter((pr) => Number.isFinite(pr?.number));
    let mapped = 0;
    for (const pr of prItems) {
      for (const event of mapPullRequestRecord(fullName, pr, options)) {
        events.push(event);
        mapped += 1;
      }
    }
    openWork.openPullRequests = prItems.filter((pr) => pr.state === "open").length;
    openWork.awaitingReview = prItems.filter(
      (pr) => pr.state === "open" && (pr.requested_reviewers || []).some((reviewer) => reviewer.login === login)
    ).length;
    record("pull-requests", result, { records: mapped, reason: result.complete ? null : result.reason });
  }

  // Open pull requests are fetched separately so "awaiting review" counts stay
  // accurate even when a busy repository has more than one page of recent PRs.
  if (client.budget.canRequest()) {
    const result = await client.paginate(`${API_BASE}/repos/${fullName}/pulls?state=open&sort=updated&direction=desc`, {
      maxPages: 1
    });
    const openPrs = result.items.filter((pr) => Number.isFinite(pr?.number));
    if (result.ok) {
      openWork.openPullRequests = openPrs.length;
      openWork.awaitingReview = openPrs.filter((pr) =>
        (pr.requested_reviewers || []).some((reviewer) => reviewer.login === login)
      ).length;
    }
    let mapped = 0;
    for (const pr of openPrs) {
      for (const event of mapPullRequestRecord(fullName, pr, options)) {
        events.push(event);
        mapped += 1;
      }
    }
    record("pull-requests", result, { records: mapped, reason: result.complete ? null : result.reason });
  }

  // Issues (excluding pull requests, which the endpoint also returns).
  if (client.budget.canRequest()) {
    const result = await client.paginate(
      `${API_BASE}/repos/${fullName}/issues?state=all&sort=updated&direction=desc&since=${encodeURIComponent(lookbackStart)}`,
      { maxPages: 1 }
    );
    const issues = result.items.filter((issue) => !issue.pull_request);
    let mapped = 0;
    for (const issue of issues) {
      for (const event of mapIssueRecord(fullName, issue, options)) {
        events.push(event);
        mapped += 1;
      }
    }
    openWork.issuesSeen = issues.filter((issue) => issue.state === "open").length;
    record("issues", result, { records: mapped, reason: result.complete ? null : result.reason });
  }

  // Issue comments for the busiest repositories only.
  if (limits.maxCommentRepositories > 0 && context.commentRepositoryNames.has(fullName) && client.budget.canRequest()) {
    const result = await client.paginate(
      `${API_BASE}/repos/${fullName}/issues/comments?since=${encodeURIComponent(lookbackStart)}&sort=created&direction=desc`,
      { maxPages: 1 }
    );
    let mapped = 0;
    for (const comment of result.items) {
      const event = mapIssueCommentRecord(fullName, comment, options);
      if (event) {
        events.push(event);
        mapped += 1;
      }
    }
    record("issue-comments", result, { records: mapped, reason: result.complete ? null : result.reason });
  }

  // Releases.
  if (client.budget.canRequest()) {
    const result = await client.paginate(`${API_BASE}/repos/${fullName}/releases`, { maxPages: 1 });
    let mapped = 0;
    for (const release of result.items) {
      const event = mapReleaseRecord(fullName, release, options);
      if (event) {
        events.push(event);
        mapped += 1;
      }
    }
    record("releases", result, { records: mapped, reason: null });
  }

  // Latest workflow run for the busiest repositories.
  if (limits.maxWorkflowRepositories > 0 && context.workflowRepositoryNames.has(fullName) && client.budget.canRequest()) {
    const result = await client.paginate(
      `${API_BASE}/repos/${fullName}/actions/runs?branch=${encodeURIComponent(candidate.defaultBranch || "main")}`,
      { maxPages: 1 }
    );
    const completed = result.items.filter((run) => run.status === "completed");
    const latest = completed.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0];
    if (latest) {
      openWork.failingWorkflows = latest.conclusion === "failure" || latest.conclusion === "timed_out" ? 1 : 0;
    }
    const event = latest
      ? mapWorkflowRunRecord(fullName, latest, { ...options, includeWorkflowFailures: true })
      : null;
    if (event) events.push(event);
    record("workflows", result, { records: event ? 1 : 0, reason: null });
  }

  return { events, observations, openWork };
}

/** Collects the user's public events feed (bounded pagination). */
async function collectPublicEvents(client, context) {
  const { login, retrievedAt, lookbackStart, workstreams, maxEventPages, ownedRepositories } = context;
  const events = [];
  const result = await client.paginate(`${API_BASE}/users/${login}/events/public`, {
    maxPages: maxEventPages,
    perPage: 100
  });

  for (const raw of result.items) {
    if (new Date(raw.created_at).getTime() < new Date(lookbackStart).getTime()) continue;
    const mapped = mapPublicEventRecord(raw, {
      retrievedAt,
      workstreams: workstreamsFor(raw?.repo?.name, workstreams),
      suppressCoarseEvents: ownedRepositories?.has(raw?.repo?.name)
    });
    events.push(...mapped);
  }

  return {
    events,
    observation: {
      repository: `@${login}`,
      source: "public-events",
      requests: result.pages,
      records: events.length,
      reason: result.complete ? null : result.reason
    }
  };
}

/** Collects authored issues/PRs and commits outside owned repositories. */
async function collectExternalContributions(client, context) {
  const { login, retrievedAt, lookbackStart, workstreams, owner } = context;
  const events = [];
  const observations = [];
  const sinceDate = lookbackStart.slice(0, 10);
  const options = { retrievedAt, owner, lookbackStart };

  const queries = [
    {
      id: "external-issues",
      label: "Authored issues and pull requests outside owned repositories",
      url: `${API_BASE}/search/issues?q=${encodeURIComponent(`author:${login} updated:>=${sinceDate} -user:${owner}`)}&sort=updated&order=desc&per_page=50`
    },
    {
      id: "external-merged",
      label: "Merged pull requests outside owned repositories",
      url: `${API_BASE}/search/issues?q=${encodeURIComponent(`is:pr is:merged author:${login} merged:>=${sinceDate} -user:${owner}`)}&sort=updated&order=desc&per_page=50`
    }
  ];

  for (const query of queries) {
    if (!client.budget.canRequest() || client.searchExhausted) break;
    const result = await client.request(query.url);
    const items = Array.isArray(result.data?.items) ? result.data.items : [];
    let mapped = 0;
    for (const item of items) {
      if (item?.user?.login !== login) continue;
      const event = mapSearchIssueRecord(item, { ...options, workstreams: workstreamsFor(repositoryFromItem(item), workstreams) });
      if (event) {
        events.push(event);
        mapped += 1;
      }
    }
    observations.push({
      repository: query.id,
      source: "external-search",
      requests: 1,
      records: mapped,
      reason: result.ok ? null : result.reason
    });
  }

  if (client.budget.canRequest() && !client.searchExhausted) {
    const result = await client.request(
      `${API_BASE}/search/commits?q=${encodeURIComponent(`author:${login} committer-date:>=${sinceDate} -user:${owner}`)}&sort=committer-date&order=desc&per_page=50`
    );
    const items = Array.isArray(result.data?.items) ? result.data.items : [];
    let mapped = 0;
    for (const item of items) {
      const event = mapSearchCommitRecord(item, {
        ...options,
        workstreams: workstreamsFor(item?.repository?.full_name, workstreams)
      });
      if (event) {
        events.push(event);
        mapped += 1;
      }
    }
    observations.push({
      repository: "external-commits",
      source: "external-search-commits",
      requests: 1,
      records: mapped,
      reason: result.ok ? null : result.reason
    });
  }

  return { events, observations };
}

function repositoryFromItem(item) {
  const prefix = `${API_BASE}/repos/`;
  const url = item?.repository_url || "";
  return url.startsWith(prefix) ? url.slice(prefix.length) : "";
}

/** Counts events per local day for the compact long-term history rollup. */
export function buildHistoryDays(events, { timeZone, lookbackStart }) {
  const byDay = new Map();
  for (const event of events) {
    const time = new Date(event.timestamp).getTime();
    if (Number.isNaN(time) || time < new Date(lookbackStart).getTime()) continue;
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date(time));
    if (!byDay.has(date)) byDay.set(date, { date, total: 0, human: 0, automated: 0, repositories: new Set(), byCategory: {} });
    const row = byDay.get(date);
    row.total += 1;
    if (event.automated) row.automated += 1;
    else row.human += 1;
    row.repositories.add(event.repository);
    row.byCategory[event.category] = (row.byCategory[event.category] || 0) + 1;
  }

  return [...byDay.values()]
    .map((row) => ({ ...row, repositories: [...row.repositories].sort() }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Merges rollups across runs, keeping the most recent observation per day. */
export function mergeHistory(previousDays, newDays, { maxDays = HISTORY_MAX_DAYS } = {}) {
  const byDate = new Map();
  for (const day of [...(previousDays || []), ...(newDays || [])]) {
    if (!day?.date) continue;
    byDate.set(day.date, day);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-maxDays);
}

export async function main() {
  const offline = process.env.ACTIVITY_OFFLINE === "1";
  const config = await readYaml(CONFIG_PATH, {});
  const timezone = config.timezone || "America/Toronto";
  const now = new Date(process.env.ACTIVITY_NOW || new Date().toISOString());
  const retrievedAt = now.toISOString();

  const lookbackDays = envInt("ACTIVITY_LOOKBACK_DAYS", config.reporting?.lookbackDays || 90);
  const overlapDays = config.reporting?.overlapDays || 7;
  const lookbackStart = new Date(now.getTime() - lookbackDays * 86_400_000).toISOString();
  const overlapStart = new Date(now.getTime() - overlapDays * 86_400_000).toISOString();
  const maxEvents = envInt("ACTIVITY_MAX_EVENTS", 9000);
  const fullCommitDetailDays = envInt("ACTIVITY_FULL_COMMIT_DAYS", 30);

  const repoData = await readJson(REPOS_PATH, { repos: [], owner: "mgifford" });
  const changeLog = await readJson(CHANGES_PATH, null);
  const previousRecent = await readJson(OUTPUT_ACTIVITY_DATA, { events: [] });
  const previousExtended = await readJson(OUTPUT_ACTIVITY_EXTENDED, { events: [] });
  const previousActivity = { events: [...(previousRecent.events || []), ...(previousExtended.events || [])] };
  const previousHistory = await readJson(OUTPUT_HISTORY, { days: [] });

  const owner = repoData.owner || config.actor?.login || "mgifford";
  const login = config.actor?.login || owner;
  const aliases = config.actor?.aliases || [];
  const identities = [login, ...aliases];
  const repositoryWorkstreams = buildRepositoryWorkstreams(config);
  const priorityNames = new Set([
    ...(repoData.pinnedRepos || []),
    ...((await readYaml("data/curation.yml", {})).featured || []).map((item) => item.repo)
  ]);

  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
  const cacheDir = process.env.ACTIVITY_CACHE_DIR || ".cache/github";
  const budget = createRequestBudget({
    maxRequests: envInt("ACTIVITY_MAX_REQUESTS", config.collection?.maxRequests || 800),
    reserve: config.collection?.rateLimitReserve || 25
  });
  const client = new GitHubClient({ token, cacheDir, budget });

  const selection = selectCandidates(repoData.repos || [], {
    lookbackStart,
    maxRepositories: envInt("ACTIVITY_MAX_REPOS", config.collection?.maxRepositories || 120),
    includeForks: Boolean(config.collection?.includeForks),
    includeArchived: Boolean(config.collection?.includeArchived),
    priorityNames
  });

  const candidates = selection.candidates;
  const workflowRepositoryNames = new Set(
    candidates.slice(0, envInt("ACTIVITY_MAX_WORKFLOW_REPOS", config.collection?.maxWorkflowRepositories || 30)).map((candidate) => candidate.fullName)
  );
  const commentRepositoryNames = new Set(
    candidates.slice(0, envInt("ACTIVITY_MAX_COMMENT_REPOS", config.collection?.maxCommentRepositories || 40)).map((candidate) => candidate.fullName)
  );

  const collected = [];
  const observations = [];
  const repositoryRows = [];

  if (!offline && token) {
    console.log(`Collecting activity for ${candidates.length} repositories (lookback ${lookbackDays}d, budget ${budget.maxRequests} requests)...`);

    const perRepo = await mapWithConcurrency(candidates, 5, async (candidate) => {
      if (!budget.canRequest()) {
        return { skipped: true, reason: budget.reason || "budget-exhausted", candidate };
      }
      try {
        const result = await collectRepository(client, candidate, {
          retrievedAt,
          lookbackStart,
          workstreams: repositoryWorkstreams,
          login,
          limits: {
            maxWorkflowRepositories: envInt("ACTIVITY_MAX_WORKFLOW_REPOS", config.collection?.maxWorkflowRepositories || 30),
            maxCommentRepositories: envInt("ACTIVITY_MAX_COMMENT_REPOS", config.collection?.maxCommentRepositories || 40)
          },
          workflowRepositoryNames,
          commentRepositoryNames
        });
        return { candidate, ...result };
      } catch (error) {
        return { candidate, events: [], observations: [], openWork: {}, error: error.message };
      }
    });

    for (const result of perRepo) {
      if (result.skipped) {
        observations.push({
          repository: result.candidate.fullName,
          source: "all",
          requests: 0,
          records: 0,
          reason: result.reason
        });
        continue;
      }
      collected.push(...result.events);
      observations.push(...result.observations);
      if (result.error) {
        observations.push({
          repository: result.candidate.fullName,
          source: "all",
          requests: 0,
          records: 0,
          reason: `error: ${result.error}`
        });
      }
      repositoryRows.push({
        ...result.candidate,
        ...result.openWork,
        workstreams: workstreamsFor(result.candidate.fullName, repositoryWorkstreams)
      });
    }

    const publicEvents = await collectPublicEvents(client, {
      login,
      retrievedAt,
      lookbackStart,
      workstreams: repositoryWorkstreams,
      maxEventPages: config.collection?.maxEventPages || 3,
      ownedRepositories: new Set((repoData.repos || []).map((repo) => repo.fullName))
    });
    collected.push(...publicEvents.events);
    observations.push(publicEvents.observation);

    const external = await collectExternalContributions(client, {
      login,
      retrievedAt,
      lookbackStart,
      workstreams: repositoryWorkstreams,
      owner
    });
    collected.push(...external.events);
    observations.push(...external.observations);
  } else if (offline) {
    console.log("ACTIVITY_OFFLINE=1: skipping network collection and rebuilding from stored events.");
  } else {
    console.warn(
      "No GH_TOKEN/GITHUB_TOKEN found: leaving stored activity data unchanged. Set ACTIVITY_ALLOW_NO_TOKEN=1 to rebuild from stored events."
    );
    if (process.env.ACTIVITY_ALLOW_NO_TOKEN !== "1") return;
  }

  // Snapshot-derived metadata events. These come from the sync change log so
  // weekly metadata edits are not lost between runs.
  const metadataEvents = buildMetadataEventsFromChangeLog(changeLog, {
    retrievedAt,
    repositoryWorkstreams,
    owner,
    lookbackStart,
    currentRepos: repoData.repos || []
  });
  collected.push(...metadataEvents);

  const merged = mergeAndPruneEvents(previousActivity.events || [], collected, { lookbackStart, maxEvents });

  // Detail-retention policy: routine commits older than the detail window are
  // dropped first, while pull requests, issues, reviews, and releases are kept
  // for the full lookback. This keeps 90-day reporting honest without keeping
  // tens of thousands of low-signal commit records in Git.
  const detailCutoffMs = now.getTime() - fullCommitDetailDays * 86_400_000;
  let prunedRoutineCommits = 0;
  const retained = merged.events.filter((event) => {
    if (event.eventType !== "commit_pushed") return true;
    const time = new Date(event.timestamp).getTime();
    if (time < detailCutoffMs) {
      prunedRoutineCommits += 1;
      return false;
    }
    return true;
  });

  const events = dedupeEvents(retained);
  const summary = summarizeEvents(events);

  const repoIndex = buildRepositoryIndexRows(events, repositoryRows, repoData.repos || [], repositoryWorkstreams);

  // Contributions: attributable public work by the configured identities.
  const identitySet = new Set(identities.map((identity) => identity.toLowerCase()));
  const contributions = events.filter(
    (event) => identitySet.has(String(event.actor).toLowerCase()) && !event.automated
  );
  const contributionSummary = summarizeEvents(contributions);

  const days = buildHistoryDays(events, { timeZone: timezone, lookbackStart });
  const history = {
    schemaVersion: 1,
    generatedAt: retrievedAt,
    timezone,
    days: mergeHistory(previousHistory.days || [], days)
  };

  const coverage = buildCoverage({
    generatedAt: retrievedAt,
    lookbackDays,
    windowStart: lookbackStart,
    windowEnd: retrievedAt,
    timezone,
    scope: {
      catalogRepositories: (repoData.repos || []).length,
      consideredRepositories: selection.considered,
      collectedRepositories: candidates.length,
      cappedRepositories: selection.capped,
      skippedArchived: selection.skipped.archived,
      skippedForks: selection.skipped.fork,
      skippedOutOfWindow: selection.skipped.outOfWindow,
      maxEvents,
      fullCommitDetailDays,
      prunedRoutineCommits,
      droppedByCap: merged.droppedByCap,
      browserWindowDays: Number(process.env.ACTIVITY_BROWSER_DAYS || 7)
    },
    sources: summarizeSources(observations, { token, offline, budget }),
    limitations: [
      ...(config.limitations || []),
      "Repository activity is collected for the bounded candidate set only; absence of an event does not prove absence of work.",
      `Routine commit detail is retained for ${fullCommitDetailDays} days; pull requests, issues, reviews, and releases are retained for the full lookback window.`
    ],
    budget,
    stats: client.stats
  });

  const browserDays = Number(process.env.ACTIVITY_BROWSER_DAYS || 7);
  const browserCutoffMs = now.getTime() - browserDays * 86_400_000;
  const recentEvents = events.filter((event) => new Date(event.timestamp).getTime() >= browserCutoffMs);
  const olderEvents = events.filter((event) => new Date(event.timestamp).getTime() < browserCutoffMs);

  const repositoryIndex = {
    schemaVersion: 1,
    generatedAt: retrievedAt,
    timezone,
    repositories: repoIndex
  };

  const personalContributions = {
    schemaVersion: 1,
    generatedAt: retrievedAt,
    user: login,
    identities,
    timezone,
    coverage: {
      window: { start: lookbackStart, end: retrievedAt },
      sources: coverage.sources.filter((source) =>
        ["public-events", "commits", "pull-requests", "issues", "issue-comments", "external-search", "external-search-commits", "reviews"].includes(source.id)
      ),
      limitations: [
        "Only public activity is collected. Private repositories, notifications, and authenticated-only data are never included.",
        "Commit attribution uses the GitHub author login when available, otherwise the recorded author email or name matched against configured identities.",
        "GitHub's public event feed exposes limited history; contribution history before the collected window is not claimed."
      ]
    },
    summary: {
      total: contributions.length,
      byEventType: contributionSummary.byEventType,
      byRepository: contributionSummary.byRepository,
      byWorkstream: contributionSummary.byWorkstream,
      byActor: contributionSummary.byActor,
      externalRepositories: [...new Set(contributions.filter((event) => event.evidence?.external).map((event) => event.repository))].sort()
    },
    contributionIds: contributions.map((event) => event.id),
    recordsLocation: "data/activity-data.json and data/activity-extended.json (join on id)"
  };

  if (offline) {
    console.log("Offline mode: leaving stored activity files unchanged.");
    return;
  }

  // A network/rate-limit failure must not replace good data with an empty or
  // degraded snapshot. Partial runs are allowed only when they collected
  // something or there was no previous data to preserve.
  if (!offline && (collected?.length || 0) === 0 && (previousActivity.events || []).length > 0) {
    console.warn("No new activity was collected; leaving stored activity files unchanged.");
    return;
  }

  const activityData = {
    schemaVersion: 1,
    generatedAt: retrievedAt,
    timezone,
    defaultRange: config.reporting?.defaultRange || "last_7_days",
    identity: { login, aliases },
    coverage,
    summary: {
      events: events.length,
      human: summary.human,
      automated: summary.automated,
      repositories: summary.repositories.length,
      byCategory: summary.byCategory,
      byEventType: summary.byEventType
    },
    window: { start: new Date(browserCutoffMs).toISOString(), end: retrievedAt },
    extendedAvailable: olderEvents.length > 0,
    extendedPath: "data/activity-extended.json",
    workstreams: summarizeWorkstreams(events, config, { repositoryIndex: repositoryIndex.repositories }),
    repositoryIndex: repositoryIndex.repositories,
    events: recentEvents.map(compactStoredEvent)
  };

  const extendedData = {
    schemaVersion: 1,
    generatedAt: retrievedAt,
    timezone,
    events: olderEvents.map(compactStoredEvent)
  };

  // The large event payloads are minified; they are consumed by scripts and
  // the browser, not read line by line.
  await writeJson(OUTPUT_ACTIVITY_DATA, activityData, { pretty: false });
  await writeJson(OUTPUT_ACTIVITY_EXTENDED, extendedData, { pretty: false });
  await writeJson(OUTPUT_INDEX, repositoryIndex);
  await writeJson(OUTPUT_CONTRIBUTIONS, personalContributions, { pretty: false });
  await writeJson(OUTPUT_HISTORY, history);

  console.log("");
  console.log(`Events: ${events.length} (${summary.human} human, ${summary.automated} automated)`);
  console.log(`Repositories with activity: ${summary.repositories.length}`);
  console.log(`Contributions attributed to ${login}: ${contributions.length}`);
  console.log(`API requests used: ${budget.used}/${budget.maxRequests}${budget.exhausted ? ` (stopped: ${budget.reason})` : ""}`);
  const limited = coverage.sources.filter((source) => source.status !== "ok");
  if (limited.length) {
    console.log("Coverage caveats:");
    for (const source of limited) {
      console.log(`  - ${source.id}: ${source.status}${source.reasons.length ? ` (${source.reasons.join(", ")})` : ""}`);
    }
  }
}

/**
 * Canonical committed event record.
 *
 * Large or derivable fields are omitted on purpose:
 * - `groupKey` is derivable from pull request number / merge commit title
 * - `repositoryUrl` is derived from `repository`
 * - `evidence` and `substantiveReason` stay in memory during collection but
 *   are not accumulated in Git
 * Commit summaries are dropped because the commit title is the evidence; pull
 * request and issue summaries are kept (bounded) because they explain intent.
 */
function compactStoredEvent(event) {
  const compact = {
    id: event.id,
    repository: event.repository,
    timestamp: event.timestamp,
    eventType: event.eventType,
    category: event.category,
    actor: event.actor,
    actorRole: event.actorRole,
    automated: Boolean(event.automated),
    title: event.title,
    summary: event.eventType === "commit_pushed" ? "" : event.summary ? String(event.summary).slice(0, 240) : "",
    url: event.url,
    source: event.source || "unrecorded",
    retrievedAt: event.retrievedAt || retrievedAt,
    workstreams: event.workstreams || [],
    pullRequestNumber: event.pullRequestNumber ?? null,
    outcome: event.outcome,
    substantive: event.substantive
  };
  if (event.automated) compact.automationReason = event.automationReason || "unknown";
  if (event.timestampPrecision && event.timestampPrecision !== "exact") compact.timestampPrecision = event.timestampPrecision;
  if (event.derived) compact.derived = true;
  return compact;
}

/** Builds per-repository index rows from events plus open-work counts. */
export function buildRepositoryIndexRows(events, candidateRows, allRepos, repositoryWorkstreams) {
  const byRepo = new Map();
  for (const event of events) {
    if (!byRepo.has(event.repository)) byRepo.set(event.repository, []);
    byRepo.get(event.repository).push(event);
  }

  const openWorkByRepo = new Map((candidateRows || []).map((row) => [row.fullName, row]));
  const repoMeta = new Map((allRepos || []).map((repo) => [repo.fullName, repo]));
  const names = new Set([...byRepo.keys(), ...openWorkByRepo.keys()]);

  return [...names]
    .map((repository) => {
      const repoEvents = (byRepo.get(repository) || []).slice().sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
      const humanEvents = repoEvents.filter((event) => !event.automated);
      const completed = repoEvents.filter((event) => event.outcome === "completed");
      const meta = repoMeta.get(repository) || {};
      const work = openWorkByRepo.get(repository) || {};
      return {
        repository,
        repositoryUrl: meta.url || `https://github.com/${repository}`,
        archived: Boolean(meta.archived),
        updatedAt: meta.updatedAt || null,
        pushedAt: meta.pushedAt || null,
        eventCount: repoEvents.length,
        humanEventCount: humanEvents.length,
        automatedEventCount: repoEvents.length - humanEvents.length,
        lastActivityAt: repoEvents[0]?.timestamp || null,
        lastHumanActivityAt: humanEvents[0]?.timestamp || null,
        lastCompletedAt: completed[0]?.timestamp || null,
        lastActivityType: repoEvents[0]?.eventType || null,
        lastHumanActivityType: humanEvents[0]?.eventType || null,
        lastActor: repoEvents[0]?.actor || null,
        lastTitle: repoEvents[0]?.title || "",
        lastUrl: repoEvents[0]?.url || "",
        automationOnly: repoEvents.length > 0 && humanEvents.length === 0,
        openIssuesRaw: Number(work.issuesSeen ?? meta.openIssues ?? 0),
        openPullRequests: Number(work.openPullRequests || 0),
        awaitingReview: Number(work.awaitingReview || 0),
        failingWorkflows: Number(work.failingWorkflows || 0),
        readmeNeedsAttention: Boolean(meta.readme?.needsAttention),
        workstreams: workstreamsFor(repository, repositoryWorkstreams)
      };
    })
    .sort((a, b) => (b.lastActivityAt || "").localeCompare(a.lastActivityAt || "") || a.repository.localeCompare(b.repository));
}

/** Combines per-source observations into the published coverage list. */
export function summarizeSources(observations, { token, offline, budget }) {
  const groups = new Map([
    ["commits", { label: "Commit history (owned repositories)", note: "Up to two pages (200 commits) per repository." }],
    ["pull-requests", { label: "Pull requests (owned repositories)", note: "Latest page plus a separate open-PR query." }],
    ["issues", { label: "Issues (owned repositories)", note: "Latest page of updated issues in the lookback window." }],
    ["issue-comments", { label: "Issue and review comments (owned repositories)", note: "Collected for the busiest bounded set of repositories." }],
    ["releases", { label: "Releases (owned repositories)", note: "Published releases in the lookback window." }],
    ["workflows", { label: "Workflow runs (bounded set)", note: "Only the latest completed run for a bounded set of repositories." }],
    ["public-events", { label: "Public contribution events", note: "At most 300 events and roughly 90 days. Payloads are truncated, so these events are coarse and marked as such." }],
    ["external-search", { label: "Authored issues and pull requests outside owned repositories", note: "Search API is capped at 50 results per query." }],
    ["external-search-commits", { label: "Authored commits outside owned repositories", note: "Search API is capped at 50 results per query." }]
  ]);

  const sourceRows = [...groups.entries()].map(([id, meta]) => ({
    ...summarizeSource(
      id,
      meta.label,
      observations.filter((observation) => observation.source === id)
    ),
    note: meta.note
  }));

  if (!token && !offline) {
    return sourceRows.map((source) => ({
      ...source,
      status: source.records > 0 ? "partial" : "unavailable",
      reasons: source.records > 0 ? source.reasons : ["no-token"]
    }));
  }

  if (budget?.exhausted) {
    return sourceRows.map((source) => ({
      ...source,
      status: source.status === "ok" ? "partial" : source.status,
      reasons: [...new Set([...source.reasons, budget.reason || "budget-exhausted"])]
    }));
  }

  return sourceRows;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
