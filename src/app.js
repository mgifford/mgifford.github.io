import { manualRankValue, parseFiltersFromUrl as _parseFiltersFromUrl, buildFilterSearch, sortRepos as _sortRepos, filterRepos as _filterRepos, applyPublicScope as _applyPublicScope } from "./filters.mjs";

const DATA_PATH = "data/site-data.json";
const OWNER_ACTION_PREFS_KEY = "mgiffordRepoCatalogOwnerActionPrefs";
const DEFAULT_SNOOZE_DAYS = 7;
const THEME_KEY = "mgiffordRepoCatalogTheme";

const els = {
  storyStats: document.querySelector("#story-stats"),
  featuredRow: document.querySelector("#featured-row"),
  freshness: document.querySelector("#freshness"),
  ownerAccess: document.querySelector("#owner-access"),
  ownerConnect: document.querySelector("#owner-connect"),
  ownerBadge: document.querySelector("#owner-badge"),
  themeToggle: document.querySelector("#theme-toggle"),
  publicScopeWrap: document.querySelector("#public-scope-wrap"),
  publicScope: document.querySelector("#public-scope"),
  search: document.querySelector("#search"),
  themeFilter: document.querySelector("#theme-filter"),
  sortBy: document.querySelector("#sort-by"),
  archivedWrap: document.querySelector("#archived-wrap"),
  archivedMode: document.querySelector("#archived-mode"),
  hasOpenIssuesWrap: document.querySelector("#has-open-issues-wrap"),
  hasOpenIssues: document.querySelector("#has-open-issues"),
  summary: document.querySelector("#summary"),
  grid: document.querySelector("#repo-grid"),
  template: document.querySelector("#repo-card-template"),
  ownerPanel: document.querySelector("#owner-panel"),
  ownerMetrics: document.querySelector("#owner-metrics"),
  impactList: document.querySelector("#impact-list"),
  impactOpenTop: document.querySelector("#impact-open-top"),
  impactRefresh: document.querySelector("#impact-refresh"),
  impactPrev: document.querySelector("#impact-prev"),
  impactNext: document.querySelector("#impact-next"),
  impactPageLabel: document.querySelector("#impact-page-label"),
  enableOwner: document.querySelector("#enable-owner"),
  clearOwner: document.querySelector("#clear-owner")
};

const state = {
  data: null,
  ownerAuthToken: "",
  filters: {
    search: "",
    theme: "all",
    sortBy: "stars",
    archivedMode: "hide",
    publicScope: "curated",
    hasOpenIssues: false
  },
  ownerSortOverridden: false,
  publicView: {
    curatedMax: 60
  },
  ownerActions: {
    items: [],
    page: 0,
    pageSize: 10
  },
  ownerActionPrefs: JSON.parse(window.localStorage.getItem(OWNER_ACTION_PREFS_KEY) || "{}")
};

function isOwnerMode() {
  return !els.ownerPanel.hidden;
}

function getCurrentTheme() {
  const theme = document.documentElement.getAttribute("data-theme");
  return theme === "dark" ? "dark" : "light";
}

function applyTheme(theme, persist = true) {
  document.documentElement.setAttribute("data-theme", theme);

  if (persist) {
    window.localStorage.setItem(THEME_KEY, theme);
  }

  const nextAction = theme === "dark" ? "light" : "dark";
  els.themeToggle.setAttribute("aria-label", `Switch to ${nextAction} mode`);
  els.themeToggle.setAttribute("title", `Switch to ${nextAction} mode`);
  els.themeToggle.setAttribute("aria-pressed", String(theme === "dark"));
}

function initTheme() {
  const savedTheme = window.localStorage.getItem(THEME_KEY);
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

  applyTheme(savedTheme || (mediaQuery.matches ? "dark" : "light"), false);

  mediaQuery.addEventListener("change", (event) => {
    const override = window.localStorage.getItem(THEME_KEY);
    if (override) return;
    applyTheme(event.matches ? "dark" : "light", false);
  });
}

function toggleTheme() {
  const nextTheme = getCurrentTheme() === "dark" ? "light" : "dark";
  applyTheme(nextTheme, true);
}

