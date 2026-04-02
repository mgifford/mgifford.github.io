const DATA_PATH = "data/site-data.json";
const TOKEN_KEY = "mgiffordRepoCatalogToken";

const els = {
  storyStats: document.querySelector("#story-stats"),
  publicScopeWrap: document.querySelector("#public-scope-wrap"),
  publicScope: document.querySelector("#public-scope"),
  search: document.querySelector("#search"),
  themeFilter: document.querySelector("#theme-filter"),
  sortBy: document.querySelector("#sort-by"),
  archivedWrap: document.querySelector("#archived-wrap"),
  archivedMode: document.querySelector("#archived-mode"),
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
  token: window.localStorage.getItem(TOKEN_KEY) || "",
  filters: {
    search: "",
    theme: "all",
    sortBy: "stars",
    archivedMode: "hide",
    publicScope: "curated"
  },
  publicView: {
    curatedMax: 60
  },
  ownerActions: {
    items: [],
    page: 0,
    pageSize: 10
  }
};

function isOwnerMode() {
  return Boolean(state.token) && !els.ownerPanel.hidden;
}

function sortRepos(repos, mode) {
  const sorted = [...repos];

  sorted.sort((a, b) => {
    if (mode === "name") return a.name.localeCompare(b.name);
    if (mode === "updated") return new Date(b.updatedAt) - new Date(a.updatedAt);
    if (mode === "watchers") return (b.watchers || 0) - (a.watchers || 0);
    return (b.stars || 0) - (a.stars || 0);
  });

  return sorted;
}

function filterRepos(repos) {
  const q = state.filters.search.trim().toLowerCase();

  return repos.filter((repo) => {
    if (state.filters.theme !== "all" && repo.theme !== state.filters.theme) return false;

    if (state.filters.archivedMode === "hide" && repo.archived) return false;
    if (state.filters.archivedMode === "only" && !repo.archived) return false;

    if (!q) return true;

    const haystack = [repo.name, repo.summary, repo.language, repo.theme, ...(repo.topics || [])]
      .join(" ")
      .toLowerCase();

    return haystack.includes(q);
  });
}

function applyPublicScope(sortedRepos) {
  if (isOwnerMode() || state.filters.publicScope === "all") {
    return sortedRepos;
  }

  const maxItems = state.publicView.curatedMax;
  const featured = sortedRepos.filter((repo) => repo.featured);
  const featuredSet = new Set(featured.map((repo) => repo.name));
  const nonFeatured = sortedRepos.filter((repo) => !featuredSet.has(repo.name));

  return [...featured, ...nonFeatured].slice(0, maxItems);
}

function renderStoryStats() {
  const total = state.data.summary?.total || state.data.repos.length;
  const featured = state.data.summary?.featured || 0;
  const themes = (state.data.themes || []).length;
  const readmeNeedsAttention = state.data.summary?.readmeNeedsAttention || 0;

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
    <article class="story__card">
      <strong>${readmeNeedsAttention}</strong>
      <span>READMEs to improve</span>
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

function renderRepos() {
  const filtered = filterRepos(state.data.repos);
  const sorted = sortRepos(filtered, state.filters.sortBy);
  const visibleRepos = applyPublicScope(sorted);

  els.grid.innerHTML = "";

  for (const repo of visibleRepos) {
    const fragment = els.template.content.cloneNode(true);
    const card = fragment.querySelector(".card");
    const link = fragment.querySelector(".card__link");
    const image = fragment.querySelector(".card__image");
    const title = fragment.querySelector(".card__title");
    const desc = fragment.querySelector(".card__desc");
    const meta = fragment.querySelector(".card__meta");
    const flags = fragment.querySelector(".card__flags");

    link.href = repo.url;
    link.setAttribute("aria-label", `Open ${repo.name}`);

    image.src = repo.screenshot || "src/assets/placeholder.svg";
    image.alt = `Preview of ${repo.name}`;

    title.textContent = repo.name;
    desc.textContent = repo.summary;
    meta.textContent = `${repo.language} · ${repo.theme} · ${repo.stars} stars · ${repo.watchers} watchers`;

    const badge = [];
    if (repo.featured) badge.push("Featured");
    if (repo.archived) badge.push("Archived");
    if (repo.readme?.needsAttention) badge.push("README needs update");
    flags.textContent = badge.join(" · ");

    card.style.animationDelay = `${Math.min(200, els.grid.childElementCount * 18)}ms`;
    els.grid.appendChild(fragment);
  }

  renderSummary(visibleRepos.length, sorted.length);
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
    ...notifications.map((item) => ({
      title: `${item.subject.type}: ${item.subject.title}`,
      url: toWebUrlFromApiUrl(item.subject.url),
      reason: `Unread notification (${item.reason})`,
      score: item.reason === "review_requested" ? 95 : 82,
      updatedAt: item.updated_at
    })),
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
    default:
      return "Unread notifications";
  }
}

