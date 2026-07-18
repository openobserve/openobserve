# Spacing (Padding/Margin) Audit — 2026-07-18

Branch `fix/token` · Scope: `web/src` (excluding `*.spec.*`, `src/test/**`, `__mocks__`, vendored echarts, and `src/lib/styles/tokens/**`).

**Question this answers:** which raw spacing values does the app actually use, and why do listing pages / dialogs / drawers / pages feel inconsistently spaced even though a token system exists.

Companion docs: [RAW_TOKEN_AUDIT.md](RAW_TOKEN_AUDIT.md) (all raw-value categories), [FONT_AUDIT.md](FONT_AUDIT.md) (type scale). This audit goes deep on **spacing only**, per-surface.

---

## 0. TL;DR — the six spacing defects

1. **The spacing token layer is dead on arrival.** `--spacing-3…10` exist in `base.css` `:root` but are registered in **no `@theme` block**; app code consumes `var(--spacing-*)` exactly **once**. All real spacing flows through Tailwind's default 0.25rem grid — which is fine, but means the "token scale" is a fiction; the *de facto* system is Tailwind numeric steps, unguarded (§2).
2. **~9,965 spacing utilities, 426 distinct classes, 36 distinct scale steps.** The top of the histogram is healthy (2/1/3/4 dominate), but a long tail of invented steps (`px-1.25`×81, `2.25`, `5.5`, `5.75`, `8.5`…) and 679 arbitrary values (`py-[0.625rem]`, `gap-[0.4rem]`, `pl-[2.15rem]`) means five different "small gap" sizes can appear on one screen (§1).
3. **No vertical-rhythm convention.** `mb-1`(237) `mb-2`(243) `mb-3`(206) `mb-4`(140) are all heavily used for the same job — spacing stacked blocks — chosen per-file by feel. Same for `mt-*`. This is the single biggest "every page stacks differently" cause.
4. **Form-field spacing rule is ignored.** The house rule says `<OForm class="flex flex-col gap-5">`. Across **99** `<OForm>` usages, ~0 follow it; observed instead: `gap-y-2`, `space-y-3`, `gap-2.5`, `py-3.5 px-5.5`, or nothing (cramped).
5. **Drawer bodies are unowned space.** ODrawer bakes in header/footer padding (uniform everywhere) but the body has none — consumers invented **9 distinct body paddings** (0 → 24px) and **14 ad-hoc vw widths** on top of the 5 presets; 2 drawers bypass ODrawer entirely (§5).
6. **Page/listing chrome has drifted per module** — 5 different root-container class strings for the same listing-page shape, canonical header string broken on 4 pages, a legacy 10px inset on 3 pages (logs, About, Overview) vs the 16px standard, sidebar widths set three different ways (`w-57.5` vs `w-[14.375rem]` vs inline `style="width:230px"`) (§3, §6).

**The counter-example that proves the fix:** dialogs. One primitive (ODialog) + component tokens = **zero spacing overrides across 87 files** (§4). Inconsistency lives exactly where no primitive owns the spacing.

---

## 1. The numbers

| Metric | Count | Note |
|---|---:|---|
| Tailwind spacing utilities (p/m/gap/space-*) | **9,286** on-scale + **679** arbitrary | 426 distinct classes |
| Distinct numeric scale steps in use | **36** | healthy core: 0–4; long tail below |
| Arbitrary values that are exact class-equivalents | **501** | mechanical rewrite (`py-[0.625rem]`→`py-2.5`, `gap-[0.375rem]`→`gap-1.5`) |
| Arbitrary values genuinely off-grid | **130** | need snap-to-scale decisions |
| Arbitrary px / other (%, em) | 9 / 39 | |
| CSS `padding:`/`margin:` declarations in style blocks | **368** (191 distinct values) | 43 still px-valued |
| CSS `gap:` declarations | ~60 | 20 distinct values incl. `0.5625rem`, `0.4375rem`, `0.8125rem` |
| Inline `style="padding/margin…"` | 49 | negligible; mostly dynamic bindings |
| `padding/margin … !important` | 44 | override-pressure vs Quasar/legacy CSS |
| `var(--spacing-*)` consumed outside token files | **1** | the token scale is unused |

