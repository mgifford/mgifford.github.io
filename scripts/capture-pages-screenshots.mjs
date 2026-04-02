import { existsSync } from "node:fs";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { chromium } from "playwright";

const INPUT = "data/site-data.json";
const OUTPUT = "data/generated/screenshots.json";
const SHOT_DIR = "src/assets/screenshots";
const _maxEnv = Number.parseInt(process.env.MAX_SCREENSHOTS || "24", 10);
const MAX_CAPTURES = _maxEnv === 0 ? Number.POSITIVE_INFINITY : _maxEnv;
const FORCE_REFRESH = String(process.env.FORCE_SCREENSHOT_REFRESH || "false") === "true";

function candidateUrl(repo) {
  if (repo.homepage && /^https?:\/\//.test(repo.homepage)) {
    return repo.homepage;
  }

  if (repo.hasPages) {
    return `https://${repo.owner || "mgifford"}.github.io/${repo.name}/`;
  }

  return "";
}

async function main() {
  if (!existsSync(INPUT)) {
    throw new Error(`Missing ${INPUT}. Run npm run sync:all first.`);
  }

  const data = JSON.parse(await readFile(INPUT, "utf8"));
  const previousReport = existsSync(OUTPUT)
    ? JSON.parse(await readFile(OUTPUT, "utf8"))
    : { captures: [] };
  const previousByRepo = new Map((previousReport.captures || []).map((item) => [item.repo, item]));

  const repos = data.repos || [];
  const allCandidates = repos
    .map((repo) => ({
      repo: repo.name,
      owner: data.owner || "mgifford",
      url: candidateUrl(repo),
      pushedAt: repo.pushedAt || repo.updatedAt || null
    }))
    .filter((item) => item.url);

  const targets = allCandidates
    .filter((item) => {
      if (FORCE_REFRESH) return true;

      const previous = previousByRepo.get(item.repo);
      if (!previous || !previous.ok || !previous.path) return true;
      if ((previous.url || "") !== item.url) return true;
      if (!previous.repoPushedAt || !item.pushedAt) return true;

      return previous.repoPushedAt !== item.pushedAt;
    })
    .slice(0, MAX_CAPTURES);

  await mkdir(SHOT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  const captures = [];

  for (const candidate of allCandidates) {
    const previous = previousByRepo.get(candidate.repo);
    if (!previous) continue;

    const willRecapture = targets.some((target) => target.repo === candidate.repo);
    if (willRecapture) continue;

    captures.push({
      ...previous,
      skipped: true,
      skipReason: "Unchanged since last capture"
    });
  }

  for (const target of targets) {
    const fileName = `${target.repo}.png`;
    const shotPath = `${SHOT_DIR}/${fileName}`;

    try {
      await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.screenshot({ path: shotPath, fullPage: false });
      captures.push({
        repo: target.repo,
        url: target.url,
        path: shotPath,
        ok: true,
        repoPushedAt: target.pushedAt,
        capturedAt: new Date().toISOString()
      });
      console.log(`Captured ${target.repo}`);
    } catch (error) {
      captures.push({
        repo: target.repo,
        url: target.url,
        path: "",
        ok: false,
        repoPushedAt: target.pushedAt,
        capturedAt: new Date().toISOString(),
        error: String(error.message || error)
      });
      console.warn(`Failed ${target.repo}: ${error.message}`);
    }
  }

  await browser.close();
  await writeFile(
    OUTPUT,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        mode: FORCE_REFRESH ? "force-refresh" : "changed-only",
        maxCaptures: MAX_CAPTURES,
        captures
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  console.log(`Screenshot report written to ${OUTPUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
