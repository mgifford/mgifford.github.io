/**
 * Activity taxonomy, attribution, automation classification, deduplication,
 * and deterministic summaries.
 *
 * Design rules:
 * - Raw observations (GitHub source events) are preserved separately from
 *   derived categories. Every derived field carries an explanation.
 * - The same work may appear in several GitHub endpoints (commit inside a
 *   merged PR, PR merge, deployment). Events carry a `groupKey` so reporting
 *   can collapse them without deleting evidence.
 * - Nothing here invents next actions. Fields are copied or derived from
 *   observable evidence.
 */

/** Primary activity categories. Categories may overlap conceptually; each
 * event records one primary category for filtering. */
export const CATEGORIES = {
  code_development: {
    label: "Code development",
    description: "Commits and substantial code changes."
  },
  pull_request: {
    label: "Pull request activity",
    description: "Opened, reviewed, approved, merged, or closed pull requests."
  },
  issue: {
    label: "Issue activity",
    description: "Opened, commented on, assigned, or closed issues."
  },
  documentation: {
    label: "Documentation",
    description: "README, technical documentation, and standards updates."
  },
  research: {
    label: "Research",
    description: "Data analysis, experiments, and recorded findings."
  },
  release: {
    label: "Release",
    description: "Tags and published versions."
  },
  deployment: {
    label: "Deployment",
    description: "Successful or failed deployment and CI workflows."
  },
  automated_maintenance: {
    label: "Automated maintenance",
    description: "Dependabot, scheduled scans, and generated data."
  },
  repository_administration: {
    label: "Repository administration",
    description: "Metadata changes, archival, and description updates."
  }
};

/** Event type registry. `category` is the derived primary category. */
export const EVENT_TYPES = {
  commit_pushed: { label: "Commit pushed", category: "code_development" },
  pull_request_opened: { label: "Pull request opened", category: "pull_request" },
  pull_request_merged: { label: "Pull request merged", category: "pull_request" },
  pull_request_closed: { label: "Pull request closed without merge", category: "pull_request" },
  pull_request_review: { label: "Pull request review", category: "pull_request" },
  pull_request_review_comment: { label: "Pull request review comment", category: "pull_request" },
  issue_opened: { label: "Issue opened", category: "issue" },
  issue_commented: { label: "Issue comment", category: "issue" },
  issue_closed: { label: "Issue closed", category: "issue" },
  release_published: { label: "Release published", category: "release" },
  deployment_succeeded: { label: "Deployment succeeded", category: "deployment" },
  deployment_failed: { label: "Deployment failed", category: "deployment" },
  workflow_run_failed: { label: "Workflow run failed", category: "deployment" },
  repository_metadata_updated: { label: "Repository metadata changed", category: "repository_administration" },
  repository_created: { label: "Repository created", category: "repository_administration" }
};

export const ACTOR_ROLES = {
  author: "Author",
  committer: "Committer",
  reviewer: "Reviewer",
  commenter: "Commenter",
  merger: "Merger",
  creator: "Creator",
  system: "System"
};

export const OUTCOMES = {
  completed: "Completed",
  in_progress: "In progress",
  discussion: "Discussion or investigation",
  informational: "Informational"
};

const BOT_LOGIN_SUFFIX = "[bot]";

/** Accounts whose activity is automation even without the `[bot]` suffix. */
const KNOWN_BOT_LOGINS = new Set([
  "dependabot",
  "dependabot-preview",
  "renovate",
  "renovate-bot",
  "github-actions",
  "github-actions-bot",
  "actions-user",
  "greenkeeper",
  "snyk-bot",
  "codecov",
  "mergify",
  "allcontributors",
  "pre-commit-ci",
  "stale",
  "imgbot",
  "copilot",
  "copilot-swe-agent",
  "deepsource-autofix",
  "restyled-io",
  "depfu"
]);

/**
 * Conservative bot-name pattern. GitHub's `type: "Bot"` covers App bots and
 * the known list covers long-lived system accounts; this pattern only catches
 * clear `bot-` prefixes and `-bot` suffixes so human logins such as
 * "a11y-bot-fan" are not misclassified as automation.
 */
const BOT_LOGIN_PATTERN = /^(?:bot|automation)[-_]|[-_]bot$/;