function renderOwnerBadge() {
  const active = isOwnerMode();
  els.ownerBadge.hidden = !active;
  els.enableOwner.hidden = active;
}

function parseFiltersFromUrl() {
  return _parseFiltersFromUrl(window.location.search);
}

function syncUrlWithFilters() {
  const query = buildFilterSearch(window.location.search, state.filters, { ownerMode: isOwnerMode() });
  const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
  window.history.replaceState(null, "", nextUrl);
}

function persistOwnerActionPrefs() {
  window.localStorage.setItem(OWNER_ACTION_PREFS_KEY, JSON.stringify(state.ownerActionPrefs));
}

function isActionDismissed(url) {
  return Boolean(state.ownerActionPrefs[url]?.dismissed);
}

function isActionSnoozed(url) {
  const snoozeUntil = state.ownerActionPrefs[url]?.snoozeUntil;
  if (!snoozeUntil) return false;
  return Date.now() < snoozeUntil;
}

function dismissOwnerAction(url) {
  state.ownerActionPrefs[url] = {
    ...(state.ownerActionPrefs[url] || {}),
    dismissed: true
  };
  persistOwnerActionPrefs();
  renderImpactDashboard();
}

function snoozeOwnerAction(url, days = DEFAULT_SNOOZE_DAYS) {
  state.ownerActionPrefs[url] = {
    ...(state.ownerActionPrefs[url] || {}),
    snoozeUntil: Date.now() + days * 24 * 60 * 60 * 1000
  };
  persistOwnerActionPrefs();
  renderImpactDashboard();
}

function visibleOwnerActions() {
  return state.ownerActions.items.filter((item) => !isActionDismissed(item.url) && !isActionSnoozed(item.url));
}

function getActionItemRepoNames() {
  const names = new Set();
  for (const item of state.ownerActions.items) {
    if (!item.url) continue;
    const match = item.url.match(/github\.com\/[^/]+\/([^/]+?)(?:\/|$)/);
    if (match) names.add(match[1].toLowerCase());
  }
  return names;
}

function sortRepos(repos, mode) {
  return _sortRepos(repos, mode, {
    ownerMode: isOwnerMode(),
    actionRepoNames: isOwnerMode() ? getActionItemRepoNames() : new Set()
  });
}

function filterRepos(repos) {
  return _filterRepos(repos, state.filters);
}

function applyPublicScope(sortedRepos) {
  return _applyPublicScope(sortedRepos, {
    ownerMode: isOwnerMode(),
    publicScope: state.filters.publicScope,
    sortBy: state.filters.sortBy,
    curatedMax: state.publicView.curatedMax
  });
}

function renderStoryStats() {
  const total = state.data.summary?.total || state.data.repos.length;
  const featured = state.data.summary?.featured || 0;
  const themes = (state.data.themes || []).length;

  els.storyStats.innerHTML = `
    <article class="story__card">
      <strong>${total}</strong>
      <span>Repositories tracked</span>
    </article>
    <article class="story__card">
      <strong>${featured}</strong>
      <span>Featured projects</span>
    </article>
    <article class="story__card">
      <strong>${themes}</strong>
      <span>Curated themes</span>
    </article>
  `;
}

function renderSummary(visibleCount, totalFiltered) {
  const total = state.data.repos.length;
  const archived = state.data.repos.filter((repo) => repo.archived).length;
  const featured = state.data.repos.filter((repo) => repo.featured).length;
  const scopeText = !isOwnerMode() && state.filters.publicScope === "curated" ? " · curated view" : "";

  els.summary.textContent = `${visibleCount} shown of ${totalFiltered} filtered · ${total} total repos · ${featured} featured · ${archived} archived${scopeText}`;
}

function shortImpactText(repo) {
  const source =
    repo.featuredNarrative ||
    repo.highlight ||
    repo.cardSummary ||
    repo.summary ||
    repo.description ||
    "No impact statement available yet.";
  const compact = source.replace(/\s+/g, " ").trim();
  if (compact.length <= 120) return compact;
  return `${compact.slice(0, 117).trimEnd()}...`;
}

