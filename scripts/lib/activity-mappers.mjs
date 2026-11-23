/**
 * Pure mapping functions between GitHub payloads and the Project Atlas
 * activity event model. No network or filesystem access lives here so the
 * mapping rules can be unit tested against fixtures.
 */

import {
  classifyActor,
  classifyCommit,
  eventIds,
  isAutomatedTitle,
  normalizeEvent,
  parseMergeCommit,
  repositoryAnchor,
  slugify
} from "../../src/activity.mjs";

const REPO_URL_PREFIX = "https://api.github.com/repos/";

/** First line of a commit or comment body, trimmed. */
export function firstLine(text, maxLength = 200) {
  if (!text || typeof text !== "string") return "";
  const line = text.split("\n").find((part) => part.trim().length > 0) || "";
  return line.trim().slice(0, maxLength);
}

/** Trims long prose for compact evidence without storing full API payloads. */
export function compactText(text, maxLength = 600) {
  if (!text || typeof text !== "string") return "";
  const normalized = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1).trimEnd()}…` : normalized;
}

/** Extracts "owner/repo" from a full GitHub API repository URL. */
export function repositoryFromApiUrl(url) {
  if (!url || typeof url !== "string") return "";
  return url.startsWith(REPO_URL_PREFIX) ? url.slice(REPO_URL_PREFIX.length) : "";
}

/**
 * Picks the most defensible commit actor: an authenticated GitHub login when
 * present, otherwise the recorded author email, otherwise their name.
 */
export function commitActor(commit, side = "author") {
  const apiUser = commit?.[side];
  if (apiUser?.login) {
    return { login: apiUser.login, type: apiUser.type || "" };
  }
  const identity = commit?.commit?.[side];
  if (identity?.email) {
    return { login: identity.email, type: String(identity.email).includes("[bot]") ? "Bot" : "" };
  }
  if (identity?.name) {
    return { login: identity.name, type: "" };
  }
  return { login: "unknown", type: "" };
}

/**
 * Maps a REST commit record to an event.
 *
 * @param {string} repository full name (`owner/repo`)
 * @param {object} commit REST commit payload (NOT the search payload)
 * @param {{retrievedAt:string, workstreams?:string[], lookbackStart?:string}} options
 */
export function mapCommitRecord(repository, commit, options) {
  const { retrievedAt, workstreams = [] } = options;
  const message = commit?.commit?.message || "";
  const author = commitActor(commit, "author");
  const committer = commitActor(commit, "committer");
  const classification = classifyCommit({
    message,
    author,
    committer
  });
  const timestamp = commit?.commit?.committer?.date || commit?.commit?.author?.date;
  if (!timestamp) return null;

  const merge = classification.mergePullRequest ? parseMergeCommit(message) : null;
  const groupKey = merge ? `pr:${repository}#${merge.number}` : `commit:${repository}@${commit.sha}`;

  return normalizeEvent({
    id: eventIds.commit(repository, commit.sha),
    repository,
    timestamp,
    eventType: "commit_pushed",
    actor: author.login,
    actorRole: "author",
    automated: classification.automated,
    automationReason: classification.automationReason,
    title: firstLine(message),
    summary: compactText(message),
    url: `https://github.com/${repository}/commit/${commit.sha}`,
    source: "github-rest-commits",
    retrievedAt,
    workstreams,
    groupKey,
    commitSha: commit.sha,
    mergeCommit: classification.mergeCommit,
    generatedData: classification.generatedData,
    evidence: {
      committer: committer.login,
      verifications: commit?.commit?.verification?.verified ? "verified" : null
    }
  });
}

/** Shared base fields for issue/PR events. */
function pullRequestBase(repository, pr, options) {
  const actor = pr?.user?.login || "unknown";
  const actorInfo = classifyActor(pr?.user || actor);
  const titleAutomated = isAutomatedTitle(pr?.title);
  return {
    repository,
    actor,
    automated: actorInfo.automated || titleAutomated,
    automationReason: actorInfo.reason || (titleAutomated ? "generated_title" : null),
    workstreams: options.workstreams || [],
    retrievedAt: options.retrievedAt,
    url: pr?.html_url || `https://github.com/${repository}/pull/${pr?.number}`
  };
}

/**
 * Maps one pull request to zero or more events inside the lookback window.
 * A PR opened and merged inside one window produces two linked events sharing
 * a group key, so reports count the work once.
 *
 * @returns {object[]}
 */