### 1a. Scale-step histogram (all spacing props aggregated)

```
step  uses        step  uses       step  uses
2     2,499       0.5     337      0.75    52   ← off-default
1     1,696       1.25    167 ←    20      25
3     1,541       6       156      10      15
4       923       5       108      5.5     13   ←
0       685       3.5      92      7/2.25  12   ←
1.5     470       8        57      4.5     11   ←
2.5     360                        1.75    10   ←
```
`←` = steps that are not on Tailwind's classic half-step grid — someone's per-file inventions (`px-1.25` alone appears 81×, an ad-hoc "5px" convention). Plus singletons: `2.75, 3.25, 3.75, 4.25, 5.25, 5.75, 8.5, 15, 18, 36`.

### 1b. Arbitrary spacing values — 501 noise, 130 real drift

**Noise (501 uses):** bracket syntax for values that have a real class — `py-[0.625rem]`→`py-2.5` (32), `py-[0.375rem]`→`py-1.5` (32), `gap-[0.625rem]`→`gap-2.5` (29), `px-[0.875rem]`→`px-3.5` (26)… Authors didn't know the fractional shorthand exists. Zero-risk codemod (identical CSS output).

**Real drift (130 uses):** values between grid steps, i.e. five different "small gap" inventions living side by side:

| Cluster | Values seen | Uses | Snap to |
|---|---|---:|---|
| "tiny gap" ~2–3px | `gap-[0.1rem]`, `gap-[0.15rem]`, `py-[0.15rem]`, `gap-[0.0938rem]`, `mt-[0.1rem]` | ~20 | `*-0.5` (2px) |
| "small gap" ~3–5px | `gap-[0.2rem]`, `gap-[0.3rem]`, `py-[0.18rem]`, `pb-[0.185rem]`, `mb-[0.2rem]` | ~30 | `*-1` (4px) |
| "5–6px" | `px-[0.325rem]`, `mr-[0.325rem]`, `p-[0.325rem]`, `py-[0.35rem]`, `gap-[0.4rem]`, `px-[0.4rem]` | ~45 | `*-1.5` (6px) |
| "10–11px" | `py-[0.6rem]`, `p-[0.675rem]`, `py-[0.725rem]`, `mr-[0.85rem]` | ~10 | `*-2.5` / `*-3` |
| one-offs | `pl-[2.15rem]` (7 — icon-inset in search inputs), `mb-[2.4rem]` | ~8 | `pl-9`, `mb-10` |

**Worst files:** `plugins/traces/SessionDetails.vue` (58 arbitrary spacing), `plugins/traces/ThreadView.vue` (30), `views/synthetics/MonitorRuns.vue` (25), `plugins/traces/TraceDetails.vue` (17), `views/OverviewTab.vue` (14).

### 1c. CSS declarations in `<style>` blocks (368)

Beyond `margin: 0`/`padding: 0` resets (~90), the rest is a per-file value zoo: `padding: 0.75rem`, `0.5rem 1rem`, `0.5rem 0.75rem`, `0.375rem 0.5rem`, `0.3rem 0.5rem`, `0.1rem 0.3rem`, `8px 12px !important`… plus off-grid `gap: 0.5625rem`, `0.4375rem`, `0.8125rem`, `1.125rem`. None reference tokens.

---

## 2. Architecture finding — where spacing *actually* comes from

- `base.css:281-288` defines `--spacing-px, -3, -4, -5, -6, -8, -10` in plain `:root`. They are **not** in any `@theme` block, so Tailwind ignores them; utilities like `p-3` resolve from Tailwind v4's built-in `--spacing: 0.25rem` multiplier. (Values happen to coincide, so no visual bug — but the project scale and the working scale are two disconnected systems.)
- The only real consumers of `--spacing-*` are component tokens in `component.css` (`--spacing-dialog-header-px/py`, `--spacing-dialog-content-px/py`, `--spacing-dialog-footer-px/py`, `--spacing-tabs-height`, `--text-icon-*`, `--spacing-field-width-*`).
- Consequence: **the de facto spacing system is "Tailwind numeric utilities, any value allowed, no guard."** Since Tailwind v4 generates *any* numeric step (`px-1.25`, `mb-5.75` all compile), nothing stops off-grid inventions — hence the 36-step histogram.