function topNarrativeRepos() {
  const repos = state.data.repos || [];
  const featured = repos
    .filter((repo) => repo.featured && !repo.archived)
    .sort((a, b) => {
      const rankDelta = manualRankValue(a) - manualRankValue(b);
      if (rankDelta !== 0) return rankDelta;
      return (b.stars || 0) - (a.stars || 0);
    });

  const chosen = [...featured.slice(0, 3)];
  if (chosen.length < 3) {
    const selected = new Set(chosen.map((repo) => repo.name));
    const fallback = repos
      .filter((repo) => !repo.archived && !selected.has(repo.name))
      .sort((a, b) => (b.stars || 0) - (a.stars || 0))
      .slice(0, 3 - chosen.length);

    chosen.push(...fallback);
  }

  return chosen;
}

function renderFeaturedNarrativeRow() {
  const top = topNarrativeRepos();

  if (!top.length) {
    els.featuredRow.hidden = true;
    els.featuredRow.innerHTML = "";
    return;
  }

  els.featuredRow.hidden = false;
  els.featuredRow.innerHTML = top
    .map(
      (repo) => `
        <article class="featured-row__item">
          <p class="featured-row__label">Featured</p>
          <h2 class="featured-row__title"><a href="${repo.url}" target="_blank" rel="noreferrer noopener">${repo.cardTitle || repo.name}</a></h2>
          <p class="featured-row__impact">${shortImpactText(repo)}</p>
        </article>
      `
    )
    .join("");
}

function formatTimestamp(value) {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "n/a";
  return date.toLocaleString();
}

function renderFreshnessFooter() {
  const freshness = state.data.freshness || {};
  const delta = freshness.repoCountDelta || 0;
  const deltaText = delta > 0 ? `+${delta}` : `${delta}`;

  els.freshness.textContent = `Data freshness: repo snapshot ${formatTimestamp(freshness.repoSnapshotGeneratedAt || state.data.sourceGeneratedAt)} · screenshots ${formatTimestamp(freshness.screenshotsGeneratedAt)} · repo delta ${deltaText}`;
}

function renderRepos() {
  const filtered = filterRepos(state.data.repos);
  const sorted = sortRepos(filtered, state.filters.sortBy);
  const visibleRepos = applyPublicScope(sorted);
  const actionRepos = isOwnerMode() ? getActionItemRepoNames() : new Set();

  els.grid.innerHTML = "";

  for (const repo of visibleRepos) {
    const fragment = els.template.content.cloneNode(true);
    const card = fragment.querySelector(".card");
    const imageLink = fragment.querySelector(".card__image-link");
    const image = fragment.querySelector(".card__image");
    const titleLink = fragment.querySelector(".card__title-link");
    const desc = fragment.querySelector(".card__desc");
    const meta = fragment.querySelector(".card__meta");
    const flags = fragment.querySelector(".card__flags");
    const links = fragment.querySelector(".card__links");

    const pagesUrl = repo.hasPages ? `https://${state.data.owner}.github.io/${repo.name}/` : "";
    const liveUrl = repo.homepage && /^https?:\/\//.test(repo.homepage) ? repo.homepage : pagesUrl;
    const imageTarget = liveUrl || repo.url;

    imageLink.href = imageTarget;
    imageLink.setAttribute("aria-label", liveUrl ? `Open live site for ${repo.name}` : `Open repository for ${repo.name}`);

    image.src = repo.screenshot || "src/assets/placeholder.svg";
    image.alt = `Preview of ${repo.name}`;

    titleLink.href = repo.url;
    titleLink.textContent = repo.cardTitle || repo.name;
    titleLink.setAttribute("aria-label", `Open repository for ${repo.name}`);

    desc.textContent = repo.cardSummary || repo.summary;
    meta.textContent = `${repo.language} · ${repo.theme} · ${repo.stars} stars · ${repo.watchers} watchers`;

    const badge = [];
    const hasActionItem = actionRepos.has(repo.name.toLowerCase());
    if (hasActionItem) {
      card.classList.add("card--has-action");
      badge.push("⚡ Needs attention");
    }
    if (repo.featured) badge.push("Featured");
    if (repo.archived) badge.push("Archived");
    if (repo.readme?.needsAttention) badge.push("README needs update");
    flags.textContent = badge.join(" · ");

    const readmeUrl = `${repo.url}/blob/${repo.defaultBranch || "main"}/README.md`;
    const linkParts = [
      `<a href="${repo.url}" target="_blank" rel="noreferrer noopener">Repository</a>`,
      `<a href="${readmeUrl}" target="_blank" rel="noreferrer noopener">README</a>`
    ];
    if (liveUrl && liveUrl !== repo.url) {
      linkParts.unshift(`<a href="${liveUrl}" target="_blank" rel="noreferrer noopener">Live Site</a>`);
    }
    links.innerHTML = linkParts.join(" · ");

    card.style.animationDelay = `${Math.min(200, els.grid.childElementCount * 18)}ms`;
    els.grid.appendChild(fragment);
  }

  renderSummary(visibleRepos.length, sorted.length);
  syncUrlWithFilters();
}