export function mapPullRequestRecord(repository, pr, options) {
  if (!pr?.number || !pr?.html_url) return [];
  const start = options.lookbackStart ? new Date(options.lookbackStart).getTime() : -Infinity;
  const base = pullRequestBase(repository, pr, options);
  const groupKey = `pr:${repository}#${pr.number}`;
  const requestedReviewers = (pr.requested_reviewers || []).map((reviewer) => reviewer.login).filter(Boolean);
  const evidence = {
    number: pr.number,
    state: pr.state,
    mergedAt: pr.merged_at || null,
    closedAt: pr.closed_at || null,
    baseBranch: pr.base?.ref || null,
    headBranch: pr.head?.ref || null,
    comments: Number(pr.comments || 0),
    reviewComments: Number(pr.review_comments || 0),
    requestedReviewers,
    draft: Boolean(pr.draft),
    mergedByKnown: false
  };
  const events = [];

  const openedMs = pr.created_at ? new Date(pr.created_at).getTime() : NaN;
  if (Number.isFinite(openedMs) && openedMs >= start) {
    events.push(
      normalizeEvent({
        ...base,
        id: eventIds.pullRequest(repository, pr.number, "opened"),
        timestamp: pr.created_at,
        eventType: "pull_request_opened",
        actorRole: "author",
        title: pr.title || `Pull request #${pr.number}`,
        summary: compactText(pr.body),
        source: "github-rest-pulls",
        groupKey,
        pullRequestNumber: pr.number,
        evidence
      })
    );
  }

  if (pr.merged_at) {
    const mergedMs = new Date(pr.merged_at).getTime();
    if (Number.isFinite(mergedMs) && mergedMs >= start) {
      events.push(
        normalizeEvent({
          ...base,
          id: eventIds.pullRequest(repository, pr.number, "merged"),
          timestamp: pr.merged_at,
          eventType: "pull_request_merged",
          actorRole: "author",
          title: pr.title || `Pull request #${pr.number}`,
          summary: compactText(pr.body),
          source: "github-rest-pulls",
          groupKey,
          pullRequestNumber: pr.number,
          evidence
        })
      );
    }
  } else if (pr.closed_at) {
    const closedMs = new Date(pr.closed_at).getTime();
    if (Number.isFinite(closedMs) && closedMs >= start) {
      events.push(
        normalizeEvent({
          ...base,
          id: eventIds.pullRequest(repository, pr.number, "closed"),
          timestamp: pr.closed_at,
          eventType: "pull_request_closed",
          actorRole: "author",
          title: pr.title || `Pull request #${pr.number}`,
          summary: compactText(pr.body),
          source: "github-rest-pulls",
          groupKey,
          pullRequestNumber: pr.number,
          evidence
        })
      );
    }
  }

  return events;
}

/**
 * Maps a REST issue (never a pull request; callers must filter those first).
 */
export function mapIssueRecord(repository, issue, options) {
  if (!issue?.number || !issue?.html_url || issue?.pull_request) return [];
  const start = options.lookbackStart ? new Date(options.lookbackStart).getTime() : -Infinity;
  const actor = issue.user?.login || "unknown";
  const actorInfo = classifyActor(issue.user || actor);
  const titleAutomated = isAutomatedTitle(issue.title);
  const base = {
    repository,
    actor,
    automated: actorInfo.automated || titleAutomated,
    automationReason: actorInfo.reason || (titleAutomated ? "generated_title" : null),
    workstreams: options.workstreams || [],
    retrievedAt: options.retrievedAt,
    url: issue.html_url,
    groupKey: `issue:${repository}#${issue.number}`,
    evidence: {
      number: issue.number,
      state: issue.state,
      closedAt: issue.closed_at || null,
      comments: Number(issue.comments || 0),
      labels: (issue.labels || []).map((label) => (typeof label === "string" ? label : label.name)).filter(Boolean).slice(0, 8)
    }
  };
  const events = [];

  const openedMs = new Date(issue.created_at).getTime();
  if (Number.isFinite(openedMs) && openedMs >= start) {
    events.push(
      normalizeEvent({
        ...base,
        id: eventIds.issue(repository, issue.number, "opened", issue.created_at),
        timestamp: issue.created_at,
        eventType: "issue_opened",
        actorRole: "author",
        title: issue.title || `Issue #${issue.number}`,
        summary: compactText(issue.body),
        source: "github-rest-issues"
      })
    );
  }

  if (issue.state === "closed" && issue.closed_at) {
    const closedMs = new Date(issue.closed_at).getTime();
    if (Number.isFinite(closedMs) && closedMs >= start) {
      events.push(
        normalizeEvent({
          ...base,
          id: eventIds.issue(repository, issue.number, "closed", issue.closed_at),
          timestamp: issue.closed_at,
          eventType: "issue_closed",
          actorRole: "author",
          title: issue.title || `Issue #${issue.number}`,
          summary: compactText(issue.body),
          source: "github-rest-issues"
        })
      );
    }
  }

  return events;
}