---

## 3. Listing pages, module by module

All 16 listing pages now use `OTable`; **no page overrides cell/row padding** — table density is fully owned by the lib component. The drift is in the page chrome around the table.

### Root container — 5 different class strings for the same shape

| Convention | Pages |
|---|---|
| `flex flex-col h-full p-0` | AlertsDestinationList, TemplateList, RegexPatternList, CipherKeys |
| `p-0 h-full flex flex-col` (same, reordered) | User, ListOrganizations, ServiceAccountsList |
| `flex flex-col h-full [min-h-0]` (no `p-0`) | AlertList, FunctionList, PipelinesList, EnrichmentTableList |
| `h-full` only | LogStream, ReportList, ActionScripts |
| `PageLayout` as root, no wrapper div | Dashboards |

The `p-0` is a no-op carried around in two different orderings — pure copy-paste drift.

### Header — canonical string `shrink-0 px-4 border-b border-border-default`, 3 deviations

| File | Deviation |
|---|---|
| [FunctionList.vue:31](src/components/functions/FunctionList.vue) | missing `border-b border-border-default` — no divider under header |
| [EnrichmentTableList.vue:32](src/components/functions/EnrichmentTableList.vue) | missing `border-b` (uses `tabs-below`) |
| [SyntheticMonitoring.vue:8](src/views/SyntheticMonitoring.vue) | missing `shrink-0` — header can collapse under flex pressure |
| [PipelinesList.vue](src/components/pipeline/PipelinesList.vue) | **no AppPageHeader at all** — only listing page without a page header; toolbar lives in OTable `#toolbar` |

Two header mounting patterns coexist: `PageLayout #header` slot (7 pages) vs `AppPageHeader` used directly (8 pages).

### Table wrapper — two nesting depths + two dropouts

- Single `bg-card-glass-bg flex-1 min-h-0…` div: AlertsDestinationList, TemplateList, RegexPatternList, CipherKeys.
- Double-nested `w-full flex-1 min-h-0 overflow-hidden` → `bg-card-glass-bg h-full`: User, ListOrganizations, ServiceAccountsList, FunctionList, PipelinesList, EnrichmentTableList.
- No glass wrapper at all: [Dashboards.vue:118](src/views/Dashboards/Dashboards.vue), [ActionScripts.vue:40](src/components/actionScripts/ActionScripts.vue).

### Sidebar width — three mechanisms for the same folder sidebar

| File | Mechanism |
|---|---|
| [AlertList.vue:76](src/components/alerts/AlertList.vue) | `w-57.5` (Tailwind step) |
| [SyntheticMonitoring.vue:35](src/views/SyntheticMonitoring.vue) | `w-[14.375rem]` (arbitrary) |
| [ReportList.vue:51](src/components/reports/ReportList.vue) | inline `style="width:230px"` (hardcoded px) |

---

## 4. Dialogs — ✅ the one clean surface (proof the token approach works)

Every real dialog is an `ODialog` (117 usages in 87 files; raw `q-dialog` = **0**), and `ODialog` applies all padding through the `--spacing-dialog-*` tokens:

| Region | Value | Source |
|---|---|---|
| Header / content / footer | `20px / 12px` (`--spacing-5`/`--spacing-3`) | [ODialog.vue](src/lib/overlay/Dialog/ODialog.vue) via `px-dialog-*-px py-dialog-*-py` |
| Footer button gap | `gap-2` everywhere — built-in footer **and** all custom `#footer` slots | — |
| `full` size body | `p-0` — full-screen bodies own their padding | ODialog.vue:559 |

