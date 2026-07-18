# Raw Token Audit — 2026-07-18

Full-application sweep of **raw (non-token) style values** in `web/src`, measured fresh on branch `fix/token` (after the `--o2-*` migration, tw-prefix removal, radius/border/font consolidation). Re-verified after merging `main` (`c302792a6b`, 52 files): all counts unchanged — the merge's only added raw values are two `--color-favorite` hex definitions inside the token files, where raw values belong.

**Scope & method:** ripgrep over `*.vue, *.ts, *.js, *.css, *.scss`, excluding `*.spec.*`, `src/test/**`, `__mocks__`, vendored `src/assets/dashboard/echarts.min.js`, and the token definition files themselves (`src/lib/styles/tokens/**` — the one legitimate home of raw values).

---

## Scoreboard

| # | Category | Count | Files | Verdict |
|---|----------|------:|------:|---------|
| 1 | Legacy `--o2-*` vars | **0** | 0 | ✅ fully eradicated |
| 2 | Quasar spacing/typography utils (`q-pa-*`, `q-gutter-*`, `text-weight-*`) | **0** | 0 | ✅ fully eradicated |
| 3 | Quasar palette `color=` props | 2 | 1 | ✅ trivial (`AWSQuickSetup.vue`) |
| 4 | CSS named colors (`white`, `black`…) as values | 6 | 5 | ✅ trivial |
| 5 | Hardcoded `font-family` | 59 | 26 | ⚠️ small, fixable |
| 6 | `rgb()/rgba()/hsl()` literals | 291 | 64 | ❌ |
| 7 | Hex color literals | **988** | 144 | ❌ (324 in vue/css, 664 in ts/js) |
| 8 | Inline `style="…"` attributes | 471 | 117 | ❌ |
| 9 | `px` values ≥ 2px in styles (1px borders excluded) | **1,121** | 224 | ❌ |
| 10 | Tailwind arbitrary values `-[…]` | **1,382** | 227 | ❌ largest category |
| 11 | `.vue` files still carrying `<style>` blocks | — | 167 | ⚠️ structural |

Token adoption for contrast: `var(--color-*)` appears **1,800 times across 219 files** — the token system is the majority idiom; the remainder above is the long tail causing visual drift.

---

## What actually causes the "app looks inconsistent" feeling

Ranked by visual impact, not raw count:

### A. Off-scale spacing/sizing via Tailwind arbitrary values (highest impact)

1,382 arbitrary-value classes. Breakdown of the 1,041 rem-based ones:

- **763 (73%) are exact Tailwind-scale equivalents** — pure noise, mechanically rewritable:
  `py-[0.625rem]`→`py-2.5`, `gap-[0.5rem]`→`gap-2`, `px-[0.75rem]`→`px-3`, `h-[2rem]`→`h-8`, `w-[100%]`→`w-full`, etc.
- **278 are off-scale** — these are the real inconsistency: `gap-[0.2rem]`, `gap-[0.3rem]`, `gap-[0.4rem]`, `py-[0.18rem]`, `px-[0.325rem]`, `h-[0.7rem]`, `pl-[2.15rem]` — five different "small gap" values that should all be `gap-1`/`gap-1.5`. Each needs a snap-to-scale decision (almost always the nearest step).
- **106 are px arbitrary values** (excluding `[1px]`) — banned by house rules: `ring-[3px]`, `border-l-[3px]`, etc.

Top offenders: `plugins/traces/SessionDetails.vue` (159), `views/OverviewTab.vue` (54), `plugins/traces/ThreadView.vue` (50), `views/synthetics/MonitorRuns.vue` (46).

### B. Raw font sizes (direct cause of type inconsistency)

`font-size` declarations still carry raw values in both units:
`0.75rem`×27, `14px`×17, `12px`×11, `0.875rem`×11, plus a zoo of off-scale sizes — `0.6875rem`, `0.8125rem`, `0.95rem`, `0.85em`, `0.78rem`, `0.72rem`, `1.05rem`. Anything not on the `--text-*` token scale renders type that matches nothing else. Cross-reference `FONT_AUDIT.md` for the type-scale decisions; this audit only counts the stragglers.

### C. Theme-blind UI colors defined in TypeScript (dark-mode drift)

664 hex literals live in `.ts/.js`. Two distinct populations:

- **Data-viz palettes (legitimate, but should be centralized):** `utils/dashboard/colorPalette.ts`, `utils/traces/traceColors.ts`, `convertTraceData.ts`, `convertLogData.ts`, `chartTheme.ts`, `constants/themes.ts`, custom-chart templates. Charts need literal hex (ECharts can't read CSS vars at config time without resolution); the fix is *one* palette module, not scattered copies — `statusParser.ts` already has a comment "aligned with convertLogData fatal/emergency", i.e. the same palette is hand-synced in ≥2 places today.
- **Semantic UI colors that never react to theme (bugs-in-waiting):** log severity colors in `utils/logs/statusParser.ts` (34) / `keyValueParser.ts` (26), injected CSS with raw shadows in `composables/useStickyColumns.ts` (`rgba(0,0,0,0.15)` box-shadows — identical in dark mode), `utils/logs/convertLogData.ts` level colors. These render the same hex on light and dark backgrounds.

### D. Hex/rgba in component styles (324 in vue/css)

Top values tell the story — they're mostly **raw Tailwind-palette grays and blues used instead of the registered tokens**: `#6b7280` (gray-500), `#9ca3af` (gray-400), `#e5e7eb` (gray-200), `#374151` (gray-700), `#3b82f6`/`#2563eb` (blue-500/600), plus `#000000`/`#ffffff`. Every one has a `--color-text-*` / `--color-border-*` / `--color-primary-*` equivalent.
Special cases: `#3f7994`, `#f0c29a`, `#e8b48c`, `#b25400` cluster in `lib/core/EmptyState/illustrations/**` — SVG illustration art, acceptable to whitelist as a decorative palette, but should be declared as such.
Worst UI files: `components/alerts/IncidentDetailDrawer.vue` (42), `ColorPaletteDropDown.vue` (32 — partly legit, it *renders* palettes), `IncidentServiceGraph.vue` (22), `EnterpriseUpgradeDialog.vue` (29 rgba), `DestinationTestResult.vue` (18 rgba).

### E. px dimensions in scoped styles (1,121)

Top values: `14px`/`12px` (font sizes → see B), then fixed layout widths `300px`×21, `200px`×16, `320px`×14, `250px`×13, `150px`×12, `400px`×11 — sidebars, drawers, columns sized in px per-file with no shared width scale. Also `80px`, `120px`, `190px`.
Worst: `views/synthetics/MonitorRuns.vue` (46), `AnomalyDetectionConfig.vue` (36), `ScheduledPipeline.vue` (34), `EnterpriseUpgradeDialog.vue` (28).

### F. The design-system lib itself is not clean

`src/lib` (excluding token files and illustrations) still hardcodes:
`OButton.vue` **39 px + 27 arbitrary values + 3 hex**, `OTreeNode.vue` 21 px, `OTableHeader.vue` 17 px, `OSelect.vue` 13 px, `ODialog.vue` 7 px.
Since every screen composes these, lib violations multiply across the whole app — highest leverage per line fixed.

### G. Inline `style="` attributes (471 in 117 files)

Bypass tokens, Tailwind, and theming entirely. Concentrated: `CreateBrowserTestSkeleton.vue` (32), `CreateReport.vue` (31), `ScheduledPipeline.vue` (31), `AnomalyDetectionConfig.vue` (24), `FlameGraphView.vue` (23). (Dynamic `:style` bindings computed from data — e.g. flame graphs — are legitimate; static `style="width: 300px"` is not. Counts above are static `style=` only.)

---

## Remediation plan (proposed order)

| Phase | Work | Size | Risk |
|-------|------|------|------|
| 1 | Codemod: 763 arbitrary→scale rewrites (`py-[0.625rem]`→`py-2.5` …) + `w-[100%]`→`w-full` | mechanical | none (identical CSS output) |
| 2 | Kill the 2 Quasar `color=` props, 6 named colors, 106 px-arbitrary values | small | low |
| 3 | Clean `src/lib` components (OButton first) — px→rem/tokens, hex→tokens | ~10 files | medium (visual review per component) |
| 4 | Map the ~30 recurring hex grays/blues in vue/css to `--color-*` tokens | 324 sites | low–medium |
| 5 | Snap 278 off-scale rem values to nearest scale step | judgment calls | medium |
| 6 | Centralize data-viz palettes into one module (`utils/colorPalette` as single source; delete hand-synced copies in statusParser/convertLogData/traceColors) | refactor | medium |
| 7 | Make log-severity + shadow colors theme-aware (tokens or dark-variant pairs) | design decision | medium |
| 8 | Font-size stragglers per `FONT_AUDIT.md` scale; kill off-scale sizes | 100+ sites | medium |
| 9 | Static inline `style=` → utilities/tokens; px layout widths → shared width scale | long tail | medium |

**Guardrail (do alongside Phase 1):** add a lint/CI grep that fails on new `#hex`/`rgb(`/`px≥2` in vue/css and new arbitrary `-[...px]` classes outside `src/lib/styles/tokens/` — otherwise the tail regrows.

Regenerate the numbers any time: `bash web/scripts/raw-token-audit.sh` (requires ripgrep; writes per-category file lists to `/tmp/audit_*.txt`).