/**
 * Classifies an actor as human or automated.
 * Accepts an API object (`{ login, type }`) or a login string.
 *
 * @param {{login?:string,type?:string}|string} actor
 * @returns {{login:string, automated:boolean, reason:string|null}}
 */
export function classifyActor(actor) {
  const login = typeof actor === "string" ? actor : actor?.login || "";
  const type = typeof actor === "object" && actor ? actor.type || "" : "";
  const normalized = login.toLowerCase();

  if (!normalized) {
    return { login: "", automated: false, reason: null };
  }

  if (type === "Bot" || normalized.endsWith(BOT_LOGIN_SUFFIX)) {
    return { login, automated: true, reason: "bot_account" };
  }

  if (KNOWN_BOT_LOGINS.has(normalized)) {
    return { login, automated: true, reason: "known_bot_account" };
  }

  if (BOT_LOGIN_PATTERN.test(normalized)) {
    return { login, automated: true, reason: "bot_name_pattern" };
  }

  return { login, automated: false, reason: null };
}

/** Commit messages produced by generated-data or scheduled automation. */
export function isGeneratedDataCommit(message) {
  if (!message || typeof message !== "string") return false;
  const firstLine = message.split("\n")[0].trim();

  if (/^chore: (weekly|monthly|bootstrap|nightly)\b/i.test(firstLine)) return true;
  if (/^update generated (data|files|site data)/i.test(firstLine)) return true;
  if (/^auto-?generated\b/i.test(firstLine)) return true;

  // Human-authored documentation or feature work that merely mentions
  // "generated data" must not be swept into the automation bucket.
  if (/^(docs|feat|fix|test|refactor|style|perf)(\(|:|\s)/i.test(firstLine)) return false;

  if (/\bgenerated\b/i.test(firstLine) && /\b(data|screenshots?|reports?|json)\b/i.test(firstLine)) return true;
  return false;
}

/** Dependency-update commits (Dependabot, Renovate, manual bumps). */
export function isDependencyUpdateCommit(message) {
  if (!message || typeof message !== "string") return false;
  const firstLine = message.split("\n")[0].trim();
  return /^(?:chore|build|ci)\(deps(?:-dev)?\)/i.test(firstLine) || /^bump\s+\S+\s+from\s+\S+\s+to\s+\S+/i.test(firstLine);
}

/**
 * Titles used by scheduled scanners and bots that run under a human account.
 * These are conservative prefixes; the event is preserved and marked
 * automated rather than deleted.
 */
const AUTOMATED_TITLE_PATTERN = /^(?:scan\s*:|\[scan\]|\[automated\]|automated\s*:|nightly\s*:|issue status\s*:)/i;

export function isAutomatedTitle(title) {
  return AUTOMATED_TITLE_PATTERN.test(String(title || "").trim());
}

/** Detects GitHub's merge-commit format and extracts the PR number. */
export function parseMergeCommit(message) {
  if (!message || typeof message !== "string") return null;
  const match = /^Merge pull request #(\d+)\b/i.exec(message.split("\n")[0].trim());
  return match ? { number: Number(match[1]) } : null;
}

/**
 * Classifies a commit's automation status and provenance.
 *
 * @param {{message?:string, author?:{login?:string,type?:string}|string, committer?:{login?:string,type?:string}|string}} commit
 */
export function classifyCommit(commit) {
  const author = classifyActor(commit?.author || "");
  const committer = classifyActor(commit?.committer || "");
  const message = commit?.message || "";
  const merge = parseMergeCommit(message);

  if (author.automated) {
    return {
      automated: true,
      automationReason: author.reason || "bot_account",
      mergeCommit: Boolean(merge),
      mergePullRequest: merge?.number ?? null,
      generatedData: isGeneratedDataCommit(message)
    };
  }

  if (isDependencyUpdateCommit(message)) {
    return {
      automated: true,
      automationReason: "dependency_update",
      mergeCommit: Boolean(merge),
      mergePullRequest: merge?.number ?? null,
      generatedData: false
    };
  }

  if (isGeneratedDataCommit(message)) {
    return {
      automated: true,
      automationReason: "generated_data_commit",
      mergeCommit: Boolean(merge),
      mergePullRequest: merge?.number ?? null,
      generatedData: true
    };
  }

  return {
    automated: committer.automated,
    automationReason: committer.automated ? committer.reason || "bot_account" : null,
    mergeCommit: Boolean(merge),
    mergePullRequest: merge?.number ?? null,
    generatedData: false
  };
}

/**
 * Derives the primary category for an event type.
 * Unknown event types fall back to `automated_maintenance` only when the
 * event is automated; otherwise they are rejected by `normalizeEvent`.
 */
export function deriveCategory(eventType) {
  return EVENT_TYPES[eventType]?.category || null;
}

/**
 * Assesses whether an event represents substantive project work.
 * Returns `substantive: null` when the evidence is insufficient, which the UI
 * must present as "uncertain" rather than as progress.
 */
export function assessSubstantive(event) {
  if (event.automated) {
    return { substantive: false, reason: "Automated activity, not human project work." };
  }

  switch (event.eventType) {
    case "repository_metadata_updated":
    case "repository_created":
      return { substantive: false, reason: "Repository administration is not a code or content change." };
    case "commit_pushed": {
      if (event.mergeCommit) {
        return { substantive: false, reason: "Merge commit; the related pull request is the primary evidence." };
      }
      if (isGeneratedDataCommit(event.title) || isDependencyUpdateCommit(event.title)) {
        return { substantive: false, reason: "Routine regeneration or dependency update." };
      }
      if (!event.title || event.title.trim().length < 6) {
        return { substantive: null, reason: "Commit message is too short to judge substance." };
      }
      return { substantive: true, reason: "Human-authored commit." };
    }
    case "pull_request_merged":
    case "release_published":
    case "deployment_succeeded":
      return { substantive: true, reason: "Completed and recorded by the source." };
    case "pull_request_opened":
    case "pull_request_closed":
    case "pull_request_review":
    case "pull_request_review_comment":
    case "issue_opened":
    case "issue_commented":
    case "issue_closed":
    case "deployment_failed":
    case "workflow_run_failed":
      return { substantive: true, reason: "Human-authored discussion, review, or workflow evidence." };
    default:
      return { substantive: null, reason: "No substance rule for this event type." };
  }
}

/** Derives a reporting outcome that never inflates an opened PR into shipped work. */
export function deriveOutcome(event) {
  if (event.automated && event.eventType !== "deployment_succeeded" && event.eventType !== "deployment_failed") {
    return "informational";
  }
  switch (event.eventType) {
    case "pull_request_merged":
    case "release_published":
    case "deployment_succeeded":
      return "completed";
    case "pull_request_opened":
    case "pull_request_closed":
    case "commit_pushed":
    case "deployment_failed":
    case "workflow_run_failed":
      return "in_progress";
    case "pull_request_review":
    case "pull_request_review_comment":
    case "issue_opened":
    case "issue_commented":
    case "issue_closed":
      return "discussion";
    default:
      return "informational";
  }
}

/** Stable anchor id for a repository timeline section. */
export function repositoryAnchor(fullName) {
  return `repo-${slugify(fullName)}`;
}

/** Slug used for stable anchor ids. */
export function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

/**
 * Derives a work-group key from the event itself. Compact stored records omit
 * `groupKey`, so grouping must be reconstructable: a pull request and its merge
 * commit resolve to `pr:<repo>#<n>`.
 */
export function deriveGroupKey(event) {
  if (event?.pullRequestNumber && String(event.eventType || "").startsWith("pull_request")) {
    return `pr:${event.repository}#${event.pullRequestNumber}`;
  }
  if (event?.eventType === "commit_pushed") {
    const merge = parseMergeCommit(event.title);
    if (merge) return `pr:${event.repository}#${merge.number}`;
  }
  return event?.id;
}

const REQUIRED_EVENT_FIELDS = ["id", "repository", "timestamp", "eventType", "actor", "actorRole", "title", "url", "source", "retrievedAt"];

/**
 * Validates and normalizes an event record.
 *
 * Derived fields (`category`, `automated`, `outcome`, `substantive`) are
 * recomputed so a malformed or hand-edited file cannot silently mislabel work.
 *
 * @param {object} input
 * @returns {object} frozen normalized event
 */
export function normalizeEvent(input) {
  for (const field of REQUIRED_EVENT_FIELDS) {
    if (input?.[field] === undefined || input[field] === null || input[field] === "") {
      throw new TypeError(`Event is missing required field "${field}": ${JSON.stringify(input).slice(0, 200)}`);
    }
  }

  if (!EVENT_TYPES[input.eventType]) {
    throw new TypeError(`Unknown event type "${input.eventType}" for event ${input.id}`);
  }

  const timestamp = new Date(input.timestamp);
  if (Number.isNaN(timestamp.getTime())) {
    throw new TypeError(`Invalid event timestamp "${input.timestamp}" for event ${input.id}`);
  }

  if (!/^https?:\/\//.test(input.url)) {
    throw new TypeError(`Event ${input.id} has a non-HTTP source URL: ${input.url}`);
  }

  const category = deriveCategory(input.eventType);
  const automated = Boolean(input.automated);
  const workstreams = Array.isArray(input.workstreams) ? [...new Set(input.workstreams)] : [];

  const event = {
    id: input.id,
    repository: input.repository,
    repositoryUrl: input.repositoryUrl || `https://github.com/${input.repository}`,
    timestamp: timestamp.toISOString(),
    eventType: input.eventType,
    category,
    actor: input.actor,
    actorRole: input.actorRole,
    automated,
    automationReason: automated ? input.automationReason || "unknown" : null,
    title: String(input.title).slice(0, 300),
    summary: input.summary ? String(input.summary).slice(0, 600) : "",
    url: input.url,
    source: input.source,
    retrievedAt: new Date(input.retrievedAt).toISOString(),
    workstreams,
    groupKey: input.groupKey || deriveGroupKey(input),
    commitSha: input.commitSha || null,
    pullRequestNumber: Number.isFinite(input.pullRequestNumber) ? input.pullRequestNumber : null,
    mergeCommit: Boolean(input.mergeCommit),
    generatedData: Boolean(input.generatedData),
    timestampPrecision: input.timestampPrecision || "exact",
    derived: Boolean(input.derived),
    evidence: input.evidence && typeof input.evidence === "object" ? { ...input.evidence } : {}
  };

  const substantive = assessSubstantive(event);
  event.substantive = substantive.substantive;
  event.substantiveReason = substantive.reason;
  event.outcome = deriveOutcome(event);

  return Object.freeze(event);
}

/**
 * Stable event id builders.
 */
export const eventIds = {
  commit: (repository, sha) => `github:commit:${repository}@${sha}`,
  pullRequest: (repository, number, action) => `github:pull_request:${repository}#${number}:${action}`,
  review: (repository, number, reviewId) => `github:review:${repository}#${number}@${reviewId}`,
  issue: (repository, number, action, timestamp) =>
    `github:issue:${repository}#${number}:${action}:${new Date(timestamp).toISOString()}`,
  issueComment: (repository, commentId) => `github:issue_comment:${repository}@${commentId}`,
  release: (repository, tag) => `github:release:${repository}@${tag}`,
  workflowRun: (repository, runId, outcome) => `github:workflow_run:${repository}@${runId}:${outcome}`,
  repositorySnapshot: (repository, updatedAt) => `github:repository_metadata:${repository}@${updatedAt}`,
  repositoryCreated: (repository) => `github:repository_created:${repository}`
};

const EVENT_PRIORITY = {
  pull_request_merged: 100,
  release_published: 95,
  deployment_succeeded: 90,
  deployment_failed: 85,
  workflow_run_failed: 84,
  pull_request_opened: 80,
  pull_request_closed: 70,
  pull_request_review: 65,
  pull_request_review_comment: 64,
  issue_closed: 60,
  issue_commented: 55,
  issue_opened: 50,
  commit_pushed: 40,
  repository_created: 10,
  repository_metadata_updated: 5
};

/** Higher is more informative; used to choose a group representative. */
export function eventPriority(event) {
  return EVENT_PRIORITY[event.eventType] ?? 0;
}

/**
 * Removes duplicate event ids, keeping the record with the richer payload.
 * Stable: input order is preserved for first occurrence.
 */
export function dedupeEvents(events) {
  const byId = new Map();
  for (const event of events || []) {
    if (!event?.id) continue;
    const existing = byId.get(event.id);
    if (!existing || eventPriority(event) > eventPriority(existing)) {
      byId.set(event.id, event);
    }
  }
  return [...byId.values()];
}

/**
 * Groups events that describe the same underlying work.
 * A merge commit and its PR merge share `pr:<repo>#<n>`; everything else
 * groups by its own id.
 */
export function groupEvents(events) {
  const groups = new Map();
  for (const event of events || []) {
    const key = event.groupKey || event.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  }

  return [...groups.entries()]
    .map(([key, groupEventsList]) => {
      const sorted = [...groupEventsList].sort((a, b) => {
        const priorityDelta = eventPriority(b) - eventPriority(a);
        if (priorityDelta !== 0) return priorityDelta;
        return new Date(b.timestamp) - new Date(a.timestamp);
      });
      return {
        key,
        repository: sorted[0].repository,
        timestamp: sorted.reduce((latest, event) => (event.timestamp > latest ? event.timestamp : latest), sorted[0].timestamp),
        representative: sorted[0],
        events: sorted,
        categories: [...new Set(sorted.map((event) => event.category))],
        automated: sorted.every((event) => event.automated),
        count: sorted.length
      };
    })
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

/**
 * Filters events. All criteria are ANDed; empty values are ignored.
 *
 * @param {object[]} events
 * @param {{range?:object, repository?:string, category?:string, eventType?:string, actor?:string,
 *          automated?:boolean|"all", excludeAutomated?:boolean, workstream?:string, search?:string}} [filters]
 */
export function filterEvents(events, filters = {}) {
  const search = (filters.search || "").trim().toLowerCase();

  return (events || []).filter((event) => {
    if (filters.range && !isInRange(event.timestamp, filters.range)) return false;
    if (filters.repository && filters.repository !== "all" && event.repository !== filters.repository) return false;
    if (filters.category && filters.category !== "all" && event.category !== filters.category) return false;
    if (filters.eventType && filters.eventType !== "all" && event.eventType !== filters.eventType) return false;
    if (filters.actor && filters.actor !== "all" && event.actor !== filters.actor) return false;
    if (filters.workstream && filters.workstream !== "all" && !(event.workstreams || []).includes(filters.workstream)) return false;
    if (filters.excludeAutomated && event.automated) return false;
    if (filters.automated === true && !event.automated) return false;
    if (filters.automated === false && event.automated) return false;
    if (search) {
      const haystack = [event.title, event.summary, event.repository, event.actor, event.category, event.eventType, ...(event.workstreams || [])]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

function isInRange(timestamp, range) {
  const time = new Date(timestamp).getTime();
  return !Number.isNaN(time) && time >= range.startMs && time <= range.endMs;
}

/** Sorts newest first without mutating the input. */
export function sortEventsNewestFirst(events) {
  return [...(events || [])].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

function increment(map, key) {
  if (!key) return;
  map[key] = (map[key] || 0) + 1;
}

/**
 * Deterministic period summary. Contains no natural-language speculation;
 * every number is traceable to the events passed in.
 */
export function summarizeEvents(events) {
  const list = events || [];
  const byCategory = {};
  const byEventType = {};
  const byRepository = {};
  const byActor = {};
  const byWorkstream = {};
  const repositories = new Set();
  const humanRepositories = new Set();
  const completedRepositories = new Set();

  let automated = 0;
  let human = 0;
  let substantive = 0;
  let uncertain = 0;
  let completed = 0;
  let inProgress = 0;
  let discussion = 0;

  for (const event of list) {
    increment(byCategory, event.category);
    increment(byEventType, event.eventType);
    increment(byRepository, event.repository);
    increment(byActor, event.actor);
    for (const workstream of event.workstreams || []) increment(byWorkstream, workstream);
    repositories.add(event.repository);

    if (event.automated) {
      automated += 1;
    } else {
      human += 1;
      humanRepositories.add(event.repository);
    }

    if (event.substantive === true) substantive += 1;
    if (event.substantive === null) uncertain += 1;

    if (event.outcome === "completed") {
      completed += 1;
      completedRepositories.add(event.repository);
    }
    if (event.outcome === "in_progress") inProgress += 1;
    if (event.outcome === "discussion") discussion += 1;
  }

  return {
    total: list.length,
    automated,
    human,
    automationShare: list.length ? Math.round((automated / list.length) * 100) : 0,
    substantive,
    uncertain,
    completed,
    inProgress,
    discussion,
    byCategory,
    byEventType,
    byRepository,
    byActor,
    byWorkstream,
    repositories: [...repositories].sort(),
    humanRepositories: [...humanRepositories].sort(),
    completedRepositories: [...completedRepositories].sort()
  };
}

/**
 * One project-level summary row for a repository, derived from its events.
 * `lastActivityAt` uses the latest event of any kind; `lastHumanActivityAt`
 * excludes automation.
 */
export function summarizeRepository(repository, events) {
  const list = sortEventsNewestFirst((events || []).filter((event) => event.repository === repository));
  const humanEvents = list.filter((event) => !event.automated);
  const completedEvents = list.filter((event) => event.outcome === "completed");

  const lastEvent = list[0] || null;
  const lastHuman = humanEvents[0] || null;
  const lastSubstantive = list.find((event) => event.substantive === true) || null;

  return {
    repository,
    repositoryUrl: lastEvent?.repositoryUrl || `https://github.com/${repository}`,
    eventCount: list.length,
    humanEventCount: humanEvents.length,
    automatedEventCount: list.length - humanEvents.length,
    lastActivityAt: lastEvent?.timestamp || null,
    lastHumanActivityAt: lastHuman?.timestamp || null,
    lastSubstantiveActivityAt: lastSubstantive?.timestamp || null,
    lastCompletedAt: completedEvents[0]?.timestamp || null,
    lastActivityType: lastEvent?.eventType || null,
    lastHumanActivityType: lastHuman?.eventType || null,
    lastActor: lastEvent?.actor || null,
    lastTitle: lastEvent?.title || "",
    lastUrl: lastEvent?.url || "",
    automationOnly: list.length > 0 && humanEvents.length === 0,
    workstreams: [...new Set(list.flatMap((event) => event.workstreams || []))].sort()
  };
}

/**
 * Builds per-repository index rows and open-work counts.
 *
 * @param {object[]} events
 * @param {object[]} repositories  Repository records with `fullName` and open-work counts
 */
export function buildRepositoryIndex(events, repositories = []) {
  const byRepo = new Map();
  for (const event of events || []) {
    if (!byRepo.has(event.repository)) byRepo.set(event.repository, []);
    byRepo.get(event.repository).push(event);
  }

  const rows = new Map();
  for (const [repository, repoEvents] of byRepo) {
    rows.set(repository, summarizeRepository(repository, repoEvents));
  }

  for (const repo of repositories) {
    const name = repo.fullName || repo.repository;
    if (!name) continue;
    const existing = rows.get(name) || summarizeRepository(name, []);
    rows.set(name, {
      ...existing,
      repositoryUrl: repo.url || existing.repositoryUrl,
      updatedAt: repo.updatedAt || null,
      pushedAt: repo.pushedAt || null,
      openIssues: Number(repo.openIssues || 0),
      openPullRequests: Number(repo.openPullRequests || 0),
      awaitingReview: Number(repo.awaitingReview || 0),
      failingWorkflows: Number(repo.failingWorkflows || 0),
      archived: Boolean(repo.archived)
    });
  }

  return [...rows.values()].sort((a, b) => {
    const aTime = a.lastHumanActivityAt || a.lastActivityAt || "";
    const bTime = b.lastHumanActivityAt || b.lastActivityAt || "";
    return bTime.localeCompare(aTime) || a.repository.localeCompare(b.repository);
  });
}

/** Returns a compact, deterministic list of "what changed" bullets for reports. */
export function summarizePeriod(events) {
  const summary = summarizeEvents(events);
  const projects = summarizeRepositoryList(events);

  return {
    ...summary,
    projects,
    completedWork: sortEventsNewestFirst(events.filter((event) => event.outcome === "completed" && event.substantive !== false)),
    inProgressWork: sortEventsNewestFirst(events.filter((event) => event.outcome === "in_progress" && event.substantive === true)),
    discussions: sortEventsNewestFirst(events.filter((event) => event.outcome === "discussion" && !event.automated)),
    automation: sortEventsNewestFirst(events.filter((event) => event.automated))
  };
}

function summarizeRepositoryList(events) {
  const byRepo = new Map();
  for (const event of events || []) {
    if (!byRepo.has(event.repository)) byRepo.set(event.repository, []);
    byRepo.get(event.repository).push(event);
  }
  return [...byRepo.keys()].sort().map((repo) => summarizeRepository(repo, byRepo.get(repo)));
}
