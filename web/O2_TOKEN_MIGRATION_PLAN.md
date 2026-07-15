# O2 Design-Token Consolidation — Plan & Consistency Audit

> **Part I** (below, condensed): the original `--o2-*` removal plan — **SHIPPED**. `grep -r 'var(--o2-' src` = 0, definitions = 0, theme.ts emits only `--color-*`, stylelint + `check-css-tokens.mjs` guards are live.
>
> **Part II** (the bulk of this document): full design-consistency audit of `web/src` (2026-07-15) — every remaining way components bypass the token system, with counts, concrete evidence, root causes, and a phased remediation plan. **The `--o2-*` problem is gone; the "raw colors everywhere" problem is not.** Changing a semantic token today (e.g. secondary text color, default radius) does NOT propagate to most of the app, because ~3,000+ call sites hardcode palette classes, hex values, or hand-rolled dark-mode ternaries.

---

# Part I — `--o2-*` removal (SHIPPED)

Status of the original plan's deliverables:

| Deliverable | Status |
|---|---|
| `--o2-*` references / definitions in `src` | ✅ **0 / 0** |
| `utils/theme.ts` emits only modern `--color-theme-*` tokens | ✅ |
| `scripts/check-css-tokens.mjs` CI guard (undefined-token check) | ✅ live — "960 tokens defined, 865 refs checked, OK" |
| `web/.stylelintrc.json` banning `var(--o2-` at ERROR | ✅ |
| `scripts/o2-token-map.json`, `codemod-o2-refs.mjs`, `codemod-color-utilities.mjs` | ✅ exist |
| Bucket D domain palettes renamed to `--color-*` | ✅ (label-chip, span-kind, field-type, trace, json, service-health, wildcard, severity all live under `--color-*`) |

Carried-over debt from Part I's explicit non-goals (now in scope for Part II):
- `.body--dark` compat class still toggled; **131 `.body--dark` selectors** remain in `src` (111 inside `.vue` style blocks across 20 files). Most are collapsible to token-based rules (§II-3.G).
- `<style>`-block `var()` usage was declared "legitimate" wholesale — Part II refines this: the *var() usage* is fine, but ~704 **hardcoded hex values** in those same blocks are not.

---

# Part II — Design-Consistency Audit & Remediation Plan (2026-07-15)

> **Review decisions (2026-07-15):**
> 1. **CI enforcement of hardcoded values — APPROVED.** Arbitrary/hardcoded values (`text-[#666]`, `text-[13px]`, `gap-[6px]`, raw hex in styles/TS) have **no off-switch in Tailwind itself**, so they are enforced in CI: Phase B's `check-design-consistency.mjs` ratchet, flipping to zero-tolerance in Phase G.
> 2. **Tailwind default-palette unset — APPROVED.** Phase G's `@theme { --color-*: initial }` will ship: `text-gray-400` / `bg-blue-50` / `border-slate-200` stop compiling, and templates use only semantic utilities (`text-text-primary`, `bg-surface-base`, `border-border-default`, …). See §12.1 for the open utility-naming question (`text-primary`-style ergonomic aliases) and Phase G.4 for the optional `--radius-*` / `--text-*` unsets.
> 3. **Findings L–Q added** (second sweep, same day): dead `tw:` classes, Quasar utility classes, arbitrary-px spacing/sizing, px units in style blocks, hex in `.ts`, arbitrary z-index — categories the original A–K sweep missed.

## 0. EXECUTION STATUS (2026-07-15) — what's done, what's pending

> Part II was executed this day on `fix/token` (not yet committed). Pending items and the
> decisions they need are tracked in **`O2_TOKEN_MIGRATION_PENDING.md`** (team discussion).

**Verified green after execution:** `check-css-tokens` ✅ · `check-design-consistency` ratchet ✅ · unit tests ✅ 38,882 pass (2 AlertList timeouts are pre-existing load-flakes, pass in isolation) · `type-check` ✅ 0 errors.

| Phase | Status | Notes |
|---|---|---|
| **0 — P0 runtime bugs** | ✅ **DONE** | 56 phantom `--q-*`, `--tw-border-style`, 66 dead `tw:`, 5 leaks, 17 no-op ternaries; `--q-` guard hole closed |
| **A — token layer** | ✅ **DONE** | dark overrides, 30+ registrations, `text-2xs`/`text-compact`, `utils/chartTheme.ts`. (`dashboard-placeholder-bg`/`actions-column-shawdow` kept — they have real consumers, not dead) |
| **B — enforcement (ratchet)** | ✅ **DONE** | `check-design-consistency.mjs` + baseline + CI; `useTheme.ts` seam; ESLint/stylelint guards at **warn** |
| **F — radius/type/spacing/quasar** | ✅ **DONE** | ~2,000 value-identical renames. z-index + 10px floor left (design calls) |
| **C — template colors** | 🟡 **~90%** | rawPalette 1263→102, hexClass 1097→269. Residuals are intentional — see PENDING §1–4 |
| **D — JS theming** | 🟡 **~90%** | themeTernary 819→186, darkMechanism 1137→390; `chartColor()`/`useTheme()` adopted; specs repaired. Residuals = image swaps / Monaco / global hooks |
| **E — style blocks** | 🔴 **PENDING** | styleBlockHex 805, unscoped 206 — hard cases need dedicated token sets + scoping needs visual review. PENDING §1–2 |
| **G — palette kill + lock flip** | 🔴 **PENDING** | **gated** on C/E residuals being registered/excepted first. PENDING §5 |

**Live debt counts (baseline snapshot):** rawPalette 102 · hexClass 269 · themeTernary 186 · darkMechanism 390 · styleBlockHex 805 · unscopedStyle 206 · stylePxUnit 1077 (ratchet-only) · arbPx 174 · arbTextSize 323 · arbRadius 25 · bareRounded 26 · arbZ 49 · inlineHex 38 · tsHex 471 (mostly allowlisted palette sources).

---

## 1. Executive summary — the debt, in numbers

Measured on `web/src` (`.vue` files unless noted):

| # | Finding | Count | Impact |
|---|---|---|---|
| A | Raw Tailwind palette utilities (`text-gray-400`, `bg-gray-800`, `text-red-500`, …) | **1,263 occurrences / 184 files** | Un-themed. Ignore token changes AND dark mode |
| B | Arbitrary hex utility classes (`text-[#666]`, `bg-[#e7e6e6]`, `border-[#e5e7eb]`) | **1,097 occurrences / 113 files** | Same, plus unreadable |
| C | `bg-white` / `text-white` / `text-black` etc. on themeable surfaces | **~250 occurrences** | Break in dark mode unless hand-paired |
| D | JS theme ternaries `theme === 'dark' ? X : Y` (`.vue`+`.ts`) | **834** in **5 spellings** (226 emit raw hex) | Hand-rolled dark mode, drifts from tokens; includes **no-op ternaries** |
| E | Static `style=""` attributes with hardcoded colors | **188** | Un-themed, highest specificity |
| F | Phantom `--q-*` tokens that are never defined | **56 `var()` refs to 18 names** | **Silently broken UI today** (transparent bg, invalid colors) — hidden by guard allowlist |
| G | Hardcoded hex inside `<style>` blocks | **~704** | Duplicates tokens; forces `.body--dark` twin rules |
| H | Unscoped `<style>` blocks | **210 of 245** | Global leakage risk (5 confirmed leaks) |
| I | Radius inconsistency (bare `rounded` ×547 vs `-md` ×289 vs `-lg` ×282 vs `xl+` ×34 vs arbitrary ×~95) | **~1,750 sites, 5 vocabularies** | No single knob to change app radius |
| J | Arbitrary font sizes (`text-[13px]` ×169, `text-[11px]` ×149, `text-[10px]` ×88, …) | **~750+** | Type scale not enforceable |
| K | Token-system defects (missing dark overrides, unregistered tokens, dead/misspelled tokens, `--tw-border-style` bug) | ~30 items | Root causes of A–J (§4) |
| L | Dead `tw:`-prefixed classes (prefix was removed from the build; these resolve to nothing) | **~196 tokens / 66 lines / 3 files** | **Silently unstyled UI today** (P0) |
| M | Quasar utility classes (`q-pa-md`, `q-mt-sm`, `text-weight-bold`, …) — helper CSS not loaded | **50 occurrences / 28 files** | Dead classes / banned vocabulary |
| N | Arbitrary-px spacing/sizing utilities (`gap-[6px]`, `px-[10px]`, `w-[200px]`, `h-[36px]`) | **~999** | Spacing scale not enforceable |
| O | Multi-digit `px` values inside `<style>` blocks (rem-only rule; `1px` hairlines exempt) | **~3,026 (≥10px alone)** | Not zoom/density-safe; violates CSS-units rule |
| P | Hardcoded hex in `.ts` files (chart palettes, theme constants, syntax highlighters) | **646 non-spec** | JS-rendered UI ignores tokens & theme |
| Q | Arbitrary z-index (`z-[1]` … `z-[10001]`) | **49** | Stacking-order roulette; no layering scale |
| R | **Dark-mode mechanism fragmentation** — 6 different ways to detect/apply dark mode (see §3.R) | **6 mechanisms, ~1,500 sites** | No single way; can't reason about or enforce dark mode |

**The user-visible consequence** (the exact scenario that motivated this audit): if design changes `--color-text-secondary` today, the **315 `text-gray-400`** and **129 `text-gray-500`** sites don't move. If design changes the app radius from `md` to `lg`, the 547 bare-`rounded` + 95 arbitrary-radius sites don't move. The token system is correct and complete enough — **the consumers bypass it.**

## 2. Root causes (why this keeps happening)

These must be fixed or the cleanup will regress within weeks:

1. **Tailwind's default palette is still enabled.** `src/styles/tailwind.css` does `@import "tailwindcss"` with **no `--color-*: initial` reset**, so `text-gray-400`, `bg-blue-50`, `text-red-500` all compile happily. The path of least resistance produces un-themed UI. *(Endgame fix: §6.1.)*
2. **The `grey`/`gray` trap.** The brand neutral scale is `--color-grey-*` (British spelling) and is **not registered** as Tailwind utilities. A developer typing `text-grey-500` gets nothing, types `text-gray-500`, gets Tailwind's *different* gray (`#6b7280` vs brand `#737373`) — and it silently works. The brand primitive scale is effectively unreachable from templates.
3. **Type-scale gaps.** The app's dense-UI sizes (13px base, 11px captions, 10px micro-labels) have **no registered utility**: `text-sm` is re-pinned to 14px, there is no `text-2xs`. So 750+ sites use `text-[13px]`-style arbitrary values because there is literally no token to reach for.
4. **`dark:` was never the convention, and tokens arrived late.** Old code hand-rolls dark mode via `store.state.theme === 'dark'` ternaries (735!). New code copies the nearest existing pattern. Nothing bans any of it — stylelint only bans `var(--o2-`.
5. **The CI token guard allowlists the entire `--q-` prefix** (`check-css-tokens.mjs:27`), so 18 invented pseudo-Quasar tokens (`--q-text-secondary`, `--q-primary-rgb`, `--q-background`, …) pass CI while rendering as *undefined* at runtime.
6. **No radius/spacing/typography policy exists in writing.** `rounded` vs `rounded-md` vs `rounded-lg` is developer mood; both the project `--radius-*` tokens and Tailwind's default radius scale coexist with identical values, so nobody notices there are two vocabularies.

## 3. Findings in detail

### A. Raw Tailwind palette utilities — 1,263 occurrences / 184 files