function populateThemeFilters(themes) {
  for (const theme of themes) {
    const option = document.createElement("option");
    option.value = theme;
    option.textContent = theme;
    els.themeFilter.append(option);
  }
}

function parseLastPage(linkHeader) {
  if (!linkHeader) return null;
  const lastMatch = linkHeader.match(/<([^>]+)>;\s*rel=\"last\"/);
  if (!lastMatch) return null;

  try {
    const url = new URL(lastMatch[1]);
    return Number.parseInt(url.searchParams.get("page") || "1", 10);
  } catch {
    return null;
  }
}

async function countSearchTotal(query, token) {
  const url = `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=1`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new Error(`Search query failed: ${query}`);
  }

  const json = await response.json();
  return json.total_count || 0;
}

async function searchItems(query, token, perPage = 20) {
  const url = `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=${perPage}&sort=updated&order=desc`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new Error(`Search query failed: ${query}`);
  }

  const json = await response.json();
  return Array.isArray(json.items) ? json.items : [];
}

function toWebUrlFromApiUrl(apiUrl) {
  if (!apiUrl) return "";
  return apiUrl
    .replace("https://api.github.com/repos/", "https://github.com/")
    .replace("/pulls/", "/pull/")
    .replace("/commits/", "/commit/");
}

function ageDays(isoDate) {
  const then = new Date(isoDate).getTime();
  const now = Date.now();
  return Math.max(0, Math.floor((now - then) / (1000 * 60 * 60 * 24)));
}

function dedupeByUrl(items) {
  const seen = new Set();
  const deduped = [];

  for (const item of items) {
    const key = item.url;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

function isRoutinePackageUpdateTitle(title) {
  return /(dependabot|bump\s+[^\s]+\s+from|chore\(deps\)|update\s+dependencies|npm|yarn|pnpm)/i.test(title || "");
}

async function fetchOwnerActionItems(token, owner) {
  const staleDate = new Date(Date.now() - 1000 * 60 * 60 * 24 * 120).toISOString().slice(0, 10);

  const [reviewRequested, staleIssues, authoredPrs, newIssues, notifications] = await Promise.all([
    searchItems(`is:open is:pr user:${owner} review-requested:${owner}`, token, 25),
    searchItems(`is:open is:issue user:${owner} archived:false updated:<${staleDate}`, token, 25),
    searchItems(`is:open is:pr user:${owner} author:${owner}`, token, 25),
    searchItems(`is:open is:issue user:${owner} archived:false created:>=${new Date(Date.now() - 1000 * 60 * 60 * 24 * 14).toISOString().slice(0, 10)}`, token, 25),
    fetch("https://api.github.com/notifications?per_page=50", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`
      }
    }).then(async (response) => {
      if (!response.ok) {
        throw new Error("Unable to load notifications. Verify token scopes.");
      }
      return response.json();
    })
  ]);

  const items = [
    ...reviewRequested.map((item) => ({
      title: `Review requested: ${item.repository_url.split("/").slice(-1)[0]} #${item.number}`,
      url: item.html_url,
      reason: "PR review request",
      score: 100,
      updatedAt: item.updated_at
    })),
    ...notifications.map((item) => {
      const reason = item.reason || "subscribed";
      const securityNotice = reason === "security_alert";

      return {
      title: `${securityNotice ? "Security" : item.subject.type}: ${item.subject.title}`,
      url: toWebUrlFromApiUrl(item.subject.url),
      reason: securityNotice ? "Security notice" : `Unread notification (${reason})`,
      score: securityNotice ? 110 : reason === "review_requested" ? 95 : 82,
      updatedAt: item.updated_at
    };
    }),
    ...newIssues.map((item) => ({
      title: `New issue: ${item.title}`,
      url: item.html_url,
      reason: `New issue (${ageDays(item.created_at)}d old)`,
      score: 78,
      updatedAt: item.updated_at
    })),
    ...staleIssues.map((item) => ({
      title: `Stale issue: ${item.title}`,
      url: item.html_url,
      reason: `Stale issue (${ageDays(item.updated_at)}d since update)`,
      score: 72,
      updatedAt: item.updated_at
    })),
    ...authoredPrs.map((item) => ({
      title: `Your PR: ${item.title}`,
      url: item.html_url,
      reason: `Open PR (${ageDays(item.updated_at)}d since update)`,
      score: 64,
      updatedAt: item.updated_at
    }))
  ];

  return dedupeByUrl(items)
    .filter((item) => item.url)
    .filter((item) => item.reason === "Security notice" || !isRoutinePackageUpdateTitle(item.title))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });
}

