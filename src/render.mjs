/**
 * Shared HTML renderers for the activity views.
 *
 * The same functions run at build time (static HTML, no JavaScript required)
 * and in the browser (progressive filtering). They return strings and are
 * dependency-free.
 *
 * Accessibility rules applied here:
 * - semantic lists, tables with captions and scoped headers
 * - no colour-only status: every state has a text label
 * - links have descriptive text plus a visually hidden new-tab note
 * - empty states are announced in text
 */

import { CATEGORIES, ACTOR_ROLES, OUTCOMES, EVENT_TYPES, repositoryAnchor } from "./activity.mjs";
import { formatLocalDateTime, formatLocalTime, formatShortDate, groupByZonedDay } from "./time.mjs";

const HTML_ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
};

/** Escapes text for safe HTML interpolation. */
export function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}

/** Escapes a value for an HTML attribute. */
export function escapeAttribute(value) {
  return escapeHtml(value);
}

export function labelForEventType(eventType) {
  return EVENT_TYPES[eventType]?.label || eventType;
}

export function labelForCategory(category) {
  return CATEGORIES[category]?.label || category;
}

export function labelForRole(role) {
  return ACTOR_ROLES[role] || role;
}

export function labelForOutcome(outcome) {
  return OUTCOMES[outcome] || outcome;
}

/** Human summary of a repository full name. */
export function repoLabel(repository) {
  return repository || "Unknown repository";
}

function newTabNote() {
  return '<span class="visually-hidden"> (opens in a new tab)</span>';
}

/**
 * A single external evidence link.
 * @param {string} url
 * @param {string} text
 * @param {{className?:string}} [options]
 */
export function externalLink(url, text, options = {}) {
  if (!url) return escapeHtml(text || "");
  const className = options.className ? ` class="${escapeAttribute(options.className)}"` : "";
  return `<a${className} href="${escapeAttribute(url)}" target="_blank" rel="noreferrer noopener">${escapeHtml(text)}${newTabNote()}</a>`;
}

/** Small text badges describing an event's state without relying on colour. */
export function renderEventBadges(event) {
  const badges = [];
  badges.push(`<span class="badge">${escapeHtml(labelForEventType(event.eventType))}</span>`);
  if (event.automated) badges.push('<span class="badge badge--automated">Automated</span>');
  if (event.outcome === "completed") badges.push('<span class="badge badge--completed">Completed</span>');
  if (event.outcome === "in_progress") badges.push('<span class="badge badge--progress">In progress</span>');
  if (event.outcome === "discussion") badges.push('<span class="badge badge--discussion">Discussion</span>');
  if (event.substantive === null && !event.automated) {
    badges.push('<span class="badge badge--uncertain">Uncertain attribution</span>');
  }
  if (event.timestampPrecision === "observed-at") {
    badges.push('<span class="badge badge--uncertain">Observed date</span>');
  }
  return badges.join(" ");
}

/**
 * One activity item as a list item.
 *
 * @param {object} event
 * @param {{timeZone:string, showRepository?:boolean}} options
 */
export function renderActivityItem(event, options) {
  const { timeZone, showRepository = true } = options;
  const time = `<time datetime="${escapeAttribute(event.timestamp)}">${escapeHtml(formatLocalTime(event.timestamp, timeZone))}</time>`;
  const title = event.title || labelForEventType(event.eventType);
  const link = externalLink(event.url, title, { className: "activity-item__link" });
  const context = [];
  if (showRepository) {
    context.push(externalLink(`https://github.com/${event.repository}`, repoLabel(event.repository)));
  }
  context.push(`${escapeHtml(event.actor)} <span class="muted">(${escapeHtml(labelForRole(event.actorRole))})</span>`);
  context.push(escapeHtml(labelForCategory(event.category)));

  const summary = event.summary
    ? `<p class="activity-item__summary">${escapeHtml(event.summary)}</p>`
    : "";

  return `<li class="activity-item${event.automated ? " activity-item--automated" : ""}">
  <p class="activity-item__meta">${time} ${renderEventBadges(event)}</p>
  <p class="activity-item__title">${link}</p>
  <p class="activity-item__context">${context.join(" · ")}</p>${summary ? `\n  ${summary}` : ""}
</li>`;
}