Top offenders: `text-gray-400` ×312, `text-gray-500` ×121, `text-red-500` ×63, `text-gray-600` ×35, `border-gray-200` ×31, `text-gray-300` ×30, `border-gray-700` ×25, `bg-gray-800` ×24, `bg-gray-100` ×21, `text-green-500` ×19, `text-blue-600` ×18, `text-amber-500` ×18, `bg-blue-50` ×18, `ring-primary-500` ×16.

Distribution: `components/` **938** (alerts 295, settings 218, pipelines 77, rum 58, ingestion 58, functions 51, pipeline 39, logstream 32, dashboards 28, anomaly_detection 27), `plugins/` **185**, `views/` **35**, `enterprise/` **13**. Worst single files: `components/settings/ServiceIdentitySetup.vue` (**149**), `plugins/logs/SearchJobInspector.vue` (63), `components/alerts/IncidentDetailDrawer.vue` (60), `plugins/traces/TraceEvaluationsView.vue` (42), `components/alerts/steps/QueryConfig.vue` (36).

*(Nuance: `text-primary-600`-style `primary-*` utilities (~80 of the 1,263) ARE token-backed — theme.ts drives `--color-primary-*` at runtime — so they theme correctly. They should still migrate to semantic wrappers (`text-accent`, `text-text-link`) but are not broken today.)*

**Three sub-patterns, worst first:**

1. **The no-op ternary** — theme-aware-*looking* code that isn't:
   `anomaly_detection/steps/AnomalyDetectionConfig.vue:172` → `store.state.theme === 'dark' ? 'text-gray-400' : 'text-gray-400'` (both branches identical; repeats at :473, :578; also `AnomalyAlerting.vue:139`, `ServiceIdentitySetup.vue:161,180,261,281,356`). The author reached for a theme conditional and forgot to differentiate — proof the raw class is un-themed while masquerading as themed.
2. **Bare raw class, no dark handling at all** — broken in dark mode:
   `views/AwsMarketplaceSetup.vue:37,64,73,…` (8× `text-gray-400` body copy; mirrored in `AzureMarketplaceSetup.vue`), `plugins/traces/TraceDAG.vue:21,30` (loading/empty states), `enterprise/components/billings/proPlan.vue:98,115,133`, `components/TenstackTable.vue:1120` (`bg-[#f5f5f5]` sticky footer).
3. **Hand-rolled real ternary from raw palette** — works, but drifts from tokens:
   `plugins/logs/SearchJobInspector.vue:77,97,114,134` → `theme === 'dark' ? 'text-gray-400' : 'text-gray-500'`; `ServiceIdentitySetup.vue:108-134` → `? 'bg-gray-700/60' : 'bg-gray-50'`, `? 'bg-gray-600 text-gray-100' : 'bg-white text-gray-500 shadow-sm'` (60 ternaries in that one file).

Status colors misused the same way: `TraceEvaluationsView.vue:90` → `PASS ? 'text-green-500' : FAIL ? 'text-red-500' : 'text-gray-400'` — should be `text-status-positive` / `text-status-error-text` / `text-text-muted`.

**Fix:** codemod per the canonical map (§7.1), collapsing dark-pair ternaries to a single semantic utility. The token already handles dark mode.

### B. Arbitrary hex classes — 1,097 occurrences / 113 files

Top values: `bg-[#e7e6e6]` ×34, `bg-[#747474]` ×34, `text-[#666]` ×33, `text-[#6b7280]` ×29, `text-[#9ca3af]` ×27, `border-[#e5e7eb]` ×27, `text-[#333]` ×24, `bg-[#f5f5f5]` ×20, `text-[#b0b0b0]` ×16, `text-[#374151]` ×15, `bg-[#1e1e1e]` ×14.

Note that most of these hexes ARE Tailwind gray values written out longhand (`#6b7280` = gray-500, `#9ca3af` = gray-400, `#e5e7eb` = gray-200, `#374151` = gray-700) — i.e. category A wearing a disguise, mapping to the same semantic tokens.

Evidence highlights:
- `plugins/traces/TraceDAG.vue:446-465` — an entire **hardcoded color map** in JS: 14 node types × hand-authored light+dark hex (`generation: 'border-[#4caf50] bg-[#e8f5e9] dark:border-[#66bb6a] dark:bg-[#1a2e1a]'`, …). This is a domain palette that belongs in the token layer (like the existing `--color-span-kind-*` family).
- `plugins/metrics/SyntaxGuideMetrics.vue:43-103` — `theme == 'dark' ? 'bg-[#747474]' : 'bg-[#e7e6e6]'` repeated ~10× for highlight chips → one `bg-highlight`-style token.
- `components/alerts/QueryEditorDialog.vue` (~23 hits) — full panel chrome (`border-[#2d3748]`/`border-[#e5e7eb]`, `bg-[#1a1a1a]`/`bg-white`) hand-forked by ternary → `border-border-default` + `bg-surface-base` do this for free.
- `components/alerts/steps/Advanced.vue:43,84,154,171` — `? 'text-[#9ca3af]' : 'text-[#6b7280]'` → literally `text-text-secondary`.
- `views/ShortUrl.vue:7` — `text-[#666]` "Redirecting…" — light-only, **snapshot-tested against the hex** (`ShortUrl.spec.ts:126`), so tests actively defend the anti-pattern.
- `plugins/pipelines/PipelineFlow.vue:26` — mixes vocabularies in one class list: `bg-white text-[#374151] … dark:bg-surface-base dark:text-[#f3f4f6]`.

**Fix:** hex→token map (§7.2) + codemod; new tokens only for the genuine domain palettes (TraceDAG node types).

### C. `bg-white` / `text-white` / `text-black` — ~250 occurrences

