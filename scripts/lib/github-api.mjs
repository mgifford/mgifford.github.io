/**
 * Minimal GitHub REST client for the activity collector.
 *
 * Goals:
 * - bounded requests (hard budget, rate-limit awareness)
 * - retry transient failures without hammering the API
 * - conditional requests (ETag) so repeated weekly runs are cheap
 * - graceful, typed failure reasons so incomplete coverage can be disclosed
 *
 * The client accepts an injectable `fetchImpl` so pagination, caching, and
 * rate-limit behaviour can be tested without network access.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const DEFAULT_USER_AGENT = "project-atlas-activity-collector";
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

/**
 * Parses an RFC 8288 Link header into `{ rel: url }`.
 * @param {string|null|undefined} value
 * @returns {Record<string,string>}
 */
export function parseLinkHeader(value) {
  if (!value) return {};
  return value.split(",").reduce((acc, chunk) => {
    const [urlPart, relPart] = chunk.split(";").map((part) => part.trim());
    const url = urlPart?.slice(1, -1);
    const relMatch = relPart?.match(/rel="(.*)"/);
    if (url && relMatch) acc[relMatch[1]] = url;
    return acc;
  }, {});
}

/** Returns the `next` page URL from a Link header, or null. */
export function extractNextLink(value) {
  return parseLinkHeader(value).next || null;
}

/**
 * Request budget shared by every call in a run. Keeping this explicit makes
 * the cost of a refresh measurable and prevents runaway pagination.
 */
export function createRequestBudget({ maxRequests = 800, reserve = 25 } = {}) {
  let used = 0;
  const budget = {
    maxRequests,
    reserve,
    exhausted: false,
    reason: null,
    get used() {
      return used;
    },
    get remaining() {
      return Math.max(0, maxRequests - used);
    },
    canRequest() {
      return !budget.exhausted && used < maxRequests;
    },
    record(count = 1) {
      used += count;
      if (used >= maxRequests) {
        budget.exhausted = true;
        budget.reason = "request-budget";
      }
    },
    /**
     * Stops before the account is drained by unrelated work.
     * Only the core REST quota is tracked here: search has a separate, much
     * smaller quota and must not halt core collection.
     */
    noteRateLimit(headers) {
      const resource = headers?.get?.("x-ratelimit-resource") || "core";
      const raw = headers?.get?.("x-ratelimit-remaining");
      if (raw === null || raw === undefined) return null;
      const remaining = Number(raw);
      if (resource === "core" && Number.isFinite(remaining) && remaining <= reserve) {
        budget.exhausted = true;
        budget.reason = "rate-limit-reserve";
      }
      return Number.isFinite(remaining) ? remaining : null;
    }
  };
  return budget;
}