/**
 * Activity grouped by local calendar day.
 *
 * @param {object[]} events
 * @param {{timeZone:string, showRepository?:boolean, emptyMessage?:string, headingLevel?:number}} options
 */
export function renderActivityByDay(events, options) {
  const {
    timeZone,
    showRepository = true,
    emptyMessage = "No activity recorded for this period.",
    emptyHint = "",
    headingLevel = 3,
    idPrefix = "day"
  } = options;
  if (!events?.length) {
    return renderEmptyState(emptyMessage, emptyHint);
  }

  const groups = groupByZonedDay(events, timeZone);
  const level = Math.min(Math.max(headingLevel, 2), 6);

  return groups
    .map((group) => {
      const headingId = `${idPrefix}-${group.dateKey}`;
      const count = group.records.length;
      return `<section class="activity-day" aria-labelledby="${escapeAttribute(headingId)}">
  <h${level} class="day-heading" id="${escapeAttribute(headingId)}">${escapeHtml(group.weekday)}, ${escapeHtml(group.dateLabel)} <span class="muted">(${count} ${count === 1 ? "item" : "items"})</span></h${level}>
  <ol class="activity-list">
${group.records.map((event) => `    ${renderActivityItem(event, { timeZone, showRepository })}`).join("\n")}
  </ol>
</section>`;
    })
    .join("\n");
}

/** Accessible empty state. */
export function renderEmptyState(message, hint = "") {
  return `<div class="empty-state">
  <p><strong>${escapeHtml(message)}</strong></p>${hint ? `\n  <p class="muted">${escapeHtml(hint)}</p>` : ""}
</div>`;
}

/**
 * Table of recently active projects.
 *
 * @param {object[]} projects rows from getRecentlyActiveProjects
 * @param {{timeZone:string}} options
 */
export function renderProjectTable(projects, options) {
  const { timeZone } = options;
  if (!projects?.length) {
    return renderEmptyState("No projects had recorded activity in this period.");
  }

  const rows = projects
    .map((project) => {
      const latest = project.latest
        ? `${externalLink(project.latest.url, project.latest.title || labelForEventType(project.latest.eventType))} <span class="muted">(${escapeHtml(labelForEventType(project.latest.eventType))})</span>`
        : "No evidence recorded";
      const latestTime = project.lastActivityAt
        ? `<time datetime="${escapeAttribute(project.lastActivityAt)}">${escapeHtml(formatLocalDateTime(project.lastActivityAt, timeZone))}</time>`
        : "Unknown";
      const humanTime = project.lastHumanActivityAt
        ? `<time datetime="${escapeAttribute(project.lastHumanActivityAt)}">${escapeHtml(formatShortDate(project.lastHumanActivityAt, timeZone))}</time>`
        : 'No human activity <span class="muted">(automation only)</span>';
      return `      <tr>
        <th scope="row"><a href="#${escapeAttribute(repositoryAnchor(project.repository))}">${escapeHtml(project.repository)}</a></th>
        <td>${latestTime}</td>
        <td>${latest}</td>
        <td>${humanTime}</td>
        <td>${project.humanEventCount} human / ${project.eventCount} total</td>
      </tr>`;
    })
    .join("\n");

  return `<div class="table-wrap">
  <table class="data-table">
    <caption>Projects with recorded activity, most recent first. Times shown in the configured reporting time zone.</caption>
    <thead>
      <tr>
        <th scope="col">Project</th>
        <th scope="col">Latest activity</th>
        <th scope="col">Latest evidence</th>
        <th scope="col">Last human activity</th>
        <th scope="col">Event count</th>
      </tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>
</div>`;
}

