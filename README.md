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

Owner view is currently disabled in the public GitHub Pages deployment until GitHub OAuth is added. The published site must not ask the owner to paste a PAT, and the repository secret cannot be used client-side in the browser.

When OAuth is implemented, owner view should help track:

- Open pull requests requesting review
- Open PRs authored by the owner
- Open and stale issues
- Recent notifications
- README files that likely need improvement

Important: `MGIFFORD_TOKEN` is an Actions secret for scheduled and validation workflows. It is not available to client-side JavaScript on GitHub Pages.

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

### Curation controls in `data/curation.yml`

You can manually control card content and visibility with per-repo overrides.

Supported override fields:

- `theme`: force a theme label.
- `manualSortRank`: lower numbers appear first before normal sort order.
- `cardTitle`: custom title shown on cards and featured row.
- `cardSummary`: short card description text.
- `featuredNarrative`: longer featured-row narrative text.
- `visibility`: `public` or `hidden`.
- `hidden`: legacy boolean flag (still supported); `visibility` takes precedence.
- `screenshot`: custom screenshot path.

Example:

```yaml
overrides:
  mgifford.github.io:
    theme: Web Platform
    manualSortRank: 1
    cardTitle: Repo Catalog and Maintenance Dashboard
    cardSummary: Curated public catalog with actionable maintenance signals.
    featuredNarrative: |
      This project connects curated storytelling for visitors with practical
      maintenance automation for repository stewardship.
    visibility: public

  archived-experiment:
    visibility: hidden
```

After editing curation, rebuild data:

```bash
npm run build:data
```

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

Run accessibility scans for the public page in desktop/mobile and light/dark modes:

```bash
npm run test:a11y
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