Sampled 30+ dialog implementations across alerts, dashboards, streams, IAM, settings, pipelines, logs, traces, enterprise: **zero files override the token values.** The only sanctioned deviation is the full-bleed pattern (negative margins `-mx-dialog-content-px -my-dialog-content-py`) in 3 files (RenderDashboardCharts, EnterpriseUpgradeDialog, OverrideConfigPopup) — which still derives from the tokens.

**Single outlier:** [O2AIConfirmDialog.vue](src/components/O2AIConfirmDialog.vue) — not an ODialog at all (bespoke inline overlay div) with hardcoded `pt-4 px-4 pb-3.5` and `gap-2.5` buttons. The only dialog-like surface off-token.

**Why this matters:** dialogs prove the recipe — one lib primitive + component tokens + slots = zero drift across 87 files. Listing pages (§3), forms, and vertical rhythm (§1) drifted precisely because they lack an equivalent owned primitive/convention.

---

## 5. Drawers — half-owned: header/footer consistent, body is a free-for-all

`ODrawer` bakes in header/footer padding (reuses the dialog tokens → 20px/12px, uniform everywhere) but **the body slot has no built-in padding** ([ODrawer.vue:475-485](src/lib/overlay/Drawer/ODrawer.vue)) — every consumer invents its own. Result across ~45 drawers:

### 9 distinct body paddings

| Body padding | Files (examples) |
|---|---|
| `p-0` / own layout | SearchJobInspector, ModelPricingList, DashboardSettings |
| `px-1 py-[0.625rem]` (4×10px) | EventDetailDrawerContent |
| `px-2 py-2` (8px) | AlertHistoryDrawer, PredefinedThemes |
| `p-2.5` (10px) | ServiceGraphNodeSidePanel |
| `p-3` / `px-3` (12px) | ImportSemanticGroupsDrawer, pipeline Condition |
| `px-4` / `p-4` (16px) | TraceDetails, DomainManagement |
| `px-4 py-2` | IncidentDetailDrawer sections |
| `p-5` / `px-5 py-4` (20px) | RunDetailDrawer, EnrichmentSchema |
| `px-6 py-4` (24×16px) | BackfillJobDetails |

Same "detail drawer" concept, nine densities depending on module.

### 19 distinct widths

Presets `sm/md/lg/xl/full` (lg=640px is the most common, ~15 drawers) **plus 14 ad-hoc numeric vw values**: 30, 40, 45, 47, 50, 60, 65, 70, 74, 80, 85, 90, 97, 100. Nobody chose between 45 and 47 or 70 and 74 for a reason — each file eyeballed it.

### 2 drawers bypass ODrawer entirely

- [ExecutionDetailDrawer.vue](src/components/synthetics/results/ExecutionDetailDrawer.vue) — hand-rolled Teleport drawer, `max-w-2xl` (672px — matches no preset), header `px-5 py-4` (vs token 20/12).
- [IncidentDetailDrawer.vue](src/components/alerts/IncidentDetailDrawer.vue) — hand-rolled in-page panel, `w-100` col, header `px-4`, three different section paddings inside one file (`px-4 py-2`, `p-4`, `p-3`).

---

## 6. Page containers & tab panels

**Dominant (and good) convention — ~19 of 29 sampled views:** no padding on the page root; `AppPageHeader` carries `px-4`; content areas manage their own inset. `AppPageHeader` is used in 92 files; the canonical header-class is `shrink-0 px-4 border-b border-border-default` (16 exact matches).

**Deviations:**

| File | Deviation |
|---|---|
| [About.vue:18](src/views/About.vue) | hand-rolled `px-[0.625rem] pb-[0.625rem] pt-2.5` root inset — 10px, matches no other page |
| [OverviewTab.vue:16](src/views/OverviewTab.vue) | `pt-[0.625rem] pr-[0.875rem] pb-[0.625rem] pl-[0.625rem]` — 10px with a 14px right edge |
| [plugins/logs/Index.vue:20](src/plugins/logs/Index.vue) | inner `pt-[0.625rem] pl-[0.625rem]` — 10px top/left only |
| [MonitorRuns.vue:37](src/views/synthetics/MonitorRuns.vue) | header `px-2` instead of `px-4` |
| [SessionViewer.vue:18](src/views/RUM/SessionViewer.vue) | legacy scoped `qp-2` class |
| [PromQL/QueryBuilder.vue](src/views/PromQL/QueryBuilder.vue) | content `px-2.5` — its own inset value |

