/**
 * Deterministic queries over the normalized activity index.
 *
 * These functions are deliberately framework-free and side-effect free so the
 * same code can power the static build, the browser UI, markdown reports, and
 * (later) a read-only API or conversational interface. None of them call an
 * LLM and none of them invent next steps.
 */

import {
  dedupeEvents,
  filterEvents,
  groupEvents,
  sortEventsNewestFirst,
  summarizeEvents,
  summarizeRepository
} from "./activity.mjs";
import { formatAge, formatLocalDateKey, groupByZonedDay, isWithinRange } from "./time.mjs";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function matchesIdentity(value, identities) {
  if (!value) return false;
  const needle = String(value).toLowerCase();
  return identities.some((identity) => String(identity).toLowerCase() === needle);
}

/**
 * Projects with at least one event inside the range.
 *
 * @param {object[]} events
 * @param {object} range resolved date range
 * @param {{excludeAutomated?:boolean, includeAutomationOnly?:boolean}} [options]
 * @returns {object[]} one summary row per project, most recent first
 */
export function getRecentlyActiveProjects(events, range, options = {}) {
  const { excludeAutomated = false, includeAutomationOnly = true } = options;
  const inRange = filterEvents(events, { range });
  const filtered = excludeAutomated ? inRange.filter((event) => !event.automated) : inRange;

  const byRepository = new Map();
  for (const event of filtered) {
    if (!byRepository.has(event.repository)) byRepository.set(event.repository, []);
    byRepository.get(event.repository).push(event);
  }

  return [...byRepository.entries()]
    .map(([repository, repositoryEvents]) => {
      const summary = summarizeRepository(repository, repositoryEvents);
      const latest = sortEventsNewestFirst(repositoryEvents)[0];
      return {
        ...summary,
        latest: latest
          ? {
              eventType: latest.eventType,
              category: latest.category,
              title: latest.title,
              actor: latest.actor,
              actorRole: latest.actorRole,
              automated: latest.automated,
              substantive: latest.substantive,
              url: latest.url,
              timestamp: latest.timestamp
            }
          : null,
        categories: [...new Set(repositoryEvents.map((event) => event.category))].sort(),
        eventTypes: [...new Set(repositoryEvents.map((event) => event.eventType))].sort()
      };
    })
    .filter((project) => includeAutomationOnly || project.humanEventCount > 0)
    .sort((a, b) => (b.lastActivityAt || "").localeCompare(a.lastActivityAt || "") || a.repository.localeCompare(b.repository));
}

/**
 * Public contributions attributable to a user.
 *
 * A repository being active is not enough: the event actor must match the user
 * (or one of their configured commit identities).
 *
 * @param {object[]} events
 * @param {string} username
 * @param {object} range
 * @param {{aliases?:string[], includeAutomation?:boolean, roles?:string[]}} [options]
 */
export function getUserContributions(events, username, range, options = {}) {
  const { aliases = [], includeAutomation = false, roles = null } = options;
  const identities = [username, ...aliases].filter(Boolean);

  return sortEventsNewestFirst(
    filterEvents(events, { range }).filter((event) => {
      if (!matchesIdentity(event.actor, identities)) return false;
      if (!includeAutomation && event.automated) return false;
      if (roles && !roles.includes(event.actorRole)) return false;
      return true;
    })
  );
}

/** Groups a contribution list by repository, with counts and latest evidence. */
export function groupContributionsByRepository(contributions) {
  const byRepository = new Map();
  for (const contribution of contributions || []) {
    if (!byRepository.has(contribution.repository)) byRepository.set(contribution.repository, []);
    byRepository.get(contribution.repository).push(contribution);
  }

  return [...byRepository.entries()]
    .map(([repository, items]) => {
      const sorted = sortEventsNewestFirst(items);
      return {
        repository,
        repositoryUrl: sorted[0].repositoryUrl,
        count: sorted.length,
        lastAt: sorted[0].timestamp,
        types: [...new Set(sorted.map((item) => item.eventType))].sort(),
        roles: [...new Set(sorted.map((item) => item.actorRole))].sort(),
        contributions: sorted
      };
    })
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt) || a.repository.localeCompare(b.repository));
}