async function fetchOwnerSignals(token, owner) {
  const staleDate = new Date(Date.now() - 1000 * 60 * 60 * 24 * 120).toISOString().slice(0, 10);
  const queries = {
    reviewRequested: `is:open is:pr user:${owner} review-requested:${owner}`,
    authoredPrs: `is:open is:pr user:${owner} author:${owner}`,
    openIssues: `is:open is:issue user:${owner} archived:false`,
    staleIssues: `is:open is:issue user:${owner} archived:false updated:<${staleDate}`
  };

  const metrics = [];
  for (const [key, query] of Object.entries(queries)) {
    const total = await countSearchTotal(query, token);
    metrics.push({ key, total });
  }

  const notificationsResponse = await fetch("https://api.github.com/notifications?per_page=100", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`
    }
  });

  if (!notificationsResponse.ok) {
    throw new Error("Unable to load notifications. Verify token scopes.");
  }

  const notifications = await notificationsResponse.json();
  const approxPages = parseLastPage(notificationsResponse.headers.get("link")) || 1;

  metrics.push({
    key: "notifications",
    total: notifications.length,
    note: approxPages > 1 ? "(latest 100 items shown)" : ""
  });

  metrics.push({
    key: "securityAlerts",
    total: notifications.filter((item) => item.reason === "security_alert").length,
    note: "(from notifications)"
  });

  return metrics;
}

function metricLabel(metric) {
  switch (metric.key) {
    case "reviewRequested":
      return "PRs requesting review";
    case "authoredPrs":
      return "Your open PRs";
    case "openIssues":
      return "Open issues";
    case "staleIssues":
      return "Stale issues (120+ days)";
    case "securityAlerts":
      return "Security notices";
    default:
      return "Unread notifications";
  }
}

function renderOwnerMetrics(metrics) {
  els.ownerMetrics.innerHTML = "";

  const readmeNeedsAttention = state.data.summary?.readmeNeedsAttention || 0;
  const backlog = document.createElement("div");
  backlog.className = "owner__metric";
  backlog.innerHTML = `<strong>READMEs to improve:</strong> ${readmeNeedsAttention}`;
  els.ownerMetrics.appendChild(backlog);

  for (const metric of metrics) {
    const div = document.createElement("div");
    div.className = "owner__metric";
    div.innerHTML = `<strong>${metricLabel(metric)}:</strong> ${metric.total} <small>${metric.note || ""}</small>`;
    els.ownerMetrics.appendChild(div);
  }
}

function impactPageCount() {
  const items = visibleOwnerActions();
  const { pageSize } = state.ownerActions;
  return Math.max(1, Math.ceil(items.length / pageSize));
}

function currentImpactItems() {
  const items = visibleOwnerActions();
  const { page, pageSize } = state.ownerActions;
  const start = page * pageSize;
  return items.slice(start, start + pageSize);
}

function renderImpactDashboard() {
  const total = visibleOwnerActions().length;
  const pages = impactPageCount();
  if (state.ownerActions.page >= pages) {
    state.ownerActions.page = Math.max(0, pages - 1);
  }
  const pageItems = currentImpactItems();
  const pageNumber = state.ownerActions.page + 1;

  els.impactList.innerHTML = "";

  if (!total) {
    els.impactList.innerHTML = '<div class="impact__item">No actionable items found right now.</div>';
  } else {
    for (const [index, item] of pageItems.entries()) {
      const div = document.createElement("div");
      div.className = "impact__item";
      div.innerHTML = `<strong>${state.ownerActions.page * state.ownerActions.pageSize + index + 1}.</strong> <a href="${item.url}" target="_blank" rel="noreferrer noopener">${item.title}</a><div class="impact__meta">${item.reason}</div><div class="impact__item-actions"><button type="button" class="btn btn--ghost impact__action" data-action="snooze" data-url="${item.url}">Snooze 7d</button><button type="button" class="btn btn--ghost impact__action" data-action="dismiss" data-url="${item.url}">Dismiss</button></div>`;
      els.impactList.append(div);
    }
  }

  els.impactPageLabel.textContent = `Page ${pageNumber} of ${pages} · ${total} items`;
  els.impactPrev.disabled = state.ownerActions.page === 0;
  els.impactNext.disabled = state.ownerActions.page >= pages - 1;
  els.impactOpenTop.disabled = pageItems.length === 0;
}

function openCurrentImpactPage() {
  const links = currentImpactItems().map((item) => item.url);

  if (!links.length) return;

  for (const url of links) {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

async function loadOwnerDashboard() {
  if (!state.ownerAuthToken) {
    throw new Error("Owner mode requires GitHub OAuth or a server-side owner data pipeline.");
  }

  const [metrics, actions] = await Promise.all([
    fetchOwnerSignals(state.ownerAuthToken, state.data.owner),
    fetchOwnerActionItems(state.ownerAuthToken, state.data.owner)
  ]);

  renderOwnerMetrics(metrics);
  state.ownerActions.items = actions;
  state.ownerActions.page = 0;
  renderImpactDashboard();

  // Default to "recently pushed" in owner mode only if the user hasn't explicitly changed the sort
  if (!state.ownerSortOverridden) {
    const publicDefault = state.data.sortingDefaults?.public || "stars";
    if (state.filters.sortBy === publicDefault) {
      state.filters.sortBy = "pushed";
      els.sortBy.value = "pushed";
    }
  }

  // Re-render cards with action-item pinning now that data is loaded
  renderRepos();
}

function enableOwnerMode() {
  els.ownerAccess.hidden = false;
  els.ownerAccess.scrollIntoView({ behavior: "smooth", block: "start" });
}

function restoreOwnerMode() {
  disableOwnerMode();
}

function disableOwnerMode() {
  state.ownerAuthToken = "";
  state.ownerActions.items = [];
  state.ownerActions.page = 0;
  state.ownerSortOverridden = false;
  state.filters.archivedMode = "hide";
  els.archivedMode.value = "hide";
  // Restore public default sort when leaving owner mode
  const publicDefault = state.data?.sortingDefaults?.public || "stars";
  state.filters.sortBy = publicDefault;
  els.sortBy.value = publicDefault;
  els.ownerPanel.hidden = true;
  els.ownerAccess.hidden = false;
  els.archivedWrap.hidden = true;
  els.publicScopeWrap.hidden = false;
  els.clearOwner.hidden = true;
  renderOwnerBadge();
  renderRepos();
}

async function init() {
  const response = await fetch(DATA_PATH);
  if (!response.ok) {
    throw new Error("Cannot load site data. Run sync scripts first.");
  }

  state.data = await response.json();
  state.filters.sortBy = state.data.sortingDefaults?.public || "stars";
  state.publicView.curatedMax = state.data.displayDefaults?.publicCuratedMax || 60;
  state.filters.publicScope = state.data.displayDefaults?.publicScope || "curated";

  const urlFilters = parseFiltersFromUrl();
  state.filters = {
    ...state.filters,
    ...urlFilters
  };

  const availableThemes = new Set(["all", ...(state.data.themes || [])]);
  if (!availableThemes.has(state.filters.theme)) {
    state.filters.theme = "all";
  }

  const allowedSort = new Set(["stars", "watchers", "updated", "pushed", "name"]);
  if (!allowedSort.has(state.filters.sortBy)) {
    state.filters.sortBy = "stars";
  }

  const allowedScope = new Set(["curated", "all"]);
  if (!allowedScope.has(state.filters.publicScope)) {
    state.filters.publicScope = state.data.displayDefaults?.publicScope || "curated";
  }

  const allowedArchived = new Set(["hide", "show", "only"]);
  if (!allowedArchived.has(state.filters.archivedMode)) {
    state.filters.archivedMode = "hide";
  }

  els.search.value = state.filters.search;
  els.sortBy.value = state.filters.sortBy;
  els.publicScope.value = state.filters.publicScope;
  if (els.hasOpenIssues) els.hasOpenIssues.checked = state.filters.hasOpenIssues;

  populateThemeFilters(state.data.themes || []);
  els.themeFilter.value = state.filters.theme;
  els.archivedMode.value = state.filters.archivedMode;
  renderStoryStats();
  renderFeaturedNarrativeRow();
  renderFreshnessFooter();

  const bind = (el, event, fn) => {
    if (!el) return;
    el.addEventListener(event, fn);
  };

  bind(els.search, "input", (event) => {
    state.filters.search = event.target.value;
    renderRepos();
  });

  bind(els.themeFilter, "change", (event) => {
    state.filters.theme = event.target.value;
    renderRepos();
  });

  bind(els.sortBy, "change", (event) => {
    state.filters.sortBy = event.target.value;
    if (isOwnerMode()) state.ownerSortOverridden = true;
    renderRepos();
  });

  bind(els.archivedMode, "change", (event) => {
    state.filters.archivedMode = event.target.value;
    renderRepos();
  });

  bind(els.hasOpenIssues, "change", (event) => {
    state.filters.hasOpenIssues = event.target.checked;
    renderRepos();
  });

  bind(els.publicScope, "change", (event) => {
    state.filters.publicScope = event.target.value;
    renderRepos();
  });

  bind(els.enableOwner, "click", enableOwnerMode);
  bind(els.ownerConnect, "click", enableOwnerMode);
  bind(els.clearOwner, "click", disableOwnerMode);
  bind(els.themeToggle, "click", toggleTheme);
  bind(els.impactOpenTop, "click", openCurrentImpactPage);
  bind(els.impactPrev, "click", () => {
    state.ownerActions.page = Math.max(0, state.ownerActions.page - 1);
    renderImpactDashboard();
  });
  bind(els.impactNext, "click", () => {
    state.ownerActions.page = Math.min(impactPageCount() - 1, state.ownerActions.page + 1);
    renderImpactDashboard();
  });
  bind(els.impactRefresh, "click", async () => {
    if (!state.ownerAuthToken) return;
    els.impactRefresh.disabled = true;
    try {
      await loadOwnerDashboard();
    } catch (error) {
      window.alert(error.message);
    } finally {
      els.impactRefresh.disabled = false;
    }
  });

  bind(els.impactList, "click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;

    const action = target.dataset.action;
    const url = target.dataset.url;
    if (!action || !url) return;

    if (action === "snooze") {
      snoozeOwnerAction(url);
      return;
    }

    if (action === "dismiss") {
      dismissOwnerAction(url);
    }
  });

  restoreOwnerMode();
  if (!isOwnerMode()) {
    els.ownerAccess.hidden = false;
    els.publicScopeWrap.hidden = false;
  }

  renderOwnerBadge();
  initTheme();

  renderRepos();
}

init().catch((error) => {
  console.error(error);
  els.summary.textContent = error.message;
});