/** Maps an issue or pull-request comment. */
export function mapIssueCommentRecord(repository, comment, options) {
  if (!comment?.id || !comment?.html_url) return null;
  const actor = comment.user?.login || "unknown";
  const actorInfo = classifyActor(comment.user || actor);
  const issueNumber = Number(repositoryFromApiUrl(comment.issue_url).split("/").pop()) || null;

  return normalizeEvent({
    id: eventIds.issueComment(repository, comment.id),
    repository,
    timestamp: comment.created_at,
    eventType: "issue_commented",
    actor,
    actorRole: "commenter",
    automated: actorInfo.automated,
    automationReason: actorInfo.reason,
    title: firstLine(comment.body) || `Comment on #${issueNumber}`,
    summary: compactText(comment.body),
    url: comment.html_url,
    source: "github-rest-comments",
    retrievedAt: options.retrievedAt,
    workstreams: options.workstreams || [],
    groupKey: `issue-comment:${repository}@${comment.id}`,
    pullRequestNumber: null,
    evidence: { issueNumber }
  });
}

/** Maps a published release. */
export function mapReleaseRecord(repository, release, options) {
  if (!release?.tag_name) return null;
  const published = release.published_at || release.created_at;
  if (!published) return null;
  const start = options.lookbackStart ? new Date(options.lookbackStart).getTime() : -Infinity;
  if (new Date(published).getTime() < start) return null;

  const actor = release.author?.login || "unknown";
  const actorInfo = classifyActor(release.author || actor);

  return normalizeEvent({
    id: eventIds.release(repository, release.tag_name),
    repository,
    timestamp: published,
    eventType: "release_published",
    actor,
    actorRole: "author",
    automated: actorInfo.automated,
    automationReason: actorInfo.reason,
    title: release.name || release.tag_name,
    summary: compactText(release.body),
    url: release.html_url || `https://github.com/${repository}/releases/tag/${release.tag_name}`,
    source: "github-rest-releases",
    retrievedAt: options.retrievedAt,
    workstreams: options.workstreams || [],
    groupKey: `release:${repository}@${release.tag_name}`,
    evidence: { tag: release.tag_name, prerelease: Boolean(release.prerelease), draft: Boolean(release.draft) }
  });
}

/** True for workflows that publish or deploy rather than test. */
export function isDeploymentWorkflow(name) {
  return /deploy|pages|publish|release/i.test(String(name || ""));
}

/**
 * Maps the latest completed workflow run for a repository.
 * Failures are always relevant; successful runs only count as deployments
 * when the workflow actually deploys.
 */
export function mapWorkflowRunRecord(repository, run, options) {
  if (!run?.id || run.status !== "completed") return null;
  const failed = run.conclusion === "failure" || run.conclusion === "timed_out";
  const deploy = isDeploymentWorkflow(run.name);
  if (!failed && !deploy) return null;
  if (failed && !options.includeWorkflowFailures) return null;

  const timestamp = run.updated_at || run.created_at;
  if (!timestamp) return null;
  const start = options.lookbackStart ? new Date(options.lookbackStart).getTime() : -Infinity;
  if (new Date(timestamp).getTime() < start) return null;

  const actor = run.actor?.login || "github-actions";
  return normalizeEvent({
    id: eventIds.workflowRun(repository, run.id, failed ? "failed" : "succeeded"),
    repository,
    timestamp,
    eventType: failed ? (deploy ? "deployment_failed" : "workflow_run_failed") : "deployment_succeeded",
    actor,
    actorRole: "system",
    automated: true,
    automationReason: "ci_workflow",
    title: `${run.name || "Workflow"} ${failed ? "failed" : "succeeded"}`,
    summary: run.display_title || "",
    url: run.html_url || `https://github.com/${repository}/actions/runs/${run.id}`,
    source: "github-rest-actions",
    retrievedAt: options.retrievedAt,
    workstreams: options.workstreams || [],
    groupKey: `workflow:${repository}@${run.id}`,
    evidence: { workflow: run.name, conclusion: run.conclusion, branch: run.head_branch, event: run.event }
  });
}

/**
 * Maps a public event from `GET /users/:user/events/public`.
 * Returns an array because PushEvent contains several commits.
 */
