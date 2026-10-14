# accessibility-audit/

WCAG 2.2 AA audit of the OpenObserve web UI, 2026-10-14. Start with `executive-summary.md`.

| File | Contents |
|---|---|
| `executive-summary.md` | Scope, verdict, key risks, top 5 fixes, limitations |
| `findings.csv` | 27 deduplicated root-cause findings (A11Y-01 … A11Y-27) with repro, fix, retest, status |
| `page-audit-report.md` | Per-route priority table (risk score, findings, criteria assessed) + deep-tested page notes |
| `route-inventory.csv` | All 380 runtime routes with test status, title, h1 count, axe results, limitations |
| `wcag-coverage.csv` | All 55 WCAG 2.2 A/AA criteria: method, sample, result, evidence |
| `remediation-plan.md` | Root-cause groups, implementation order, effort, dependencies, regression prevention |
| `audit-limitations.md` | What was not tested and why, caveats, open questions |
| `screenshots/pages/` | Initial state of every crawled route (1440x900) |
| `screenshots/states/` | Interactive states: login, dialogs, menus, date picker, toasts, dashboard view, reflow 320/720/768, dark mode |
| `test-results/` | Raw axe JSON per route, crawl/keyboard/interaction results, findings.json, page-scores.json |
| `test-results/harness/` | Playwright + axe scripts used; rerun to retest (see remediation-plan.md) |

## Re-running the audit

The scripts in `test-results/harness/` need Node ≥ 20 and `playwright@1.55.1`, `@axe-core/playwright@4.10.2`, `pngjs@7`, `pixelmatch@5` (install them in a scratch folder, not in `web/`). Set `A11Y_BASE_URL` to the instance's `/web` URL (default `http://localhost:5080/web`). Internal hostnames were replaced with `<dev-env>` in this copy.

1. `node manual-login.mjs auth-state.json`: opens a browser; sign in by hand and the session is saved. Keep `auth-state.json` out of git.
2. `node discover.mjs auth-state.json <out>`: dumps the runtime route table.
3. `node crawl.mjs auth-state.json <route-list.json> <out> 3`: axe scan + screenshot per route.
4. `node kb-tests.mjs`, `interact.mjs`, `final.mjs`, `verify.mjs` (`auth-state.json <out>`): keyboard, focus, state, reflow and dark-mode checks. `public-audit.mjs <out>` covers the login page.
5. `node gen-reports.mjs <this-dir>` and `node gen-wcag.mjs <this-dir>`: regenerate `findings.csv`, `route-inventory.csv`, `page-audit-report.md` and `wcag-coverage.csv` from `findings.mjs` and the crawl output.