`bg-white` ×102 (+ opacity variants), `text-white` ×93, `border-white` ×17, `text-black` ×12, `bg-black` ×6. Legitimate when on top of a fixed-color accent (e.g. white text on a primary button — though that's `text-button-primary-foreground`). Broken when used as a surface: `views/Dashboards/addPanel/AddPanel.vue:177` → `theme === 'dark' ? 'bg-[#1a1a1a]' : 'bg-white'` (→ `bg-surface-base`), `plugins/traces/ThreadView.vue:211` chat bubble `bg-white border-[#e5e7eb]` with **no dark handling**.

**Fix:** manual-review category (not blind codemod): `bg-white`-as-surface → `bg-surface-base`/`bg-surface-overlay`; `text-white`-on-accent → `text-text-inverse` or component foreground token.

### D. JS theme ternaries — 735 in `.vue` (226 emitting hex), plus the chart-utils layer

Four recurring shapes:

1. **Class-string ternaries** (covered in A/B above) — collapse to semantic utility.
2. **Local ad-hoc CSS-var injection** — `components/shared/HomeViewSkeleton.vue:29-31` (×5 blocks, spec-asserted in `HomeViewSkeleton.spec.ts`):
   ```
   theme === 'dark' ? '[--tile-bg:#2b2c2d] [--tile-border:#444444] [--text-primary:#cccfd1]'
                    : '[--tile-bg:#ffffff] [--tile-border:#e7eaee] [--text-primary:#2e3133]'
   ```
   The sibling `plugins/traces/LLMInsightsSkeleton.vue:143-145` defines the *same three local vars* correctly as aliases of `var(--color-surface-base)` etc. Two components, same intent, opposite strategies — the correct one already exists in-repo and the whole ternary deletes.
3. **`:style` object ternaries** — `components/iam/quota/Quota.vue:160` (`backgroundColor: … ? '#212121' : '#f1f1ee'`), `alerts/IncidentDetailDrawer.vue:336,452,453`, `alerts/steps/QueryConfig.vue:617`, `ServiceIdentitySetup.vue:1366-1483`, SVG strokes in `SearchJobInspector.vue:38-232` (7 icon strokes hand-themed → `stroke="currentColor"` + a text-color class).
4. **Chart config objects (ECharts/Plotly)** — `views/UsageTab.vue` ×11 (`color: theme === "dark" ? "#B7B7B7" : "#72777B"`), `plugins/traces/Index.vue:1518-1536`, `TraceDetails.vue:1671`, `composables/useStickyColumns.ts:58,74`, and the whole `utils/dashboard/` conversion layer (`convertPromQLData.ts:403,944`, `convertSQLGaugeChart.ts:57`, `convertSQLHeatmapChart.ts:152`, `convertSQLPieDonutChart.ts:58,209`, `heatmapDefaults.ts:41`, …) — all `? "#fff" : "#000"` variants.

**Fix for shape 4 (the only one that can't use CSS):** a single **chart-theme module** (`utils/chartTheme.ts`) that reads resolved token values via `getComputedStyle(document.documentElement).getPropertyValue('--color-text-secondary')` (cached, invalidated on theme change) and exposes `chartTheme.textSecondary`, `chartTheme.surfaceBase`, `chartTheme.axisLine`, etc. Chart builders take colors from it; zero hex in chart code. This also makes charts follow *custom* accent themes, which the ternaries never did.

### E. Static inline `style=""` with hardcoded colors — 188

Concentrations: `components/alerts/IncidentServiceGraph.vue` (legend dots `style="color: #ef4444;"` :36-49 + JS-built tooltip HTML :524-580), `components/traces/FlameGraphView.vue:60,428-439` (tooltip HTML strings), `plugins/traces/TraceDetailsSidebar.vue:1136-1151` (JSON pretty-printer emits `<span style="color: #9ca3af;">` — the `--color-json-*` tokens exist for exactly this), `views/RUM/SessionViewer.vue:56,61`, `components/logstream/schema.vue:386`, `alerts/AlertHistoryTimeline.vue:38`.

**Fix:** convert to classes/tokens. JS-built HTML strings should emit class names styled in (scoped) CSS with `var(--color-*)`, not inline hex.

### F. Phantom `--q-*` tokens — silently broken UI **today** (P0)

Quasar defines only `--q-primary/secondary/accent/dark/dark-page/positive/negative/info/warning/transition-duration` (and the project aliases `--q-primary → var(--color-theme-accent)` in `semantic.css:210`). Everything else `--q-*` is **undefined at runtime** — and invisible to CI because `check-css-tokens.mjs:27` allowlists the whole `/^--q-/` prefix.

18 phantom names, 56 `var()` refs. What actually breaks:

| Phantom token | Refs | Where | Visible breakage |
|---|---|---|---|
| `--q-primary-rgb` | 30 | `EnterpriseUpgradeDialog.vue:152-191`, `RUM/SourceMapDropzone.vue:34-37` | `rgba(var(--q-primary-rgb), .1)` = **invalid color → rule dropped**; hover tints/dropzone accents silently missing |
| `--q-text-secondary` | 18 | `alerts/DestinationTestResult.vue` (10×), `TelemetryCorrelationPanel.vue` (7×), `CorrelationDemo.vue:204` | text falls back to inherited color |
| `--q-background` | 8 | `RUM/UploadSourceMaps.vue:18`, `SourceMaps.vue`, `AwsMarketplaceSetup.vue:18`, `SearchJobInspector.vue:18`, … | transparent backgrounds |
| `--q-border-color` | 8 | `alerts/AlertInsights.vue:81,160`, `TelemetryCorrelationPanel.vue` | borders collapse to `currentColor` |
| `--q-color-text` | 5 | `enterprise/EvalTemplateEditor.vue:46-115` | form labels inherit (black in dark mode) |
| `--q-text`, `--q-primary-text`, `--q-page-background`, `--q-item-bg`, `--q-color-dark`, `--q-positive-rgb`, `--q-hover-color`, `--q-negative-rgb`, `--q-item-hover-bg`, `--q-header-bg`, `--q-color-text-primary`, `--q-color-separator`, `--q-card-background` | 1–4 each | `AddTemplate.vue:102`, `AddAkeylessType.vue:64,148`, `component.css:3626`, … | assorted transparent/inherited fallthroughs |

**`components/TelemetryCorrelationPanel.vue` is the single worst file** — its entire chrome (`--q-background`, `--q-border-color`, `--q-header-bg`, `--q-text-secondary`, `--q-item-bg`, `--q-item-hover-bg`) rests on tokens that don't exist; the panel renders essentially unstyled in both themes.

**Fix (P0, do first):**
1. Map each phantom to its modern token (`--q-text-secondary`→`--color-text-secondary`, `--q-background`→`--color-surface-base`, `--q-border-color`→`--color-border-default`, `--q-item-bg`→`--color-surface-panel`, `--q-primary-rgb` consumers → `color-mix(in srgb, var(--q-primary) 10%, transparent)` instead of `rgba(var(--q-primary-rgb), 0.1)`).
2. In `check-css-tokens.mjs`, **replace the `/^--q-/` prefix allowlist with an exact-name list** of the 10 real Quasar variables so this class of bug can never hide again.

### G. Hardcoded hex inside `<style>` blocks — ~704, and the `.body--dark` twin-rule pattern

Top files: `O2AIChat.vue` (**~122**), `traces/ServiceGraphEdgeSidePanel.vue` (70), `traces/TraceDetailsSidebar.vue` (48), `alerts/IncidentList.vue` (46), `RichTextInput.vue` (38), `ingestion/setupCard/SetupCardRenderer.vue` (35).

Character analysis of the top offenders:
- **O2AIChat.vue** — mostly neutral greys duplicating text/surface/border tokens (`#1a202c`, `#e2e8f0`, `#191919`) + brand-purple accents duplicating primary; driven by manual `.light-mode`/`.dark-mode` class pairs instead of tokens. Only the gradient stops are genuinely bespoke.
- **ServiceGraphEdgeSidePanel.vue** — ~40% status colors duplicating `--color-status-*`/service-health tokens (`#10b981`, `#fbbf24`, `#ef4444`), ~40% dark-surface greys (`#242938`, `#1f2937`) that should be surface tokens, ~20% indigo accent.
- **IncidentList.vue** — 100% status/severity/badge border colors in light+dark pairs — every one collapses to a single token rule.
- **SetupCardRenderer.vue:813-855** — invents a full **private token vocabulary** (`--clay`, `--panel`, `--border`, `--text-1/2/3`, `--ok`, `--warn`…) with hardcoded light+dark values, all of which have global equivalents.

The `.body--dark` twin-rule pattern (111 occurrences / 20 files in `.vue` blocks): the large majority re-specify colors that a token-based base rule handles automatically. Example collapses:
- `IncidentList.vue:657` `.status-open { border: 1px solid #dc2626 }` + `:695` `body.body--dark .status-open { border: 1px solid #fca5a5 }` → one rule with `var(--color-status-error-*)` (×23 in this file alone).
- `TraceDetailsSidebar.vue:2788` `th { background:#f5f5f5 !important }` + `:2792` dark twin `#424242` → `var(--color-surface-panel)`.
- Legit keepers (minority): scrollbar-thumb colors, vue-flow canvas bg, the theme-picker's own preview chips.

**Fix:** replace hex with `var(--color-*)` in the base rule; delete the `.body--dark` twin. This *shrinks* CSS while fixing themeability.

*(Related, uncounted above: ~1,214 `rgb()`/`rgba()` literals across `.vue` files (templates + style blocks) escape the hex-only scan — the Phase B `styleBlockHex` regex counts `rgba?(` / `hsl(` too, and the fix is the same: `var(--color-*)` or `color-mix(in srgb, var(--color-*) N%, transparent)` for alpha variants.)*

### H. Unscoped `<style>` blocks — 210 of 245 (86%)

`<style>` ×206 + `<style lang="scss">` ×4 unscoped, vs only 35 scoped. Mitigating fact: the codebase overwhelmingly namespaces rules under a unique per-component root class, so **broad leakage is rare** — but five confirmed genuine leaks exist:

1. `plugins/traces/TraceDetailsSidebar.vue:2758` — bare `.highlight { background-color: yellow; }` global.
2. `views/UsageTab.vue:1212-1213` — global `a:focus-visible, button:focus-visible { … }`.
3. `lib/data/Timeline/OTimeline.vue:23` — bare `li:last-child …` descendant.
4. `TraceDetailsSidebar.vue:2189-2213` — restyles bare `table/th/td` under a generic parent.
5. `alerts/IncidentList.vue:657-736` — **23 generic global class names** (`.status-open`, `.severity-p1`, `.badge-blue`…) with no root namespace — collide with any same-named class anywhere in the app.

Also: `ServiceGraphEdgeSidePanel.vue` registers global `.slide-enter-*` transition classes and generic `.panel-header`/`.metric-*` roots.

**Why so many are unscoped:** many blocks style Quasar internals (`.q-*`), teleported dialogs/menus, or `v-html` content that scoped CSS can't reach without `:deep()`. That's a reason for *those rules*, not for the whole block.

**Fix policy:** every `<style>` block becomes `scoped`; rules that must escape use explicit `:deep()` / `:global()` so escape hatches are visible and greppable. Convert file-by-file with visual check (adding `scoped` can change effective specificity/reach — this is the one mechanical change in this plan that genuinely needs eyes). New-file enforcement immediately via `vue/enforce-style-attribute` (§6.2).

### I. Radius inconsistency — 5 competing vocabularies

Current spread: bare `rounded` (4px) ×547, `rounded-md` (6px) ×289, `rounded-lg` (8px) ×282, `rounded-full` ×167, `rounded-sm` (4px) ×83, `rounded-none` ×26, `rounded-xl` ×28 / `-2xl` ×4 / `-3xl` ×1, `rounded-xs` ×4, plus ~95 arbitrary (`rounded-[3px]` ×15, `rounded-[0.625rem]` ×14, `rounded-[5px]` ×13, `rounded-[2px]` ×11, `rounded-[10px]` ×11, `rounded-[0.3rem]` ×9, `rounded-[20px]` ×6, `rounded-[3.125rem]` ×5, …).

The project `--radius-*` tokens (sm=4, md=6, lg=8, xl=12, full) are registered and **coincide with Tailwind defaults**, so today `rounded-md` already flows through `--radius-md` — the system works; the 640+ bare-`rounded`/arbitrary sites just bypass it. If design bumps `--radius-md` 6→8, only the 289 `rounded-md` sites move.

**Proposed radius policy (needs a design sign-off, then enforced):**

| Role | Utility | Value |
|---|---|---|
| Chips, badges, tags, small inline controls | `rounded-sm` | 4px |
| **Default** — buttons, inputs, cards, menus, table wrappers | `rounded-md` | 6px |
| Dialogs, drawers, large panels | `rounded-lg` | 8px |
| Marketing/hero/empty-state cards only | `rounded-xl` | 12px |
| Pills, avatars, dots | `rounded-full` | — |
| **Banned** | bare `rounded`, `rounded-2xl+`, `rounded-[arbitrary]` | |

Migration mapping: bare `rounded` → `rounded-sm` (identical 4px — pure rename, then re-role to `-md` opportunistically during touch-ups); `[2px]/[3px]` → `rounded-sm`; `[5px]/[0.3rem]/[0.375rem]` → `rounded-md`; `[10px]/[0.625rem]` → `rounded-lg` or `-xl` (visual judgment); `[20px]/[3.125rem]` → `rounded-full` (they're pills).

### J. Typography — arbitrary sizes because the scale has holes

`text-[13px]` ×169 + `text-[0.8125rem]` ×53 (= the app's element base size), `text-[11px]` ×149 + `text-[0.6875rem]` ×36 + `text-[11.5px]` ×35, `text-[10px]` ×88, `text-[12px]` ×43 + `text-[0.75rem]` ×29 (duplicate `text-xs`!), `text-[14px]` ×22 (duplicate re-pinned `text-sm`), `text-[15px]` ×26, …

Known quirk to preserve: `:root` `--text-sm`=13px / `--text-base`=14px drive *element-level* rules, but `tailwind.css:34-53` re-pins the `text-sm`/`text-base` **utilities** to 14/16px. (Also: the comment on `--text-base` in `base.css:512` says "16px" but the value is 14px — fix the comment.)

**Fixes:**
1. Add + register `--text-2xs: 0.6875rem` (11px) → kills 220 arbitrary sites.
2. Design call for 13px: either accept `text-sm` (14px, +1px visually) at migration time, or add a registered `--text-compact: 0.8125rem` utility for dense data UIs (recommended — 222 sites want it).
3. `text-[12px]`/`text-[0.75rem]` → `text-xs` (mechanical, ×72).
4. 10px: keep only for chart axis micro-labels via one token (`--text-3xs: 0.625rem`) or lift to 11px; decide once.

### K. Token-system defects (fix in the token layer itself)

1. **`--tw-border-style: #e5e7eb`** (`semantic.css:211`, `dark.css:549`) — a **hex assigned to Tailwind's internal border-STYLE variable** (expects `solid`/`dashed`). Almost certainly meant to be a default border-*color*. Bug; remove/replace (a proper default border color already exists via `@layer base` in `tailwind.css:85-88`).
2. **Missing dark overrides** (light value renders on dark surfaces): all 10 `--color-field-type-*` (pastel bg + saturated text — the worst), `--color-service-health-{critical,degraded,healthy,warning}`, `--color-wildcard-bar-blue` (its green/orange/purple siblings HAVE dark overrides — someone forgot blue), `--color-cancel-query-bg`, `--color-icon-color`.
3. **Defined but unregistered** (no Tailwind utility, `var()`-only): `--color-json-{boolean,null,number,object,string}` (while `json-key` IS registered — split family), all 6 `--color-trace-*`, all `--color-field-type-*`, `--color-focus-ring` (so `ring-primary-500` ×16 gets used instead), `--color-log-table-header-bg`/`-row-hover`, `--color-table-actions-bg`, `--color-text-soft`, `--text-md`.
4. **Registration gaps in primitives:** `primary-950`, `error-300` unregistered; success scale has no registered text utility (`text-green-500` ×19 + `text-green-600` ×11 exist partly because `text-success-*` doesn't).
5. **Dead tokens:** `--color-dashboard-placeholder-bg` (0 consumers), `--color-actions-column-shawdow` (0 consumers, and misspelled). Delete.
6. **Near-dead (1 consumer):** `latency-p95`, `pivot-header-border`, `wildcard-bar-blue`, `icon-color-dark`, `log-table-row-hover`, `status-neutral-text` — review during Phase A.
7. `--color-icon-color-dark` is a static "dark variant as a second token" anti-pattern — should be one `--color-icon` token with a `.dark` override.

### L. Dead `tw:`-prefixed classes — 3 files, silently unstyled TODAY (P0)

The `tw:` prefix was removed from the Tailwind build, so any surviving `tw:flex` / `tw:items-center` / `tw:gap-*` class resolves to **nothing** — the elements render with no layout/spacing at all. Three files missed the prefix-removal migration:

| File | Affected lines |
|---|---|
| `components/iam/organizations/OrgCleanupTasksDialog.vue` | 46 |
| `components/settings/General.vue` | 19 |
| `components/iam/organizations/ListOrganizations.vue` | 1 |

**Fix (Phase 0):** strip the `tw:` prefix in these 3 files (mechanical `tw:` → `` within class attributes), then **visually verify both screens in light + dark** — two known prefix-removal gotchas apply: (a) bare utilities can collide with legacy global CSS classes of the same name (`bg-white` et al.), and (b) previously-dead malformed classes "wake up" after the strip. Guarded forever after by the `twPrefix` category in `check-design-consistency.mjs`.

### M. Quasar utility classes — 50 occurrences / 28 files

`q-pa-md`, `q-pt-sm`, `q-mt-*`, `q-gutter-*`, `text-weight-bold`, … Quasar's helper CSS is not loaded in this build (project convention: banned vocabulary), so these are dead classes like §L — spacing/weight silently missing.

**Fix (Phase F):** mechanical map to Tailwind equivalents — `q-pa-md`→`p-4`, `q-pa-sm`→`p-2`, `q-mt-sm`→`mt-2`, `q-gutter-{sm,md}`→`gap-{2,4}` on the flex parent, `text-weight-bold`→`font-bold`, `text-weight-medium`→`font-medium`. Visual check per file (same "was it dead or alive" caveat as §L).

### N. Arbitrary-px spacing/sizing utilities — ~999 occurrences

Beyond radius (§I) and font sizes (§J), spacing and sizing bypass the scale too: `gap-[6px]` ×34, `gap-[10px]` ×32, `px-[10px]` ×24, `py-[10px]` ×23, `h-[36px]` ×22, `w-[200px]` ×20, plus a long tail of `m*/p*/w/h/top/left/inset/leading-[Npx]`.

Tailwind v4's spacing scale is derived from `--spacing` (0.25rem), so numbered steps exist at 2px granularity — nearly every arbitrary value has an exact named step: `gap-[6px]`→`gap-1.5`, `gap-[10px]`→`gap-2.5`, `px-[10px]`→`px-2.5`, `h-[36px]`→`h-9`, `w-[200px]`→`w-50`. Only genuinely odd values (`text-[11.5px]`-style) need a design call.

**Fix (Phase F):** sed-able rename map for exact-step values; review tier for oddballs. Ratcheted as `arbPx` from Phase B.

### O. `px` units inside `<style>` blocks — ~3,026 (≥10px values alone)

The project CSS rule is rem-only (`1px` hairlines exempt), but style blocks are full of `13px`, `36px`, `200px`, … This is lower-priority than color work (px values are theme-neutral) but blocks density/zoom work.

**Fix:** fold into the Phase E per-file procedure as step 2½ — convert `px` → `rem` (÷16) while a file is already being tokenized/scoped; do NOT run a blind app-wide sed (line-height/letter-spacing/media-query values need eyes). Ratcheted as `stylePxUnit` so it only shrinks; zero-tolerance is **not** the Phase G bar for this category (see §12.4).

### P. Hardcoded hex in `.ts` — 646 (non-spec)

Top files: `utils/traces/traceColors.ts` (70), `utils/dashboard/colorPalette.ts` (50), `utils/logs/convertLogData.ts` (38), `constants/themes.ts` (36), `utils/logs/statusParser.ts` (34), `utils/query/vrlLanguage.ts` (28) — plus the chart converters already covered by §D shape 4.

Two distinct kinds — do not treat uniformly:
1. **Theme-dependent UI colors in JS** (converters, status parsers, Monaco/VRL syntax colors, sticky-column shadows) → route through Phase A's `chartColor('--color-…')`; zero hex is the target.
2. **Declared data-viz palette sources** (`colorPalette.ts` series palette, `constants/themes.ts` theme definitions, span palette fallbacks in `traceColors.ts`) — these are palette *definitions*, arguably the single legitimate home for literal hex outside the token files. Decision needed (§12.3): allowlist them by path in the `tsHex` guard, or move them into the token layer and read back via `chartColor()`.

**Fix:** Phase D covers kind 1; §12.3 decides kind 2. Ratcheted as `tsHex` (with the palette-source allowlist) from Phase B.

### Q. Arbitrary z-index — 49 occurrences

`z-[1]` ×16, `z-[1000]` ×9, `z-[10001]` ×4, `z-[100]` ×4, `z-[2]` ×4, … Ad-hoc stacking values are how tooltip-under-dialog bugs are born.

**Fix (Phase F):** adopt a documented ladder — `z-10` raised-in-flow · `z-20` sticky headers · `z-30` dropdowns/popovers · `z-40` overlays/drawers · `z-50` modals · `z-60` toasts (exact values need the §12.5 call, including where Quasar's own stacking contexts sit) — and map all 49 sites onto it. Anything above the ladder exists only for third-party interop and is allowlisted by file. Ratcheted as `arbZ` from Phase B.

### R. Dark-mode mechanism fragmentation — 6 ways to do one thing (**must converge to one schema, hard-enforced**)

Today there is **one source of truth** (correct) but **six downstream mechanisms** reading/applying it — three redundant CSS conventions, JS string-compares written five different ways, and 40 private wrapper flags. This is the reason "change how dark mode works" is currently impossible: there is no single seam. This section defines the **mandatory schema** and the **linter rules that make every other way fail the build.**

#### R.1 — The canonical dark-mode schema (the ONE way; this is the contract)

> **DOM contract:** the *only* signal for dark mode is the class **`.dark` on `<html>`**, owned solely by `utils/theme.ts`. `.body--dark`/`.body--light` on `<body>` are **compat-only, written by `theme.ts`, and read by nobody** (deleted once §R migration hits 0). `store.state.theme` is read in **exactly two files** — `composables/useTheme.ts` and `utils/chartTheme.ts` — and nowhere else, ever.

**Strict decision table — for any dark-mode need, there is exactly one allowed construct:**

| The need | The ONE allowed construct | Never |
|---|---|---|
| A color/bg/border that differs light↔dark | **A token** (`text-text-secondary`, `bg-surface-base`, …). Dark is handled automatically by `dark.css` `.dark` overrides — **write no dark handling at all** | any `dark:` on a color, any ternary, any hex pair |
| A **non-color** dark-only rule in a template (shadow swap, bg-image, opacity) | **Tailwind `dark:` variant** (`dark:shadow-none`) | `.body--dark`, `.light-mode`, JS ternary on class |
| A dark-only rule inside a `<style>` block (`:deep()`, keyframes, complex selector) | **`:where(.dark) &` / `.dark &`** in a **scoped** block, referencing tokens | `.body--dark`, `body.body--dark`, `.dark-mode` |
| A **resolved color value** for a JS chart/canvas lib (ECharts/Plotly) | **`chartColor('--color-…')`** (§3.A) | `theme === 'dark' ? '#x' : '#y'` |
| A **boolean** in JS logic that truly can't be CSS | **`const { isDark } = useTheme()`** | `store.state.theme === 'dark'`, a local `isDark` const, `classList.contains('body--dark')` |

That's it — five needs, five constructs, two of which (`.dark &`, `dark:`) are the same mechanism at different layers. Everything else is banned.

#### R.2 — Current fragmentation (the audit numbers)

| # | Mechanism | Count | Verdict under R.1 |
|---|---|---|---|
| 1 | `store.state.theme === 'dark'` JS reads (templates, computeds, `.ts`) | **834**, in **5 spellings** (`===`/`==` × `'dark'`/`"dark"`, +15 `!==`) | **Kill** → tokens / `useTheme()` / `chartColor()` |
| 2 | `isDark`/`isDarkMode`/`darkMode` local computed flags | **40** | **Consolidate** → the one `useTheme()` |
| 3 | Tailwind `dark:` variant (keyed to `.dark`) | **293** | ✅ **Canonical.** Keep |
| 4 | `.dark` selectors in `<style>` | **107** | ✅ Canonical (scoped, `:where(.dark) &`). Keep |
| 5 | `.body--dark` / `.body--light` selectors | **193** | **Migrate → `.dark`** (mostly deletable, §3.G) |
| 6 | `classList.contains('body--dark')` JS | **3** | **Migrate → `useTheme()`** |
| 7 | `.light-mode` / `.dark-mode` pairs (component-invented, e.g. O2AIChat) | **73** | **Delete** — a 3rd ad-hoc convention |

Fragmentation = **3 CSS conventions** + **JS compares in 5 spellings** + **40 private flags**. Target: mechanisms 3+4 are the only survivors on the CSS side; `useTheme()`+`chartColor()` the only survivors on the JS side.

#### R.3 — Enforcement (real linter rules, not just the count ratchet — this is what makes it "strong")

Three independent guards, so a violation fails on at least one:

1. **ESLint** `no-restricted-syntax` banning theme string-compares, with a **file `overrides` allowlist** of `composables/useTheme.ts` + `utils/chartTheme.ts` (only those two may compare `store.state.theme`):
   ```jsonc
   // .eslintrc — applies to src/**, overridden to "off" for the 2 sanctioned files
   "no-restricted-syntax": ["error", {
     "selector": "BinaryExpression[operator=/^[!=]==?$/] > MemberExpression[property.name='theme']",
     "message": "Dark mode has one JS seam: useTheme().isDark or chartColor(). Do not compare store.state.theme (§3.R)."
   }]
   ```
   Also ban the wrapper flags: `no-restricted-syntax` on `VariableDeclarator[id.name=/^(isDark|isDarkMode|darkMode)$/]` outside `useTheme.ts` → "import `useTheme()` instead."
2. **Stylelint** `selector-disallowed-list` (in the `**/*.{vue,css,scss}` override) banning the legacy/ad-hoc CSS conventions:
   ```json
   "selector-disallowed-list": [
     ["/\\.body--(dark|light)/", "/\\.(light|dark)-mode/"],
     { "message": "Dark mode CSS uses .dark only (Tailwind dark: variant or :where(.dark) &). §3.R" }
   ]
   ```
3. **`check-design-consistency.mjs`** `darkMechanism` category (belt-and-suspenders count ratchet) — counts mechanisms 1,2,5,6,7 per file; can only decrease.

**Rollout:** all three land at **Phase B** as `warn`/ratchet (freezes the debt immediately — no new violation can be added from day one), and flip to **`error`/zero-tolerance at Phase G**. New code is therefore held to the schema *strongly and immediately*; existing violations burn down through Phases D/E without ever blocking a build.

#### R.4 — Migration & scope note (supersedes Part I §2)

Part I explicitly deferred `.body--dark` removal as "a separate future effort." A single enforced mechanism **overrides that** — `.body--dark` migration is now **in scope**: mechanism 1/2 in **Phase D** (introduce `useTheme()`, route JS cases through it, eliminate ternaries), mechanism 5/7 in **Phase E** (`.body--dark` twins collapse to token rules; `.light-mode`/`.dark-mode` → `dark:`+tokens), mechanism 6 in **Phase 0/D**. The `theme.ts` compat toggle of `.body--dark`/`.body--light` is the **last** thing removed, only after grep shows zero consumers.

## 4. Canonical decision: what "correct" looks like

For every color/size/radius decision in a `.vue` file, in order of preference:

1. **Registered semantic utility** — `text-text-secondary`, `bg-surface-base`, `border-border-default`, `text-status-error-text`, `rounded-md`, `text-2xs`. *(Default; covers ~90% of sites.)*
2. **Registered component/domain utility** — `bg-label-chip-ip-bg`, `text-service-health-critical`.
3. **`var(--color-*)` inside a `scoped` style block** — when the rule can't be a utility (`:deep()`, keyframes, v-html content, complex selectors).
4. **A new token** — only when the intent genuinely doesn't exist yet (e.g. TraceDAG node-type palette). Added to the token files with light+dark values and `@theme inline` registration, never locally.

**Dark mode has exactly one way** (§3.R): tokens handle it automatically; for a genuine dark-only rule use the Tailwind `dark:` variant; in JS-only surfaces use `chartColor()` or the single `useTheme()` composable. Never `.body--dark`/`.body--light`, `.light-mode`/`.dark-mode`, raw `store.state.theme === 'dark'`, or a private `isDark` flag.

Never: raw Tailwind palette classes, hex anywhere in `.vue`, `theme === 'dark'` for colors, unscoped styles, local private color vars, bare `rounded`, arbitrary `text-[..px]`/`rounded-[..]`/`gap-[..px]`-style px values, `tw:` prefixes, Quasar utility classes (`q-pa-*`, `text-weight-*`), arbitrary `z-[..]`, multi-digit `px` in style blocks, and any dark-mode mechanism other than the one above.

## 5. Remediation plan — phased, executed same-day, each phase independently shippable

Order is dependency order, not a schedule: 0→B are prerequisites and small; C–F are parallelizable mechanical burn-down (codemod + agents can run batches concurrently); G flips the locks. If the day ends mid-C–F, the ratchet from B guarantees nothing regresses and any batch can land alone.

### Phase 0 — P0 runtime bug fixes — *do immediately, independent of everything*

**How:**
1. `scripts/check-css-tokens.mjs:27` — remove `/^--q-/` from `ALLOW_PREFIXES`; add to `ALLOW_EXACT`: `--q-primary`, `--q-secondary`, `--q-accent`, `--q-positive`, `--q-negative`, `--q-info`, `--q-warning`, `--q-dark`, `--q-dark-page`, `--q-transition-duration`. Now `node scripts/check-css-tokens.mjs` **prints every phantom ref with its file** — fix each one using the §7.3 map (the §3.F table lists all known locations). For `rgba(var(--q-X-rgb), 0.1)` patterns, rewrite the whole expression as `color-mix(in srgb, var(--color-…) 10%, transparent)` — do NOT invent an `-rgb` token.
2. `--tw-border-style` — delete the declaration at `semantic.css:211` and `dark.css:549` (the app-wide default border color is already correctly set via `@layer base` in `tailwind.css:85-88`; verify borders unchanged after deletion).
3. No-op ternaries — replace the **entire ternary** with the correct semantic class (not "keep one branch"; the author's intent was themed supporting text): `anomaly_detection/steps/AnomalyDetectionConfig.vue:172,473,578-579`, `anomaly_detection/steps/AnomalyAlerting.vue:139`, `settings/ServiceIdentitySetup.vue:161-162,180-181,261-262,281-282,356-357` → `text-text-label` (metadata/labels) or `text-text-secondary` (descriptions) by reading the surrounding element.
4. Global leaks: `TraceDetailsSidebar.vue:2758` `.highlight` → rename to `.trace-sidebar-highlight` (update template) and replace `yellow` with a token; `UsageTab.vue:1212-1213` → prefix with the component root class; `OTimeline.vue:23` → prefix `li` with the timeline root class; `TraceDetailsSidebar.vue:2189-2213` keep (parent-namespaced) but note in Phase E; `IncidentList.vue:657-736` → prefix all 23 `.status-*`/`.severity-*`/`.badge-*` classes with `.incident-list ` (or convert to scoped in the same PR — they collapse to tokens in Phase E anyway).
5. Dead `tw:` classes (§3.L) — strip the `tw:` prefix in the 3 files (`iam/organizations/OrgCleanupTasksDialog.vue` ×46 lines, `settings/General.vue` ×19, `iam/organizations/ListOrganizations.vue` ×1). The classes have been dead since prefix removal, so stripping restores the *intended* styling — then visually verify each screen in light + dark for the two known prefix-removal traps: bare-utility collisions with legacy global CSS, and malformed variants waking up.

**Verify:**
```sh
node scripts/check-css-tokens.mjs                       # green with the tightened allowlist
grep -rE 'var\(--q-' src --include='*.vue' --include='*.ts' --include='*.css' \
  | grep -vE '\(--q-(primary|secondary|accent|positive|negative|info|warning|dark|dark-page|transition-duration)[),]' # → 0 lines
grep -rn 'tw-border-style' src                          # → 0
grep -rEn "\? '([a-z-]+)' : '\1'" src --include='*.vue' # no-op ternaries → 0
grep -rn '\btw:' src --include='*.vue'                  # dead tw: classes → 0
```
Manual: open **TelemetryCorrelationPanel** (correlation UI), **alerts → destination test result**, **EnterpriseUpgradeDialog** (hover the CTA), **RUM → source map upload dropzone** in light + dark — all four were visibly broken and must now show proper backgrounds/borders/hover tints.

### Phase A — Token-layer completion

**How (all §3.K items):**
1. **Dark overrides** — add to the `.dark`/`.body--dark` block in `dark.css` (alongside the existing label-chip overrides, which are the pattern to copy): `--color-field-type-*` (10 — follow the label-chip dark treatment: darken the pastel bg toward the surface, lighten the text one-two steps; same hue), `--color-service-health-*` (4 — lighten each ~1 step for dark-surface contrast, like `severity-*` does), `--color-wildcard-bar-blue` (copy the pattern of its green/orange/purple siblings at `dark.css:641-643`), `--color-cancel-query-bg`, `--color-icon-color`. Merge `--color-icon-color-dark` INTO `--color-icon-color`'s dark override and migrate its single consumer.
2. **Registrations** — add to the `@theme inline` block at `component.css:4252`: `--color-json-{boolean,null,number,object,string}`, `--color-trace-*` (6), `--color-field-type-*` (10), `--color-focus-ring`, `--color-text-soft`, `--color-log-table-header-bg`, `--color-log-table-row-hover`, `--color-table-actions-bg`. In `semantic.css` `@theme inline`: `--color-primary-950`, `--color-error-300`, and the success scale (`--color-success-{50,100,400,500,600,700}` — values already in `base.css`).
3. **Type scale** — in `base.css` next to `--text-xs`: add `--text-2xs: 0.6875rem;` (11px) and (pending the design call, default YES) `--text-compact: 0.8125rem;` (13px); register both in a `@theme inline` block so `text-2xs`/`text-compact` compile. Fix the wrong `--text-base` comment (`base.css:512` says 16px, value is 14px).
4. **New domain tokens** — `--color-dag-node-{generation,embedding,…}-{border,bg,text}` (extract the 14-type map from `TraceDAG.vue:446-465` — light values from the current light hexes, dark values from the current `dark:` hexes) and `--color-highlight-bg` (light `#e7e6e6` / dark `#747474` from SyntaxGuideMetrics). Define light in `semantic.css`, dark in `dark.css`, register in `component.css`.
5. **Delete dead tokens** — `--color-dashboard-placeholder-bg`, `--color-actions-column-shawdow` (both 0 consumers; confirm with grep first).
6. **`utils/chartTheme.ts`** — token-driven chart palette:
```ts
const cache = new Map<string, string>();
export function chartColor(token: `--color-${string}`): string {
  let v = cache.get(token);
  if (v === undefined) {
    v = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
    cache.set(token, v);
  }
  return v;
}
export function invalidateChartTheme(): void { cache.clear(); }
```
Call `invalidateChartTheme()` at the end of `applyThemeColors()` in `utils/theme.ts` (and on `.dark` toggle). Charts re-render on theme change already (they re-run their option builders), so reading fresh values is sufficient. Export convenience getters used by the converters: `chartTextColor()` → `--color-text-secondary`, `chartAxisLine()` → `--color-border-default`, `chartBg()` → `--color-surface-base`.

**Verify:**
```sh
node scripts/check-css-tokens.mjs        # still green (all new refs defined)
npm run build                            # text-2xs / text-compact / new utilities compile
grep -rn 'icon-color-dark\|dashboard-placeholder-bg\|actions-column-shawdow' src  # → 0
```
Manual (dark mode): logs field-type chips (the 10 field-type tokens — pastel-on-dark was the bug), service graph health colors, wildcard blue bar.

### Phase B — Enforcement scaffolding in RATCHET mode

**How:**
1. New CI script `scripts/check-design-consistency.mjs` (same shape as `check-css-tokens.mjs`). It counts, per `.vue` file, matches for each banned-pattern category:

| Category key | Regex (JS) |
|---|---|
| `rawPalette` | `/\b(?:dark:|hover:|focus:)*(?:text\|bg\|border\|ring\|fill\|stroke\|divide\|outline\|decoration\|placeholder\|from\|via\|to)-(?:slate\|gray\|zinc\|neutral\|stone\|red\|orange\|amber\|yellow\|lime\|green\|emerald\|teal\|cyan\|sky\|blue\|indigo\|violet\|purple\|fuchsia\|pink\|rose)-\d{2,3}\b/g` |
| `hexClass` | `/-\[#[0-9a-fA-F]{3,8}\]/g` |
| `inlineHex` | `/style="[^"]*#[0-9a-fA-F]{3,8}/g` and `/:style="[^"]*#[0-9a-fA-F]{3,8}/g` |
| `styleBlockHex` | `#[0-9a-fA-F]{3,8}\b` **or** `rgba?\(` / `hsla?\(` counted only between `<style` and `</style>` |
| `themeTernary` | `/theme\s*===?\s*['"]dark['"]/g` |
| `bareRounded` | `/(?:^\|[\s"'`])rounded(?![-\w])/g` |
| `arbRadius` | `/rounded(?:-[a-z]+)*-\[[^\]]+\]/g` |
| `arbTextSize` | `/text-\[[0-9.]+(?:px\|rem)\]/g` |
| `unscopedStyle` | `/<style(?![^>]*scoped)[^>]*>/g` |
| `twPrefix` | `/\btw:/g` (§3.L) |
| `quasarUtil` | `/\b(?:q-(?:pa\|pt\|pb\|pl\|pr\|px\|py\|ma\|mt\|mb\|ml\|mr\|mx\|my\|gutter)-(?:none\|xs\|sm\|md\|lg\|xl)\|text-weight-[a-z]+)\b/g` (§3.M) |
| `arbPx` | `/\b(?:gap\|p[trblxy]?\|m[trblxy]?\|w\|h\|size\|min-w\|min-h\|max-w\|max-h\|top\|left\|right\|bottom\|inset\|leading)-\[[0-9.]+px\]/g` (§3.N) |
| `stylePxUnit` | `/\b(?:[2-9]\|[0-9]{2,})(?:\.[0-9]+)?px\b/g` counted only between `<style` and `</style>` (`1px` hairlines exempt; §3.O — ratchet-only, never zero-tolerance without §12.4) |
| `tsHex` | `/['"]#[0-9a-fA-F]{3,8}['"]/g` over `.ts` (non-spec), minus the §12.3 palette-source allowlist (§3.P) |
| `arbZ` | `/\bz-\[[0-9]+\]/g` (§3.Q) |

   On `--baseline` it writes `scripts/design-debt-baseline.json` (`{ "<file>": { "<category>": n } }` + per-category totals). Default run: recount, **fail (exit 1) if any file's count in any category exceeds baseline**, print the offending file/category/diff; if counts dropped, print the improvement and instruct to re-run `--baseline` (committed with the PR). Wire into `package.json` (`"lint:design": "node scripts/check-design-consistency.mjs"`) and the CI lint job next to `check-css-tokens`.
2. ESLint (`.eslintrc` / flat config): `"vue/enforce-style-attribute": ["warn", { "allow": ["scoped", "module"] }]` — flips to `error` in Phase F.
3. Stylelint (`.stylelintrc.json`): in the existing `**/*.vue` override add `"color-no-hex": [true, { "severity": "warning" }]` (scoped to the `.vue` override so token files stay legal) — flips to `error` in Phase G.
4. **Dark-mode schema guards (§3.R.3) — land all three now:** (a) ESLint `no-restricted-syntax` banning `store.state.theme` compares + `isDark`/`isDarkMode` flag declarations, with a `.eslintrc` `overrides` block turning the rule `off` for `src/composables/useTheme.ts` and `src/utils/chartTheme.ts` only; (b) Stylelint `selector-disallowed-list` banning `.body--dark`/`.body--light`/`.light-mode`/`.dark-mode`; (c) the `darkMechanism` category in `check-design-consistency.mjs`. All at `warn`/ratchet now → `error` at Phase G. (Create the empty `composables/useTheme.ts` seam in this phase so the allowlist target exists; fill it in Phase D.)

**Verify:** commit the baseline; then in a scratch branch add `class="text-gray-400"` to any component → `npm run lint:design` must fail naming that file/category; revert. CI green on main.

### Phase C — Template codemod: raw classes → semantic utilities (batched)

**How:** extend `scripts/codemod-color-utilities.mjs` (it already parses `@theme inline` registrations, so it can only ever emit utilities that exist) with the §7.1/§7.2 maps in two tiers:
- **Auto tier** (rewrite in place): exact-value renames — `border-gray-200`→`border-border-default`, `border-gray-300`→`border-border-strong`, `bg-gray-50`→`bg-surface-panel`, `bg-gray-100`→`bg-surface-subtle`, `text-[12px]`/`text-[0.75rem]`→`text-xs`, bare `rounded`→`rounded-sm`, every §7.2 hex whose mapping is 1:1, and **dark-pair collapse**: when a ternary's/`dark:` pair's two values map to the same semantic token (e.g. `? 'border-gray-700' : 'border-gray-200'` → both are "default border") emit the single token utility and delete the conditional.
- **Review tier** (codemod writes the suggestion as a diff/TODO, human approves per hunk): every gray *text* shade, `bg-gray-700/800`, `bg-white`/`text-white`, status colors. Decision rubric for gray text — read the element: form label / field name / metadata chip → `text-text-label`; description / helper / secondary paragraph → `text-text-secondary`; timestamp / footnote → `text-text-caption`; disabled state → `text-text-disabled`; icon → `text-icon-color`; de-emphasized filler ("No data yet") → `text-text-muted`. For `text-white`: on a colored/accent background → `text-text-inverse`; on a button → the button's foreground token. For `bg-white`: page/card surface → `bg-surface-base`; floating menu/popover → `bg-surface-overlay`.

Batch order = debt order, one commit per batch: `components/alerts` (295) → `components/settings` (218) → `components/pipelines`+`pipeline` (116) → `plugins/traces` → `plugins/logs` → `components/rum`+`ingestion`+`functions` → `views/` → `enterprise/` → rest.

**Verify per batch:**
```sh
npm run build && npm run lint:design     # counts strictly lower, none higher
grep -rEc 'text-gray-[0-9]' src/components/alerts   # trending → 0 for the batch dir
```
Manual: open the batch's main screens in light + dark (alerts list, settings pages, …) — text hierarchy should look *unchanged* in light mode (the tokens resolve to near-identical greys) and *fixed* in dark mode where raw classes had no dark twin.

### Phase D — JS theming elimination + dark-mode mechanism unification (§3.R)

**First, create the single JS seam** `composables/useTheme.ts` — the ONE allowed way to read theme in JS:
```ts
import { computed } from "vue";
import { useStore } from "vuex";
export function useTheme() {
  const store = useStore();
  const isDark = computed(() => store.state.theme === "dark");
  return { isDark };
}
```
This is the only file (besides `utils/chartTheme.ts`) permitted to string-compare the theme; the `darkMechanism` guard (§6) enforces that. Then eliminate the mechanisms:
- **The 40 ad-hoc `isDark`/`isDarkMode` consts** → replace each with `const { isDark } = useTheme()`. Pure consolidation, no behavior change.
- **The 3 `classList.contains('body--dark')` JS reads** → `useTheme().isDark`.
- **The 834 raw `theme *==* 'dark'` reads** → most become tokens/`dark:` (below); the residual genuinely-JS ones go through `useTheme()`.

**How, by shape (find them all with `grep -rn "theme\s*===\?*\s*['\"]dark" src --include='*.vue' --include='*.ts'`):**
- **Class ternaries** → single token utility (bulk of the 834; the C-tier rubric applies). If the two branches genuinely differ in intent (rare), use `dark:` variants — **never a JS ternary for a class**.
- **Local var-injection** (`HomeViewSkeleton.vue:29-31,61-63,86-88,111-113,163-165`) → replace the whole ternary with static `[--tile-bg:var(--color-surface-base)] [--tile-border:var(--color-border-default)] [--text-primary:var(--color-text-heading)]` exactly as `LLMInsightsSkeleton.vue:143-145` already does — or drop the local vars entirely and use the utilities directly.
- **`:style` object ternaries** (`Quota.vue:160`, `IncidentDetailDrawer.vue:336,452-453`, `QueryConfig.vue:617`, `ServiceIdentitySetup.vue:1366-1483`) → move to classes with token utilities; where it must stay a style binding (computed values), bind `var(--color-*)` strings, not hex.
- **Chart builders** (`utils/dashboard/convertPromQLData.ts:403,944`, `convertSQLGaugeChart.ts:57`, `convertSQLHeatmapChart.ts:152`, `convertSQLPieDonutChart.ts:58,209`, `promql/convertPromQLGaugeChart.ts:144`, `convertPromQLHeatmapChart.ts:311,482`, `sql/shared/contextBuilder.ts:483`, `heatmapDefaults.ts:41`, `views/UsageTab.vue` ×11, `plugins/traces/Index.vue:1518-1536`, `TraceDetails.vue:1671`, `composables/useStickyColumns.ts:58,74`, `PanelSchemaRenderer.vue:671`) → replace every `theme === 'dark' ? '#x' : '#y'` with `chartColor('--color-…')` from Phase A's `chartTheme.ts`. ECharts/Plotly need resolved values, which is exactly what `chartColor` returns.
- **SVG strokes** (`SearchJobInspector.vue:38-232`) → `stroke="currentColor"` + a text-color utility on the svg, or `stroke="var(--color-…)"`.
- **JS-built HTML strings** (`IncidentServiceGraph.vue:524-580`, `FlameGraphView.vue:428-439`, `TraceDetailsSidebar.vue:1136-1151` JSON printer, `IncidentTimeline.vue:539`) → emit class names, style them in the component's scoped CSS with `var(--color-*)`; the JSON printer uses the (now-registered) `--color-json-*` tokens.
- **Specs asserting raw values** — update in the same commit as their component: `HomeViewSkeleton.spec.ts:60,82,230-231` (asserts `[--tile-bg:#ffffff]`), `ShortUrl.spec.ts:126` (asserts `text-[#666]`).

**Verify:**
```sh
grep -rEn "theme\s*===?\s*['\"]dark['\"][^\n]{0,60}#[0-9a-fA-F]{3}" src --include='*.vue' --include='*.ts'  # → 0
# dark-mode mechanism: raw theme compares only survive in the 2 sanctioned files
grep -rEl "theme\s*[=!]==?\s*['\"]dark['\"]" src --include='*.vue' --include='*.ts' | grep -vE 'useTheme\.ts|chartTheme\.ts'  # → 0
grep -rn "classList\.contains\(['\"]body--" src --include='*.vue' --include='*.ts'  # → 0
npm run test:unit  # updated specs green
```
Manual: §8 matrix **including one custom accent color** — dashboards/charts must now follow the accent + dark mode live (they never did before); flip theme with a chart on screen and confirm axis/label colors update without reload.

### Phase E — Style-block program (file-batched)

**How — fixed per-file procedure (apply in this order within each file):**
1. **Tokenize colors:** replace every hex/named color with the matching `var(--color-*)` (use §7.2's hex→token map; the top-file characterizations in §3.G say which family each file's hexes belong to). Where light rule + `.body--dark` twin exist, put the token in the base rule and **delete the twin** — the token's dark override does the work. Keep only the legit `.body--dark` cases (scrollbar thumbs, canvas bg, theme-picker chips) and convert those selectors to `.dark` while touching them.
2. **Lift trivial rules to utilities:** rules that are pure display/flex/gap/padding/margin/font-size/weight/radius on elements the template owns → delete the rule, add utilities to the template (`display:flex; justify-content:space-between` → `flex justify-between`). Hover/focus one-liners → `hover:`/`focus:` variants.
   2½. **px → rem while you're here (§3.O):** convert remaining `px` values to `rem` (÷16) in every rule the pass touches — `1px` hairlines stay. No blind app-wide sed; line-heights, letter-spacing and media queries need eyes.
3. **Scope the block:** add `scoped`; anything that must reach Quasar internals / teleported content / `v-html` gets explicit `:deep(.q-…)` or `:global(…)`. Watch for two known traps: (a) rules that currently style a **child component's** internals rely on being unscoped — they need `:deep()`; (b) teleported elements (menus, dialogs, tooltips like `CustomNode.vue`'s `.pipeline-error-tooltip`) render outside the component subtree — those need `:global()` or a dedicated global stylesheet entry.
4. **What stays:** `:deep()` chains, `.q-*` overrides (×53), `@keyframes` (×103 — all EmptyState illustrations are pure animation, leave whole), v-html/markdown content styling (`LLMContentRenderer`, `RichTextInput`, `AlertSummary`), scrollbar pseudo-elements, `@media` — all fine as scoped, token-based CSS.

Priority order: `IncidentList.vue` (pure win: 46 hex + 23 global classes + 23 dark twins all collapse), `TraceDetailsSidebar.vue`, `ServiceGraphEdgeSidePanel.vue` + `ServiceGraphNodeSidePanel.vue`, `SetupCardRenderer.vue` (delete the private `--clay/--panel/--text-1..3` vocabulary at lines 813-855, point consumers at global tokens), `HomeViewSkeleton.vue` (adopt `LLMInsightsSkeleton`'s aliasing), `TraceErrorTab.vue`, `RichTextInput.vue`, `O2AIChat.vue` (biggest — 122 hexes, ~1548-line block; do last, its `.light-mode`/`.dark-mode` class pairs become token rules + `dark:`).

**Verify per file:**
```sh
npm run lint:design    # styleBlockHex + unscopedStyle counts drop for the file
```
Manual: that file's surface in light + dark, before/after screenshot compare (the change must be a visual no-op in light mode; dark mode may *improve* where hexes were light-only). For scoping changes, exercise the component's dialogs/menus/tooltips specifically (trap 3b).

### Phase F — Radius + typography + spacing + z-index normalization

**How:**
- Radius (mostly sed-able, per §3.I): bare `rounded ` → `rounded-sm` (identical 4px, pure rename — regex `(?<![-\w])rounded(?![-\w])`); `rounded-[2px]`/`[3px]` → `rounded-sm`; `[5px]`/`[0.3rem]`/`[0.375rem]` → `rounded-md`; `[10px]`/`[0.625rem]` → `rounded-lg` (visual check the 25 sites; promote to `-xl` only if it looks wrong); `[20px]`/`[3.125rem]` → `rounded-full`; audit the 33 `rounded-xl/2xl/3xl` against the policy table (keep only marketing/empty-state cards).
- Typography: `text-[11px]`/`[0.6875rem]`/`[11.5px]` → `text-2xs`; `text-[13px]`/`[0.8125rem]` → `text-compact` (or `text-sm` per the design call); `text-[12px]`/`[0.75rem]` → `text-xs`; `text-[14px]`/`[0.875rem]` → `text-sm`; `text-[15px]`/`[0.9375rem]` → `text-sm` or `text-md-…` per design call; `text-[10px]` → `text-2xs` where it fits, else the agreed 10px token for chart micro-labels only.
- Spacing/sizing (§3.N, ~999 sites, mostly sed-able): exact-step renames — `gap-[6px]`→`gap-1.5`, `gap-[10px]`→`gap-2.5`, `px-[10px]`→`px-2.5`, `py-[10px]`→`py-2.5`, `h-[36px]`→`h-9`, `w-[200px]`→`w-50`, and generally `X-[Npx]` → `X-{N/4}` when N is a multiple of 2; oddballs get the nearest step with a visual check.
- Quasar utility classes (§3.M, 50 sites — currently dead): `q-pa-md`→`p-4`, `q-pa-sm`→`p-2`, `q-mt-sm`→`mt-2`, `q-gutter-{sm,md}`→`gap-{2,4}` on the flex parent, `text-weight-bold`→`font-bold`, `text-weight-medium`→`font-medium`; visual check per file (styling appears where there was none).
- z-index (§3.Q, 49 sites): map onto the §12.5 ladder (`z-10`…`z-60` roles); above-ladder values only for third-party interop, allowlisted by file.
- Flip `vue/enforce-style-attribute` to `error` (Phase E made all blocks scoped).

**Verify:**
```sh
npm run lint:design   # bareRounded, arbRadius, arbTextSize, arbPx, quasarUtil, arbZ → 0
grep -rEoh 'rounded-(xl|2xl|3xl)' src --include='*.vue' | wc -l   # ≤ allowlisted count
```
Manual: chips/badges, buttons/inputs, dialogs — corner radii visually consistent per the policy table; dense tables/toolbars unchanged after spacing renames (they're value-identical).

### Phase G — Endgame: make wrong impossible

**How:**
1. **Disable Tailwind's default palette.** Create `src/lib/styles/tokens/palette-reset.css` containing exactly:
```css
@theme {
  --color-*: initial;
}
```
   and in `src/styles/tailwind.css` import it **immediately after** `@import "tailwindcss";` and **before** the four token-file imports (their `@theme inline` blocks re-register the sanctioned set, so import order is what brings the approved colors back). From then on `text-gray-400` **does not compile into CSS** — the build itself is the guard. Two follow-ups this forces (good): (a) any surviving legit `bg-white`/`text-black` needs `--color-white`/`--color-black` registered in a `@theme inline` block (add to `semantic.css`; `transparent`/`current`/`inherit` are Tailwind keywords, unaffected); (b) run a full build + grep the output CSS for any class the app uses that stopped resolving — `npm run build` then click through §8; a missing utility shows up as visibly unstyled, and `lint:design` (now at 0) proves no raw classes remain in source.
2. Flip every remaining warn to `error`: stylelint `color-no-hex`; delete `scripts/design-debt-baseline.json` and make `check-design-consistency.mjs` fail on ANY match (no baseline = zero tolerance — **except `stylePxUnit`, which stays ratchet-only per §12.4**).
3. Document the §4 decision ladder + radius/type policy tables in `web/CONTRIBUTING.md` and the repo `CLAUDE.md` so humans *and* code-gen agents produce compliant code.
4. **Extend the unset to the other scales (recommended, same mechanism, after Phase F reaches 0):** add to `palette-reset.css`:
```css
@theme {
  --radius-*: initial;
  --text-*: initial;
}
```
   then re-register ONLY the sanctioned scales via `@theme inline` — `--radius-{sm,md,lg,xl,full}` (per the §3.I policy table) and `--text-{2xs,xs,compact,sm,base,lg,xl,2xl}` (per §3.J; keep the `tailwind.css:34-53` `text-sm`/`text-base` re-pins consistent with whatever is registered). Result: `rounded-3xl`, `rounded-[10px]`-adjacent named steps, and `text-5xl`-style off-scale sizes **stop compiling**, exactly like raw palette colors. `--shadow-*: initial` can follow once an elevation policy exists (only 68 `shadow-*` uses today — cheap to normalize whenever).

**Verify:**
```sh
npm run build                                    # compiles with palette reset
npm run lint:design && npm run lint:css          # zero tolerance, all green
grep -rE '\btext-gray-[0-9]' src --include='*.vue'   # → 0 (and wouldn't compile anyway)
```
Full §8 matrix + Cypress suite. Then, in a scratch branch, add `class="bg-blue-50"` → build output must NOT contain a `bg-blue-50` rule (proves the palette kill works).

## 6. Enforcement summary (what fails the build, when)

| Guard | Phase B | Phase G |
|---|---|---|
| `check-css-tokens.mjs` — undefined tokens, no `--q-` prefix hole | error | error |
| `check-design-consistency.mjs` — per-file ratchet on all §3 patterns (A–R: incl. `twPrefix`, `quasarUtil`, `arbPx`, `tsHex`, `arbZ`, `darkMechanism`) | ratchet | error, baseline deleted |
| **Dark-mode schema (§3.R), 3 guards:** ESLint `no-restricted-syntax` on `store.state.theme` compares + `isDark` flags (allowlist: `useTheme.ts`, `chartTheme.ts`) | warn | error |
| — Stylelint `selector-disallowed-list`: `.body--dark`/`.body--light`/`.light-mode`/`.dark-mode` | warn | error |
| — `check-design-consistency.mjs` `darkMechanism` count ratchet | ratchet | error, baseline deleted |
| `check-design-consistency.mjs` — `stylePxUnit` (px in style blocks) | ratchet | **ratchet (stays; §12.4)** |
| Tailwind default palette (`--color-*: initial`) | enabled | **removed — raw classes don't compile** ✅ approved |
| Tailwind default radius/text scales (`--radius-*`/`--text-*: initial`, G.4) | enabled | removed — only sanctioned steps compile |
| stylelint `color-no-hex` in `.vue` styles | warn | error |
| ESLint `vue/enforce-style-attribute` (scoped) | warn | error |
| stylelint `var(--o2-` ban | error (already live) | error |

## 7. Canonical mapping tables

### 7.1 Raw palette class → semantic utility (top of the codemod map)

| Raw (occurrences) | Correct utility | Tier |
|---|---|---|
| `text-gray-400` (312) | `text-text-label` or `text-text-secondary` (intent) | review |
| `text-gray-500` (121) | `text-text-secondary` / `text-text-caption` | review |
| `text-gray-300` in dark ternaries (30) | collapse ternary → `text-text-secondary` | auto |
| `text-gray-600/700` (54) | `text-text-body` | review |
| `text-red-500/600/700` (83) | `text-status-error-text` (status) / `text-error-500` (decor) | review |
| `text-green-500/600` (30) | `text-status-positive` / `text-status-success-text` | auto |
| `text-amber-500`/`text-orange-500` (25) | `text-status-warning-text` / `text-warning-500` | review |
| `text-blue-500/600` (25) | `text-text-link` / `text-status-info-text` | review |
| `bg-white` as surface (most of 102) | `bg-surface-base` / `bg-surface-overlay` | review |
| `bg-gray-50` (14) | `bg-surface-panel` | auto |
| `bg-gray-100` (21) | `bg-surface-subtle` | auto |
| `bg-gray-700/800` (40) | dark-ternary collapse → surface token | auto (when paired) |
| `border-gray-200` (31) | `border-border-default` | auto |
| `border-gray-300` (10) | `border-border-strong` | auto |
| `border-gray-700` (25) | dark-pair collapse → `border-border-default` | auto (when paired) |
| `ring-primary-500` (16) | `ring-focus-ring` (after registration) | auto |
| `text-white` on accent bg (93) | `text-text-inverse` / component foreground token | review |
| `text-primary-600` etc. (~80) | `text-accent` / `text-text-link` | review (works today) |

### 7.2 Arbitrary hex → token (top values; they're mostly Tailwind grays longhand)

| Hex class | = Tailwind | Correct utility |
|---|---|---|
| `text-[#6b7280]`, `text-[#666]`, `text-[#6c757d]` | gray-500 | `text-text-secondary` |
| `text-[#9ca3af]`, `text-[#b0b0b0]`, `text-[#a0aec0]` | gray-400 | `text-text-label` (or dark-pair collapse) |
| `text-[#374151]`, `text-[#333]`, `text-[#4a5568]`, `text-[#2d3748]` | gray-700/800 | `text-text-body` / dark-pair |
| `border-[#e5e7eb]`, `border-[#e9ecef]` | gray-200 | `border-border-default` |
| `border-[#2d3748]`, `border-[#374151]`, `border-[#343434]` | gray-700/800 | dark-pair collapse → `border-border-default` |
| `bg-[#f5f5f5]`, `bg-[#f3f4f6]` | gray-100 | `bg-surface-subtle` / `bg-surface-panel` |
| `bg-[#1e1e1e]`, `bg-[#1a1a1a]` | — | dark-pair collapse → `bg-surface-base` |
| `bg-[#e7e6e6]` / `bg-[#747474]` (SyntaxGuide pair ×68) | — | new `bg-highlight` token (Phase A) |
| `text-[#1976d2]`, `border-[#1976d2]` | — | `text-text-link` / `border-accent` |
| `bg-[#dc2626]`, `text-[#ef4444]` | red-600/500 | `bg-status-negative` / `text-status-error-text` |
| TraceDAG node-type map (36 hits) | — | new `--color-dag-node-*` family (Phase A) |

### 7.3 Phantom `--q-*` → modern token (Phase 0)

`--q-text-secondary`→`--color-text-secondary` · `--q-text`/`--q-color-text`/`--q-color-text-primary`→`--color-text-primary` · `--q-background`/`--q-page-background`/`--q-card-background`→`--color-surface-base` · `--q-header-bg`→`--color-surface-panel` · `--q-item-bg`→`--color-surface-panel` · `--q-item-hover-bg`/`--q-hover-color`→`--color-interactive-hover-bg` · `--q-border-color`/`--q-color-separator`→`--color-border-default` · `--q-color-dark`→`--color-surface-base` (dark resolves via token) · `--q-primary-text`→`--color-button-primary-foreground` · `rgba(var(--q-{primary,positive,negative}-rgb), α)`→`color-mix(in srgb, var(--color-{theme-accent,status-positive,status-negative}) α%, transparent)`.

## 8. Verification matrix (gates for phases C–G)

Same surface as Part I §9 — for each predefined theme × {light, dark} + one custom accent + live preview: app chrome, buttons, inputs, tables, badges/toasts, domain viz (severity spines, span-kind chips, field-type chips, label chips, JSON colors, service health). **New additions for Part II:** dashboards/charts must follow the accent theme (Phase D makes this true for the first time); TelemetryCorrelationPanel, DestinationTestResult, EnterpriseUpgradeDialog, SourceMapDropzone (the Phase-0 repairs); IncidentList badges; TraceDAG nodes; O2AIChat panels.
Cheap automation: Cypress + unit suites, `check-css-tokens.mjs`, `check-design-consistency.mjs` ratchet.

## 9. Same-day execution order

1. **Morning, sequential (prerequisites):** Phase 0 → A → B. These fix everything *visibly broken today*, close the guard holes, and install the ratchet so debt can only shrink from this point.
2. **Rest of day, parallel:** Phases C, D, E, F are independent mechanical burn-down — run the codemod batches and file conversions concurrently (directory batches don't overlap; each lands as its own commit, ratchet verifies).
3. **End of day:** Phase G (kill default palette, flip errors) — only if C–F reached zero on raw palette classes; otherwise G's lint-flip lands and the palette kill waits for the last batch.

Safety floor: after B, any unfinished batch is just remaining debt frozen by the ratchet — the app is fully working at every commit.

## 10. Deliverables checklist (Part II)

> Legend: ✅ done · 🟡 partial (residuals need a decision — see `O2_TOKEN_MIGRATION_PENDING.md`) · ⬜ pending

- [x] ✅ Phase 0: phantom `--q-*` fixes (56 refs) + exact-name Quasar allowlist in `check-css-tokens.mjs`
- [x] ✅ Phase 0: `--tw-border-style` bug fix, 17 no-op ternaries, 5 global leak selectors
- [x] ✅ Phase 0: strip dead `tw:` prefixes (3 files, 66 lines) — *visual re-check of the 2 screens still recommended*
- [x] ✅ Phase A: dark overrides (field-type ×10, service-health ×4, wildcard-blue, cancel-query, icon-color)
- [x] ✅ Phase A: registrations (json-* ×5, trace-* ×6, field-type ×10, focus-ring, text-soft, success text scale, primary-950, error-300)
- [x] ✅ Phase A: `--text-2xs` (11px) + `--text-compact` (13px). *10px floor = still a design call*
- [x] ✅ Phase A: radius policy applied via codemod (formal design sign-off on the table still open)
- [x] ✅ Phase A: `--color-highlight-bg` + `--color-brand-indigo` added; `dashboard-placeholder-bg`/`actions-column-shawdow` KEPT (real consumers, not dead). ⬜ `--color-dag-node-*` deferred (see PENDING §3)
- [x] ✅ Phase A: `utils/chartTheme.ts` token-driven chart palette (+ jsdom fallback map)
- [x] ✅ Phase B: `scripts/check-design-consistency.mjs` + `design-debt-baseline.json` ratchet in CI
- [x] ✅ Phase B: `vue/enforce-style-attribute` + stylelint `color-no-hex` (at **warn**; → error in G)
- [x] 🟡 Phase C: codemod + 10 directory agent batches (rawPalette 1263→102, hexClass 1097→269). Residuals = PENDING §1–4
- [x] 🟡 Phase D: theme ternaries 819→186; specs updated to assert `chartColor()` tokens
- [x] ✅ Phase D: **dark-mode unified** — `composables/useTheme.ts` created; ad-hoc `isDark` flags + `classList.contains('body--*')` routed through it; raw `theme === 'dark'` confined to `useTheme.ts`/`chartTheme.ts` (+ documented residuals)
- [ ] ⬜ Phase E: style-block hexes → `var(--color-*)` (805 left, hard cases); `.body--dark`/`.light-mode`/`.dark-mode` → `.dark`; all blocks `scoped` (206 left); px → rem — **PENDING §1–2**
- [ ] ⬜ Post-migration: `theme.ts` stops toggling `.body--dark`/`.body--light` (last step, after 0 consumers)
- [x] ✅ Phase F: arbitrary radius/font-size normalized (bareRounded 547→26, arbRadius 127→25, arbTextSize 918→323)
- [x] 🟡 Phase F: Quasar utils ×50→0 (§3.M); arbitrary-px spacing 999→174 (§3.N). ⬜ z-index ×49 → ladder (needs §12.5)
- [x] 🟡 Phase D/P: chart-converter `.ts` colors → `chartColor()`; palette-source `.ts` files allowlisted per §12.3 (tsHex 471 left, mostly allowlisted)
- [ ] ⬜ Phase G: `@theme { --color-*: initial }` — **gated on C/E residuals** (PENDING §5); then flip guards warn→error, delete baseline
- [ ] ⬜ Phase G.4: `--radius-*`/`--text-*` unsets + sanctioned-scale re-registration
- [ ] ⬜ §12 decisions resolved (white/black keep-list, data-viz palette policy, px→rem breadth, z ladder, 10px floor) — utility naming & 13px **DECIDED**

## 11. Appendix — audit reproduction commands (definition of done)

Run from `web/`. These are the exact scans behind every §1 number; each category is DONE when its command returns the target. Re-run any time to measure progress (or let `lint:design` do it — same regexes).

```sh
# A. Raw palette utilities — target 0 (baseline 1,263 / 184 files)
grep -rEoh '\b(text|bg|border|ring|fill|stroke|divide|outline|decoration|placeholder|from|via|to)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}\b' --include='*.vue' src | wc -l

# B. Arbitrary hex classes — target 0 (baseline 1,097 / 113 files)
grep -rEoh '[a-z-]+-\[#[0-9a-fA-F]{3,8}\]' --include='*.vue' src | wc -l

# C. white/black utilities — target: only reviewed/legit sites (baseline ~250)
grep -rEoh '\b(text|bg|border)-(white|black)(/[0-9]+)?\b' --include='*.vue' src | wc -l

# D. JS theme ternaries — target 0 for color purposes (baseline 735; 226 with hex)
grep -rE "theme\s*===?\s*['\"]dark" --include='*.vue' src | wc -l
grep -rE "theme\s*===?\s*['\"]dark['\"].{0,40}#[0-9a-fA-F]{3}" --include='*.vue' --include='*.ts' src | wc -l

# E. Inline style attrs with colors — target 0 (baseline 188)
grep -rEoh 'style="[^"]*(color|background)[^"]*"' --include='*.vue' src | grep -vE ':style' | wc -l

# F. Phantom --q-* tokens — target 0 (baseline 56 refs / 18 names) — also guarded by check-css-tokens after Phase 0
grep -rEoh 'var\(--q-[A-Za-z0-9_-]+' --include='*.vue' --include='*.ts' --include='*.css' src \
  | grep -cvE '\(--q-(primary|secondary|accent|positive|negative|info|warning|dark|dark-page|transition-duration)$'

# G. Hex inside <style> blocks — target 0 (baseline ~704)
for f in $(grep -rl '<style' --include='*.vue' src); do awk '/<style/{s=1} s{print} /<\/style>/{s=0}' "$f" | grep -cE '#[0-9a-fA-F]{3,8}\b'; done | paste -sd+ | bc

# H. Unscoped style blocks — target 0 (baseline 210/245); .body--dark selectors target ≤ legit keepers (baseline 131)
grep -rEoh '<style[^>]*>' --include='*.vue' src | grep -cv scoped
grep -rE '\.body--dark' --include='*.vue' --include='*.css' --include='*.scss' src | wc -l

# I. Radius — bare `rounded` and arbitrary target 0 (baselines 547 / ~95); xl+ ≤ allowlist (baseline 34)
grep -rEoh '(^|[[:space:]"'"'"'])rounded([[:space:]"'"'"']|$)' --include='*.vue' src | wc -l
grep -rEoh 'rounded(-[a-z]+)*-\[[^]]+\]' --include='*.vue' src | wc -l

# J. Arbitrary font sizes — target 0 (baseline ~750)
grep -rEoh 'text-\[[0-9.]+(px|rem)\]' --include='*.vue' src | wc -l

# L. Dead tw: classes — target 0 (baseline ~196 tokens / 66 lines / 3 files)
grep -rn '\btw:' --include='*.vue' src | wc -l

# M. Quasar utility classes — target 0 (baseline 50 / 28 files)
grep -rEoh '\bq-(pa|pt|pb|pl|pr|px|py|ma|mt|mb|ml|mr|mx|my|gutter)-(none|xs|sm|md|lg|xl)\b|\btext-weight-[a-z]+\b' --include='*.vue' src | wc -l

# N. Arbitrary-px spacing/sizing — target 0 (baseline ~999)
grep -rEoh '\b(gap|p[trblxy]?|m[trblxy]?|w|h|size|min-w|min-h|max-w|max-h|top|left|right|bottom|inset|leading)-\[[0-9.]+px\]' --include='*.vue' src | wc -l

# O. Multi-digit px in <style> blocks — ratchet-only (baseline ~3,026 for ≥10px; 1px hairlines exempt)
grep -rEoh '\b[0-9]{2,}px\b' --include='*.vue' src | wc -l

# P. Hex in .ts — target: §12.3 allowlisted palette files only (baseline 646 non-spec)
grep -rEoh "['\"]#[0-9a-fA-F]{3,8}['\"]" --include='*.ts' src | grep -v spec | wc -l

# Q. Arbitrary z-index — target 0 (baseline 49)
grep -rEoh '\bz-\[[0-9]+\]' --include='*.vue' src | wc -l

# R. Dark-mode mechanism — one way only (§3.R). Targets:
#   raw theme compares (834) → 0 outside useTheme.ts/chartTheme.ts
grep -rE "theme\s*[=!]==?\s*['\"]dark['\"]" --include='*.vue' --include='*.ts' src | grep -vE 'useTheme\.ts|chartTheme\.ts' | wc -l
#   ad-hoc isDark flags (40) → 0 (all via useTheme)
grep -rEn 'const (isDark|isDarkMode|darkMode)\s*=' --include='*.vue' --include='*.ts' src | grep -v 'useTheme.ts' | wc -l
#   legacy/ad-hoc CSS conventions: .body--dark/.body--light (193) + .light-mode/.dark-mode (73) → 0
grep -rEoh '\.body--(dark|light)|\.(light|dark)-mode' --include='*.vue' --include='*.css' --include='*.scss' src | wc -l
#   classList.contains('body--*') JS reads (3) → 0
grep -rEn "classList\.contains\(['\"]body--" --include='*.vue' --include='*.ts' src | wc -l
#   .dark selectors (107) + dark: variant (293) are the KEPT mechanism — should be the ONLY survivors

# Always-green invariants (any phase, any commit):
node scripts/check-css-tokens.mjs          # no undefined tokens, no --o2-, no phantom --q-
node scripts/check-design-consistency.mjs  # no file above baseline (Phase B+); zero tolerance (Phase G+)
npm run build
```

## 12. Open decisions — need a call at review time (everything else above is settled)

1. **Utility naming ergonomics — `text-text-primary` vs `text-primary`.** Semantic tokens live in a namespaced vocabulary (`--color-text-primary`), so the generated utility doubles the word: `text-text-primary`, `bg-surface-base` (fine), `border-border-default` (doubles too). Options:
   - **(a) Keep the full names** — zero work, unambiguous, matches what the codemod emits and what `<style>` blocks reference. *Recommended default.*
   - **(b) Add ergonomic aliases for the top ~10 tokens** via Tailwind v4 `@utility` (NOT via a second `--color-primary` token — that would generate wrong `bg-primary`/`border-primary` twins from one var): `@utility text-primary { color: var(--color-text-primary); }`, `@utility text-secondary { … }`, `@utility border-default { … }`. Caveats: two legal spellings per token (the guard should then ban the long form to keep one vocabulary), and `text-primary` visually collides with the `--color-primary-*` accent scale (`text-primary-600`) — a genuine confusion risk.
   - Decision needed before Phase C (the codemod map emits one spelling everywhere).
2. **`white`/`black` after the palette unset.** Re-register `--color-white`/`--color-black` for the reviewed-legit sites (icon-on-accent etc.), or ban entirely in `.vue` and force `text-text-inverse`/component foreground tokens? (Phase G.1a currently assumes re-register.)
3. **Data-viz palette sources in `.ts`** (§3.P kind 2: `colorPalette.ts`, `constants/themes.ts`, span palette): allowlist these files in the `tsHex` guard as the declared "palette home", or move the values into the token layer and read back via `chartColor()`? Allowlist is pragmatic; token-layer is one-source-of-truth but makes 50-color series palettes noisy in CSS.
4. **px→rem breadth in style blocks** (§3.O, ~3,026 sites): opportunistic-on-touch under a shrink-only ratchet (recommended — zero visual risk budget), or a dedicated conversion pass with screenshot compares? This is the one category proposed to stay ratchet-only even after Phase G.
5. **z-index ladder values** (§3.Q): confirm the role → step table (raised 10 / sticky 20 / dropdown 30 / overlay 40 / modal 50 / toast 60) and where Quasar's own stacking contexts (dialog/menu/notify) sit relative to it, so the 49 arbitrary values have unambiguous homes.
6. **10px micro-label floor** (§3.J item 4, restated here so all open calls live in one list): keep 10px as a chart-micro-label-only token (`--text-3xs`) or lift to 11px app-wide.
