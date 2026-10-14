# Remediation Plan

Findings are in `findings.csv`. Severity (user impact) and priority (scheduling) are separate fields.

## Effort assumptions

- S ≤ 1 day, M = 2–5 days, L = 1–2 weeks for one engineer who knows `web/src/lib`. QA and design review are extra.
- Shared-component fixes include updating unit tests in `web/src/lib/**.spec.ts`.
- Call-site sweeps assume grep-driven mechanical edits, reviewed per feature area.

## Root-cause groups

| Group | Shared component(s) | Findings | Routes affected | Expected effect of fixing the shared component |
|---|---|---|---|---|
| G1 Form labelling | `lib/forms/Select/OSelect.vue`, `lib/forms/Input/OInput.vue`, `lib/forms/Switch/OSwitch.vue` | A11Y-01, A11Y-17 (number input) | 47 | Fixes attribute forwarding everywhere; call sites without any label still need a `label`/`ariaLabel` (171 OSelect, 29 OSwitch, 106 OSearchInput usages) |
| G2 Icon-only controls | `lib/core/Button/OButton.vue`, `lib/overlay/Tooltip/OTooltip.vue`, `lib/core/Table/sub-components/OTablePagination.vue`, `OTableSelectCheckbox.vue` | A11Y-04, A11Y-05, A11Y-09 | 57 + 54 + 23 | Pagination and checkboxes are fully fixed in 2 files. The tooltip-naming change auto-fixes most of ~406 icon buttons. The rest need an explicit `aria-label` |
| G3 Theme and contrast | `utils/theme.ts`, `constants/themes.ts`, tokens in `lib/styles/tokens/*.css` | A11Y-06, A11Y-07 | 136 | Token change fixes all accent/placeholder instances; code-highlight theme is separate |
| G4 App shell | `layouts/MainLayout.vue`, `components/Header.vue`, `lib/core/Navbar/ONavbar.vue` | A11Y-08 (header images), A11Y-11, A11Y-16 | all | Single-file fixes |
| G5 Editors | `components/CodeQueryEditor.vue`, `components/RichTextInput.vue` | A11Y-02, A11Y-15 | logs, metrics, traces, alerts SQL, functions, pipelines, home | One config change covers every Monaco instance |
| G6 Feedback and overlays | `lib/feedback/Toast/*`, `lib/overlay/Dropdown/ODropdown.vue`, `lib/overlay/Dialog/ODialog.vue` | A11Y-12, A11Y-13, A11Y-14 | 46 + 13 + dialogs | Shared fixes |
| G7 Data visualisation | `components/dashboards/panels/ChartRenderer.vue`, `lib/data/ProgressBar/OProgressBar.vue` | A11Y-10, A11Y-19 | dashboards, metrics, RUM, infra, usage | `aria` option + labelled wrapper fixes all charts; a "view as table" alternative is a feature-level task |
| G8 Page-level | individual views, login | A11Y-03, A11Y-18, A11Y-20–A11Y-27 | per page | Local edits |

## Suggested implementation order

### Sprint 1: P0 (blockers)
1. **A11Y-03** Login internal-user toggle → real button. *S.* No dependencies.
2. **A11Y-18** Login autocomplete, `<main>`, `<h1>`, inline server error. *S.* Same file as 1, so ship together.
3. **A11Y-02** Monaco `tabFocusMode` / Escape-to-exit, `aria-describedby` hint, focus ring. *S–M.* Verify that query-history and autocomplete keybindings still work.
4. **A11Y-01** OSelect/OInput/OSwitch attribute forwarding plus `/alerts/add` call sites. *M.* Do this before G2, because pagination's page-size select depends on it.

### Sprint 2: P1 (high-volume shared fixes)
5. **A11Y-04, A11Y-09** OTablePagination labels, `<nav aria-label>`, row checkbox labels. *S.*
6. **A11Y-05** OTooltip names its trigger; OButton `ariaLabel` prop + dev warning; sweep the remaining icon buttons (logs toolbar, dashboard view toolbar, vue-flow controls, code-block copy). *M–L.*
7. **A11Y-06** Contrast floor 4.5:1, derived accent shades, a unit test across `PREDEFINED_THEMES`, and validation of custom org colours. *M.* Needs design sign-off on brand shade changes.
8. **A11Y-08** `alt=""` on decorative images (AI icon, SSO, custom logos). *S.*
9. **A11Y-10** ECharts `aria` + decal, `role="img"` wrapper with panel title, unique ids. *M.* A "view data as table" option is *L* and can follow later.

### Sprint 3: P2
10. A11Y-11 skip link · A11Y-16 mobile drawer · A11Y-12 dropdown trigger · A11Y-13 toasts · A11Y-14 dialog focus after a failed submit · A11Y-15 home composer · A11Y-17 date picker · A11Y-19 progress bars · A11Y-07 secondary contrast · A11Y-20 target sizes · A11Y-21 code blocks · A11Y-24 misc ARIA · A11Y-25 shortcut setting · A11Y-26 tooltip hoverable. *About 2 weeks in total.*

### Backlog: P3
11. A11Y-22 one `<h1>` per page via a shared page header · A11Y-23 specific titles for child routes · A11Y-27 tab/tabpanel semantics.

## Dependencies

- G1 before G2 (page-size select, combobox names).
- G3 needs design and product agreement because brand colours change visually. Consider adding an "accessible contrast" toggle per theme if brand fidelity is non-negotiable; the default should still be AA.
- Enterprise-gated views (AI observability, on-call, synthetics) only compile in enterprise builds, so verify those call-site fixes against an enterprise build.

## Preventing regressions

1. **Lint:** add `eslint-plugin-vuejs-accessibility` (start with `alt-text`, `anchor-has-content`, `click-events-have-key-events`, `form-control-has-label`, `interactive-supports-focus`) in warn mode, then ratchet it like the existing design-debt checks.
2. **Unit tests:** in `web/src/lib/**.spec.ts`, assert that `OButton` icon-only requires a name, that `OSelect`/`OInput` forward `aria-label` to the control, and that pagination buttons have names.
3. **E2E:** add an axe smoke spec under `tests/ui-testing/playwright-tests/RegressionSet/Accessibility/` (registered in `ci_matrix_regression.json`). It should scan the 12 deep-tested routes, fail on new `critical`/`serious` violations against a checked-in baseline, and never suppress rules globally. The harness in `test-results/harness/crawl.mjs` is a ready starting point.
4. **Keyboard regression:** port `kb-tests.mjs` checks for the login link, Monaco exit, dialog focus return, and the skip link.

## Retest strategy

- After each sprint, rerun `test-results/harness/crawl.mjs` with the same route list, then `gen-reports.mjs`, and diff `findings.csv` instance counts against this baseline.
- Rerun `kb-tests.mjs`, `interact.mjs`, and `verify.mjs` for the keyboard, state, and focus checks.
- Before calling the work done, run one manual VoiceOver (macOS) and one NVDA (Windows) pass over: login, logs search, alert create, dashboard view, and streams list.
- Mark each finding "Fixed and retested" in `findings.csv` only after both the automated and the manual retest pass.
