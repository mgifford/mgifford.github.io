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
| Scheduled workflow frequency | Weekly sync, monthly screenshots |
| Screenshot generation cap | Bounded by MAX_SCREENSHOTS |
| Image optimization policy | Required before adding large assets |
| JS/CSS budget trend | Track and keep lean |
| Last sustainability review date | 2026-04-02 |

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

- Weekly repository sync to detect new, deleted, and archived repos.
- Monthly screenshot refresh for repos with pages/home URLs.

Efficiency rules:

- Keep schedule frequency conservative unless there is a documented need.
- Commit only changed generated files.
- Use dependency caching where possible.
- Limit screenshot capture volume with environment controls.

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

- The repository currently stores generated metadata and screenshots in git history, which can grow over time.
- Screenshot automation may occasionally produce larger-than-needed images.
- External GitHub API calls are required for synchronization and cannot be fully eliminated.

## 9. Continuous improvement

Planned sustainability improvements:

- Add explicit size budgets for CSS, JS, and images.
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

Last updated: 2026-04-02