/** Table summarizing contributions by event type. */
export function renderTypeCountTable(counts, options = {}) {
  const entries = Object.entries(counts || {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return renderEmptyState("No contributions recorded for this period.");
  const caption = options.caption || "Contribution types in this period.";
  return `<div class="table-wrap">
  <table class="data-table data-table--compact">
    <caption>${escapeHtml(caption)}</caption>
    <thead><tr><th scope="col">Contribution type</th><th scope="col">Count</th></tr></thead>
    <tbody>
${entries
  .map(
    ([type, count]) =>
      `      <tr><th scope="row">${escapeHtml(/^[a-z_]+$/.test(type) ? labelForEventType(type) : type)}</th><td>${count}</td></tr>`
  )
  .join("\n")}
    </tbody>
  </table>
</div>`;
}

/**
 * Contribution timeline grouped by day, then repository.
 *
 * @param {object[]} contributions
 * @param {{timeZone:string, emptyMessage?:string}} options
 */
export function renderContributions(contributions, options) {
  const { timeZone, emptyMessage = "No public contributions by this account were recorded for this period." } = options;
  if (!contributions?.length) {
    return renderEmptyState(emptyMessage, "Only public activity is collected. Private work is never included.");
  }

  const days = groupByZonedDay(contributions, timeZone);
  return days
    .map((day) => {
      const byRepo = new Map();
      for (const contribution of day.records) {
        if (!byRepo.has(contribution.repository)) byRepo.set(contribution.repository, []);
        byRepo.get(contribution.repository).push(contribution);
      }

      const repoBlocks = [...byRepo.entries()]
        .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
        .map(
          ([repository, items]) => `<section class="contribution-repo" aria-labelledby="contrib-${escapeAttribute(day.dateKey)}-${escapeAttribute(repository.replace(/[^a-z0-9]+/gi, "-"))}">
  <h4 id="contrib-${escapeAttribute(day.dateKey)}-${escapeAttribute(repository.replace(/[^a-z0-9]+/gi, "-"))}">${externalLink(`https://github.com/${repository}`, repository)} <span class="muted">(${items.length})</span></h4>
  <ul class="activity-list">
${items.map((event) => `    ${renderActivityItem(event, { timeZone, showRepository: false })}`).join("\n")}
  </ul>
</section>`
        )
        .join("\n");

      return `<section class="activity-day" aria-labelledby="contrib-day-${escapeAttribute(day.dateKey)}">
  <h3 id="contrib-day-${escapeAttribute(day.dateKey)}">${escapeHtml(day.weekday)}, ${escapeHtml(day.dateLabel)}</h3>
${repoBlocks}
</section>`;
    })
    .join("\n");
}

/**
 * Workstream summary cards with links to their static sections.
 *
 * @param {object[]} workstreams
 * @param {{timeZone:string}} options
 */
export function renderWorkstreamCards(workstreams, options) {
  const { timeZone } = options;
  if (!workstreams?.length) return renderEmptyState("No workstreams are configured.");

  return `<ul class="workstream-grid">
${workstreams
  .map(
    (workstream) => `  <li class="workstream-card" id="${escapeAttribute(workstream.id)}">
    <h3><a href="#workstream-${escapeAttribute(workstream.id)}">${escapeHtml(workstream.name)}</a></h3>
    <p>${escapeHtml(workstream.description || "")}</p>
    <p class="workstream-card__stats"><strong>${workstream.humanEventCount}</strong> human events in the lookback window · <strong>${workstream.activeRepositories.length}</strong> active ${workstream.activeRepositories.length === 1 ? "project" : "projects"}</p>
    <p class="muted">Last activity: ${workstream.lastActivityAt ? escapeHtml(formatLocalDateTime(workstream.lastActivityAt, timeZone)) : "none collected"}</p>
    <p class="workstream-card__links"><a href="#workstream-${escapeAttribute(workstream.id)}">See ${escapeHtml(workstream.name)} activity</a></p>
  </li>`
  )
  .join("\n")}
</ul>`;
}

/** Renders the resolved date range plus its definition. */
export function renderRangeSummary(range) {
  if (!range) return "";
  return `<p class="range-summary"><strong>${escapeHtml(range.label)}</strong>: ${escapeHtml(range.summary)} <span class="muted">(${range.rolling ? `${range.days * 24}-hour rolling window` : "calendar-aligned range"})</span></p>`;
}

/**
 * Discloses data coverage and limitations. Always visible (not collapsed by
 * default) because readers must not mistake missing data for inactivity.
 */
export function renderCoverage(coverage) {
  if (!coverage) return "";
  const sources = coverage.sources || [];
  const limitations = coverage.limitations || [];
  const badSources = sources.filter((source) => source.status !== "ok");

  const sourceRows = sources
    .map(
      (source) => `      <tr>
        <th scope="row">${escapeHtml(source.label || source.id)}</th>
        <td>${escapeHtml(source.status)}</td>
        <td>${source.records ?? 0}</td>
        <td>${escapeHtml(source.note || "")}${source.reasons?.length ? ` ${escapeHtml(`(${source.reasons.join(", ")})`)}` : ""}</td>
      </tr>`
    )
    .join("\n");

  return `<section class="coverage" aria-labelledby="coverage-heading">
  <h2 id="coverage-heading">Data coverage and limitations</h2>
  <p>Activity is collected from public GitHub data for a bounded set of repositories. Missing events are not evidence that no work happened.</p>
  ${coverage.window ? `<p><strong>Collected window:</strong> ${escapeHtml(formatLocalDateTime(coverage.window.start, coverage.timezone || "America/Toronto"))} – ${escapeHtml(formatLocalDateTime(coverage.window.end, coverage.timezone || "America/Toronto"))}. <strong>Lookback:</strong> ${coverage.lookbackDays} days.</p>` : ""}
  ${coverage.requests ? `<p><strong>API requests this run:</strong> ${coverage.requests.used} of ${coverage.requests.budgetMax}${coverage.requests.exhausted ? " (budget reached)" : ""}.</p>` : ""}
  ${badSources.length ? `<p class="notice">${badSources.length} source${badSources.length === 1 ? "" : "s"} reported incomplete or unavailable coverage. Details are listed below and in the source table.</p>` : ""}
  <div class="table-wrap">
    <table class="data-table data-table--compact">
      <caption>Collection sources and their status.</caption>
      <thead><tr><th scope="col">Source</th><th scope="col">Status</th><th scope="col">Records</th><th scope="col">Notes</th></tr></thead>
      <tbody>
${sourceRows}
      </tbody>
    </table>
  </div>
  ${
    limitations.length
      ? `<h3>Known limitations</h3>
  <ul class="limitations">
${limitations.map((limitation) => `    <li>${escapeHtml(limitation)}</li>`).join("\n")}
  </ul>`
      : ""
  }
</section>`;
}

/** Renders the "saved questions" links as normal links with query parameters. */
export function renderSavedQuestions(questions) {
  return `<ul class="saved-questions">
${questions
  .map(
    (question) =>
      `  <li><a href="${escapeAttribute(question.href)}">${escapeHtml(question.label)}</a></li>`
  )
  .join("\n")}
</ul>`;
}

/** Formats a timestamp for a `<time>` element in a table cell. */
export function timeCell(timestamp, timeZone, { dateOnly = false } = {}) {
  if (!timestamp) return "—";
  const text = dateOnly ? formatShortDate(timestamp, timeZone) : formatLocalDateTime(timestamp, timeZone);
  return `<time datetime="${escapeAttribute(timestamp)}">${escapeHtml(text)}</time>`;
}

/** Human-readable page-level count line. */
export function renderCountLine(counts, label) {
  if (!counts) return "";
  return `<p class="count-line">${counts} ${escapeHtml(label)}</p>`;
}
