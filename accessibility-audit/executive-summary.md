# OpenObserve Web UI: WCAG 2.2 AA Accessibility Audit, Executive Summary

**Date:** 2026-10-14. **Environment:** `<dev-env>` (enterprise build v1.1.0-rc2), org `default`, test account (synthetic data).
**Method:** source inspection, live Chromium (Playwright 1.55), axe-core 4.10 (WCAG 2.0/2.1/2.2 A+AA tags), scripted keyboard-only tests, pixel-diff focus measurement, reflow, zoom, and text-spacing tests, light and dark theme.
**Not performed:** testing with a real screen reader (VoiceOver/NVDA). Screen-reader outcomes are inferred from the DOM and accessibility attributes, and are marked unverified.

## Overall assessment

The UI **does not conform to WCAG 2.2 AA**.

The product has a sound structural base:

- Real landmarks (`header`, `nav`, `main`).
- A translated page title on every route.
- `lang` set correctly.
- Header menus and the sidebar follow the ARIA menu pattern with full arrow-key and Escape support.
- Dialogs (built on reka-ui) trap and restore focus.
- Sortable tables expose `aria-sort`.
- Inline form errors use `role=alert` + `aria-invalid` + `aria-describedby`.
- Pages reflow at 320 px without page-level horizontal scrolling.

The failures are concentrated in a **small number of shared components**, so most defects can be removed with a few targeted fixes.

| Metric | Value |
|---|---|
| Routes discovered (runtime router) | 381 records → 380 inventory entries (13 redirect aliases, 33 parameterised, 183 ingestion guides) |
| Distinct pages loaded and tested | 137 (126 automated + structure, 10 deep keyboard/state tests, login, dashboard view via in-app nav) |
| Ingestion integration guides | 183 routes on 1 shared template; 16 sampled |
| Unique root-cause findings | **27**: 2 Critical, 5 High, 14 Medium, 6 Low |
| Remediation priority | 3 × P0, 6 × P1, 15 × P2, 3 × P3 |
| Verification | 25 confirmed violations, 2 suspected (need manual verification) |
| Automated volume (light theme) | 709 unnamed buttons on 116 routes; 416 contrast failures on 136 routes; 166 images without alt on 158 routes |
| WCAG 2.2 A/AA criteria (55) | 16 Fail, 6 Partial, 15 Pass (10 of them on sampled pages only), 4 Suspected, 7 Not tested, 7 Not applicable |

## Key risks and blockers

1. **Keyboard users with internal accounts cannot log in** (A11Y-03, Critical). "Login as internal user" is an `<a>` with no `href`, so it cannot be focused or activated by keyboard.
2. **Alert creation is unusable without sight** (A11Y-01, Critical). All 14 sampled controls on `/alerts/add` have visible labels that are not programmatically tied to the control. The root cause sits in `OSelect`/`OInput`, which put `aria-*` attributes on the wrapper `<div>`. It affects 47 routes.
3. **The log search editor traps Tab** (A11Y-02, High, P0). The Monaco editor can only be exited with an undocumented Ctrl+Shift+M (macOS) / Ctrl+M, and it shows no focus ring.
4. **Unnamed icon buttons everywhere** (A11Y-04/05/09, High). This covers table pagination on 54 routes, toolbar actions, and row checkboxes. The OTooltip pattern never names the button it decorates.
5. **The brand accent fails contrast** (A11Y-06, High). The O2 Signature theme `#6B76E3` reaches 3.3 to 3.94:1 on primary buttons, links, and active tabs. `utils/theme.ts` deliberately accepts 3:1.
6. **Charts are invisible to assistive technology** (A11Y-10, High). ECharts runs without `aria`, panels have no text alternative, and every panel reuses `id="chart1"`.

## Top five recommended fixes (in order)

| # | Fix | Resolves | Effort* |
|---|---|---|---|
| 1 | Forward `aria-*` to the real control in `OSelect` / `OInput` / `OSwitch`; require `label` or `ariaLabel` | A11Y-01, part of 17 | M (3–5 d incl. call-site audit) |
| 2 | Make `OTooltip` name its trigger; add an `ariaLabel` prop and dev warning to `OButton`; label `OTablePagination` and `OTableSelectCheckbox` | A11Y-04, 05, 09 (~600 of 709 axe nodes) | M (3–5 d) |
| 3 | Login: make the internal-login toggle a real button; add `autocomplete`, `<main>`, and `<h1>` | A11Y-03, 18 | S (0.5 d) |
| 4 | Monaco: enable `tabFocusMode` (or Escape-to-exit) with a visible hint, and restore the focus ring | A11Y-02 | S (1 d) |
| 5 | Theme: raise the contrast floor to 4.5:1 and derive accessible accent text/background shades for every predefined and custom theme | A11Y-06, part of 07 | M (2–3 d + design review) |

\*Effort assumes one engineer familiar with the O2 component library, excluding QA. See `remediation-plan.md`.

## Main limitations

- No real screen-reader testing. AT announcements are unverified.
- 33 parameterised detail routes (alert, SLO, incident, on-call, synthetics, AI datasets) were **not tested**: the environment had no entities, or rows did not open detail pages.
- 7 Settings sub-routes (Nodes, License, Password Policy, Domain Management, Query Management, Announcements, Synthetics Locations) redirect to General Settings in this org. They are probably `_meta`-org only, so they were not tested.
- Destructive or creating flows were not submitted with valid data: delete confirmations, multi-step wizards, user invites, billing.
- Only Chromium on macOS was used. Windows/NVDA, Firefox, Safari, and mobile devices were not tested.
- Contrast was measured with the org's active theme (O2 Signature). Other predefined themes were not scanned.

Full details: `audit-limitations.md`.

## Deliverables in this folder

`route-inventory.csv` · `page-audit-report.md` · `findings.csv` · `wcag-coverage.csv` · `remediation-plan.md` · `audit-limitations.md` · `screenshots/` (`pages/` = 160 initial states, `states/` = interactive states) · `test-results/` (raw axe JSON per route, keyboard/state results, harness scripts).
