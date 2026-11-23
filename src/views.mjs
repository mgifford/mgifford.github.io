/**
 * View renderers shared by the static build and the browser enhancement.
 *
 * Keeping one implementation guarantees that the no-JavaScript HTML and the
 * interactive view show the same evidence, headings, and disclosures.
 */

import { slugify } from "./activity.mjs";
import {
  groupContributionsByRepository,
  groupContributionsByType,
  getOpenWork,
  getProjectActivity,
  getProjectContinuity,
  getRecentlyActiveProjects,
  getUserContributions,
  getWorkstreamActivity,
  summarizeWorkstreams
} from "./queries.mjs";
import {
  escapeHtml,
  externalLink,
  labelForRole,
  renderActivityByDay,
  renderContributions,
  renderCoverage,
  renderEmptyState,
  renderProjectTable,
  renderRangeSummary,
  renderTypeCountTable,
  renderWorkstreamCards
} from "./render.mjs";
import { formatLocalDateTime } from "./time.mjs";

function repositoryAnchor(repository) {
  return `repo-${slugify(repository)}`;
}

function openWorkBlock(openWork) {
  const criteria = (openWork?.criteria || []).filter((criterion) => criterion.count > 0);
  if (!criteria.length) return '<p class="muted">No open-work signals recorded for this project in the collected data.</p>';
  return `<div class="open-work">
  <h3>Open work signals</h3>
  <dl>${criteria
    .map((criterion) => `<dt>${escapeHtml(criterion.label)}: ${criterion.count}</dt><dd>${escapeHtml(criterion.basis)}</dd>`)
    .join("")}</dl>
</div>`;
}

/**
 * Recent Activity view.
 *
 * @param {{events:object[], repositoryIndex:object[], coverage:object, range:object, timeZone:string, projectLimit?:number}} input
 */