function cacheKey(url) {
  return createHash("sha256").update(url).digest("hex");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @typedef {object} GitHubResponse
 * @property {boolean} ok
 * @property {number} status
 * @property {any} data
 * @property {Headers|null} headers
 * @property {boolean} notModified
 * @property {string|null} reason
 */

export class GitHubClient {
  constructor(options = {}) {
    this.token = options.token || "";
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.cacheDir = options.cacheDir || null;
    this.budget = options.budget || createRequestBudget();
    this.userAgent = options.userAgent || DEFAULT_USER_AGENT;
    this.retryBaseMs = options.retryBaseMs ?? 800;
    this.maxRetries = options.maxRetries ?? 2;
    this.logger = options.logger || console;
    this.searchExhausted = false;
    this.stats = {
      requests: 0,
      cacheHits: 0,
      notModified: 0,
      retries: 0,
      failures: 0,
      rateLimited: 0,
      unauthorized: 0,
      notFound: 0
    };
  }

  get authenticated() {
    return Boolean(this.token);
  }

  async readCache(url) {
    if (!this.cacheDir) return null;
    try {
      const raw = await readFile(join(this.cacheDir, `${cacheKey(url)}.json`), "utf8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async writeCache(url, entry) {
    if (!this.cacheDir) return;
    try {
      const file = join(this.cacheDir, `${cacheKey(url)}.json`);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(entry), "utf8");
    } catch {
      // Caching is an optimisation; a read-only filesystem must not fail a run.
    }
  }

  /**
   * Performs one logical request with retries and optional conditional cache.
   *
   * @param {string} url
   * @param {{accept?:string, method?:string, retries?:number}} [options]
   * @returns {Promise<GitHubResponse>}
   */
  async request(url, options = {}) {
    const { accept = "application/vnd.github+json", method = "GET" } = options;
    const retries = options.retries ?? this.maxRetries;

    if (!this.token) {
      return { ok: false, status: 0, data: null, headers: null, notModified: false, reason: "no-token" };
    }

    if (!this.budget.canRequest()) {
      return { ok: false, status: 0, data: null, headers: null, notModified: false, reason: "budget-exhausted" };
    }

    const cached = method === "GET" ? await this.readCache(url) : null;
    const headers = {
      Accept: accept,
      "User-Agent": this.userAgent,
      Authorization: `Bearer ${this.token}`,
      "X-GitHub-Api-Version": "2022-11-28"
    };
    if (cached?.etag) headers["If-None-Match"] = cached.etag;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (!this.budget.canRequest()) {
        return { ok: false, status: 0, data: null, headers: null, notModified: false, reason: "budget-exhausted" };
      }

      this.budget.record(1);
      this.stats.requests += 1;

      let response;
      try {
        response = await this.fetchImpl(url, { method, headers });
      } catch (error) {
        if (attempt < retries) {
          this.stats.retries += 1;
          await sleep(this.retryBaseMs * 2 ** attempt);
          continue;
        }
        this.stats.failures += 1;
        return { ok: false, status: 0, data: null, headers: null, notModified: false, reason: `network-error: ${error.message}` };
      }

      this.budget.noteRateLimit(response.headers);

      if (response.status === 304) {
        this.stats.notModified += 1;
        return {
          ok: true,
          status: 304,
          data: cached?.body ?? null,
          headers: response.headers,
          notModified: true,
          reason: null
        };
      }

      if (response.status === 401) {
        this.stats.unauthorized += 1;
        return { ok: false, status: 401, data: null, headers: response.headers, notModified: false, reason: "unauthorized" };
      }

      if (response.status === 404 || response.status === 410) {
        this.stats.notFound += 1;
        return {
          ok: false,
          status: response.status,
          data: null,
          headers: response.headers,
          notModified: false,
          reason: response.status === 404 ? "not-found" : "gone"
        };
      }

      if (response.status === 403) {
        const remaining = response.headers.get?.("x-ratelimit-remaining");
        const resource = response.headers.get?.("x-ratelimit-resource") || "core";
        if (remaining === "0" && resource === "search") {
          this.stats.rateLimited += 1;
          this.searchExhausted = true;
          return { ok: false, status: 403, data: null, headers: response.headers, notModified: false, reason: "search-rate-limit" };
        }
        if (remaining === "0") {
          this.stats.rateLimited += 1;
          this.budget.exhausted = true;
          this.budget.reason = "rate-limit-exceeded";
          return { ok: false, status: 403, data: null, headers: response.headers, notModified: false, reason: "rate-limit" };
        }
        // Secondary rate limits are retryable.
        if (attempt < retries) {
          this.stats.retries += 1;
          await sleep(this.retryBaseMs * 2 ** attempt);
          continue;
        }
        this.stats.failures += 1;
        return { ok: false, status: 403, data: null, headers: response.headers, notModified: false, reason: "forbidden" };
      }

      if (RETRYABLE_STATUSES.has(response.status)) {
        if (attempt < retries) {
          this.stats.retries += 1;
          const retryAfter = Number(response.headers.get?.("retry-after"));
          const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : this.retryBaseMs * 2 ** attempt;
          await sleep(delay);
          continue;
        }
        this.stats.failures += 1;
        return { ok: false, status: response.status, data: null, headers: response.headers, notModified: false, reason: `http-${response.status}` };
      }

      if (!response.ok) {
        this.stats.failures += 1;
        return {
          ok: false,
          status: response.status,
          data: null,
          headers: response.headers,
          notModified: false,
          reason: `http-${response.status}`
        };
      }

      const data = await response.json().catch(() => null);
      const etag = response.headers.get?.("etag");
      if (method === "GET" && etag) {
        await this.writeCache(url, { etag, body: data, fetchedAt: new Date().toISOString() });
      }

      return { ok: true, status: response.status, data, headers: response.headers, notModified: false, reason: null };
    }

    return { ok: false, status: 0, data: null, headers: null, notModified: false, reason: "retry-exhausted" };
  }

  /** Convenience wrapper returning data or null. */
  async json(url, options) {
    const result = await this.request(url, options);
    return result.ok ? result.data : null;
  }

  /**
   * Follows Link rel="next" up to `maxPages`.
   *
   * @param {string} url
   * @param {{accept?:string, maxPages?:number, perPage?:number}} [options]
   * @returns {Promise<{items: any[], pages: number, complete: boolean, reason: string|null}>}
   */
  async paginate(url, options = {}) {
    const { accept, maxPages = 3, perPage = 100 } = options;
    const items = [];
    let nextUrl = appendPerPage(url, perPage);
    let pages = 0;
    let complete = false;

    while (nextUrl && pages < maxPages) {
      const result = await this.request(nextUrl, { accept });
      pages += 1;
      if (!result.ok) {
        return { items, pages, complete: false, reason: result.reason };
      }
      if (Array.isArray(result.data)) items.push(...result.data);
      nextUrl = extractNextLink(result.headers?.get?.("link"));
    }

    complete = !nextUrl;
    return { items, pages, complete, reason: complete ? null : "page-cap" };
  }
}

/** Adds or replaces per_page without mutating the input URL. */
export function appendPerPage(url, perPage) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("per_page", String(perPage));
    return parsed.toString();
  } catch {
    return url;
  }
}

/** True when the failure reason indicates data could not be collected. */
export function isAvailabilityFailure(reason) {
  return [
    "no-token",
    "budget-exhausted",
    "rate-limit",
    "rate-limit-exceeded",
    "unauthorized",
    "forbidden",
    "not-found",
    "gone",
    "page-cap",
    "search-rate-limit"
  ].includes(reason);
}