export function mapPublicEventRecord(event, options) {
  const repository = event?.repo?.name;
  const actor = event?.actor?.login || "unknown";
  const actorInfo = classifyActor(event?.actor || actor);
  const retrievedAt = options.retrievedAt;
  const workstreams = options.workstreams || [];

  if (!repository || !event?.created_at) return [];

  const base = {
    repository,
    actor,
    automated: actorInfo.automated,
    automationReason: actorInfo.reason,
    workstreams,
    retrievedAt,
    source: "github-public-events"
  };

  switch (event.type) {
    case "PushEvent": {
      const commits = Array.isArray(event.payload?.commits) ? event.payload.commits : [];

      // GitHub truncates PushEvent payloads in the public feed: there is often
      // no commit list at all. Rather than silently dropping the contribution,
      // emit a coarse push event for repositories whose detailed commits are
      // not collected elsewhere. It is labelled as truncated, never as a
      // specific change.
      if (commits.length === 0) {
        if (options.suppressCoarseEvents) return [];
        const ref = event.payload?.ref || "";
        const head = event.payload?.head || "";
        return [
          normalizeEvent({
            ...base,
            id: `github:push_event:${repository}@${event.id || `${event.created_at}-${head}`}`,
            timestamp: event.created_at,
            eventType: "commit_pushed",
            actorRole: "committer",
            title: `Pushed commits${ref ? ` to ${ref.replace("refs/heads/", "")}` : ""} in ${repository}`,
            summary: "GitHub's public event feed does not expose the commits in this push.",
            url: `https://github.com/${repository}/commits${head ? `/${head}` : ""}`,
            groupKey: `push-event:${repository}@${event.id || head || event.created_at}`,
            commitSha: null,
            evidence: { payloadTruncated: true, ref, head }
          })
        ];
      }

      return commits
        .filter((commit) => commit?.sha)
        .map((commit) => {
          const classification = classifyCommit({ message: commit.message, author: actor });
          const merge = classification.mergePullRequest ? parseMergeCommit(commit.message) : null;
          return normalizeEvent({
            ...base,
            id: eventIds.commit(repository, commit.sha),
            timestamp: event.created_at,
            eventType: "commit_pushed",
            actorRole: "committer",
            automated: classification.automated || actorInfo.automated,
            automationReason: classification.automationReason || actorInfo.reason,
            title: firstLine(commit.message),
            summary: compactText(commit.message),
            url: `https://github.com/${repository}/commit/${commit.sha}`,
            groupKey: merge ? `pr:${repository}#${merge.number}` : `commit:${repository}@${commit.sha}`,
            commitSha: commit.sha,
            mergeCommit: classification.mergeCommit,
            generatedData: classification.generatedData,
            evidence: {
              pushedBy: actor,
              authoredBy: commit.author?.name || "",
              authoredEmail: commit.author?.email || ""
            }
          });
        });
    }
    case "PullRequestEvent": {
      const pr = event.payload?.pull_request;
      const action = event.payload?.action;
      if (!pr?.number) return [];
      if (!pr.html_url && options.suppressCoarseEvents) return [];

      const truncated = !pr.html_url;
      const isAuthor = pr.user?.login ? actor === pr.user.login : true;
      const merged = Boolean(pr.merged_at);
      let eventType;
      if (action === "opened" || action === "reopened") eventType = "pull_request_opened";
      else if (action === "closed") eventType = merged ? "pull_request_merged" : "pull_request_closed";
      else return [];
      const role = eventType === "pull_request_merged" && !isAuthor ? "merger" : isAuthor ? "author" : "contributor";

      return [
        normalizeEvent({
          ...base,
          id: eventIds.pullRequest(repository, pr.number, eventType === "pull_request_merged" ? "merged" : action === "closed" ? "closed" : "opened"),
          timestamp: event.created_at,
          eventType,
          actorRole: role,
          title: pr.title || `Pull request #${pr.number} in ${repository}`,
          summary: compactText(pr.body),
          url: pr.html_url || `https://github.com/${repository}/pull/${pr.number}`,
          groupKey: `pr:${repository}#${pr.number}`,
          pullRequestNumber: pr.number,
          evidence: {
            number: pr.number,
            mergedAt: pr.merged_at || null,
            payloadTruncated: truncated,
            mergeStateUnknown: truncated && action === "closed"
          }
        })
      ];
    }
    case "PullRequestReviewEvent": {
      const review = event.payload?.review;
      const pr = event.payload?.pull_request;
      if (!review?.id || !pr?.number) return [];
      return [
        normalizeEvent({
          ...base,
          id: eventIds.review(repository, pr.number, review.id),
          timestamp: event.created_at,
          eventType: "pull_request_review",
          actor: review.user?.login || actor,
          actorRole: "reviewer",
          title: `${review.state === "approved" ? "Approved" : review.state === "changes_requested" ? "Requested changes on" : "Reviewed"} #${pr.number}: ${pr.title || ""}`.trim(),
          summary: compactText(review.body),
          url: review.html_url || pr.html_url,
          groupKey: `pr-review:${repository}#${pr.number}@${review.id}`,
          pullRequestNumber: pr.number,
          evidence: { reviewState: review.state || null }
        })
      ];
    }
    case "PullRequestReviewCommentEvent": {
      const comment = event.payload?.comment;
      const pr = event.payload?.pull_request;
      if (!comment?.id || !pr?.number) return [];
      return [
        normalizeEvent({
          ...base,
          id: `github:review_comment:${repository}@${comment.id}`,
          timestamp: event.created_at,
          eventType: "pull_request_review_comment",
          actor: comment.user?.login || actor,
          actorRole: "reviewer",
          title: firstLine(comment.body) || `Review comment on #${pr.number}`,
          summary: compactText(comment.body),
          url: comment.html_url || pr.html_url,
          groupKey: `pr-review-comment:${repository}@${comment.id}`,
          pullRequestNumber: pr.number,
          evidence: { path: comment.path || null }
        })
      ];
    }
    case "IssueCommentEvent": {
      const comment = event.payload?.comment;
      const issue = event.payload?.issue;
      if (!comment?.id) return [];
      return [
        normalizeEvent({
          ...base,
          id: eventIds.issueComment(repository, comment.id),
          timestamp: event.created_at,
          eventType: "issue_commented",
          actor: comment.user?.login || actor,
          actorRole: "commenter",
          title: firstLine(comment.body) || `Comment on #${issue?.number}`,
          summary: compactText(comment.body),
          url: comment.html_url,
          groupKey: `issue-comment:${repository}@${comment.id}`,
          evidence: { issueNumber: issue?.number || null, isPullRequest: Boolean(issue?.pull_request) }
        })
      ];
    }
    case "IssuesEvent": {
      const issue = event.payload?.issue;
      const action = event.payload?.action;
      if (!issue?.number || !issue?.html_url) return [];
      if (!["opened", "closed", "reopened"].includes(action)) return [];
      const eventType = action === "opened" ? "issue_opened" : action === "closed" ? "issue_closed" : "issue_opened";
      const isAuthor = actor === issue.user?.login;
      const titleAutomated = isAutomatedTitle(issue.title);
      return [
        normalizeEvent({
          ...base,
          id: eventIds.issue(repository, issue.number, eventType === "issue_closed" ? "closed" : "opened", event.created_at),
          timestamp: event.created_at,
          eventType,
          automated: base.automated || titleAutomated,
          automationReason: base.automationReason || (titleAutomated ? "generated_title" : null),
          actorRole: isAuthor ? "author" : "commenter",
          title: issue.title || `Issue #${issue.number}`,
          summary: compactText(issue.body),
          url: issue.html_url,
          groupKey: `issue:${repository}#${issue.number}`,
          evidence: { number: issue.number, action }
        })
      ];
    }
    case "ReleaseEvent": {
      const release = event.payload?.release;
      if (!release?.tag_name) return [];
      return [
        normalizeEvent({
          ...base,
          id: eventIds.release(repository, release.tag_name),
          timestamp: event.created_at,
          eventType: "release_published",
          actor: release.author?.login || actor,
          actorRole: "author",
          title: release.name || release.tag_name,
          summary: compactText(release.body),
          url: release.html_url || `https://github.com/${repository}/releases/tag/${release.tag_name}`,
          groupKey: `release:${repository}@${release.tag_name}`,
          evidence: { tag: release.tag_name }
        })
      ];
    }
    case "CreateEvent": {
      if (event.payload?.ref_type !== "repository") return [];
      return [
        normalizeEvent({
          ...base,
          id: eventIds.repositoryCreated(repository),
          timestamp: event.created_at,
          eventType: "repository_created",
          actorRole: "creator",
          title: `Created repository ${repository}`,
          summary: "",
          url: `https://github.com/${repository}`,
          groupKey: `repository:${repository}`
        })
      ];
    }
    default:
      // Watch, Fork, Delete, CommitComment, and public events have no reliable
      // work signal for this dashboard. They are intentionally ignored rather
      // than guessed at.
      return [];
  }
}