export function renderActivityView(input) {
  const {
    events,
    repositoryIndex = [],
    coverage,
    range,
    timeZone,
    projectLimit = 10,
    timelineLimit = 120
  } = input;
  const indexByRepo = new Map(repositoryIndex.map((row) => [row.repository, row]));
  const projects = getRecentlyActiveProjects(events, range);
  const visible = events
    .filter((event) => {
      const time = new Date(event.timestamp).getTime();
      return time >= range.startMs && time <= range.endMs;
    })
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const timelineEvents = visible.slice(0, timelineLimit);
  const merged = visible.filter((event) => event.eventType === "pull_request_merged");
  const releases = visible.filter((event) => event.eventType === "release_published");
  const human = visible.filter((event) => !event.automated).length;
  const automated = visible.length - human;

  const timelines = projects.slice(0, projectLimit).map((project) => {
    const timeline = getProjectActivity(events, project.repository, range, { timeZone });
    const indexRow = indexByRepo.get(project.repository) || { repository: project.repository };
    const continuity = getProjectContinuity(events, indexRow, { range, timeZone });
    const anchor = repositoryAnchor(project.repository);
    const shown = timeline.events.slice(0, 10);
    return `<section class="project-timeline" id="${escapeHtml(anchor)}" aria-labelledby="${escapeHtml(`${anchor}-heading`)}">
  <h2 id="${escapeHtml(`${anchor}-heading`)}">${externalLink(project.repositoryUrl || `https://github.com/${project.repository}`, project.repository)}</h2>
  <p class="muted">${project.humanEventCount} human events · ${project.automatedEventCount} automated · last human activity ${
    project.lastHumanActivityAt ? escapeHtml(formatLocalDateTime(project.lastHumanActivityAt, timeZone)) : "not recorded"
  }</p>
  ${openWorkBlock(getOpenWork(indexByRepo.get(project.repository)))}
  <div class="continuity">
    <h3>Where you left off</h3>
    ${
      continuity.lastHumanActivity
        ? `<p>Last human activity: ${externalLink(continuity.lastHumanActivity.url, continuity.lastHumanActivity.title || continuity.lastHumanActivity.eventType)} <span class="muted">(${escapeHtml(formatLocalDateTime(continuity.lastHumanActivity.timestamp, timeZone))}, ${escapeHtml(continuity.lastHumanActivity.actor)})</span></p>`
        : '<p class="muted">No human activity recorded in this range.</p>'
    }
    ${
      continuity.nextAction.text
        ? `<p><strong>Recorded next action:</strong> ${externalLink(continuity.nextAction.source, continuity.nextAction.text)}</p>`
        : `<p class="muted">${escapeHtml(continuity.nextAction.basis)}</p>`
    }
  </div>
  ${renderActivityByDay(shown, {
    timeZone,
    showRepository: false,
    headingLevel: 3,
    idPrefix: `${anchor}-day`,
    emptyMessage: "No activity recorded for this project in the selected range."
  })}
  ${timeline.events.length > shown.length ? `<p class="muted">Showing the ${shown.length} most recent of ${timeline.events.length} collected events for this project.</p>` : ""}
</section>`;
  });

  return `<section class="atlas-section" aria-labelledby="range-summary-heading">
  <h2 id="range-summary-heading">Date range</h2>
  ${renderRangeSummary(range)}
  <p class="muted">Repository <code>updatedAt</code> timestamps are never used as activity timestamps. Metadata-only changes appear as events marked &ldquo;Observed date&rdquo;, because GitHub does not expose the exact edit time.</p>
</section>
<section class="atlas-section" aria-labelledby="activity-summary-heading">
  <h2 id="activity-summary-heading">What changed</h2>
  <p><strong>${human}</strong> human events and <strong>${automated}</strong> automated events across <strong>${projects.length}</strong> projects. ${merged.length} pull requests merged; ${releases.length} releases published.</p>
  <p class="muted">Automated activity is reported separately and never counted as personal work.</p>
</section>
<section class="atlas-section" aria-labelledby="projects-active-heading">
  <h2 id="projects-active-heading">Projects updated in this range</h2>
  <p class="muted">Sorted by most recent activity. "Latest evidence" links to the original GitHub commit, pull request, issue, or release.</p>
  ${renderProjectTable(projects, { timeZone })}
</section>
<section class="atlas-section" aria-labelledby="timeline-heading">
  <h2 id="timeline-heading">Activity by date</h2>
  <p class="muted">All collected events in the resolved range, including automation. Use "Exclude routine automation" to filter.</p>
  ${renderActivityByDay(timelineEvents, {
    timeZone,
    showRepository: true,
    headingLevel: 3,
    idPrefix: "activity-day",
    emptyMessage: "No activity was recorded in this range.",
    emptyHint: "Try a wider date range. An empty result does not prove that nothing happened; see the coverage notes below."
  })}
  ${visible.length > timelineEvents.length ? `<p class="muted">Showing the ${timelineEvents.length} most recent of ${visible.length} events. Narrow the date range, workstream, or activity type to see more, or open a project timeline below.</p>` : ""}
</section>
<section class="atlas-section" aria-labelledby="project-timelines-heading">
  <h2 id="project-timelines-heading">Project timelines</h2>
  <p class="muted">The ${Math.min(projectLimit, projects.length)} most recently active projects, with open-work signals and direct evidence links.</p>
  ${
    timelines.length
      ? timelines.join("\n")
      : renderEmptyState("No project timelines are available for this range.")
  }
</section>
${renderCoverage(coverage)}`;
}

/**
 * My Contributions view.
 *
 * @param {{events:object[], coverage:object, range:object, timeZone:string, identity:{login:string, aliases?:string[]}}} input
 */
export function renderContributionsView(input) {
  const { events, coverage, range, timeZone, identity, limit = 150 } = input;
  const contributions = getUserContributions(events, identity.login, range, { aliases: identity.aliases || [] });
  const visibleContributions = contributions.slice(0, limit);
  const byRepository = groupContributionsByRepository(contributions);
  const byType = groupContributionsByType(contributions);
  const roles = [...new Set(contributions.map((contribution) => contribution.actorRole))].sort();

  const repoRows = byRepository
    .map(
      (group) => `      <tr>
        <th scope="row">${externalLink(`https://github.com/${group.repository}`, group.repository)}</th>
        <td>${group.count}</td>
        <td>${escapeHtml(group.roles.map((role) => labelForRole(role)).join(", "))}</td>
        <td>${escapeHtml(formatLocalDateTime(group.lastAt, timeZone))}</td>
      </tr>`
    )
    .join("\n");

  return `<section class="atlas-section" aria-labelledby="range-heading">
  <h2 id="range-heading">Date range</h2>
  ${renderRangeSummary(range)}
</section>
<section class="atlas-section" aria-labelledby="identity-heading">
  <h2 id="identity-heading">What counts as my contribution</h2>
  <p>Only events whose actor is <strong>${escapeHtml(identity.login)}</strong> (or a configured commit identity) are counted. Activity by other people in repositories you maintain is excluded. Authored, reviewed, commented, merged, and committed work are labelled separately.</p>
  <p class="muted">Configured identities: ${(identity.aliases || []).map((alias) => escapeHtml(alias)).join(", ") || "none"}. Only public activity is collected; private work is never included.</p>
</section>
<section class="atlas-section" aria-labelledby="contribution-summary-heading">
  <h2 id="contribution-summary-heading">Summary</h2>
  <p><strong>${contributions.length}</strong> attributable contributions across <strong>${byRepository.length}</strong> repositories and <strong>${byType.length}</strong> contribution types. Roles represented: ${escapeHtml(roles.map((role) => labelForRole(role)).join(", ") || "none")}.</p>
  <div class="two-column">
    ${renderTypeCountTable(Object.fromEntries(byType.map((group) => [group.eventType, group.count])), {
      caption: "Attributable contributions by type."
    })}
    <div class="table-wrap">
      <table class="data-table data-table--compact">
        <caption>Attributable contributions by repository.</caption>
        <thead><tr><th scope="col">Repository</th><th scope="col">Count</th><th scope="col">Roles</th><th scope="col">Most recent</th></tr></thead>
        <tbody>
${repoRows || '          <tr><td colspan="4">No contributions recorded.</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>
</section>
<section class="atlas-section" aria-labelledby="contribution-timeline-heading">
  <h2 id="contribution-timeline-heading">Contributions by date</h2>
  ${renderContributions(visibleContributions, { timeZone })}
  ${contributions.length > visibleContributions.length ? `<p class="muted">Showing the ${visibleContributions.length} most recent of ${contributions.length} contributions. Narrow the date range or activity type to see more.</p>` : ""}
</section>
${renderCoverage(coverage)}`;
}

/**
 * Workstreams view.
 *
 * @param {{events:object[], repositoryIndex:object[], coverage:object, range:object, timeZone:string, config:object}} input
 */
export function renderWorkstreamsView(input) {
  const { events, repositoryIndex = [], coverage, range, timeZone, config } = input;
  const summaries = summarizeWorkstreams(events, config, { repositoryIndex, range });
  const repositoryWorkstreams = new Map();
  for (const workstream of config.workstreams || []) {
    for (const repository of workstream.repositories || []) {
      if (!repositoryWorkstreams.has(repository)) repositoryWorkstreams.set(repository, []);
      repositoryWorkstreams.get(repository).push(workstream.id);
    }
  }

  const sections = summaries
    .map((workstream) => {
      const scoped = getWorkstreamActivity(events, workstream.id, range, { repositoryWorkstreams, timeZone });
      const shown = scoped.events.slice(0, 8);
      return `<section class="atlas-section workstream-section" id="workstream-${escapeHtml(workstream.id)}" aria-labelledby="workstream-${escapeHtml(workstream.id)}-heading">
  <h2 id="workstream-${escapeHtml(workstream.id)}-heading">${escapeHtml(workstream.name)}</h2>
  <p>${escapeHtml(workstream.description || "")}</p>
  <p class="muted">${scoped.summary.human} human events across ${workstream.activeRepositories.length} active projects in this range. ${workstream.repositories.length} configured repositories.</p>
  ${
    workstream.repositories.length
      ? `<p class="workstream-repos"><strong>Configured projects:</strong> ${workstream.repositories
          .map((repository) => externalLink(`https://github.com/${repository}`, repository))
          .join(" · ")}</p>`
      : ""
  }
  ${renderActivityByDay(shown, {
    timeZone,
    showRepository: true,
    headingLevel: 3,
    idPrefix: `workstream-${workstream.id}-day`,
    emptyMessage: "No activity in this workstream in the selected range."
  })}
  ${scoped.events.length > shown.length ? `<p class="muted">Showing the ${shown.length} most recent of ${scoped.events.length} collected events in this workstream.</p>` : ""}
</section>`;
    })
    .join("\n");

  return `<section class="atlas-section" aria-labelledby="workstreams-heading">
  <h2 id="workstreams-heading">Workstreams</h2>
  <p>Workstreams group related repositories under a research or development area. A project can belong to more than one workstream. Membership is configured explicitly in <code>data/workstreams.yml</code>; it is not inferred from repository topics.</p>
  ${renderWorkstreamCards(summaries, { timeZone })}
</section>
${sections}
${renderCoverage(coverage)}`;
}
