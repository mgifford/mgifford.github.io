# Accessibility Commitment (ACCESSIBILITY.md)

## 1. Our commitment

This project treats accessibility as a core quality requirement.

For public content and interface behavior in this repository, we target conformance with WCAG 2.2 AA where applicable to static web content and interactions.

This repository is a curated catalog and maintenance dashboard for GitHub repositories. Some linked external pages and embedded previews are outside our direct control.

## 2. Real-time health metrics

| Metric | Status / Value |
| :--- | :--- |
| Open accessibility issues | View issues with accessibility label (create label if missing) |
| Accessibility checks in CI | Manual checks plus scheduled maintenance workflows |
| Keyboard navigation status | Required for primary controls and filters |
| Contrast review status | Review required for each UI refresh |
| Last accessibility review date | 2026-04-02 |

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
- Keyboard-only interaction pass for filter/search/sort controls
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
- Owner mode relies on a user-provided token in local browser storage.
- Some repository metadata, descriptions, and screenshots come from automated scripts and may be incomplete.
- External linked project pages may not meet the same accessibility level as this repository.

## 8. Getting help

- Report barriers: https://github.com/mgifford/mgifford.github.io/issues
- General repository help: https://github.com/mgifford/mgifford.github.io/discussions

If you need an accommodation for contribution or review, open an issue and note that you need accessibility support.

## 9. Continuous improvement

We will keep this file current as the project evolves.

Planned improvements:

- Add repeatable accessibility checks in CI for static pages
- Add issue labeling conventions for accessibility defects
- Track accessibility review dates and unresolved barriers
- Improve screenshot and image text alternatives over time

Last updated: 2026-04-02