/** Maps a search/issues result (authored outside owned repositories). */
export function mapSearchIssueRecord(item, options) {
  if (!item?.html_url) return null;
  const repository = repositoryFromApiUrl(item.repository_url);
  if (!repository) return null;
  const actor = item.user?.login || "unknown";
  const actorInfo = classifyActor(item.user || actor);
  const titleAutomated = isAutomatedTitle(item.title);
  const isPullRequest = Boolean(item.pull_request);
  const merged = Boolean(item.pull_request?.merged_at);

  const eventType = isPullRequest
    ? merged
      ? "pull_request_merged"
      : item.state === "closed"
        ? "pull_request_closed"
        : "pull_request_opened"
    : item.state === "closed"
      ? "issue_closed"
      : "issue_opened";

  const timestamp = merged ? item.pull_request.merged_at : item.state === "closed" ? item.closed_at || item.updated_at : item.created_at;

  return normalizeEvent({
    id: isPullRequest
      ? eventIds.pullRequest(repository, item.number, merged ? "merged" : item.state === "closed" ? "closed" : "opened")
      : eventIds.issue(repository, item.number, item.state === "closed" ? "closed" : "opened", timestamp),
    repository,
    timestamp,
    eventType,
    actor,
    actorRole: "author",
    automated: actorInfo.automated || titleAutomated,
    automationReason: actorInfo.reason || (titleAutomated ? "generated_title" : null),
    title: item.title || `${isPullRequest ? "Pull request" : "Issue"} #${item.number}`,
    summary: compactText(item.body),
    url: item.html_url,
    source: options.source || "github-search",
    retrievedAt: options.retrievedAt,
    workstreams: options.workstreams || [],
    groupKey: isPullRequest ? `pr:${repository}#${item.number}` : `issue:${repository}#${item.number}`,
    pullRequestNumber: isPullRequest ? item.number : null,
    evidence: {
      external: !repository.startsWith(`${options.owner || "mgifford"}/`),
      state: item.state,
      comments: Number(item.comments || 0)
    }
  });
}

