# mgifford.github.io

A project of projects.

This repository powers https://mgifford.github.io as a curated catalog of work across the GitHub account for @mgifford. Instead of showing a flat list of hundreds of repositories, it organizes projects into a useful table of contents with themes, highlights, and maintenance signals.

## Why this exists

With a large and growing set of repositories, a raw repository index is hard to navigate and hard to maintain.

This project provides two practical views:

- Public view: a curated portfolio of meaningful projects.
- Owner view: a maintenance dashboard for unfinished work and neglected tasks.

The goal is to surface what matters most:

- Work worth showcasing
- Work needing attention
- Work that has gone stale or been archived

## What it does

- Syncs repositories from GitHub on a weekly schedule.
- Detects new, deleted, archived, and unarchived repositories.
- Supports curation by theme, featured status, and summary overrides.
- Lets users sort by stars, watchers, recency, or name.
- Hides archived repositories by default in public mode.
- Shows maintenance signals in owner mode.
- Captures preview screenshots monthly for projects with GitHub Pages or a homepage URL.

## Public and owner views

### Public view

- Focuses on curated, high-signal projects.
- Prioritizes readability and discoverability.
- Keeps archived repositories out of the default experience.

### Owner view

Owner view is optional and token-based in the browser. It helps track:

- Open pull requests requesting review
- Open PRs authored by the owner
- Open and stale issues
- Recent notifications
- README files that likely need improvement

Important: This is a static site, so it cannot automatically use your signed-in GitHub browser session. Owner mode uses a personal token stored in local browser storage and sent only to the GitHub API.

## Curation model

The catalog is intentionally hybrid:

- Automated data collection for repo facts and change tracking
- Human curation for quality, theme, and narrative

Manual curation lives in:

- `data/curation.yml`

Generated data lives in:

- `data/generated/repos.json`
- `data/generated/changes.json`
- `data/generated/screenshots.json`
- `data/site-data.json`

## Project structure

- `index.html` - static page shell
- `src/app.js` - frontend logic (filters, sorting, owner mode)
- `src/styles.css` - presentation layer
- `scripts/sync-repos.mjs` - GitHub sync and README quality heuristics
- `scripts/build-site-data.mjs` - merge generated data with curation
- `scripts/capture-pages-screenshots.mjs` - screenshot capture pipeline
- `.github/workflows/weekly-sync.yml` - weekly metadata refresh
- `.github/workflows/monthly-screenshots.yml` - monthly screenshot refresh

## Local development

Install dependencies:

```bash
npm install
```

Run full sync and data build:

```bash
npm run sync:all
```

Capture screenshots:

```bash
npm run screenshot:pages
```

Run locally:

```bash
npm run start
```

Then open http://localhost:3000.

## Automation

### Weekly workflow

- Sync repository metadata
- Compute repo change report
- Rebuild merged site data

### Monthly workflow

- Capture preview screenshots for eligible projects
- Rebuild merged site data with screenshot paths

Recommended repository secret:

- `MGIFFORD_TOKEN` with at least `public_repo` scope (or broader `repo`) for better API limits and richer results.

Recommended token scopes:

- Classic PAT (simplest):
	- `public_repo` for public repository metadata and search
	- `notifications` for owner notification dashboard signals
- Fine-grained PAT (preferred when possible):
	- Repository metadata: read-only on target repositories
	- Pull requests: read-only
	- Issues: read-only
	- Notifications access equivalent (if available in your selected token model)

Without this secret, workflows can still run with `GITHUB_TOKEN` but may be more limited.

Secret setup path in GitHub:

- Repository Settings -> Secrets and variables -> Actions -> New repository secret
- Name: `MGIFFORD_TOKEN`
- Value: your token

## Accessibility and sustainability

This project treats accessibility and sustainability as first-class constraints.

- Accessibility policy: `ACCESSIBILITY.md`
- Sustainability policy: `SUSTAINABILITY.md`
- Agent and workflow guidance: `AGENTS.md`
- Copilot workspace instructions: `.github/copilot-instructions.md`

## How to contribute

- Improve curation in `data/curation.yml`.
- Improve sync/build scripts for better data quality.
- Improve owner signals to make maintenance work more actionable.
- Improve frontend information architecture and visual clarity.

When changing behavior, update policy and documentation in the same pull request.

## License

This repository is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0).

- Full license text: `LICENSE`
- SPDX identifier: `AGPL-3.0-only`