/** Groups a contribution list by workstream id (events may span workstreams). */
export function groupContributionsByWorkstream(contributions) {
  const byWorkstream = new Map();
  for (const contribution of contributions || []) {
    for (const workstream of contribution.workstreams || []) {
      if (!byWorkstream.has(workstream)) byWorkstream.set(workstream, []);
      byWorkstream.get(workstream).push(contribution);
    }
  }

  return [...byWorkstream.entries()]
    .map(([workstream, items]) => ({
      workstream,
      count: items.length,
      repositories: [...new Set(items.map((item) => item.repository))].sort(),
      contributions: sortEventsNewestFirst(items)
    }))
    .sort((a, b) => b.count - a.count || a.workstream.localeCompare(b.workstream));
}

/** Groups contributions by event type, which is more precise than category. */
export function groupContributionsByType(contributions) {
  const byType = new Map();
  for (const contribution of contributions || []) {
    if (!byType.has(contribution.eventType)) byType.set(contribution.eventType, []);
    byType.get(contribution.eventType).push(contribution);
  }
  return [...byType.entries()]
    .map(([eventType, items]) => ({ eventType, count: items.length, contributions: sortEventsNewestFirst(items) }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Timeline for one project.
 *
 * @param {object[]} events
 * @param {string} repository
 * @param {object|null} range
 * @param {{timeZone?:string, includeAutomated?:boolean}} [options]
 */
export function getProjectActivity(events, repository, range = null, options = {}) {
  const { timeZone = "America/Toronto", includeAutomated = true } = options;
  const scoped = asArray(events).filter((event) => event.repository === repository);
  const ranged = range ? scoped.filter((event) => isWithinRange(event.timestamp, range)) : scoped;
  const visible = includeAutomated ? ranged : ranged.filter((event) => !event.automated);
  const sorted = sortEventsNewestFirst(visible);

  return {
    repository,
    repositoryUrl: sorted[0]?.repositoryUrl || `https://github.com/${repository}`,
    summary: summarizeRepository(repository, visible),
    groups: groupEvents(sorted),
    events: sorted,
    days: groupByZonedDay(sorted, timeZone),
    range: range || null
  };
}

/**
 * Explicit open-work signals for one repository. No composite urgency score.
 *
 * @param {{openIssues?:number, openPullRequests?:number, awaitingReview?:number,
 *          failingWorkflows?:number, archived?:boolean, repository?:string}} repositoryEntry
 */
export function getOpenWork(repositoryEntry) {
  const entry = repositoryEntry || {};
  const criteria = [
    {
      id: "open_pull_requests",
      label: "Open pull requests",
      count: Number(entry.openPullRequests || 0),
      basis: "Count of open pull requests reported by GitHub."
    },
    {
      id: "awaiting_review",
      label: "Pull requests awaiting review from this account",
      count: Number(entry.awaitingReview || 0),
      basis: "Open pull requests with a review requested from the account."
    },
    {
      id: "open_issues",
      label: "Open issues",
      count: Number(entry.openIssues ?? entry.openIssuesRaw ?? 0),
      basis: "Open issue count reported by GitHub; not every issue needs a reply."
    },
    {
      id: "failing_workflows",
      label: "Most recent workflow run failed",
      count: Number(entry.failingWorkflows || 0),
      basis: "Latest completed run of a selected workflow on the default branch."
    },
    {
      id: "readme_quality",
      label: "README may need improvement",
      count: entry.readmeNeedsAttention ? 1 : 0,
      basis: "README heuristic score is low. Review before treating this as a defect."
    }
  ];

  return {
    repository: entry.repository || entry.fullName || "",
    archived: Boolean(entry.archived),
    criteria,
    needingReview: criteria.some((criterion) =>
      ["open_pull_requests", "awaiting_review", "failing_workflows"].includes(criterion.id) && criterion.count > 0
    ),
    note: "These are explainable public signals, not a priority score. Absence of a signal does not mean a project needs nothing."
  };
}

/** Merged pull requests in a range, deduplicated by pull request group. */
export function getRecentMergedPullRequests(events, range) {
  const merged = filterEvents(events, { range, eventType: "pull_request_merged" });
  return groupEvents(dedupeEvents(merged)).map((group) => group.representative);
}

/** Releases published in a range. */
export function getRecentReleases(events, range) {
  return sortEventsNewestFirst(filterEvents(events, { range, eventType: "release_published" }));
}

/** Events for a workstream, resolving repository membership when configured. */
export function getWorkstreamActivity(events, workstreamId, range, options = {}) {
  const { repositoryWorkstreams = new Map(), repositories = null } = options;
  const inRange = filterEvents(events, { range });

  const lookup = (repository) => {
    if (repositoryWorkstreams instanceof Map) return repositoryWorkstreams.get(repository) || [];
    if (repositoryWorkstreams && typeof repositoryWorkstreams === "object") {
      return repositoryWorkstreams[repository] || [];
    }
    return [];
  };

  const matches = (event) =>
    (event.workstreams || []).includes(workstreamId) ||
    lookup(event.repository).includes(workstreamId) ||
    (Array.isArray(repositories) && repositories.includes(event.repository));

  const scoped = inRange.filter(matches);
  return {
    workstream: workstreamId,
    summary: summarizeEvents(scoped),
    repositories: [...new Set(scoped.map((event) => event.repository))].sort(),
    events: sortEventsNewestFirst(scoped),
    days: groupByZonedDay(sortEventsNewestFirst(scoped), options.timeZone || "America/Toronto")
  };
}

const MS_PER_DAY = 86_400_000;

/**
 * Projects without recent human activity.
 *
 * `lastHumanActivityAt` comes from collected events. Projects with no collected
 * events are reported as `coverage: "unknown"` unless an `updatedAt`/`pushedAt`
 * fallback is requested, so a gap in collection is never presented as a stale
 * project.
 *
 * @param {object[]} repositoryIndex rows from buildRepositoryIndex
 * @param {number} days
 * @param {{now?:Date|string|number, includeArchived?:boolean, fallbackToRepoDates?:boolean}} [options]
 */
export function getProjectsWithoutRecentHumanActivity(repositoryIndex, days, options = {}) {
  const { now = new Date(), includeArchived = false, fallbackToRepoDates = true } = options;
  const nowMs = new Date(now).getTime();
  const cutoffMs = nowMs - days * MS_PER_DAY;
  const results = [];

  for (const entry of asArray(repositoryIndex)) {
    if (!includeArchived && entry.archived) continue;

    const humanAt = entry.lastHumanActivityAt ? new Date(entry.lastHumanActivityAt).getTime() : null;
    const fallbackAt = entry.updatedAt || entry.pushedAt ? new Date(entry.updatedAt || entry.pushedAt).getTime() : null;
    const referenceMs = humanAt ?? (fallbackToRepoDates ? fallbackAt : null);

    if (referenceMs === null) {
      results.push({
        repository: entry.repository,
        lastHumanActivityAt: null,
        idleDays: null,
        coverage: "unknown",
        reason: "No activity events have been collected for this period."
      });
      continue;
    }

    if (referenceMs >= cutoffMs) continue;

    results.push({
      repository: entry.repository,
      lastHumanActivityAt: humanAt ? new Date(humanAt).toISOString() : null,
      idleDays: Math.floor((nowMs - referenceMs) / MS_PER_DAY),
      coverage: humanAt ? "collected" : "repository-date-only",
      reason: humanAt
        ? `No human activity collected since ${formatLocalDateKey(humanAt)}.`
        : "No activity events collected; based on repository timestamps only."
    });
  }

  return results.sort((a, b) => (b.idleDays ?? -1) - (a.idleDays ?? -1));
}

/**
 * "What was I doing / where did I leave off" for one project.
 *
 * Returns only evidence: the latest human activity, open work counts, recent
 * merged PRs, and links. If the source records no next action, `nextAction` is
 * null with an explicit explanation.
 */
export function getProjectContinuity(events, repositoryEntry, options = {}) {
  const { range = null, user = null, userAliases = [], timeZone = "America/Toronto" } = options;
  const repository = repositoryEntry?.repository || repositoryEntry?.fullName;
  const timeline = getProjectActivity(events, repository, range, { timeZone });
  const human = timeline.events.filter((event) => !event.automated);
  const lastHuman = human[0] || null;
  const openWork = getOpenWork(repositoryEntry);

  const explicitNextAction = lastHuman?.summary && /next|todo|follow[- ]up/i.test(lastHuman.summary) ? lastHuman.summary : null;
  const lastMerged = human.find((event) => event.eventType === "pull_request_merged") || null;
  const lastIssue = human.find((event) => event.category === "issue") || null;
  const lastReview = human.find((event) => event.eventType.startsWith("pull_request_review")) || null;

  return {
    repository,
    repositoryUrl: timeline.repositoryUrl,
    lastHumanActivity: lastHuman,
    lastMergedPullRequest: lastMerged,
    lastIssueActivity: lastIssue,
    lastReview,
    openWork,
    nextAction: explicitNextAction
      ? { text: explicitNextAction, source: lastHuman.url, basis: "Text recorded in the most recent event." }
      : {
          text: null,
          source: null,
          basis: "No next action is recorded in the collected public evidence. Open the linked issue or pull request to decide."
        },
    coverage: {
      eventsCollected: timeline.events.length,
      disclosed: timeline.events.length === 0
    }
  };
}

/**
 * "What needs attention" candidates with explainable criteria only.
 *
 * @param {object[]} repositoryIndex
 * @param {{now?:Date|string|number, staleDays?:number, readmeAttention?:Map<string,boolean>,
 *          includeArchived?:boolean}} [options]
 */
export function getAttentionCandidates(repositoryIndex, options = {}) {
  const { now = new Date(), staleDays = 120, readmeAttention = new Map(), includeArchived = false } = options;
  const nowMs = new Date(now).getTime();
  const items = [];

  for (const entry of asArray(repositoryIndex)) {
    if (!includeArchived && entry.archived) continue;
    const repository = entry.repository;

    if (Number(entry.awaitingReview || 0) > 0) {
      items.push({
        repository,
        kind: "review_requested",
        label: "Pull requests await your review",
        count: Number(entry.awaitingReview),
        basis: "Open pull requests where your review was requested.",
        url: entry.repositoryUrl
      });
    }

    if (Number(entry.failingWorkflows || 0) > 0) {
      items.push({
        repository,
        kind: "failing_workflow",
        label: "A recent workflow run failed",
        count: Number(entry.failingWorkflows),
        basis: "Latest completed run on the default branch failed.",
        url: `${entry.repositoryUrl}/actions`
      });
    }

    if (Number(entry.openPullRequests || 0) > 0) {
      items.push({
        repository,
        kind: "open_pull_requests",
        label: "Open pull requests",
        count: Number(entry.openPullRequests),
        basis: "Open pull request count reported by GitHub.",
        url: `${entry.repositoryUrl}/pulls`
      });
    }

    if (readmeAttention.get(repository)) {
      items.push({
        repository,
        kind: "readme_quality",
        label: "README may need improvement",
        count: 1,
        basis: "README heuristic score is low; review before treating this as a defect.",
        url: `${entry.repositoryUrl}#readme`
      });
    }

    const lastHumanMs = entry.lastHumanActivityAt ? new Date(entry.lastHumanActivityAt).getTime() : null;
    if (lastHumanMs !== null && nowMs - lastHumanMs > staleDays * MS_PER_DAY) {
      items.push({
        repository,
        kind: "stale_human_activity",
        label: `No collected human activity in ${formatAge(nowMs - lastHumanMs)}`,
        count: 1,
        basis: `No human event collected since ${formatLocalDateKey(lastHumanMs)}.`,
        url: entry.repositoryUrl
      });
    }
  }

  return {
    items,
    unavailable: [
      {
        id: "security_alerts",
        label: "Dependency and security alerts",
        reason: "Dependabot alerts are not public data. They require an authenticated owner workflow and are intentionally excluded from the public dataset."
      },
      {
        id: "issue_response",
        label: "Issues needing a response",
        reason: "Whether an issue needs a reply is a judgement. The dashboard shows open issue counts and recent discussion instead."
      }
    ]
  };
}

/**
 * Summarizes each configured workstream from collected events plus open-work
 * counts. Workstream membership is explicit configuration; a repository can
 * belong to several workstreams.
 *
 * @param {object[]} events
 * @param {{workstreams?:object[]}} workstreamsConfig
 * @param {{repositoryIndex?:object[], range?:object}} [options]
 */
export function summarizeWorkstreams(events, workstreamsConfig, options = {}) {
  const { repositoryIndex = [], range = null } = options;
  const indexByRepo = new Map(repositoryIndex.map((row) => [row.repository, row]));
  const scoped = range ? events.filter((event) => isWithinRange(event.timestamp, range)) : events;

  return (workstreamsConfig?.workstreams || []).map((workstream) => {
    const repositorySet = new Set(workstream.repositories || []);
    const workstreamEvents = scoped.filter(
      (event) => (event.workstreams || []).includes(workstream.id) || repositorySet.has(event.repository)
    );
    const summary = summarizeEvents(workstreamEvents);
    const activeRepositories = [...new Set(workstreamEvents.map((event) => event.repository))].sort();
    const rows = [...repositorySet].map((repository) => indexByRepo.get(repository)).filter(Boolean);

    return {
      id: workstream.id,
      name: workstream.name || workstream.id,
      description: workstream.description || "",
      repositories: [...repositorySet].sort(),
      activeRepositories,
      summary,
      lastActivityAt: workstreamEvents.length
        ? sortEventsNewestFirst(workstreamEvents)[0].timestamp
        : null,
      humanEventCount: summary.human,
      openPullRequests: rows.reduce((sum, row) => sum + Number(row.openPullRequests || 0), 0),
      openIssuesRaw: rows.reduce((sum, row) => sum + Number(row.openIssuesRaw || 0), 0),
      awaitingReview: rows.reduce((sum, row) => sum + Number(row.awaitingReview || 0), 0),
      failingWorkflows: rows.reduce((sum, row) => sum + Number(row.failingWorkflows || 0), 0)
    };
  });
}

/** Per-day activity totals for accessible text summaries (never a chart-only view). */
export function getActivityByDay(events, timeZone = "America/Toronto") {
  return groupByZonedDay(sortEventsNewestFirst(events), timeZone).map((group) => ({
    dateKey: group.dateKey,
    dateLabel: group.dateLabel,
    weekday: group.weekday,
    total: group.records.length,
    human: group.records.filter((record) => !record.automated).length,
    automated: group.records.filter((record) => record.automated).length,
    repositories: [...new Set(group.records.map((record) => record.repository))].sort()
  }));
}

/** Single call used by static pages and reports. */
export function buildActivityDigest(events, range, options = {}) {
  const { timeZone = "America/Toronto", excludeAutomated = false } = options;
  const scoped = filterEvents(events, { range });
  const visible = excludeAutomated ? scoped.filter((event) => !event.automated) : scoped;

  return {
    range,
    summary: summarizeEvents(visible),
    byDay: getActivityByDay(visible, timeZone),
    projects: getRecentlyActiveProjects(events, range, { excludeAutomated }),
    mergedPullRequests: getRecentMergedPullRequests(events, range),
    releases: getRecentReleases(events, range),
    events: sortEventsNewestFirst(visible)
  };
}