/** Maps a search/commits result (authored outside owned repositories). */
export function mapSearchCommitRecord(item, options) {
  const repository = item?.repository?.full_name;
  if (!repository || !item?.sha) return null;
  const message = item?.commit?.message || "";
  const author = item?.author?.login
    ? { login: item.author.login, type: item.author.type || "" }
    : { login: item?.commit?.author?.email || item?.commit?.author?.name || "unknown", type: "" };
  const classification = classifyCommit({ message, author });
  const timestamp = item?.commit?.committer?.date || item?.commit?.author?.date;
  if (!timestamp) return null;
  const merge = classification.mergePullRequest ? parseMergeCommit(message) : null;

  return normalizeEvent({
    id: eventIds.commit(repository, item.sha),
    repository,
    timestamp,
    eventType: "commit_pushed",
    actor: author.login,
    actorRole: "author",
    automated: classification.automated,
    automationReason: classification.automationReason,
    title: firstLine(message),
    summary: compactText(message),
    url: `https://github.com/${repository}/commit/${item.sha}`,
    source: options.source || "github-search-commits",
    retrievedAt: options.retrievedAt,
    workstreams: options.workstreams || [],
    groupKey: merge ? `pr:${repository}#${merge.number}` : `commit:${repository}@${item.sha}`,
    commitSha: item.sha,
    mergeCommit: classification.mergeCommit,
    evidence: { external: !repository.startsWith(`${options.owner || "mgifford"}/`) }
  });
}

/**
 * Builds `repository -> [workstreamId]` from configuration.
 * A project can belong to several workstreams.
 */
export function buildRepositoryWorkstreams(workstreamsConfig) {
  const map = new Map();
  for (const workstream of workstreamsConfig?.workstreams || []) {
    if (!workstream?.id) continue;
    for (const repo of workstream.repositories || []) {
      if (!map.has(repo)) map.set(repo, []);
      if (!map.get(repo).includes(workstream.id)) map.get(repo).push(workstream.id);
    }
  }
  return map;
}

/** Returns the workstream ids for a repository, if configured. */
export function workstreamsFor(repository, repositoryWorkstreams) {
  return repositoryWorkstreams?.get?.(repository) || [];
}

/**
 * Chooses which repositories get detailed activity collection.
 *
 * Priority order: manually featured/pinned, then most recent push, then open
 * work. Archived repositories and forks are skipped by default because their
 * activity rarely answers "what changed this week".
 */
export function selectCandidates(repos, options = {}) {
  const {
    lookbackStart,
    maxRepositories = 120,
    includeForks = false,
    includeArchived = false,
    priorityNames = new Set()
  } = options;
  const startMs = lookbackStart ? new Date(lookbackStart).getTime() : -Infinity;
  const eligible = [];
  const skipped = { archived: 0, fork: 0, outOfWindow: 0 };

  for (const repo of repos || []) {
    const fullName = repo.fullName || repo.full_name;
    if (!fullName) continue;
    if (repo.archived && !includeArchived) {
      skipped.archived += 1;
      continue;
    }
    if (repo.fork && !includeForks) {
      skipped.fork += 1;
      continue;
    }

    const reasons = [];
    const pushedMs = repo.pushedAt ? new Date(repo.pushedAt).getTime() : NaN;
    const updatedMs = repo.updatedAt ? new Date(repo.updatedAt).getTime() : NaN;
    if (Number.isFinite(pushedMs) && pushedMs >= startMs) reasons.push("recent push");
    if (Number.isFinite(updatedMs) && updatedMs >= startMs) reasons.push("recent metadata update");
    if (priorityNames.has(fullName) || priorityNames.has(repo.name)) reasons.push("curated or pinned");
    if (Number(repo.openIssues || 0) > 0) reasons.push("open work");

    if (!reasons.length) {
      skipped.outOfWindow += 1;
      continue;
    }

    eligible.push({
      fullName,
      name: repo.name,
      url: repo.url || `https://github.com/${fullName}`,
      pushedAt: repo.pushedAt || null,
      updatedAt: repo.updatedAt || null,
      openIssues: Number(repo.openIssues || 0),
      defaultBranch: repo.defaultBranch || "main",
      reasons,
      priority: priorityNames.has(fullName) || priorityNames.has(repo.name) ? 1 : 0
    });
  }

  eligible.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    const aTime = a.pushedAt || a.updatedAt || "";
    const bTime = b.pushedAt || b.updatedAt || "";
    return bTime.localeCompare(aTime) || a.fullName.localeCompare(b.fullName);
  });

  return {
    candidates: eligible.slice(0, maxRepositories),
    skipped,
    considered: eligible.length,
    capped: Math.max(0, eligible.length - maxRepositories)
  };
}

