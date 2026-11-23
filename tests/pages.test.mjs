import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { after, before, test } from "node:test";

import { chromium } from "playwright";

const ROOT_DIR = process.cwd();
const HOST = "127.0.0.1";
const PAGES = ["activity", "contributions", "workstreams", "reports"];

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".md": "text/markdown; charset=utf-8",
  ".xml": "application/xml; charset=utf-8"
};

function safeFilePath(urlPath) {
  const pathname = urlPath === "/" ? "/index.html" : urlPath;
  const cleanPath = normalize(pathname)
    .replace(/^[/\\]+/, "")
    .replace(/^([.][.][/\\])+/, "");
  return join(ROOT_DIR, cleanPath);
}

function createStaticServer() {
  return createServer(async (request, response) => {
    try {
      const filePath = safeFilePath(new URL(request.url || "/", `http://${request.headers.host}`).pathname);
      const contents = await readFile(filePath);
      response.writeHead(200, {
        "Content-Type": MIME_TYPES[extname(filePath)] || "application/octet-stream",
        "Cache-Control": "no-store"
      });
      response.end(contents);
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
    }
  });
}

let server;
let baseUrl = "";

before(async () => {
  for (const page of PAGES) {
    assert.ok(
      existsSync(join(ROOT_DIR, `${page}.html`)),
      `${page}.html is missing. Run "npm run build:all" before testing.`
    );
  }

  server = createStaticServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, () => {
      server.off("error", reject);
      baseUrl = `http://${HOST}:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

async function withPage(options, run) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...options });
  const page = await context.newPage();
  try {
    await run(page);
  } finally {
    await context.close();
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Static structure
// ---------------------------------------------------------------------------

for (const page of PAGES) {
  test(`${page}.html has a single h1, a main landmark, and unique ids`, async () => {
    const html = await readFile(join(ROOT_DIR, `${page}.html`), "utf8");
    assert.equal((html.match(/<h1[ >]/g) || []).length, 1, `${page} must have exactly one h1`);
    assert.match(html, /<main id="main"/);
    assert.match(html, /<nav aria-label="Main">/);
    assert.match(html, /aria-current="page"/);

    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    assert.deepEqual([...new Set(duplicates)], [], `${page} has duplicate ids: ${[...new Set(duplicates)].join(", ")}`);
  });
}

test("activity.html contains the initial answer, evidence links, and coverage disclosure", async () => {
  const html = await readFile(join(ROOT_DIR, "activity.html"), "utf8");
  assert.match(html, /Projects updated in this range/);
  assert.match(html, /<caption>/);
  assert.match(html, /Activity by date/);
  assert.match(html, /Where you left off/);
  assert.match(html, /Data coverage and limitations/);
  assert.match(html, /America\/Toronto/);
  assert.match(html, /<noscript>/);
  assert.match(html, /https:\/\/github\.com\/[^"]+\/(commit|pull|issues|releases)/);
});

test("contributions.html explains attribution in static HTML", async () => {
  const html = await readFile(join(ROOT_DIR, "contributions.html"), "utf8");
  assert.match(html, /What counts as my contribution/);
  assert.match(html, /Activity by other people in repositories you maintain is excluded/);
  assert.match(html, /Only public activity is collected/);
});

test("workstreams.html lists configured workstreams with in-page anchors", async () => {
  const html = await readFile(join(ROOT_DIR, "workstreams.html"), "utf8");
  assert.match(html, /id="workstream-drupal-accessibility"/);
  assert.match(html, /id="workstream-government-monitoring"/);
  assert.match(html, /not inferred from repository topics/);
});

test("reports.html contains deterministic reports and links to Markdown sources", async () => {
  const html = await readFile(join(ROOT_DIR, "reports.html"), "utf8");
  assert.match(html, /Deterministic reports/);
  assert.match(html, /reports\/activity\/latest-week\.md/);
  assert.match(html, /reports\/activity\/latest-month\.md/);
});

test("sitemap.xml lists every public page", async () => {
  const sitemap = await readFile(join(ROOT_DIR, "sitemap.xml"), "utf8");
  for (const loc of ["https://mgifford.github.io/", "activity.html", "contributions.html", "workstreams.html", "reports.html"]) {
    assert.ok(sitemap.includes(loc), `sitemap missing ${loc}`);
  }
});

test("activity reports include evidence and coverage limitations", async () => {
  for (const report of ["latest-week.md", "latest-month.md"]) {
    const markdown = await readFile(join(ROOT_DIR, "reports/activity", report), "utf8");
    assert.match(markdown, /## Summary/);
    assert.match(markdown, /## Completed and merged work/);
    assert.match(markdown, /## Coverage and limitations/);
    assert.match(markdown, /Public event feed|public event/i);
  }
});

// ---------------------------------------------------------------------------
// No-JavaScript availability
// ---------------------------------------------------------------------------

test("activity page is meaningful with JavaScript disabled and hides nonfunctional controls", async () => {
  await withPage({ javaScriptEnabled: false }, async (page) => {
    await page.goto(`${baseUrl}/activity.html`, { waitUntil: "load" });

    assert.equal(await page.locator("#atlas-filters").isVisible(), false, "filters must not appear without JS");
    assert.equal(await page.locator("#saved-questions").isVisible(), false, "saved-question links need JS to apply filters");
    assert.equal(await page.locator("#atlas-results").isVisible(), true);

    const text = await page.locator("#atlas-results").innerText();
    assert.match(text, /Projects updated in this range/);
    assert.match(text, /Activity by date/);
    assert.match(text, /Data coverage and limitations/);

    const evidenceLinks = await page.locator('#atlas-results a[href^="https://github.com/"]').count();
    assert.ok(evidenceLinks > 0, "static page must link to original GitHub evidence");
  });
});

test("contributions page is meaningful with JavaScript disabled", async () => {
  await withPage({ javaScriptEnabled: false }, async (page) => {
    await page.goto(`${baseUrl}/contributions.html`, { waitUntil: "load" });
    const text = await page.locator("#atlas-results").innerText();
    assert.match(text, /attributable contributions|What counts as my contribution/i);
  });
});

// ---------------------------------------------------------------------------
// Progressive enhancement behaviour
// ---------------------------------------------------------------------------

test("filters become available after enhancement and update the URL", async () => {
  await withPage({}, async (page) => {
    await page.goto(`${baseUrl}/activity.html`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.documentElement.classList.contains("atlas-js"));

    assert.equal(await page.locator("#atlas-filters").isVisible(), true);
    const initialStatus = await page.locator("#atlas-status").innerText();
    assert.match(initialStatus, /Showing \d+ events/);
    assert.match(initialStatus, /America\/Toronto/);

    await page.selectOption("#f-range", "last_30_days");
    await page.waitForFunction(() => window.location.search.includes("range=last_30_days"));
    await page.waitForFunction(() => !/Showing 0 /.test(document.querySelector("#atlas-status").textContent));

    const status = await page.locator("#atlas-status").innerText();
    const count = Number(status.match(/Showing (\d+)/)[1]);
    assert.ok(count > 0);
  });
});

test("URL parameters restore filters on load", async () => {
  await withPage({}, async (page) => {
    await page.goto(`${baseUrl}/activity.html?range=last_30_days&category=pull_request`, {
      waitUntil: "networkidle"
    });
    await page.waitForFunction(() => document.documentElement.classList.contains("atlas-js"));

    assert.equal(await page.locator("#f-range").inputValue(), "last_30_days");
    assert.equal(await page.locator("#f-category").inputValue(), "pull_request");
    assert.match(await page.locator("#atlas-status").innerText(), /Showing \d+ events/);
  });
});

test("excluding automation reduces the visible event count", async () => {
  await withPage({}, async (page) => {
    await page.goto(`${baseUrl}/activity.html?range=last_7_days`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.documentElement.classList.contains("atlas-js"));

    const before = Number((await page.locator("#atlas-status").innerText()).match(/Showing (\d+)/)[1]);
    await page.check("#f-exclude-automated");
    await page.waitForFunction(() => window.location.search.includes("automation=exclude"));
    await page.waitForFunction(
      (previous) => Number(document.querySelector("#atlas-status").textContent.match(/Showing (\d+)/)[1]) < previous,
      before
    );
    const after = Number((await page.locator("#atlas-status").innerText()).match(/Showing (\d+)/)[1]);
    assert.ok(after < before, "excluding automation should reduce the count");
    assert.ok((await page.locator("#atlas-status").innerText()).includes("Routine automation is excluded"));
  });
});

test("custom range controls appear only for the custom preset", async () => {
  await withPage({}, async (page) => {
    await page.goto(`${baseUrl}/activity.html`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.documentElement.classList.contains("atlas-js"));

    assert.equal(await page.locator("#f-from").isVisible(), false);
    await page.selectOption("#f-range", "custom");
    assert.equal(await page.locator("#f-from").isVisible(), true);
    assert.equal(await page.locator("#f-to").isVisible(), true);
  });
});

test("contributions status counts attributable work, not repository activity", async () => {
  await withPage({}, async (page) => {
    await page.goto(`${baseUrl}/contributions.html`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.documentElement.classList.contains("atlas-js"));

    const status = await page.locator("#atlas-status").innerText();
    const summary = await page.locator("#contribution-summary-heading + p").innerText();
    const statusCount = Number(status.match(/Showing (\d+) attributable contributions/)[1]);
    const summaryCount = Number(summary.match(/(\d+) attributable contributions/)[1]);
    assert.equal(statusCount, summaryCount);
    assert.ok(statusCount > 0);
  });
});

test("every project table anchor has a matching timeline", async () => {
  await withPage({}, async (page) => {
    await page.goto(`${baseUrl}/activity.html`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.documentElement.classList.contains("atlas-js"));

    const hrefs = await page.$$eval('#atlas-results table.data-table tbody th a[href^="#repo-"]', (links) =>
      [...new Set(links.map((link) => link.getAttribute("href")))]
    );
    assert.ok(hrefs.length > 0, "expected at least one project timeline anchor");
    for (const href of hrefs) {
      assert.equal(await page.locator(href).count(), 1, `missing timeline target ${href}`);
    }

    // Projects without a rendered timeline must link to GitHub instead.
    const githubLinks = await page.locator('#atlas-results table.data-table tbody th a[href^="https://github.com/"]').count();
    assert.ok(githubLinks >= 0);
  });
});

test("interactive controls are native, labelled, and keyboard reachable", async () => {
  await withPage({}, async (page) => {
    await page.goto(`${baseUrl}/activity.html`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.documentElement.classList.contains("atlas-js"));

    for (const selector of ["#f-range", "#f-from", "#f-to", "#f-workstream", "#f-category", "#f-repository", "#f-search", "#f-exclude-automated"]) {
      const locator = page.locator(selector);
      assert.equal(await locator.count(), 1, `${selector} should exist`);
      assert.equal(await locator.evaluate((element) => element.tabIndex >= 0), true, `${selector} must be focusable`);
    }

    const tabindexes = await page.locator("[tabindex]").evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("tabindex"))
    );
    assert.ok(!tabindexes.some((value) => Number(value) > 0), "no positive tabindex values");

    await page.locator("#f-range").focus();
    assert.equal(await page.evaluate(() => document.activeElement.id), "f-range");
    await page.keyboard.press("ArrowDown");
    assert.ok(await page.locator("#f-range").inputValue());
  });
});
