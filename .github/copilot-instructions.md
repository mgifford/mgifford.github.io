# Copilot Instructions for This Repository

These instructions are for GitHub Copilot and other coding agents operating in this repository.

## Source of truth

Treat these documents as policy and implementation guidance:

- AGENTS.md for architecture and workflow rules
- ACCESSIBILITY.md for accessibility requirements
- SUSTAINABILITY.md for sustainability and automation efficiency requirements

If guidance appears to conflict, follow this precedence:

1. Explicit user request in the current task
2. This file
3. AGENTS.md
4. ACCESSIBILITY.md and SUSTAINABILITY.md
5. README.md and inline code comments

## Repository intent

This repository is a static GitHub Pages project that serves as a curated catalog of repositories owned by mgifford.

Key constraints:

- Keep the site static and lightweight
- Preserve human-managed curation data
- Keep generated data deterministic
- Avoid introducing unnecessary runtime or infrastructure complexity

## Coding expectations

- Prefer small, surgical changes over broad rewrites.
- Do not hand-edit generated files in data/generated unless explicitly requested.
- When changing data shape, update scripts and frontend usage together.
- Keep dependencies minimal and justify new packages.
- Never commit secrets, tokens, or sensitive data.
- Preserve owner-mode token handling as browser-local only.
- When drafting commit messages and PR titles, follow the `Commit and PR Conventions` section in AGENTS.md exactly.

## Accessibility expectations

For any UI change, ensure:

- Semantic HTML and logical heading order
- Keyboard operability for interactive controls
- Visible focus indicators
- Sufficient color contrast
- Meaningful alternative text for images

Reference: ACCESSIBILITY.md

## Sustainability expectations

For any automation or asset changes:

- Prefer deterministic scheduled workflows over constant polling
- Keep cron frequency conservative
- Limit screenshot capture volume with MAX_SCREENSHOTS
- Reduce payload size and avoid unnecessary client-side compute

Reference: SUSTAINABILITY.md

## Preferred validation commands

Use these when relevant to your changes:

```bash
npm run sync:all
npm run build:data
npm run screenshot:pages
```

If a command is too expensive for the current task, explain what was skipped and why.

## Automation boundaries

- Weekly workflow should update repo metadata and merged site data.
- Monthly workflow should refresh screenshots and merged site data.
- Do not add AI-dependent cron jobs by default.

## Documentation updates

When behavior or policy changes, update corresponding docs in the same pull request:

- AGENTS.md
- ACCESSIBILITY.md
- SUSTAINABILITY.md
- README.md