/**
 * Emits repository-administration events by diffing committed repository
 * snapshots. This is what stops ordinary metadata changes from being silently
 * discarded between weekly runs.
 *
 * Timestamps use the repository's `updatedAt` with `timestampPrecision:
 * "observed-at"`, because GitHub does not expose when a description changed.
 */
export function buildSnapshotMetadataEvents(previousRepos, currentRepos, options = {}) {
  const { retrievedAt, repositoryWorkstreams, owner = "mgifford" } = options;
  const previousByName = new Map((previousRepos || []).map((repo) => [repo.fullName, repo]));
  const events = [];

  for (const repo of currentRepos || []) {
    const fullName = repo.fullName;
    if (!fullName || !repo.updatedAt) continue;
    const previous = previousByName.get(fullName);

    if (!previous) {
      if (repo.createdAt && new Date(repo.createdAt).getTime() >= new Date(options.lookbackStart || 0).getTime()) {
        events.push(
          normalizeEvent({
            id: eventIds.repositoryCreated(fullName),
            repository: fullName,
            timestamp: repo.createdAt,
            eventType: "repository_created",
            actor: owner,
            actorRole: "creator",
            automated: false,
            title: `Created repository ${repo.name || fullName}`,
            summary: repo.description || "",
            url: repo.url || `https://github.com/${fullName}`,
            source: "github-repository-snapshot",
            retrievedAt,
            workstreams: workstreamsFor(fullName, repositoryWorkstreams),
            groupKey: `repository:${fullName}`
          })
        );
      }
      continue;
    }

    const changed = describeSnapshotChanges(previous, repo);
    if (!changed.length) continue;

    // A push already explains activity for this period; metadata changes are
    // still recorded but grouped separately so they cannot inflate code work.
    events.push(
      normalizeEvent({
        id: eventIds.repositorySnapshot(fullName, repo.updatedAt),
        repository: fullName,
        timestamp: repo.updatedAt,
        eventType: "repository_metadata_updated",
        actor: "github",
        actorRole: "system",
        automated: false,
        title: changed.join("; "),
        summary: "Repository metadata changed. This is repository administration, not a code or content change.",
        url: repo.url || `https://github.com/${fullName}`,
        source: "github-repository-snapshot",
        retrievedAt,
        workstreams: workstreamsFor(fullName, repositoryWorkstreams),
        groupKey: `repository-metadata:${fullName}@${repo.updatedAt}`,
        timestampPrecision: "observed-at",
        derived: true,
        evidence: { changes: changed, pushedAt: repo.pushedAt || null }
      })
    );
  }

  return events;
}

/**
 * Builds metadata events from the repository sync change log.
 *
 * `changes.json` is written by sync-repos.mjs during the same workflow run and
 * records which repositories changed, so metadata-only edits survive even
 * when there is no push. Entries where `pushedAt` advanced are still recorded
 * when a concrete metadata change was observed, but generic "something
 * changed" entries are suppressed because the push already explains activity.
 */
