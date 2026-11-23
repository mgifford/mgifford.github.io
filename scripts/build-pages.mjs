#!/usr/bin/env node
/**
 * Build the static Project Atlas pages.
 *
 * Every page is generated with meaningful content in the initial HTML so the
 * dashboard works without JavaScript (progressive enhancement). The browser
 * script only adds filtering, URL state, and live re-rendering.
 *
 * Outputs:
 *   activity.html, contributions.html, workstreams.html, reports.html
 *   sitemap.xml
 *   reports/activity/latest-week.md, latest-month.md
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import yaml from "js-yaml";

import { summarizeEvents } from "../src/activity.mjs";
import { RANGE_OPTIONS, SAVED_QUESTIONS } from "../src/activity-filters.mjs";
import { getUserContributions } from "../src/queries.mjs";
import {
  escapeAttribute,
  escapeHtml,
  externalLink,
  renderRangeSummary,
  renderSavedQuestions
} from "../src/render.mjs";
import { renderActivityView, renderContributionsView, renderWorkstreamsView } from "../src/views.mjs";
import { formatLocalDateTime, resolveDateRange } from "../src/time.mjs";

const SITE_URL = "https://mgifford.github.io";
const DEFAULT_TIME_ZONE = "America/Toronto";

const INPUT_ACTIVITY = "data/activity-data.json";
const INPUT_ACTIVITY_EXTENDED = "data/activity-extended.json";
const INPUT_WORKSTREAMS = "data/workstreams.yml";

const PAGE_FILES = {
  activity: "activity.html",
  contributions: "contributions.html",
  workstreams: "workstreams.html",
  reports: "reports.html"
};

const NAV = [
  { id: "projects", label: "Projects", href: "index.html" },
  { id: "activity", label: "Recent Activity", href: "activity.html" },
  { id: "contributions", label: "My Contributions", href: "contributions.html" },
  { id: "workstreams", label: "Workstreams", href: "workstreams.html" },
  { id: "reports", label: "Reports", href: "reports.html" }
];

async function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function readYaml(path, fallback) {
  if (!existsSync(path)) return fallback;
  return yaml.load(await readFile(path, "utf8")) || fallback;
}

async function writeFileEnsured(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}

const THEME_SCRIPT = `<script>
  (function () {
    const storageKey = "mgiffordRepoCatalogTheme";
    const savedTheme = window.localStorage.getItem(storageKey);
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const theme = savedTheme || (prefersDark ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", theme);
  })();
</script>`;

function themeToggle() {
  return `<button id="theme-toggle" class="theme-toggle" type="button" aria-label="Switch to dark mode" title="Switch to dark mode">
  <svg aria-hidden="true" class="theme-icon sun-icon" viewBox="0 0 24 24" width="20" height="20">
    <circle cx="12" cy="12" r="4.25" fill="currentColor"></circle>
    <path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"></path>
  </svg>
  <svg aria-hidden="true" class="theme-icon moon-icon" viewBox="0 0 24 24" width="20" height="20">
    <path fill="currentColor" d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79Z"></path>
  </svg>
</button>`;
}

function siteHeader(currentPage) {
  const items = NAV.map((item) => {
    const current = item.id === currentPage ? ' aria-current="page"' : "";
    return `        <li><a href="${escapeAttribute(item.href)}"${current}>${escapeHtml(item.label)}</a></li>`;
  }).join("\n");

  return `<header class="site-header">
  <div class="site-header__inner">
    <a class="site-brand" href="index.html">Project Atlas <span class="site-brand__sub">by Mike Gifford</span></a>
    <nav aria-label="Main">
      <ul class="site-nav">
${items}
      </ul>
    </nav>
    ${themeToggle()}
  </div>
</header>`;
}

function siteFooter(generatedAt, timeZone) {
  return `<footer class="site-footer">
  <p>Project Atlas is a static catalogue of public GitHub work. Activity is collected from public GitHub data; private repositories and authenticated-only signals are never published.</p>
  <p class="muted">Activity data generated ${escapeHtml(generatedAt ? formatLocalDateTime(generatedAt, timeZone) : "not yet generated")} · Reporting time zone: ${escapeHtml(timeZone)} · <a href="https://github.com/mgifford/mgifford.github.io">Source repository<span class="visually-hidden"> (opens in a new tab)</span></a></p>
</footer>`;
}

function pageShell({ pageId, title, description, h1, lede, tools = "", body, generatedAt, timeZone }) {
  const canonical = `${SITE_URL}/${PAGE_FILES[pageId] || ""}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeAttribute(description)}" />
  <link rel="canonical" href="${escapeAttribute(canonical)}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${escapeAttribute(title)}" />
  <meta property="og:description" content="${escapeAttribute(description)}" />
  <meta property="og:url" content="${escapeAttribute(canonical)}" />
  <meta name="color-scheme" content="light dark" />
  ${THEME_SCRIPT}
  <link rel="stylesheet" href="src/styles.css" />
</head>
<body>
  <a class="skip-link" href="#main">Skip to main content</a>
  ${siteHeader(pageId)}
  <main id="main" class="atlas-main">
    <div class="atlas-intro">
      <p class="eyebrow">Project Atlas</p>
      <h1>${escapeHtml(h1)}</h1>
      <p class="lede">${lede}</p>
    </div>
${tools}
    <div id="atlas-results" data-view="${escapeAttribute(pageId)}">
${body}
    </div>
  </main>
  ${siteFooter(generatedAt, timeZone)}
  <script type="module" src="src/activity-app.js"></script>
</body>
</html>
`;
}

function noScriptNote() {
  return `<noscript>
    <p class="notice">This page shows a fixed snapshot for the default date range. Interactive date filters require JavaScript. Every value below is also available in the page text and its source links.</p>
  </noscript>`;
}

function rangeOptionsMarkup() {
  return RANGE_OPTIONS.map(
    (range) =>
      `          <option value="${escapeAttribute(range.value)}"${range.value === "last_7_days" ? " selected" : ""}>${escapeHtml(range.label)}</option>`
  ).join("\n");
}

function filterForm(pageId, { showWorkstream, showCategory, showRepository }) {
  return `<form id="atlas-filters" class="filters js-only" method="get" action="${escapeAttribute(
    PAGE_FILES[pageId]
  )}" data-view="${escapeAttribute(pageId)}">
  <div class="filters__grid">
    <div class="filters__field">
      <label for="f-range">Date range</label>
      <select id="f-range" name="range" aria-describedby="f-range-help">
${rangeOptionsMarkup()}
      </select>
      <p id="f-range-help" class="filters__help">Times use the configured reporting time zone. "This week" starts Monday 00:00.</p>
    </div>
    <div class="filters__field" data-custom-range hidden>
      <label for="f-from">From date</label>
      <input id="f-from" name="from" type="date" />
    </div>
    <div class="filters__field" data-custom-range hidden>
      <label for="f-to">To date</label>
      <input id="f-to" name="to" type="date" />
    </div>
${
  showWorkstream
    ? `    <div class="filters__field">
      <label for="f-workstream">Workstream</label>
      <select id="f-workstream" name="workstream">
        <option value="all">All workstreams</option>
      </select>
    </div>`
    : ""
}
${
  showCategory
    ? `    <div class="filters__field">
      <label for="f-category">Activity type</label>
      <select id="f-category" name="category">
        <option value="all">All activity types</option>
      </select>
    </div>`
    : ""
}
${
  showRepository
    ? `    <div class="filters__field">
      <label for="f-repository">Project</label>
      <select id="f-repository" name="repository">
        <option value="all">All projects</option>
      </select>
    </div>`
    : ""
}
    <div class="filters__field">
      <label for="f-search">Search</label>
      <input id="f-search" name="q" type="search" placeholder="Title, project, or actor" />
    </div>
    <div class="filters__field filters__field--check">
      <label><input id="f-exclude-automated" name="automation" type="checkbox" value="exclude" /> Exclude routine automation</label>
    </div>
  </div>
  <div class="filters__actions">
    <button class="btn btn--primary" type="submit">Apply filters</button>
    <a class="btn btn--ghost" href="${escapeAttribute(PAGE_FILES[pageId])}" data-reset-link>Reset</a>
  </div>
</form>
<div id="atlas-status" class="atlas-status" role="status" aria-live="polite"></div>`;
}

function savedQuestionsSection() {
  return `<section class="atlas-section js-only" aria-labelledby="saved-questions-heading" id="saved-questions">
  <h2 id="saved-questions-heading">Common questions</h2>
  <p class="muted">Each link applies filters to this page. The same filters power the deterministic reports.</p>
  ${renderSavedQuestions(SAVED_QUESTIONS)}
</section>`;
}

export function buildReportMarkdown({ title, range, period, contributions, coverage, timeZone, generatedAt }) {
  const lines = [
    `# ${title}`,
    "",
    `Generated: ${generatedAt}`,
    `Range: ${range.summary}`,
    `Time zone: ${timeZone}`,
    "",
    "## Summary",
    "",
    `- Human events: ${period.summary.human}`,
    `- Automated events: ${period.summary.automated}`,
    `- Projects with activity: ${period.summary.repositories.length}`,
    `- Completed or merged: ${period.completedWork.length}`,
    `- In progress: ${period.inProgressWork.length}`,
    `- Discussions and reviews: ${period.discussions.length}`,
    `- Attributable contributions by ${contributions.user}: ${contributions.items.length}`,
    "",
    "## Completed and merged work",
    ""
  ];

  const pushEvents = (events, emptyLabel) => {
    if (!events.length) {
      lines.push(`- None recorded in this period.`);
      return;
    }
    for (const event of events.slice(0, 40)) {
      lines.push(`- ${formatLocalDateTime(event.timestamp, timeZone)} · [${event.repository}](${event.url}) · ${event.actor} · ${event.title}`);
    }
    if (emptyLabel) lines.push("");
  };

  pushEvents(period.completedWork);

  lines.push("", "## Work in progress", "");
  pushEvents(period.inProgressWork);

  lines.push("", "## Discussions and reviews", "");
  pushEvents(period.discussions);

  lines.push("", "## Projects", "", "| Project | Human events | Automated | Last human activity |", "| --- | --- | --- | --- |");
  for (const project of period.projects) {
    lines.push(
      `| ${project.repository} | ${project.humanEventCount} | ${project.automatedEventCount} | ${project.lastHumanActivityAt ? formatLocalDateTime(project.lastHumanActivityAt, timeZone) : "not recorded"} |`
    );
  }

  lines.push("", `## Contributions by ${contributions.user}`, "", "| Type | Count |", "| --- | --- |");
  const byType = contributions.byType || {};
  if (!Object.keys(byType).length) lines.push("| None recorded | 0 |");
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${type} | ${count} |`);
  }

  lines.push("", "## Automation", "");
  if (!period.automation.length) {
    lines.push("- None recorded in this period.");
  } else {
    for (const event of period.automation.slice(0, 20)) {
      lines.push(`- ${formatLocalDateTime(event.timestamp, timeZone)} · ${event.repository} · ${event.actor} · ${event.title}`);
    }
  }

  lines.push("", "## Coverage and limitations", "");
  lines.push(
    `- Collection window: ${coverage?.window?.start || "unknown"} to ${coverage?.window?.end || "unknown"} (${coverage?.lookbackDays ?? "unknown"} day lookback).`
  );
  for (const source of coverage?.sources || []) {
    lines.push(`- ${source.label}: ${source.status}${source.reasons?.length ? ` (${source.reasons.join(", ")})` : ""}.`);
  }
  for (const limitation of coverage?.limitations || []) {
    lines.push(`- ${limitation}`);
  }

  lines.push("");
  return lines.join("\n");
}

function reportsView({ reports, timeZone }) {
  const sections = reports
    .map(
      (report) => `<section class="atlas-section" aria-labelledby="report-${escapeAttribute(report.id)}-heading">
  <h2 id="report-${escapeAttribute(report.id)}-heading">${escapeHtml(report.title)}</h2>
  ${renderRangeSummary(report.range)}
  <p><strong>${report.period.summary.human}</strong> human events, <strong>${report.period.summary.automated}</strong> automated events, across <strong>${report.period.projects.length}</strong> projects. <strong>${report.period.completedWork.length}</strong> completed and merged items.</p>
  ${
    report.period.completedWork.length
      ? `<h3>Completed and merged</h3>
  <ul class="activity-list">
${report.period.completedWork
  .slice(0, 15)
  .map(
    (event) =>
      `    <li class="activity-item"><p class="activity-item__meta">${escapeHtml(formatLocalDateTime(event.timestamp, timeZone))}</p><p class="activity-item__title">${externalLink(event.url, event.title || event.eventType)}</p><p class="activity-item__context">${escapeHtml(event.repository)} · ${escapeHtml(event.actor)}</p></li>`
  )
  .join("\n")}
  </ul>`
      : '<p class="muted">No completed or merged work recorded in this period.</p>'
  }
  <p><a href="${escapeAttribute(report.markdownPath)}">Read the full report in Markdown</a> · <a href="${escapeAttribute(report.githubPath)}">View the report source on GitHub<span class="visually-hidden"> (opens in a new tab)</span></a></p>
</section>`
    )
    .join("\n");

  return `<section class="atlas-section" aria-labelledby="reports-intro-heading">
  <h2 id="reports-intro-heading">Deterministic reports</h2>
  <p>Reports are generated from the same activity records as the dashboard. They contain no AI-generated summaries and no inferred next steps. A weekly report covers the last completed Monday-to-Sunday period; a monthly report covers a rolling 30 days.</p>
</section>
${sections}`;
}

function summarizePeriodFor(events) {
  const summary = summarizeEvents(events);
  const byTime = (list) => [...list].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const completedWork = byTime(events.filter((event) => event.outcome === "completed" && event.substantive !== false));
  const inProgressWork = byTime(events.filter((event) => event.outcome === "in_progress" && event.substantive === true));
  const discussions = byTime(events.filter((event) => event.outcome === "discussion" && !event.automated));
  const automation = byTime(events.filter((event) => event.automated));

  const byRepo = new Map();
  for (const event of events) {
    if (!byRepo.has(event.repository)) byRepo.set(event.repository, []);
    byRepo.get(event.repository).push(event);
  }
  const projects = [...byRepo.entries()]
    .map(([repository, repoEvents]) => {
      const human = repoEvents.filter((event) => !event.automated);
      const latest = byTime(repoEvents)[0];
      const latestHuman = byTime(human)[0];
      return {
        repository,
        humanEventCount: human.length,
        automatedEventCount: repoEvents.length - human.length,
        lastHumanActivityAt: latestHuman?.timestamp || null,
        lastActivityAt: latest?.timestamp || null
      };
    })
    .sort((a, b) => (b.lastActivityAt || "").localeCompare(a.lastActivityAt || ""));

  return { summary, completedWork, inProgressWork, discussions, automation, projects };
}

async function main() {
  const config = await readYaml(INPUT_WORKSTREAMS, { workstreams: [], reporting: {}, actor: {} });
  const recentActivity = await readJson(INPUT_ACTIVITY, null);
  const olderActivity = await readJson(INPUT_ACTIVITY_EXTENDED, { events: [] });
  const activity = recentActivity
    ? { ...recentActivity, events: [...(recentActivity.events || []), ...(olderActivity.events || [])] }
    : null;

  const timeZone = activity?.timezone || config.timezone || DEFAULT_TIME_ZONE;
  const generatedAt = activity?.generatedAt || new Date().toISOString();
  const now = new Date(process.env.ACTIVITY_NOW || generatedAt);
  const identity = {
    login: config.actor?.login || activity?.identity?.login || "mgifford",
    aliases: config.actor?.aliases || activity?.identity?.aliases || []
  };
  const coverage = activity?.coverage || null;
  const events = activity?.events || [];
  const repositoryIndex = activity?.repositoryIndex || [];

  // Workstream config can come from the browser payload (which carries the
  // membership arrays) when the YAML is unavailable.
  const workstreamConfig = Array.isArray(config.workstreams) && config.workstreams.length
    ? config
    : { workstreams: activity?.workstreams || [] };

  const defaultRange = resolveDateRange("last_7_days", { now, timeZone });

  const activityPage = pageShell({
    pageId: "activity",
    title: "Recent Activity | Project Atlas",
    description:
      "Which GitHub projects were updated this week? A date-ranged, evidence-linked activity index for Mike Gifford's open-source work, with automated activity separated from human contributions.",
    h1: "Recent activity",
    lede:
      "Which projects were updated this week? Activity grouped by date, project, and type, with links to the commits, pull requests, issues, and releases that prove it. Automated maintenance is labelled and never counted as personal work.",
    tools: `${noScriptNote()}
${filterForm("activity", { showWorkstream: true, showCategory: true, showRepository: true })}`,
    body: `${savedQuestionsSection()}
${renderActivityView({ events, repositoryIndex, coverage, range: defaultRange, timeZone })}`,
    generatedAt,
    timeZone
  });

  const contributionsPage = pageShell({
    pageId: "contributions",
    title: "My Contributions | Project Atlas",
    description:
      "Public GitHub contributions attributed to Mike Gifford over a selected date range, including work in repositories he does not own.",
    h1: "My contributions",
    lede:
      "What have I actually worked on? Only public events attributed to the configured account or commit identities are counted, and authored, reviewed, commented, and merged work are distinguished.",
    tools: `${noScriptNote()}
${filterForm("contributions", { showWorkstream: true, showCategory: true, showRepository: false })}`,
    body: renderContributionsView({ events, coverage, range: defaultRange, timeZone, identity }),
    generatedAt,
    timeZone
  });

  const workstreamsPage = pageShell({
    pageId: "workstreams",
    title: "Workstreams | Project Atlas",
    description:
      "Configurable workstreams that group related repositories, with recent activity and open work for each research or development area.",
    h1: "Workstreams",
    lede:
      "Projects grouped by the questions they answer. Workstreams are configured explicitly so a project can belong to more than one area of work.",
    body: renderWorkstreamsView({
      events,
      repositoryIndex,
      coverage,
      range: defaultRange,
      timeZone,
      config: workstreamConfig
    }),
    generatedAt,
    timeZone
  });

  const weekRange = resolveDateRange("last_week", { now, timeZone });
  const monthRange = resolveDateRange("last_30_days", { now, timeZone });
  const inRange = (range) =>
    events.filter((event) => {
      const time = new Date(event.timestamp).getTime();
      return time >= range.startMs && time <= range.endMs;
    });

  const buildModel = (id, title, range, markdownPath, githubPath) => {
    const scoped = inRange(range);
    const contributionItems = getUserContributions(events, identity.login, range, { aliases: identity.aliases });
    return {
      id,
      title,
      range,
      period: summarizePeriodFor(scoped),
      contributions: {
        user: identity.login,
        items: contributionItems,
        byType: contributionItems.reduce((acc, item) => {
          acc[item.eventType] = (acc[item.eventType] || 0) + 1;
          return acc;
        }, {})
      },
      markdownPath,
      githubPath
    };
  };

  const weekModel = buildModel(
    "week",
    "Latest completed week",
    weekRange,
    "reports/activity/latest-week.md",
    "https://github.com/mgifford/mgifford.github.io/blob/master/reports/activity/latest-week.md"
  );
  const monthModel = buildModel(
    "month",
    "Rolling 30 days",
    monthRange,
    "reports/activity/latest-month.md",
    "https://github.com/mgifford/mgifford.github.io/blob/master/reports/activity/latest-month.md"
  );

  const reportsPage = pageShell({
    pageId: "reports",
    title: "Reports | Project Atlas",
    description:
      "Deterministic weekly and monthly activity reports for Mike Gifford's open-source projects, with source links and explicit coverage limitations.",
    h1: "Reports",
    lede:
      "Deterministic summaries built from the same activity evidence as the dashboard. No model-generated claims, no invented next steps.",
    body: reportsView({ reports: [weekModel, monthModel], timeZone }),
    generatedAt,
    timeZone
  });

  const outputs = {
    [PAGE_FILES.activity]: activityPage,
    [PAGE_FILES.contributions]: contributionsPage,
    [PAGE_FILES.workstreams]: workstreamsPage,
    [PAGE_FILES.reports]: reportsPage
  };

  for (const [file, contents] of Object.entries(outputs)) {
    await writeFileEnsured(file, contents);
  }

  const sitemapEntries = [
    { loc: `${SITE_URL}/`, lastmod: generatedAt, priority: "1.0" },
    { loc: `${SITE_URL}/activity.html`, lastmod: generatedAt, priority: "0.9" },
    { loc: `${SITE_URL}/contributions.html`, lastmod: generatedAt, priority: "0.8" },
    { loc: `${SITE_URL}/workstreams.html`, lastmod: generatedAt, priority: "0.7" },
    { loc: `${SITE_URL}/reports.html`, lastmod: generatedAt, priority: "0.6" }
  ];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapEntries
  .map(
    (entry) => `  <url>
    <loc>${entry.loc}</loc>
    <lastmod>${entry.lastmod.slice(0, 10)}</lastmod>
    <priority>${entry.priority}</priority>
  </url>`
  )
  .join("\n")}
</urlset>
`;
  await writeFileEnsured("sitemap.xml", sitemap);

  await writeFileEnsured(
    "reports/activity/latest-week.md",
    buildReportMarkdown({
      title: "Project Atlas weekly activity report",
      range: weekRange,
      period: weekModel.period,
      contributions: weekModel.contributions,
      coverage,
      timeZone,
      generatedAt
    })
  );
  await writeFileEnsured(
    "reports/activity/latest-month.md",
    buildReportMarkdown({
      title: "Project Atlas monthly activity report",
      range: monthRange,
      period: monthModel.period,
      contributions: monthModel.contributions,
      coverage,
      timeZone,
      generatedAt
    })
  );

  console.log(`Wrote ${Object.keys(outputs).length} static pages, sitemap.xml, and 2 activity reports.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