function renderOwnerMetrics(metrics) {
  els.ownerMetrics.innerHTML = "";

  for (const metric of metrics) {
    const div = document.createElement("div");
    div.className = "owner__metric";
    div.innerHTML = `<strong>${metricLabel(metric)}:</strong> ${metric.total} <small>${metric.note || ""}</small>`;
    els.ownerMetrics.appendChild(div);
  }
}

function impactPageCount() {
  const { items, pageSize } = state.ownerActions;
  return Math.max(1, Math.ceil(items.length / pageSize));
}

function currentImpactItems() {
  const { items, page, pageSize } = state.ownerActions;
  const start = page * pageSize;
  return items.slice(start, start + pageSize);
}

function renderImpactDashboard() {
  const pageItems = currentImpactItems();
  const total = state.ownerActions.items.length;
  const pages = impactPageCount();
  const pageNumber = state.ownerActions.page + 1;

  els.impactList.innerHTML = "";

  if (!total) {
    els.impactList.innerHTML = '<div class="impact__item">No actionable items found right now.</div>';
  } else {
    for (const [index, item] of pageItems.entries()) {
      const div = document.createElement("div");
      div.className = "impact__item";
      div.innerHTML = `<strong>${state.ownerActions.page * state.ownerActions.pageSize + index + 1}.</strong> <a href="${item.url}" target="_blank" rel="noreferrer noopener">${item.title}</a><div class="impact__meta">${item.reason}</div>`;
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
  const [metrics, actions] = await Promise.all([
    fetchOwnerSignals(state.token, state.data.owner),
    fetchOwnerActionItems(state.token, state.data.owner)
  ]);

  renderOwnerMetrics(metrics);
  state.ownerActions.items = actions;
  state.ownerActions.page = 0;
  renderImpactDashboard();
}

async function enableOwnerMode() {
  const existing = state.token;
  const token = window.prompt("Enter a GitHub token for owner mode", existing || "");
  if (!token) return;

  state.token = token.trim();
  window.localStorage.setItem(TOKEN_KEY, state.token);

  try {
    await loadOwnerDashboard();
    els.ownerPanel.hidden = false;
    els.archivedWrap.hidden = false;
    els.publicScopeWrap.hidden = true;
    els.clearOwner.hidden = false;
    renderRepos();
  } catch (error) {
    window.alert(error.message);
  }
}

async function restoreOwnerMode() {
  if (!state.token) return;

  try {
    await loadOwnerDashboard();
    els.ownerPanel.hidden = false;
    els.archivedWrap.hidden = false;
    els.publicScopeWrap.hidden = true;
    els.clearOwner.hidden = false;
  } catch {
    disableOwnerMode();
  }
}

function disableOwnerMode() {
  window.localStorage.removeItem(TOKEN_KEY);
  state.token = "";
  state.ownerActions.items = [];
  state.ownerActions.page = 0;
  state.filters.archivedMode = "hide";
  els.archivedMode.value = "hide";
  els.ownerPanel.hidden = true;
  els.archivedWrap.hidden = true;
  els.publicScopeWrap.hidden = false;
  els.clearOwner.hidden = true;
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
  els.sortBy.value = state.filters.sortBy;
  els.publicScope.value = state.filters.publicScope;

  populateThemeFilters(state.data.themes || []);
  renderStoryStats();

  const bind = (el, event, fn) => el.addEventListener(event, fn);

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
    renderRepos();
  });

  bind(els.archivedMode, "change", (event) => {
    state.filters.archivedMode = event.target.value;
    renderRepos();
  });

  bind(els.publicScope, "change", (event) => {
    state.filters.publicScope = event.target.value;
    renderRepos();
  });

  bind(els.enableOwner, "click", enableOwnerMode);
  bind(els.clearOwner, "click", disableOwnerMode);
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
    if (!state.token) return;
    els.impactRefresh.disabled = true;
    try {
      await loadOwnerDashboard();
    } catch (error) {
      window.alert(error.message);
    } finally {
      els.impactRefresh.disabled = false;
    }
  });

  await restoreOwnerMode();
  if (!isOwnerMode()) {
    els.publicScopeWrap.hidden = false;
  }

  renderRepos();
}

init().catch((error) => {
  console.error(error);
  els.summary.textContent = error.message;
});
