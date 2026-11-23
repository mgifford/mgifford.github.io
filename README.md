# Project Atlas: Open-Source Work, Activity, and Knowledge

**A curated catalogue of open-source projects, extended with an evidence-backed activity dashboard for understanding recent work.**

**[Explore the projects](https://mgifford.github.io/)** · [Recent activity](https://mgifford.github.io/activity.html) · [My contributions](https://mgifford.github.io/contributions.html) · [Workstreams](https://mgifford.github.io/workstreams.html) · [Reports](https://mgifford.github.io/reports.html)

This repository powers [mgifford.github.io](https://mgifford.github.io/), a public catalogue of projects developed, maintained, or contributed to by Mike Gifford.

The catalogue makes it easier to discover the purpose of individual projects, explore related work, and find their source code, demonstrations, documentation, and ongoing development.

Project Atlas adds a second question: **what changed recently, who did it, and what still needs attention?** It combines the curated catalogue with a normalized, public, evidence-linked activity index. Every activity row points back to the commit, pull request, issue, review, release, or metadata change that supports it.

## What you can ask

| Question | Where |
|---|---|
| Which projects were updated this week? | [Recent Activity](https://mgifford.github.io/activity.html) |
| Which projects had commits, pull requests, issues, or releases in a date range? | Recent Activity, with saved questions and shareable filter URLs |
| What has `mgifford` worked on recently, including projects he does not own? | [My Contributions](https://mgifford.github.io/contributions.html) |
| Where did I leave off on a specific project? | Project timelines on Recent Activity, with open-work signals |
| Which workstreams moved forward? | [Workstreams](https://mgifford.github.io/workstreams.html) |
| What was completed or still in progress over the last week or month? | [Reports](https://mgifford.github.io/reports.html) |

The activity views are deterministic. They do not require an AI model, and they work
without JavaScript: each page contains a complete static snapshot for its default date
range, with links to the original evidence. Interactive filters are a progressive
enhancement.

Reporting dates use `America/Toronto` and are configurable in
[`data/workstreams.yml`](data/workstreams.yml). "This week" means Monday 00:00 local
time to now. "Last 7 days" is a rolling 168-hour window. The resolved range is always
shown in the interface.

## Why this project exists

A GitHub account containing hundreds of repositories is difficult to navigate.

Repository names rarely communicate the full purpose of a project. GitHub activity, stars, and programming languages provide useful information but do not necessarily explain why the work matters or who might benefit from it.

This catalogue aims to provide a more useful entry point.

It combines:

- Human-written project descriptions and editorial curation.
- Automated GitHub repository metadata.
- Links to published demonstrations and reports.
- Project screenshots where available.
- Thematic groupings connecting related work.
- Maintenance signals identifying projects that need attention.

**The goal is to make useful work easier to find, understand, evaluate, reuse, and improve.**

## Explore the research themes

The catalogue organizes projects into several broad themes.

### Digital accessibility and inclusive design

Projects investigating how to make software, content, and digital services more accessible.

Examples include:

| Project | Focus |
|---|---|
| [WCAG Spine](https://github.com/mgifford/wcag-spine) | Connecting WCAG requirements with testing rules, organizational responsibilities, and functional accessibility needs |
| [Open Scans](https://github.com/mgifford/open-scans) | Comparing accessibility testing engines, ACT Rules, and differences in automated findings |
| [Drupal Core Lab](https://github.com/mgifford/drupal-core-lab) | Reproducible before-and-after experiments for Drupal development, accessibility, and performance |
| [OpenACR Release Evidence](https://github.com/mgifford/openacr-release-evidence) | Investigating version-specific accessibility evidence and automated reporting for software releases |
| [Design System Lab](https://github.com/mgifford/design-system-lab) | Experimenting with design-system components, accessibility, and user preferences |

### Digital government and public-interest technology

Projects examining how governments design, procure, maintain, and evaluate digital services.

Examples include:

| Project | Focus |
|---|---|
| [VITAL Scans](https://github.com/mgifford/vital-core) | Continuous website quality monitoring and historical evidence |
| [EU Plus Government Scans](https://github.com/mgifford/eu-plus-government-scans) | Comparative research into government websites, accessibility, technology adoption, and digital dependencies |
| [Drupal Core Monitoring](https://github.com/mgifford/drupal-core) | Automated quality monitoring and reporting for Drupal |
| [FASTER](https://github.com/mgifford/FASTER) | Exploring ways to make standards and horizontal review processes more efficient and evidence-based |

### Open standards and sustainable technology

Projects exploring open standards, accountable technology governance, resource efficiency, and long-term sustainability.

Examples include:

| Project | Focus |
|---|---|
| [Firefox Energy Scanner](https://github.com/mgifford/firefox-energy-scanner) | Investigating browser resource consumption and energy-related signals |
| [MENA Policy Observatory](https://github.com/mgifford/mena-policy-observatory) | Researching digital policies, their sources, and opportunities for structured policy information |

### Research and experimentation

The catalogue also includes experimental projects investigating new approaches to difficult problems.

For example, [AEDES Project UIF](https://github.com/mgifford/aedesproject-uif) explores whether vector-borne disease surveillance methods can be transferred between regions and diseases.

Experimental projects should clearly distinguish validated findings from hypotheses, demonstrations, and untested capabilities.

These examples are representative, not a complete project inventory.

[Browse the full catalogue](https://mgifford.github.io/).

## How the catalogue works

The site combines automated repository discovery with human editorial control.

### Automated repository information

A scheduled GitHub Actions workflow retrieves public repository information, including:

- Repository names and descriptions.
- Links to source code and published sites.
- Primary programming languages and topics.
- Stars, watchers, and issue counts.
- Repository activity and archival status.
- README quality indicators.
- Availability of selected project governance and AI instruction files.

The catalogue also detects changes such as newly discovered, removed, archived, and unarchived repositories, and records timestamp and metadata changes that were previously discarded.

### Activity evidence

A bounded weekly collection adds normalized events from public GitHub data:

- Commits, pull requests, issues, comments, releases, and workflow results in
  repositories owned by the account.
- Public contribution events and authored work in repositories outside the account.
- Repository metadata changes detected by diffing weekly snapshots.

Events record the actor, role, timestamp, source URL, automation status, and outcome.
Automated maintenance is labelled and never counted as personal work. An opened pull
request is not treated as shipped; a merged pull request is not treated as a
deployment.

Collection is capped by repository count, page count, and a hard API-request budget.
Coverage is published with the data, including unavailable or partial sources, so a
gap is never presented as inactivity. See
[`docs/data-provenance.md`](docs/data-provenance.md) and
[`docs/activity-schema.md`](docs/activity-schema.md).

The resulting data is stored in version-controlled JSON files.

### Human curation

The catalogue does not rely on repository popularity alone to determine which projects matter.

The file [`data/curation.yml`](data/curation.yml) controls editorial choices, including:

- Featured projects.
- Project themes.
- Display titles.
- Short descriptions.
- Featured-project narratives.
- Manual ordering.
- Public visibility.
- Screenshot overrides.

The goal is to emphasize relevance and usefulness rather than merely highlighting projects with the most GitHub stars.

### Screenshots and project previews

A separate workflow captures preview images for selected repositories that provide a website or GitHub Pages destination.

These images help visitors understand the projects before opening them.

Screenshots are supporting material, not substitutes for meaningful text descriptions or links to accessible live demonstrations.

### Public and owner views

The public view presents the curated project catalogue.

The codebase also contains an owner-maintenance interface intended to help identify work requiring attention, including open pull requests, stale issues, repository quality signals, and other maintenance tasks.

The activity views are public-only. They use public GitHub data, never notifications,
private repositories, or authenticated-only signals. Owner mode remains disabled.

It would require an appropriate authentication or server-side reporting mechanism.

GitHub Actions secrets must never be exposed to client-side JavaScript, and private
API results must never be written into GitHub Pages files.

## Search and AI discoverability

An important objective is to make open-source research and project documentation easier to discover through conventional search engines and AI-assisted search.

This includes both the catalogue itself and the individual project websites.

### Search engine optimization

The project aims to support:

- Descriptive page titles and summaries.
- Meaningful headings and semantic HTML.
- Searchable text explaining project purpose and limitations.
- Direct links to authoritative source repositories.
- Crawlable project navigation.
- Appropriate canonical URLs.
- XML sitemaps.
- Relevant structured metadata.
- Clear publication and update information where available.
- Accessible, performant pages.

The catalogue should provide enough information for a person or search engine to understand why a project exists without needing to inspect its source code.

### AI-search discoverability

The project also aims to make information easier for AI-assisted search systems to retrieve, interpret, and cite.

This involves:

- Explaining projects in clear, factual language.
- Identifying the original source of important claims.
- Linking to authoritative project documentation and evidence.
- Distinguishing maintained tools from experiments and archived work.
- Making relevant content accessible without requiring JavaScript execution.
- Using consistent project names and descriptions.
- Maintaining accurate structured data.
- Avoiding unsupported claims about capabilities, compliance, or research results.

These practices can improve machine readability, but they do not guarantee placement in search results or citations by AI systems.

Generative Engine Optimization (GEO) is used here as a description of AI-search discoverability work, not as an established measurement of project quality.

### Project-level discoverability

The catalogue should eventually help identify discoverability problems across linked public project sites.

Potential checks include:

- Missing or unclear project descriptions.
- Generic document titles.
- Missing metadata or canonical URLs.
- Restrictive or missing crawler configuration.
- Missing or invalid sitemaps.
- Important content available only after JavaScript execution.
- Broken links between repositories and published sites.
- Outdated project status information.
- Missing structured data where it would add value.

**These project-level SEO and AI-search checks are proposed improvements. They are not yet implemented as a complete auditing system.**

Not every repository needs to be indexed independently. Data-only repositories, archived experiments, duplicated content, and internal tooling may require different treatment.

## Accessibility and sustainability

The catalogue treats accessibility and environmental sustainability as core quality requirements.

### Accessibility

The site aims to conform to WCAG 2.2 Level AA.

This includes:

- Semantic HTML.
- Keyboard-operable controls.
- Visible focus indicators.
- Appropriate colour contrast.
- Support for light and dark preferences.
- Responsive layouts.
- Meaningful project descriptions and image alternatives.

Automated tests cover selected desktop, mobile, light, and dark presentations.

Automated testing does not establish complete accessibility conformance.

See [ACCESSIBILITY.md](ACCESSIBILITY.md).

### Sustainability

The catalogue uses static hosting and scheduled data collection rather than an always-running application server.

The project aims to:

- Minimize unnecessary client-side computation.
- Keep dependencies small.
- Avoid repeated collection of unchanged information.
- Limit screenshot generation and storage.
- Use efficient, deterministic build processes.
- Avoid AI inference for routine scheduled tasks unless there is a demonstrated need.

See [SUSTAINABILITY.md](SUSTAINABILITY.md).

## Repository architecture

The project is a static website with a Node.js data pipeline.

| Location | Purpose |
|---|---|
| `index.html` | Public catalogue page |
| `activity.html`, `contributions.html`, `workstreams.html`, `reports.html` | Generated activity pages with static default content |
| `src/app.js` | Catalogue filtering, sorting, project cards, and owner-mode logic |
| `src/activity-app.js` | Progressive enhancement for activity filters and URLs |
| `src/time.mjs` | Timezone and date-range engine |
| `src/activity.mjs` | Activity taxonomy, validation, attribution, automation, dedupe |
| `src/queries.mjs` | Deterministic activity questions |
| `src/activity-filters.mjs` | Filter state and shareable URL serialization |
| `src/render.mjs`, `src/views.mjs` | Shared accessible rendering for static and browser views |
| `src/styles.css` | Presentation and responsive styling |
| `data/curation.yml` | Human-maintained project descriptions and presentation settings |
| `data/workstreams.yml` | Timezone, collection scope, identities, workstreams, limitations |
| `data/generated/` | Automatically collected repository and activity information |
| `data/activity-data.json` | Recent activity payload, coverage, workstreams, repository index |
| `data/activity-extended.json` | Older activity events, loaded on demand |
| `data/site-data.json` | Consolidated catalogue dataset used by the frontend |
| `scripts/sync-repos.mjs` | GitHub repository synchronization |
| `scripts/collect-activity.mjs` | Bounded public activity collection |
| `scripts/lib/github-api.mjs` | Request budget, retries, pagination, conditional cache |
| `scripts/lib/activity-mappers.mjs` | GitHub payload to normalized event mapping |
| `scripts/build-site-data.mjs` | Merges generated metadata with manual curation |
| `scripts/build-pages.mjs` | Generates activity pages, sitemap, and reports |
| `scripts/capture-pages-screenshots.mjs` | Project screenshot capture |
| `.github/workflows/weekly-sync.yml` | Scheduled repository and activity updates |
| `.github/workflows/monthly-screenshots.yml` | Scheduled screenshot updates |

Generated datasets should normally be updated through their build scripts rather than edited manually.

## Local development

### Requirements

- Node.js 22 or later.
- npm.
- Git.

### Clone and install

```bash
git clone https://github.com/mgifford/mgifford.github.io.git
cd mgifford.github.io
npm ci
```

### Run the website

```bash
npm run start
```

Open `http://localhost:3000`.

### Refresh repository and activity information

```bash
GH_TOKEN=… npm run sync:all
```

`sync:all` runs the repository sync, the bounded activity collection, and both builds.
Requires a GitHub token for API collection. If no token is present, stored activity
data is left untouched rather than replaced with an empty snapshot.

Individual steps:

```bash
npm run sync:repos     # repository metadata and change log
npm run sync:activity  # bounded public activity collection
npm run build:data     # catalogue dataset + activity summary
npm run build:pages    # static activity pages, sitemap, reports
```

Useful environment overrides:

| Variable | Default | Purpose |
|---|---|---|
| `ACTIVITY_LOOKBACK_DAYS` | 90 | Collection lookback |
| `ACTIVITY_MAX_REPOS` | 120 | Candidate repository cap |
| `ACTIVITY_MAX_REQUESTS` | 1200 | Hard API request budget |
| `ACTIVITY_MAX_EVENTS` | 9000 | Retained event cap |
| `ACTIVITY_FULL_COMMIT_DAYS` | 30 | Routine commit detail retention |
| `ACTIVITY_BROWSER_DAYS` | 7 | Recent browser payload window |
| `ACTIVITY_OFFLINE` | unset | Set to `1` to rebuild without network |

A GitHub token can be provided through the environment for higher API limits.

Never place personal access tokens in publicly served website files or browser code.

### Validate the project

```bash
npm run build:all
npm test
npm run validate:data
npm run validate:curation
npm run test:a11y
```

`npm test` expects the generated pages to exist. `npm run build:all` rebuilds them from
the committed data.

The accessibility test suite uses Playwright and axe-core and scans the catalogue plus
the four activity pages in light and dark modes.

### Capture screenshots

```bash
npm run screenshot:pages
```

Screenshot capture requires the appropriate Playwright browser dependencies.

The scheduled workflows limit screenshot collection to avoid unnecessary resource consumption.

## Contributing

Contributions are welcome.

Useful improvements include:

- Correcting project descriptions.
- Improving the organization of project themes.
- Identifying important work that should be featured.
- Fixing broken links.
- Improving accessibility and performance.
- Correcting outdated project status information.
- Improving repository metadata and curation.
- Adding useful search discoverability checks.
- Making project content more understandable to people and search systems.

Changes to generated data should be reproducible.

Changes to project descriptions should remain factual and traceable to the corresponding repositories.

[Open an issue or propose a pull request](https://github.com/mgifford/mgifford.github.io/issues).

## Documentation

- [Accessibility Commitment](ACCESSIBILITY.md).
- [Sustainability Commitment](SUSTAINABILITY.md).
- [Agent Instructions](AGENTS.md).
- [Project Curation](data/curation.yml).
- [Workstreams and collection configuration](data/workstreams.yml).
- [Architecture audit](docs/audit.md).
- [Technical strategy](docs/strategy.md).
- [Activity schema](docs/activity-schema.md).
- [Data provenance and limitations](docs/data-provenance.md).
- [Implementation plan](docs/implementation-plan.md).
- [Change summary](docs/change-summary.md).
- [GitHub Actions](.github/workflows/).

## License

This project is licensed under the [GNU Affero General Public License, version 3](LICENSE).

SPDX identifier: `AGPL-3.0-only`.

The catalogue links to independently maintained projects. Their software and content may use different licenses.

## Project status

The public catalogue is operational and updated through scheduled GitHub workflows.

The activity layer is implemented: date-ranged activity, personal contributions,
workstreams, project timelines, coverage disclosure, and deterministic weekly/monthly
reports. The initial question — **which projects were updated this week?** — is
answered from committed evidence, including commits, pull requests, issues, releases,
and metadata changes.

Owner-mode functionality remains disabled in the public site pending an appropriate
authentication or reporting mechanism.

Optional AI-assisted summaries over verified evidence are intentionally deferred until
the deterministic model is reliable and a review/disclosure workflow exists. Improved
search indexing, structured data, and project-level SEO and accessibility auditing of
linked sites remain proposed enhancements.

The aim is to make this catalogue a useful starting point for discovering open-source
work, understanding recent activity, and deciding what to work on next.
