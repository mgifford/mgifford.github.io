# Sustainability Commitment (SUSTAINABILITY.md)

## 1. Our commitment

This project commits to reducing environmental impact while maintaining usability, accessibility, and transparency.

For this repository, sustainability means:

- Keeping the website lightweight and fast.
- Avoiding unnecessary compute-heavy automation.
- Minimizing storage and transfer footprint for generated assets.
- Using AI and automation intentionally, with clear value.

## 2. Real-time sustainability metrics

| Metric | Status / Value |
| :--- | :--- |
| Static site architecture | Yes (no always-on backend) |
| Scheduled workflow frequency | Weekly sync, monthly screenshots. No daily jobs. |
| Screenshot generation cap | Bounded by MAX_SCREENSHOTS |
| Activity API budget | 1,200 requests per weekly run (measured: 579) |
| Activity data retained | ~4.4 MB committed; recent payload ~1.1 MB / 120 KB gzip |
| Browser payload split | 7-day payload on load; older events lazy-loaded on demand |
| ETag cache | Conditional requests cached in GitHub Actions, never committed |
| Image optimization policy | Required before adding large assets |
| JS/CSS budget trend | Track and keep lean |
| Last sustainability review date | 2026-11-23 |

## 3. Contributor requirements (guardrails)

Contributors should follow these sustainability guardrails:

- Prefer static generation and precomputed data over runtime-heavy patterns.
- Keep dependencies minimal and remove unused packages quickly.
- Avoid adding large libraries when native browser APIs are sufficient.
- Minimize JavaScript sent to the client.
- Compress and optimize images and screenshots before commit when feasible.
- Avoid unnecessary polling or high-frequency cron jobs.
- Keep CI workflows scoped, cached, and deterministic.
- Document why compute-heavy workflows are necessary.

## 4. AI usage policy

AI-assisted development is allowed, but should be intentional and cost-aware.

Principles:

- Use AI for high-value tasks (design, analysis, documentation quality, difficult refactors).
- Do not require AI-driven cron jobs for routine maintenance.
- Prefer deterministic scripts for recurring automation.
- Review AI-generated content for correctness, accessibility, and clarity before merge.
- Avoid generating large volumes of low-signal content or duplicate assets.

## 5. Build and workflow efficiency

This project uses scheduled workflows designed to balance freshness and resource use:

- Weekly repository sync to detect new, deleted, archived, and metadata-updated repos.
- Weekly bounded activity collection for active public repositories only.
- Monthly screenshot refresh for repos with pages/home URLs.
- Static page generation at build time; no client-side data processing beyond filtering.

Efficiency rules:

- Keep schedule frequency conservative unless there is a documented need.
- Commit only changed generated files.
- Use dependency caching where possible.
- Limit screenshot capture volume with environment controls.
- Bound activity collection by repository count, page caps, and a hard request budget.
- Retain routine commit detail for 30 days; keep PRs, issues, reviews, and releases for
  the full 90-day lookback.
- Minify large generated event payloads and keep size budgets in the data validator.
- Lazy-load older activity so the default page does not transfer the full lookback.

## 6. Asset and content sustainability

- Use responsive, compressed images.
- Remove obsolete assets from the repository.
- Prefer SVG or text where practical.
- Keep placeholder media small and reusable.
- Avoid autoplaying heavy media on landing pages.

For screenshots:

- Capture only when a valid page URL exists.
- Keep dimensions reasonable for card previews.
- Skip or retry failed captures without rerunning the full pipeline unnecessarily.

## 7. Performance and user impact

Sustainability and performance are linked. We aim to:

- Keep first-load experience fast on low-bandwidth connections.
- Reduce total transfer size.
- Avoid CPU-heavy client-side rendering for simple views.
- Preserve readability and accessibility while optimizing assets.

## 8. Known limitations

- The repository currently stores generated metadata, activity data, and screenshots in git history, which can grow over time.
- Volume is bounded: routine commit detail is retained for 30 days, and payload size budgets fail validation if exceeded.
- Screenshot automation may occasionally produce larger-than-needed images.
- External GitHub API calls are required for synchronization and cannot be fully eliminated.
- The extended activity payload (3.0 MB raw / ~333 KB gzip) is fetched only when a
  visitor selects a range older than seven days.

## 9. Continuous improvement

Planned sustainability improvements:

- Add explicit size budgets for CSS, JS, and images (activity payload budgets are already enforced).
- Add optional image compression step in screenshot workflow.
- Add periodic cleanup policy for stale or obsolete screenshot assets.
- Add lightweight reporting in CI for changed asset weight.
- Review dependency footprint quarterly.

## 10. Reporting and collaboration

To report sustainability concerns, open an issue:

- https://github.com/mgifford/mgifford.github.io/issues

Suggested labels:

- sustainability
- performance
- automation
- documentation

Last updated: 2026-11-23