The `0.625rem` (10px) page inset in logs/About/Overview is a legacy Quasar-era value (`q-pa-sm`≈8px → eyeballed 10px) that survived migration — these three pages have visibly tighter/odd chrome than the `px-4` (16px) standard.

**Tab panels:** all O2 (`q-tab-panel` only in test stubs). `OTabPanel` defaults to `p-0`; 50 of 54 instances keep the default, 4 use `padding="sm"` ([EventDetailDrawerContent.vue](src/components/rum/EventDetailDrawerContent.vue)). Consistent enough — the panel-owner-pads model works because the default is 0, mirroring the dialog lesson.

---

## 7. Remediation plan

Ordered by leverage; phases 1–2 are mechanical, 3–5 are the structural fixes that make drift impossible to reintroduce.

| Phase | Work | Size | Risk |
|---|---|---|---|
| 1 | **Codemod:** 501 bracket→class rewrites (`py-[0.625rem]`→`py-2.5` …) — identical CSS output | mechanical | none |
| 2 | **Snap the 130 off-grid values** to the §1b cluster table (+ 9 px-arbitrary, 43 px CSS decls → rem) | ~180 sites | low — 1–2px shifts, visual spot-check |
| 3 | **Define the blessed scale & guard it.** Decide the allowed steps (proposal: `0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12` + layout sizes); kill off-scale inventions (`px-1.25`×81, `2.25`, `4.5`, `5.5`, `5.75`, `8.5`…); add a ratchet in `check-design-consistency.mjs` that fails on new arbitrary spacing brackets and non-blessed steps | decision + ~300 sites | medium |
| 4 | **Give ODrawer a body-padding prop** (`padding="none|sm|md"` like OTabPanel, default `md`=`p-4`); migrate the 9 body-padding variants onto it; collapse the 14 ad-hoc vw widths onto presets (+ allow explicit width only for editor-style 90+ drawers); rewrite the 2 hand-rolled drawers (ExecutionDetailDrawer, IncidentDetailDrawer) onto ODrawer | ~45 files | medium |
| 5 | **Standardize page chrome:** one root recipe (`flex flex-col h-full min-h-0`, no `p-0` noise), canonical header string enforced (fix FunctionList/EnrichmentTableList/SyntheticMonitoring/MonitorRuns), add missing AppPageHeader to PipelinesList, migrate the 10px-inset pages (About, OverviewTab, logs/Index) to the `px-4` standard, one sidebar width token (fix ReportList's `style="width:230px"`) | ~12 files | medium — visible (intended) changes |
| 6 | **Vertical rhythm + forms:** pick one stack convention (`flex flex-col gap-*` over `mb-*` chains; `gap-5` on OForm per house rule) and apply on touched files opportunistically; enforce for new code via review/ratchet | long tail | low per-file |
| 7 | **Reconcile the token layer:** either register the blessed steps as real `--spacing-*` `@theme` tokens (making `p-3` resolve from project tokens) or delete the dead `:root` scale and document "Tailwind grid is the scale" — currently it's half of each | small | low |

**Model to copy:** §4 dialogs — a single lib primitive owning all chrome spacing via component tokens produced zero drift across 87 files without any enforcement. Drawer body, page chrome, and forms drift exactly where no primitive owns the spacing.

---

Regenerate the §1 numbers any time: `bash web/scripts/spacing-audit.sh` (writes per-category lists to `/tmp/spacing_audit_*.txt`). The §3–§6 surface tables were compiled by file-by-file reading of all 16 listing pages, 30+ dialogs, ~45 drawers, and ~29 routed views on 2026-07-18.
