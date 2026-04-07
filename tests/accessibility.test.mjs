import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { after, before, test } from "node:test";

import AxeBuilder from "@axe-core/playwright";
import { chromium, devices } from "playwright";

const ROOT_DIR = process.cwd();
const HOST = "127.0.0.1";
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const scenarios = [
  {
    name: "desktop light",
    contextOptions: {
      colorScheme: "light",
      viewport: { width: 1440, height: 1100 }
    }
  },
  {
    name: "desktop dark",
    contextOptions: {
      colorScheme: "dark",
      viewport: { width: 1440, height: 1100 }
    }
  },
  {
    name: "mobile light",
    contextOptions: {
      ...devices["iPhone 13"],
      colorScheme: "light"
    }
  },
  {
    name: "mobile dark",
    contextOptions: {
      ...devices["iPhone 13"],
      colorScheme: "dark"
    }
  }
];

function buildSiteData() {
  const result = spawnSync(process.execPath, ["scripts/build-site-data.mjs"], {
    cwd: ROOT_DIR,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "Failed to build site data.");
  }
}

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
      const fileContents = await readFile(filePath);
      response.writeHead(200, {
        "Content-Type": MIME_TYPES[extname(filePath)] || "application/octet-stream",
        "Cache-Control": "no-store"
      });
      response.end(fileContents);
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
    }
  });
}

function formatViolations(violations) {
  return violations
    .map((violation) => {
      const nodes = violation.nodes
        .map((node) => `${node.target.join(", ")}: ${node.failureSummary || "No summary provided."}`)
        .join("\n");

      return `${violation.id} (${violation.impact || "unknown"})\n${violation.help}\n${nodes}`;
    })
    .join("\n\n");
}

buildSiteData();

const server = createStaticServer();
let baseUrl = "";

before(async () => {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, () => {
      server.off("error", reject);
      const address = server.address();
      baseUrl = `http://${HOST}:${address.port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
});

for (const scenario of scenarios) {
  test(`axe scan passes in ${scenario.name}`, async () => {
    const browser = await chromium.launch();
    const context = await browser.newContext(scenario.contextOptions);
    const page = await context.newPage();

    try {
      await page.goto(baseUrl, { waitUntil: "networkidle" });
      await page.waitForSelector("#repo-grid .card");

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();

      assert.equal(
        results.violations.length,
        0,
        `Axe violations found for ${scenario.name}:\n\n${formatViolations(results.violations)}`
      );
    } finally {
      await context.close();
      await browser.close();
    }
  });
}