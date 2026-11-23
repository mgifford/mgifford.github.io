# Accessibility Commitment (ACCESSIBILITY.md)

## 1. Our commitment

This project treats accessibility as a core quality requirement.

For public content and interface behavior in this repository, we target conformance with WCAG 2.2 AA where applicable to static web content and interactions.

This repository is a curated catalog and maintenance dashboard for GitHub repositories. Some linked external pages and embedded previews are outside our direct control.

## 2. Real-time health metrics

| Metric | Status / Value |
| :--- | :--- |
| Open accessibility issues | View issues with accessibility label (create label if missing) |
| Accessibility checks in CI | Automated axe scans for the catalogue and four activity pages, light/dark, plus validation workflow |
| Keyboard navigation status | Required for primary controls and activity filters; covered by tests |
| Contrast review status | Reviewed for the activity views in light and dark mode |
| No-JavaScript status | Activity pages ship a complete static snapshot; interactive controls appear only after enhancement |
| Last accessibility review date | 2026-11-23 |

## 3. Contributor requirements (guardrails)

Contributors should follow these requirements for UI, docs, and automation changes:

- Use semantic HTML before adding ARIA.
- Ensure all interactive controls are keyboard operable.
- Preserve visible focus indicators.
- Maintain sufficient color contrast for text and controls.
- Provide meaningful alternative text for images and screenshots.
- Keep heading structure logical and sequential.
- Use descriptive link text.
- Avoid motion that cannot be reduced or disabled.
- Keep language clear and avoid unnecessary jargon.
- Meet WCAG 2.2 SC 2.5.8 Target Size (Minimum): at least 24×24 CSS pixels or
  equivalent spacing for interactive targets.
- Ensure activity status is communicated in text, not colour alone (automated,
  human, completed, in progress, uncertain).
- Ensure coverage and data limitations are always disclosed, not hidden in a
  collapsed panel.

When changing layout, styling, or interaction logic, include accessibility checks before merge.

## 4. Reporting and severity taxonomy

If you find an accessibility barrier, open an issue and include:

- What failed and where
- Steps to reproduce
- Browser and operating system
- Assistive technology used (if applicable)
- Expected behavior

Severity model:

- Critical: blocks core task completion for one or more user groups
- High: major friction for common tasks, workaround may exist
- Medium: notable usability/accessibility degradation
- Low: minor issue that should still be fixed

## 5. Automated and manual check coverage

Current and planned checks for this repository:

- HTML and content structure review during pull requests
- Automated axe-core scans in CI for the catalogue plus `activity.html`,
  `contributions.html`, `workstreams.html`, and `reports.html` in light and dark modes
- Static-content checks with JavaScript disabled for the activity pages
- Keyboard-only interaction pass for filter/search/sort controls, including date range,
  custom range, project, workstream, activity type, and automation toggle
- Duplicate-id, heading, landmark, and table caption/scope checks in page tests
- Contrast review for new visual styles
- Link validation through scheduled workflows
- Periodic screen reader spot checks for key flows

Recommended manual test pass before merge for UI changes:

- Navigate primary controls using keyboard only
- Verify focus visibility and focus order
- Confirm heading order and landmarks are meaningful
- Spot-check with at least one screen reader

## 6. Browser and assistive technology coverage

Primary browser support target:

- Latest two major versions of Chrome, Firefox, and Safari

Assistive technology spot-check targets (when available):

- NVDA with Firefox or Chrome on Windows
- VoiceOver with Safari on macOS

## 7. Known limitations

- This is a static GitHub Pages site and cannot directly read your signed-in GitHub browser session.
- Owner mode is disabled in the public site until GitHub OAuth or a server-side owner data pipeline is added.
- Some repository metadata, descriptions, and screenshots come from automated scripts and may be incomplete.
- Activity data is collected for a bounded set of public repositories and may be
  partial. Coverage and limitations are disclosed on every activity page.
- Interactive activity filters require JavaScript. The default seven-day snapshot,
  evidence links, project timelines, and coverage notes are available without it.
- Wide activity tables scroll horizontally at narrow viewport widths; each table also
  has a caption and scoped headers for assistive technology.
- External linked project pages may not meet the same accessibility level as this repository.

## 8. Getting help

- Report barriers: https://github.com/mgifford/mgifford.github.io/issues
- General repository help: https://github.com/mgifford/mgifford.github.io/discussions

If you need an accommodation for contribution or review, open an issue and note that you need accessibility support.

## 9. Continuous improvement

We will keep this file current as the project evolves.

Planned improvements:

- Add issue labeling conventions for accessibility defects
- Track accessibility review dates and unresolved barriers
- Improve screenshot and image text alternatives over time
- Add a periodic screen-reader pass over the activity filters and project timelines

Last updated: 2026-11-23