export function buildMetadataEventsFromChangeLog(changeLog, options = {}) {
  const { retrievedAt, repositoryWorkstreams, owner = "mgifford", lookbackStart, currentRepos = [] } = options;
  const startMs = lookbackStart ? new Date(lookbackStart).getTime() : -Infinity;
  const currentByName = new Map(currentRepos.map((repo) => [repo.fullName, repo]));
  const events = [];

  for (const entry of changeLog?.updated || []) {
    if (!entry?.fullName) continue;
    const current = currentByName.get(entry.fullName);
    const updatedAt = current?.updatedAt || entry.updatedAt;
    if (!updatedAt) continue;
    const time = new Date(updatedAt).getTime();
    if (!Number.isFinite(time) || time < startMs) continue;

    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    const metadataOnly = (entry.previousPushedAt || null) === (entry.pushedAt || null);
    if (!metadataOnly && changes.length === 0) continue;

    events.push(
      normalizeEvent({
        id: eventIds.repositorySnapshot(entry.fullName, updatedAt),
        repository: entry.fullName,
        timestamp: updatedAt,
        eventType: "repository_metadata_updated",
        actor: "github",
        actorRole: "system",
        automated: false,
        title: changes.length ? changes.join("; ") : "Repository metadata updated",
        summary:
          "Repository metadata changed. This is repository administration, not a code or content change.",
        url: current?.url || `https://github.com/${entry.fullName}`,
        source: "github-repository-snapshot",
        retrievedAt,
        workstreams: workstreamsFor(entry.fullName, repositoryWorkstreams),
        groupKey: `repository-metadata:${entry.fullName}@${updatedAt}`,
        timestampPrecision: "observed-at",
        derived: true,
        evidence: {
          changes,
          previousUpdatedAt: entry.previousUpdatedAt || null,
          previousPushedAt: entry.previousPushedAt || null,
          pushedAt: entry.pushedAt || null
        }
      })
    );
  }

  for (const fullName of changeLog?.added || []) {
    const current = currentByName.get(fullName);
    if (!current) continue;
    const createdAt = current.createdAt || current.updatedAt;
    const time = new Date(createdAt).getTime();
    if (!Number.isFinite(time) || time < startMs) continue;
    events.push(
      normalizeEvent({
        id: eventIds.repositoryCreated(fullName),
        repository: fullName,
        timestamp: createdAt,
        eventType: "repository_created",
        actor: owner,
        actorRole: "creator",
        automated: false,
        title: `Created repository ${current.name || fullName}`,
        summary: current.description || "",
        url: current.url || `https://github.com/${fullName}`,
        source: "github-repository-snapshot",
        retrievedAt,
        workstreams: workstreamsFor(fullName, repositoryWorkstreams),
        groupKey: `repository:${fullName}`
      })
    );
  }

  return events;
}

/** Human-readable list of observable metadata changes. */
export function describeSnapshotChanges(previous, current) {
  if (!previous) return [];
  const changes = [];

  if (Boolean(previous.archived) !== Boolean(current.archived)) {
    changes.push(current.archived ? "Repository archived" : "Repository unarchived");
  }
  if ((previous.description || "") !== (current.description || "")) changes.push("Description changed");
  if ((previous.homepage || "") !== (current.homepage || "")) changes.push("Homepage changed");
  if ((previous.defaultBranch || "") !== (current.defaultBranch || "")) changes.push("Default branch changed");
  if ((previous.visibility || "public") !== (current.visibility || "public")) changes.push("Visibility changed");
  const previousTopics = [...(previous.topics || [])].sort().join(",");
  const currentTopics = [...(current.topics || [])].sort().join(",");
  if (previousTopics !== currentTopics) changes.push("Topics changed");
  if (Boolean(previous.hasPages) !== Boolean(current.hasPages)) changes.push("GitHub Pages availability changed");

  return changes;
}

/**
 * Merges previous and freshly collected events, keeps the lookback window,
 * and caps total volume. Fresh events are kept first so detailed REST
 * evidence wins over coarser public-event evidence for the same id.
 */
export function mergeAndPruneEvents(previousEvents, newEvents, options = {}) {
  const { lookbackStart, maxEvents = 4000 } = options;
  const startMs = lookbackStart ? new Date(lookbackStart).getTime() : -Infinity;
  const merged = [];
  const seen = new Set();

  for (const event of [...(newEvents || []), ...(previousEvents || [])]) {
    if (!event?.id || seen.has(event.id)) continue;
    const time = new Date(event.timestamp).getTime();
    if (!Number.isFinite(time) || time < startMs) continue;
    seen.add(event.id);
    merged.push(event);
  }

  merged.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const pruned = merged.slice(0, maxEvents);

  return {
    events: pruned,
    droppedByCap: Math.max(0, merged.length - pruned.length),
    droppedOutOfWindow: Math.max(0, (newEvents?.length || 0) + (previousEvents?.length || 0) - merged.length)
  };
}

/**
 * Builds the machine-readable coverage record that every view must disclose.
 */
export function buildCoverage({ generatedAt, lookbackDays, windowStart, windowEnd, timezone, scope, sources, limitations, budget, stats }) {
  return {
    generatedAt,
    timezone,
    lookbackDays,
    window: { start: windowStart, end: windowEnd },
    scope,
    sources,
    limitations,
    requests: {
      budgetMax: budget?.maxRequests ?? null,
      used: budget?.used ?? null,
      exhausted: Boolean(budget?.exhausted),
      budgetReason: budget?.reason ?? null,
      ...stats
    }
  };
}
