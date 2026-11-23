# Mike Gifford's Open Source Projects

**A curated catalogue of open-source projects exploring digital accessibility, public-interest technology, open standards, sustainability, and responsible AI.**

**[Explore the projects](https://mgifford.github.io/)** | [GitHub profile](https://github.com/mgifford) | [Personal website](https://ox.ca/)

This repository powers [mgifford.github.io](https://mgifford.github.io/), a public catalogue of projects developed, maintained, or contributed to by Mike Gifford.

The catalogue makes it easier to discover the purpose of individual projects, explore related work, and find their source code, demonstrations, documentation, and ongoing development.

It also provides automated repository maintenance information and a foundation for identifying opportunities to improve project documentation, accessibility, sustainability, and discoverability.

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

The catalogue also detects changes such as newly discovered, removed, archived, and unarchived repositories.

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

**Owner mode is not currently available in the public deployment.**

It requires an appropriate authentication or server-side reporting mechanism.

GitHub Actions secrets must never be exposed to client-side JavaScript.

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
| `index.html` | Public page structure |
| `src/app.js` | Catalogue filtering, sorting, project cards, and owner-mode logic |
| `src/styles.css` | Presentation and responsive styling |
| `data/curation.yml` | Human-maintained project descriptions and presentation settings |
| `data/generated/` | Automatically collected GitHub repository information |
| `data/site-data.json` | Consolidated dataset used by the frontend |
| `scripts/sync-repos.mjs` | GitHub repository synchronization |
| `scripts/build-site-data.mjs` | Merges generated metadata with manual curation |
| `scripts/capture-pages-screenshots.mjs` | Project screenshot capture |
| `.github/workflows/weekly-sync.yml` | Scheduled repository metadata updates |
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

### Refresh repository information

```bash
npm run sync:all
```

This retrieves repository information from GitHub and rebuilds the local site dataset.

A GitHub token can be provided through the appropriate environment configuration for higher API limits.

Never place personal access tokens in publicly served website files or browser code.

### Validate the project

```bash
npm test
npm run validate:data
npm run validate:curation
npm run test:a11y
```

The accessibility test suite uses Playwright and axe-core.

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
- [GitHub Actions](.github/workflows/).

## License

This project is licensed under the [GNU Affero General Public License, version 3](LICENSE).

SPDX identifier: `AGPL-3.0-only`.

The catalogue links to independently maintained projects. Their software and content may use different licenses.

## Project status

The public catalogue is operational and updated through scheduled GitHub workflows.

Owner-mode functionality remains disabled in the public site pending an appropriate authentication or reporting mechanism.

Improved search indexing, pre-rendered project content, structured data, and project-level SEO and AI-search auditing are proposed enhancements.

The aim is to make this catalogue a useful starting point for discovering open-source work and understanding how its projects relate to one another.
