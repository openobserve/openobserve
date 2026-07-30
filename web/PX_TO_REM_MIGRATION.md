# px → rem migration: scenario reference

> **STATUS: COMPLETE.** All convertible px migrated. `local/no-hardcoded-px` (eslint)
> reports **0 violations** across `src/**/*.{vue,ts,css}`; `vue-tsc` exits 0; stylelint,
> lint:tokens, lint:token-purity and lint:design:strict all pass.
>
> **What landed**
> | Batch | Converted |
> | --- | ---: |
> | C5 component size props | 153 |
> | C4 inline styles (static + bound ternaries) | 278 |
> | C2 Tailwind arbitrary values (utility + arbitrary-property) | 64 |
> | C8/C6/C7 script + `.ts` constants and CSS-in-JS | 65 |
> | Final ESLint-driven sweep | 31 |
> | **Total** | **591** |
>
> **Guardrails added — ONE rule, one owner**
>
> `local/no-hardcoded-px` (`eslint.config.js`) enforces px across **every** file type:
> `.vue`, `.ts` and `.css` (the last via the `@eslint/css` language plugin, with
> `tolerant: true` so Tailwind v4 syntax like `--color-*: initial` and `@custom-variant`
> parses). Run by `lint:ci` over `src/**/*.{vue,ts,css}`. Rules live in
> `scripts/px-rules.mjs`, imported by the rule so there is a single definition.
>
> - The design-consistency ratchet carries **no px category at all**. It briefly did,
>   and that was a mistake: a counter cannot catch a swap (remove one px, add another —
>   count unchanged, CI passes), it reports a per-file number instead of a location, and
>   the two exemption lists drifted apart (the ratchet recorded 113 px as debt while
>   eslint reported 0). Its baseline is now `{ rawVarInComponent: 103 }`.
> - `toPx()` / `rootFontSize()` in `src/utils/units.ts` — the unit-safe replacement
>   for `parseInt` on authored sizes (§6 R7).
>
> **Deliberately still px** (§5 / §6 R1): hairlines, shadow/ring/blur widths, query
> conditions, `IntersectionObserver` `rootMargin` (§6 R5 — rem *throws*), `calc()` mixing
> vh/vw, `* 1px` unit-multiplication, SVG/img dimension attributes, canvas/ECharts/email
> consumers, and comment annotations.
>
> **Reviewer note — the one behaviour change.** Everything else is pixel-identical by
> construction. `useStickyColumns` previously did `parseInt("100.5px") → 100`, truncating
> fractional column widths in an offset that *accumulates* across sticky columns; `toPx`
> preserves `100.5`. One test encoded the old truncation and was updated with that
> rationale. See §6 T1.
>
> **Also touched, outside the migration proper:**
> - Widening `lint:ci` from `src/**/*.vue` to `src/**/*.{vue,ts,css}` exposed one
>   pre-existing error — a duplicate `import i18n` in `plugins/traces/TraceDAG.spec.ts`
>   — which was removed (80 tests still pass).
> - `js.configs.recommended` and the vue flat configs carried no `files` key, so they
>   applied to every file including `.css`, where their rules crash (the CSS SourceCode
>   has no `getAllComments()`). Both are now scoped to the JS/Vue file sets they were
>   always meant for; JS and Vue rules verified still firing.

Every literal pixel value in `web/src`, classified by what it is and what should happen to it.

Counts are **measured, not estimated** — produced by a context-aware parser over 2,905 `.vue`/`.ts`
files plus 11 `.css` files, excluding vendored bundles.

**Scope:** `web/src` · branch `fix/px-to-rem`
**Regex:** `(?<![a-zA-Z0-9.])(\d+(\.\d+)?)px\b` — permits `_` and `-` before the number so Tailwind
arbitrary-value escapes (`shadow-[0_1px_2px]`) and negative values (`translate-x-[-4px]`) are
**discovered**.

> **Counted ≠ migrated.** The regex only decides what becomes *visible* to the audit. Every value it
> finds is then classified into a verdict below. Widening it added ~112 values, of which **90 landed
> in KEEP** (86 `shadow-[…]`, 2 blur, 2 gradient stops) and ~22 in CONVERT (`p-[8px_12px]`,
> `grid-cols-[200px_1fr]`, and all 7 negative values). See §4 C2 and §5 K7.

---

## 1. Summary

**1,573 real pixel literals across 23 distinct scenarios.**

> This section onward is the **pre-migration audit**, preserved as the record of what was found
> and why each verdict was reached. For what actually landed, see the status banner at the top.
> The two differ legitimately: the audit's 744 CONVERT includes values later reclassified KEEP once
> their consumer was checked (allowlisted canvas/email files, SVG and `<img>` dimension attributes),
> and R1's `calc(vh − px)` set, which was deferred by decision rather than converted.

| Verdict | Count | Files | Meaning |
| --- | ---: | ---: | --- |
| **CONVERT** | **744** | 168 | rem is legal and correct |
| **KEEP** | **529** | — | px is the *correct* unit; converting is a defect |
| **FOLLOW** | **227** | 69 | Test assertions — update with their source |
| **DEFER** | **54** | 24 | Layout debt, not unit debt — out of scope |
| **COUPLED** | **19** | 3 | Breaks silently unless changed with its reader |

### Why this differs from a plain editor search

Searching `px` in VSCode returns ~3,900 hits. About **1,580 of those are Tailwind's `px-3` / `w-px`
utilities** — that `px` means *padding-x*, not pixels, and those classes already compile to rem.

| What `px` matched | Count | Real pixel value? |
| --- | ---: | --- |
| `px-3`, `px-1`, `px-2.5` … | 1,435 | ❌ Tailwind padding-x utility |
| `w-px`, `border-px` … | 145 | ❌ Tailwind 1px-step utility name |
| `300px`, `4px`, `1px` … | ~1,573 | ✅ real |

Use `\d+(\.\d+)?px\b` in VSCode's regex mode (the `.*` icon) to count only real values.

---

## 2. The arithmetic

`src/styles/base-elements.css` declares **no `html { font-size }`**, so the root stays at the browser
default of 16px. That makes every conversion a clean divide — and it means a correct migration
changes **nothing on screen**, which is what makes it reviewable.

```
px ÷ 16  = rem           300px → 18.75rem
px ÷ 4   = Tailwind step 300px → w-75      (75 × 0.25rem = 18.75rem)
```

`body`'s 13px font-size is irrelevant to this: **rem resolves against the root element, never the
parent.** That parent-independence is exactly why rem and not `em` — `em` would compound through
every nested component.

---

## 3. Master table — all 23 scenarios

| ID | Scenario | Verdict | Count | Files |
| --- | --- | --- | ---: | ---: |
| C5 | Component size props — `max-width="300px"` | CONVERT | 162 | 41 |
| C4 | Static inline `style="width: 300px"` | CONVERT | 293 | 67 |
| C8 | JS constants & prop defaults | CONVERT | 145 | 50 |
| C2 | Tailwind arbitrary values — `p-[10px]` | CONVERT | 60 | 25 |
| C6 | JS-built HTML strings (tooltips) | CONVERT | 26 | 4 |
| C1 | Token / CSS dimensions | CONVERT | 15 | 3 |
| C3 | Bound `:style` objects | CONVERT | 15 | 8 |
| C7 | Direct DOM `.style` writes | CONVERT | 2 | 1 |
| Z1 | Comments & documentation | KEEP | 281 | 78 |
| K4 | User-facing copy (tooltip/placeholder/label text) | KEEP | 1 | 1 |
| K2 | Hairline borders — `1px`, `1.5px` | KEEP | 77 | 32 |
| K7 | Arbitrary shadow / ring / blur widths | KEEP | 49 | 16 |
| R2 | Canvas font & text measurement | KEEP | 36 | 9 |
| K1 | Media / container query conditions | KEEP | 32 | 12 |
| K8 | Consumer requires px (email, fonts) | KEEP | 24 | 2 |
| R4 | ECharts option objects | KEEP | 17 | 6 |
| K3 | Shadow offsets in style blocks | KEEP | 2 | 2 |
| R5 | `IntersectionObserver` `rootMargin` | KEEP | 4 | 4 |
| R6 | JS scroll thresholds | KEEP | 2 | 1 |
| K6 | `9999px` pill sentinel | KEEP | 1 | 1 |
| K9 | Unit-multiplication `calc(var(--x) * 1px)` | KEEP | 7 | 2 |
| R3 | Gridstack `cellHeight` | KEEP | 1 | 1 |
| T1 | Test assertions on literal px strings | FOLLOW | 227 | 69 |
| R1 | `calc(100vh − Npx)` viewport math | DEFER | 54 | 24 |
| R7 | `parseInt()` readers of size strings | COUPLED | 19 | 3 |

---

## 4. CONVERT — what to migrate, and how

### C5 · Component size props — 162 occurrences, 41 files  ·  **153 converted, 9 excluded**

Size passed as a string prop to an O2 or app component.

**Verified safe:** `lib/overlay/Tooltip/OTooltip.types.ts:24` declares `maxWidth?: string` and
`OTooltip.vue:172` passes it straight into a style binding. `components/shared/SkeletonBox.vue:19-20`
is the same shape — `width?: string` → `:style="{ width }"`. The value reaches CSS untouched.

```diff
- <OTooltip :max-width="'300px'" />
+ <OTooltip :max-width="'18.75rem'" />
```

**Check first:** confirm the receiving component has no `parseInt` consumer (see §6 R7).

Heaviest files:

```
46  views/synthetics/MonitorRuns.vue
20  components/dashboards/addPanel/ConfigPanel.vue
12  lib/core/Table/sub-components/OTableHeader.vue
11  components/dashboards/addPanel/PromQLChartConfig.vue
11  components/rum/errorTracking/view/PrettyStackTrace.vue
```

---

### C4 · Static inline styles — 293 occurrences, 67 files  ·  **278 converted**

Hardcoded `style=""` on an element.

> **What was actually done: px → rem in place, `style=""` preserved.** Converting these to
> Tailwind utilities would also clear the no-inline-`style` house rule, but inline styles have
> specificity 1000 and always beat classes — moving 278 of them to classes risks losing to
> scoped-CSS and `lib-override` rules, which would break this migration's zero-visual-diff
> property. The utility conversion is a separate, reviewable follow-up.

```diff
- style="max-width: 150px; max-height: 32px"
+ class="max-w-37.5 max-h-8"
```

Heaviest files:

```
26  components/anomaly_detection/steps/AnomalyDetectionConfig.vue
17  components/pipeline/NodeForm/ScheduledPipeline.vue
15  components/reports/CreateReport.vue
10  components/pipeline/ImportPipeline.vue
10  views/AwsMarketplaceSetup.vue
10  views/AzureMarketplaceSetup.vue
```

---

### C8 · JS constants and prop defaults — 145 occurrences, 50 files

Size strings defined in `<script>` — `withDefaults` values, config maps, layout constants.

```diff
- default: "20px"
+ default: "1.25rem"
```

**Audit each for a numeric reader before converting** (see §6 R7).

Heaviest files:

```
11  utils/dashboard/legendConfiguration.ts
10  utils/dashboard/convertPromQLData.ts
 9  components/settings/ServiceIdentitySetup.vue
 7  plugins/traces/ServiceGraph.vue
```

---

### C2 · Tailwind arbitrary values — 60 occurrences, 25 files

Escape-hatch classes where a scale utility exists. Tailwind v4 accepts fractional steps, so nearly
every value has a clean equivalent.

```diff
- p-[10px]              gap-y-[6px]        grid-cols-[200px_1fr]
+ p-2.5                 gap-y-1.5          grid-cols-[12.5rem_1fr]
```

**Excludes** `shadow-`, `ring-`, `border-`, `blur-` arbitrary values — those are K7 and stay px.

**Negative values all convert.** The minus sign is irrelevant to convertibility:

```diff
- translate-x-[-4px]    top-[-14px]    inset-[-18px]
+ translate-x-[-0.25rem]  top-[-0.875rem]  inset-[-1.125rem]
```

The four `tracking-[-0.2px]` / `tracking-[-0.6px]` cases are letter-spacing — prefer the existing
`--tracking-*` tokens over a raw rem value.

Heaviest: `components/EnterpriseUpgradeDialog.vue` (21).

---

### C6 · JS-built HTML strings — 26 occurrences, 4 files

Template literals producing markup for tooltips and trace trees. These render inside the app
document, so they inherit the root font-size and rem resolves normally.

```diff
- '<div style="margin-top:4px;">'
+ '<div style="margin-top:0.25rem;">'
```

```
15  utils/traces/treeTooltipHelpers.ts
 5  components/traces/FlameGraphView.vue
 5  utils/logs/convertLogData.ts
```

**Exception:** strings destined for a canvas or an email document are K8 — see §5.

---

### C1 · Token & CSS dimensions — 15 occurrences, 3 files

Remaining px inside the token files themselves. Convert real dimensions only; shadow offsets and
the `9999px` sentinel in the same file stay.

```
12  lib/styles/tokens/base.css
 2  styles/base-elements.css
 1  lib/styles/tokens/semantic.css
```

Includes `--navbar-height: 36px` — **but see §6 R1 before touching it.**

---

### C3 · Bound `:style` objects — 15 occurrences, 8 files

Dynamic style bindings with literal px in the expression. Mostly toggles like `height: 0px`.

Note: `height: '0px'` → `'0'` is cleaner than `'0rem'`; zero needs no unit.

---

### C7 · Direct DOM style writes — 2 occurrences, 1 file

`lib/core/Table/sub-components/OTableLoading.vue` assigns `style.boxShadow` imperatively. The
offsets themselves are K3-class values; only the spread/geometry converts.

---

## 5. KEEP — where px is the correct answer (529)

These are **not backlog**. Converting them introduces a bug or changes behaviour for no benefit, and
a future lint rule should allowlist them explicitly.

There are two distinct reasons a value lands here, and it matters which:

- **Physically cannot be rem** — the consumer is not a CSS cascade at all (canvas, email client,
  JS number API). rem is not merely discouraged, it does not resolve.
- **Should not be rem** — CSS would accept it, but converting changes rendering or semantics in a
  way you do not want. This is a judgement call, and it is recorded as such.

---

### Z1 · Comments and documentation — 281 · *cannot matter*

Prose inside `//`, `/* */`, and `<!-- -->`. No runtime effect whatsoever, and they inflate every
naive `grep` — the single biggest reason raw search counts mislead.

**But they are not all the same, and "strip the px from comments" would be actively wrong.**

#### The house convention already answers this

This codebase deliberately documents rem values with their px equivalent, in 30 places:

```css
--text-xs: 0.75rem;      /* 12px — captions, metadata, timestamps */
--text-sm: 0.875rem;     /* 14px — DEFAULT body text */
--radius-default: 0.375rem;  /* 6px  — control tier */
```

That px is **not stale documentation — it is the point of the comment.** Nobody reads `0.8125rem`
and pictures a size; `13px` is how humans reason about type scales, and how a designer's spec is
written. Removing it would make the token file harder to use, not more consistent.

#### Policy per comment type

| Comment type | Example | Action |
| --- | --- | --- |
| **Token annotation** | `0.75rem; /* 12px */` | **Leave.** Intentional. When you convert a value, *add* this form rather than removing px. |
| **Describes a value you just converted** | `<!-- Hero metrics (100px height) -->` above a now-`6.25rem` block | **Update** — restate as `6.25rem (100px)` so it matches the code it sits on. |
| **Cites a Tailwind class's px equivalent** | `<!-- size-12! (48px) exceeds OIcon's xl (40px) -->` | **Leave.** Still true — `size-12` really does render 48px. |
| **Explains why a px is kept** | `// 1px hairline — must not scale` | **Leave, and strengthen** if the reason is only implied. These are the comments that stop someone "fixing" a KEEP value later. |
| **Describes a value you did *not* touch** | anything near K1/K2/K7/R1 | **Leave.** |

#### The rule

> A comment is stale only when it **contradicts** the code — not when it mentions px.
> `/* 12px */` next to `0.75rem` does not contradict; it explains.

So: update the comments attached to lines you actually change, adopting the `rem /* px */` form the
token files already use. Do not sweep the other 250. There is no separate "comment migration" task,
and no lint rule should ever flag px inside a comment.

---

### K2 · Hairline borders — 77 · *should not*

`1px` and `1.5px` on `border`, `outline`, and divider rules.

At the current root size `0.0625rem` computes to exactly `1px`, so converting looks harmless. The
problem appears the moment rem does its job. A user who sets their browser font to 20px scales that
border to `1.25px`. Browsers cannot paint a quarter pixel, so the renderer either anti-aliases it
into a soft grey smear or snaps it away entirely — and on non-integer device-pixel-ratio displays
(150% Windows scaling, common on your users' machines) it can disappear on some edges and not
others, leaving visibly uneven table grids.

A hairline is a **1-device-pixel rule**, not a proportional dimension. It should stay crisp while
text around it scales. Your own token file already encodes this decision — `--spacing-px: 1px` sits
in `lib/styles/tokens/base.css:372` as a deliberate px escape hatch, and Tailwind's stock `border`
utility is likewise px, not rem.

---

### K7 · Arbitrary shadow / ring / blur widths — 49 · *should not*

`shadow-[0_1px_2px_…]`, `ring-[3px]`, `border-l-[…]`, `blur-[…]` written as Tailwind arbitrary values.

Shadow offsets and blur radii are **optical effects, not layout dimensions**. A shadow exists to lift
a surface off the page by a fixed visual amount; scaling it with the user's text size makes elevation
bloom disproportionately — a 12px shadow becomes 15px while the card it belongs to stays put, and the
whole UI reads as heavier. `ring-[3px]` is a focus indicator, which is an accessibility affordance
that must stay crisp and consistent at every zoom level.

**Where these hide:** most are not in templates. `lib/core/Button/OButton.vue` alone holds 21
`ring-[3px]` inside a CVA-style variant map in its `<script>` block. Any audit that scans only
`<template>` will miss them and report a smaller KEEP surface than reality.

---

### R2 · Canvas font and text measurement — 36 · *cannot*

`utils/fonts.ts:76` `canvasFont()` builds a CSS font shorthand string that is assigned to
`ctx.font`, and `utils/dashboard/chartDimensionUtils.ts` measures label widths with it.

Verified: `chartDimensionUtils.ts:23` creates the measuring canvas with
`document.createElement("canvas")` and **never appends it to the document**. Relative font units in
`ctx.font` resolve against the canvas element's computed style; a detached element is outside the
document tree, so there is no reliable root font-size to resolve `rem` against. The measurement
silently returns a wrong number rather than throwing.

That number feeds ECharts' `nameGap` and axis label widths, so the failure surfaces as clipped or
overlapping chart labels — far from the code that caused it.

There is a second failure path in the same file: line 37's jsdom fallback does
`parseFloat(fontSize) || 12` and multiplies. Pass `"0.75rem"` and it computes text width from `0.75`
instead of `12`, collapsing every estimate by ~16×.

---

### K1 · Container-query conditions — 32 · *should not*

**Correction to a common assumption: this codebase has zero `@media` rules containing px.** All 32
are Tailwind container-query variants and viewport variants:

```
@max-[900px]/stream-config   @max-[1300px]/topbar   @max-[850px]/topbar
@max-[750px]   @max-[680px]   @max-[600px]   max-[1024px]:
```

These are *technically* convertible — `@max-[56.25rem]` is valid CSS and rem in a query condition
resolves against the root. But a query condition is not a dimension being rendered; it is a
**threshold defining when a layout changes**. These specific thresholds were tuned by eye against
px container widths, and converting them changes *when* they fire the moment root font-size differs
from 16px.

These 32 values are also, almost literally, the entire responsive story in the app (19 of 896 `.vue`
files use any responsive mechanism). Perturbing the only working responsive code during a migration
whose stated goal is *zero visual change* is gratuitous risk. Revisit them deliberately during the
responsiveness workstream, where changing breakpoint semantics is the point.

---

### K8 · Email templates and font definitions — 24 · *cannot*

`utils/prebuilt-templates/email.ts` emits a **complete standalone HTML document** — its own
`<style>` block, its own `<body>` — that is delivered to a mail client. Outlook's desktop client
renders via Word's HTML engine, which has poor and inconsistent rem support; several webmail clients
strip or rewrite `<style>` entirely.

More fundamentally: rem resolves against *the rendering document's* root font-size. That document is
the recipient's mail client, not your app. Even where rem is supported, you have no control over what
it resolves to — the whole email would resize unpredictably per recipient.

This file already carries an exemption in `scripts/check-design-consistency.mjs` under
`FONT_ALLOWLIST` for exactly this reason. The px exemption belongs in the same place.

`utils/fonts.ts` is here for a different reason: it *defines* the font stacks and the `canvasFont`
helper, so it is upstream of the tokens rather than a consumer of them.

---

### R4 · ECharts option objects — 17 · *cannot*

Values inside ECharts configuration — `axisLabel`, `symbolSize`, `barWidth`, `legend`, `grid`.

ECharts serialises these into a **canvas renderer**. There is no CSS cascade inside a `<canvas>`
bitmap: neither `var(--token)` nor `rem` resolves, because nothing in that pipeline consults the
document's computed styles. ECharts treats a bare number as device-independent pixels and a string
like `"12px"` by parsing the number out of it. Hand it `"0.75rem"` and you get either a parse failure
or the literal `0.75`.

This is the same constraint that already forces `utils/dashboard/` onto the `TS_HEX_ALLOWLIST` in
your design-consistency script — colours can't be tokens there for exactly the same reason sizes
can't be rem.

---

### K4 · User-facing copy — 1 · *should not*

Text the reader sees is prose *about* a size, not a size being applied. Converting it edits the
sentence rather than the styling — and usually makes it untrue, because the quantity being
described is a fixed layout constant that does not scale with font-size:

```html
<!-- views/Dashboards/PanelLayoutSettings.vue -->
<OTooltip content="1 unit = 30px" />        <!-- KEEP -->
<OTooltip content="1 unit = 1.875rem" />    <!-- WRONG: the grid unit is a unitless 30 in the
                                                  row-count maths and a fixed gridstack
                                                  cellHeight; it never scales with type -->
```

Two independent reasons to keep px here: the statement stays **true**, and readers do not think
in rem — "30px" communicates a size, "1.875rem" does not.

This is the rendered-string sibling of Z1 (comments). Z1 is handled by `maskCommentsForPx()`;
this category is handled by a `px-rules.mjs` exemption covering text-bearing attributes
(`content`, `placeholder`, `label`, `title`, `aria-label`, …) and template text nodes. The
exemption is deliberately narrow — px inside an unclosed `<tag …` still reports, so
`<div style="width: 300px">` is unaffected.

> Prefer spelling the unit out (`"1 unit = 30 pixels"`) in new copy: it reads better and needs
> no exemption at all.

---

### R5 · `IntersectionObserver` `rootMargin` — 4 · *cannot*

The `rootMargin` string is parsed by the **API**, not by the style system, and its grammar
accepts **px and % only**. A rem value does not degrade — it throws from the constructor:

```
SyntaxError: Failed to construct 'IntersectionObserver':
rootMargin must be specified in pixels or percent.
```

All four sites build the observer inside `onMounted`, so the throw aborts the mount hook and
whatever the observer gates never happens — and because the work is lazy ("load when scrolled
near"), the failure is **silent**: an empty cell, not an error the user can see.

```js
// components/rum/errorTracking/list/ErrorTrendCell.vue
// components/rum/sessionReplay/SessionActivitySparkline.vue
// plugins/logs/patterns/PatternVolumeCell.vue
// plugins/traces/LLMErrorTable.vue
{ rootMargin: "200px 0px" }   // KEEP — "12.5rem 0px" throws
```

Like K1 (query conditions) this is a **threshold that decides when** something loads, not a
rendered length, so it has no reason to track font-size. `%` is accepted if a viewport-relative
prefetch distance is ever wanted (`MetricCard.vue` already uses `"100% 0px"`).

Enforced by a `rootMargin` exemption in `scripts/px-rules.mjs` — without it the eslint rule
reports the correct px as an error and pushes the next author straight back into the crash.

---

### R6 · JS scroll thresholds — 2 · *cannot*

`components/O2AIChat.vue` compares against DOM measurements:

```js
const hasScrollableContent = scrollHeight > clientHeight + 100;
const isScrolledUp = scrollTop + clientHeight < scrollHeight - 100;
```

`scrollHeight`, `clientHeight`, and `scrollTop` are **always returned in CSS pixels**, by
specification, regardless of what units produced the layout. The literal `100` must therefore be in
the same unit to be comparable. There is no rem to convert to — it is arithmetic on px, not a style
value.

---

### K3 · Shadow offsets in style blocks — 2 · *should not*

Same reasoning as K7, appearing as CSS declarations rather than Tailwind classes:
`box-shadow: inset 0 0 0 1px …`. Optical effect, not layout.

---

### K6 · The `9999px` pill sentinel — 1 · *should not*

`--radius-full: 9999px` in `lib/styles/tokens/base.css`.

This is not a dimension. It is the idiomatic "make this fully rounded" sentinel — an arbitrarily
large number that guarantees the border-radius always exceeds half the element's height, producing a
pill or circle at any size. `624.9375rem` would be identical in effect and actively harder to read.

---

### K9 · Unit-multiplication `calc(var(--x) * 1px)` — 7 · *cannot*

Both `TenstackTable.vue` files (5 in `components/`, 2 in `plugins/logs/`) size columns like this:

```js
`calc(var(--col-${id}-size) * 1px)`
`calc((var(--col-${id}-size) * 1px) - 0.5rem)`
```

The custom property holds a **unitless number** — a column width TanStack Table computed in JS.
CSS cannot use a bare number as a length, so `* 1px` is the canonical idiom for attaching a unit to
it. The `1px` is not a dimension anyone chose; it is a **unit conversion operator**.

Change it to `* 1rem` and every column becomes 16× too wide. There is nothing to migrate here.

Note the second line: `(var(…) * 1px) - 0.5rem` already mixes px and rem *correctly* — the px term
is a measured pixel value from JS, the rem term is a padding subtraction from the design scale. Mixed
units in `calc()` are not inherently wrong; they are wrong when both terms are supposed to mean the
same kind of thing (see §6 R1).

> **This scenario was initially misfiled as C8 (convert).** It is the exact pattern recommended as
> solution #2 in §6 R7 — store unitless, let each consumer attach its own unit — already in use in
> this codebase. Worth copying when you fix `useStickyColumns.ts`.

---

### R3 · Gridstack `cellHeight` — 1 · *cannot*

`views/Dashboards/RenderDashboardCharts.vue` passes `cellHeight: "17px"` to gridstack.

Gridstack computes grid geometry in JS and writes px back to the DOM. Its API contract is a number or
a px string; it parses the numeric part. A rem string yields `17` → `0.something`, and every panel in
every dashboard mislays. Same class of constraint as any JS layout library — `@tanstack/vue-virtual`'s
`estimateSize` behaves identically, which is why virtualised lists break so spectacularly when fed
the wrong unit.

---

### K10 · SVG geometry attributes — 4 · *cannot*

> **CORRECTION.** An earlier revision of this document claimed "zero px in SVG geometry
> attributes". That was wrong: the grep behind it was single-line, and these `<svg>` tags
> span several lines, so it matched nothing. A multiline-aware scan finds **4**, in
> `components/icons/DynamicFilterIcon.vue` and `components/icons/SlackIcon.vue`.

```html
<svg xmlns="…" width="24px" height="24px" viewBox="0 0 24 24">
```

`width`/`height` on an SVG element are parsed with SVG's own attribute length grammar,
which predates `rem` and does not accept it reliably across browsers. The idiomatic
alternative is unitless SVG **user units** (`width="24"`), not rem — so these stay px and
both files are on the eslint rule's file allowlist.

`stroke-width` px: genuinely zero, confirmed by the same scan.

Related, same reasoning: **`<img width>` / `<img height>`** (reached via
`O2AIContextAddBtn`'s `imageWidth` / `imageHeight` props) are HTML *dimension attributes*,
which take a bare integer. `<img height="1.25rem">` is invalid markup.

---

## 6. Risk register — what breaks if you convert blindly

### ✅ RESOLVED · R7 — `parseInt()` readers (19 occurrences, 3 files)

> **Done.** All three now go through `toPx()` from `src/utils/units.ts`, which resolves
> px/rem against the LIVE root font-size. `TraceTree.vue` no longer parses a CSS string at
> all: `TraceDetails.vue` now emits a unitless `style.leftPx` sibling next to `style.left`,
> so the arithmetic consumers read the number and the CSS consumers read the string.
> Kept below as the reference for why this class of site is dangerous.

**Why "coupled" is a separate verdict from convert or keep.**

Everywhere else, a px literal has exactly one consumer: the CSS cascade. You change the literal, CSS
reads the new value, done. These 19 are different — the value is read by **two consumers with
incompatible expectations**. One is CSS, which understands units. The other is JavaScript, which
calls `parseInt` and gets a bare number it then assumes is px.

That makes the occurrence un-migratable *in isolation*. Whether it converts depends entirely on
whether you also change its reader — so the value and its reader form a single unit of work.

The failure is uniquely nasty because **nothing detects it**:

```js
parseInt("300px")     →  300    ✅
parseInt("18.75rem")  →  18     ❌  silent 16× shrink
```

No exception. No TypeScript error — the signature is `string` either way. No test failure, because
the tests assert on the *output* string, which is still a well-formed `"18px"`. The only symptom is
a layout that is quietly, wrongly small.

#### `composables/useStickyColumns.ts:39`

```js
cumulativeWidth += col.width ? parseInt(String(col.width)) : 100;
```

Accumulates the left-offset for each sticky table column. Convert any column's `width` to rem and
that column contributes ~1/16th of its real width to the running total, so every subsequent sticky
column is positioned too far left — they stack on top of each other instead of sitting side by side.

#### `plugins/traces/TraceTree.vue:48, 53, 73, 107` — the hard one

```js
left: parseInt(spans[i].style.left) + 'px'      // line 73  — parsed, re-suffixed
left: spans[i].style.left                        // line 317 — consumed raw as CSS
```

The **same** `style.left` value feeds both paths. Line 317 hands it straight to CSS, which needs a
unit. Lines 48/53/73/107 parse it as a number and re-append `'px'`, which needs it *not* to have a
rem unit. There is no single value that satisfies both — convert it and line 317 renders correctly
while the connector segments collapse; leave it and nothing changes.

This one cannot be fixed by editing a literal. The shape of the data has to change.

#### `lib/core/Table/OTable.vue:617`

```js
sum += measuredVar ? parseFloat(measuredVar) : col.getSize();
```

Column-width summation reading a CSS custom property. Same mechanism — but **latent, not
live**: `measuredColumnSizeVars` is declared (`ref<Record<string,string>>({})`) and never
assigned anywhere in the file, so this branch is currently unreachable. Hardened anyway,
because the moment someone populates that ref it becomes a real failure with no signal.

**Solution.** Pick one of two shapes, per site:

1. **Keep the store in px, convert at the boundary.** The stored value stays `"300px"`; only the
   final CSS write converts. Lowest risk, leaves the px literal in place — these then legitimately
   move to KEEP rather than being migrated.
2. **Store a unitless number.** `col.width = 300` (a `number`, not a string), and every consumer
   appends the unit it needs. This removes the ambiguity permanently and is the better long-term
   shape, but it is an API change to the column definition and touches every call site.

Either way, **never convert the string in place.** (In the event these were done LAST, with the
values they read held back from the earlier batches.) The principle stands for any new such site:
that when you reach C5 and C8 you already know which size strings have numeric readers.

**Safe by contrast:** `lib/core/ToggleGroup/OToggleGroup.vue:79-80` also calls `parseFloat`, but on
values from `getComputedStyle`. Computed styles are **always** resolved to px by the browser
regardless of the authored unit, so that code is immune. Use this as the test when auditing a new
`parseInt` site: *does the string come from the DOM, or from our own source?* DOM is safe; ours is not.

---

### ✅ RESOLVED · No regression guard existed

> **Done.** `local/no-hardcoded-px` (eslint) now guards `.vue` + `.ts` at zero tolerance, and
> `cssPx` guards `.css`. `lint:ci` was widened from `src/**/*.vue` to `src/**/*.{vue,ts}` so the
> rule actually reaches `.ts` in CI. Verified by planting one violation of every category in a
> `.vue`, a `.ts` and a `.css` and confirming each is caught.
>
> **Known residual gap:** the ratchet is a counter, so in the 23 files that still carry debt a
> same-category *swap* (remove one, add one) passes. That is why px moved to a predicate rule.
> `rawVarInComponent`, `unscopedStyle` and `darkMechanism` remain swap-vulnerable in those files.
>
> Original finding, kept for context:

`npm run lint:design:strict` passes today, but running its actual regexes against the tree shows it
guards **0 of 1,573** live px. All three px categories read zero because the codebase already
satisfies them — every remaining value sits in a category the ratchet does not model. The walker
also visits only `.vue` and `.ts`, so all 11 `.css` files are never scanned.

```
arbPx: 0    arbTextSize: 0    stylePxUnit: 0
guarded 0 / 1573            css files scanned: 0 / 11
```

**Solution.** In `scripts/check-design-consistency.mjs`, add categories for inline-style px,
component size-prop px, and JS size constants; extend `walk()` to `.css`; baseline at today's
counts. Do this **before** migrating — the ratchet then drives the cleanup monotonically and blocks
regressions across 168 files of hand edits.

---

### 🟠 DEFER · R1 — `calc(100vh − Npx)` (54 occurrences, 24 files)

**Why this is deferred rather than converted or kept.**

These expressions mix two units that answer to different masters. `100vh` is 1% of the viewport
height — it tracks the *window*, and is completely unaffected by font-size. A `rem` term tracks the
*root font-size*, and is completely unaffected by the window. Subtracting one from the other only
produces a stable result while both stay fixed.

```css
/* today — both terms are viewport-anchored, result is predictable */
max-height: calc(100vh - var(--navbar-height) - 157px);

/* after a naive conversion — the second term now moves independently */
max-height: calc(100vh - var(--navbar-height) - 9.8125rem);
```

Converted, a user who raises their browser font size shrinks every one of these panes — even though
their window did not change and the chrome being subtracted may not have grown by the same amount.
You get panes that no longer reach the bottom of the screen, or that overflow it.

The deeper issue is that the number being subtracted is a **hardcoded guess at the height of
surrounding chrome** — navbar, tabs, toolbars, footers. That guess is already fragile: it silently
breaks whenever anyone changes the header. Converting it to rem does not fix that; it adds a second
independent variable to a number that was already wrong-by-construction.

```
8  components/pipeline/NodeForm/ScheduledPipeline.vue
6  lib/overlay/Dialog/ODialog.vue
4  components/common/BaseImport.vue
4  components/dashboards/PanelEditor/PanelEditor.vue
```

**Decision.** Leave every one of these as px, and keep `--navbar-height: 36px` in px alongside them
so the whole family stays unit-consistent. This is **layout-architecture debt, not unit debt.** The
real fix is to delete the arithmetic — a flex column with `flex: 1` and `min-height: 0` fills the
remaining space without anyone needing to know how tall the header is. That is a genuine refactor
with real regression risk per pane, it belongs to the responsiveness workstream, and bundling it
into a migration whose whole value proposition is *zero visual diff* would destroy that property.

---

### ✅ RESOLVED · T1 — Test assertions (forecast 227, actual **1**)

> **Done.** The forecast was far too high. Spec px overwhelmingly either sat in files whose source
> px turned out to be sanctioned, or asserted values the migration did not touch. Exactly one test
> needed updating — `useStickyColumns.spec.ts`, and for a real behaviour change rather than a
> string swap: `parseInt("100.5px")` truncated to `100`, while `toPx` preserves `100.5`. Sticky
> offsets accumulate, so the old truncation compounded across columns; the new value is more
> correct and the test now documents why.
>
> Original estimate, kept for context:

Specs assert literal strings — `expect(style).toContain("top: 300px")`,
`node.style.height = "1024px"`.

```
13  components/rum/errorTracking/view/ErrorStackTrace.spec.ts
12  components/dashboards/AlertContextMenu.spec.ts
12  plugins/traces/TraceTree.spec.ts
11  plugins/traces/TraceHeader.spec.ts
```

**Solution.** Mechanical, but budget for it — this is ~23% of total touch count. Update each spec in
the **same commit** as its source file so the suite never goes red mid-migration.

---

## 7. Batching — 168 files, heavily skewed

The convert surface is concentrated: 6 files carry 20+ occurrences each, while 122 files carry four
or fewer. That shape favours a few careful PRs followed by a long mechanical tail.

| Band | Files | Approach |
| --- | ---: | --- |
| 20+ occurrences | 6 | One PR each. Individual review — these carry the layout-sensitive cases. |
| 10–19 | 15 | Group 3–5 per PR by feature area. |
| 5–9 | 25 | Group by directory. |
| 2–4 | 65 | Bulk codemod + spot review. |
| 1 | 57 | Bulk codemod. |

The six heavyweight files:

```
48  views/synthetics/MonitorRuns.vue                                C5:46  C2:2
33  components/anomaly_detection/steps/AnomalyDetectionConfig.vue   C4:26  C5:7
25  components/EnterpriseUpgradeDialog.vue                          C2:21  C4:4
24  components/pipeline/NodeForm/ScheduledPipeline.vue              C4:17  C5:6  C3:1
23  utils/traces/treeTooltipHelpers.ts                              C6:15  C8:8
20  components/dashboards/addPanel/ConfigPanel.vue                  C5:20
```

Next tier (10–19):

```
18  components/rum/errorTracking/view/PrettyStackTrace.vue
17  lib/core/Table/sub-components/OTableHeader.vue
16  components/reports/CreateReport.vue
15  components/settings/ServiceIdentitySetup.vue
15  components/traces/FlameGraphView.vue
12  lib/styles/tokens/base.css
11  components/TenstackTable.vue
11  components/login/Login.vue
11  components/dashboards/addPanel/PromQLChartConfig.vue
11  components/dashboards/PanelEditor/PanelEditor.vue
11  utils/dashboard/legendConfiguration.ts
10  components/pipeline/ImportPipeline.vue
10  views/AwsMarketplaceSetup.vue
10  views/AzureMarketplaceSetup.vue
10  utils/dashboard/convertPromQLData.ts
```

---

## 8. Execution order — as actually run

1. ✅ **Guard first.** px categories added to the ratchet and baselined, so 138 files of edits had
   something holding the line. *(Later superseded — see the status banner: px enforcement moved to
   the eslint rule and the ratchet kept only `cssPx`.)*
2. ✅ **C5 component props — 153 converted, 9 excluded.** All 13 receiver×prop pairs were verified
   pass-through before converting; the 9 exclusions are SVG geometry, `<img>` dimension attrs, and
   one tooltip string that merely mentions px.
3. ✅ **C4 inline styles — 278** (263 static + 15 inside bound ternaries).
4. ✅ **C2 Tailwind arbitrary values — 64** (50 utility-name + 14 arbitrary-property).
5. ✅ **C8 / C6 / C7 script + `.ts` — 65.**
6. ✅ **R7 last, by request** — with `TraceDetails.vue`'s `top`/`left` stringification and any table
   `col.width` held back from step 5 so deferring it did not just relocate the risk.
7. ✅ **Final eslint-driven sweep — 31**, converting exactly the positions the rule still reported.
8. ✅ **Re-baseline + full verify.** `lint:ci`, `lint:styles`, `lint:tokens`, `lint:token-purity`,
   `lint:design:strict`, `vue-tsc` and the unit suite all green.

**Actual touch surface:** 591 conversions across 138 files. Test updates needed: **1**, not the ~227
forecast — most spec px turned out to sit in files whose source px was sanctioned, or to assert
values that did not change.

### What went wrong along the way (kept as a warning)

Four codemod bugs, each of which would have shipped silently:

1. **`px\b` does not match `8px` in `p-[8px_12px]`.** `_` is a word character, and Tailwind uses it
   for the space inside arbitrary values — so `\b` skipped the first value of every multi-part
   utility, and every value of `shadow-[0_4px_8px_…]`. Use `px(?![a-zA-Z0-9])`.
2. **Emitting a normalised property name deleted markup.** In `<div style="min-width:190px">` the
   first declaration arrives glued to its prefix; re-emitting just `min-width` dropped the `<div
   style="`. Caught by three failing tests — the whole of `src/` was reverted and every codemod
   re-run from `HEAD`.
3. **A string regex allowed newlines**, so a match ran from one statement's closing quote to the
   next statement's opening quote and swallowed the code between. `'…'`/`"…"` cannot span lines in
   JS; only backticks can.
4. **Case-sensitive `box-shadow`** never matched the camelCase `boxShadow:` that every JS style
   object writes, so sanctioned shadows were counted as debt.

---

## 9. Out of scope (deliberately)

- **Responsiveness.** rem does not make an application responsive. With the root font-size unset,
  `1rem === 16px` permanently, so this migration is pixel-identical by construction. rem buys
  accessibility (honouring the user's browser font-size, WCAG 1.4.4) and one global density knob —
  not layout reflow.
- **Current responsive coverage, for the record:** 19 of 896 `.vue` files (2.1%) use any breakpoint
  or container query — 37 responsive utility usages total (`sm:` 8, `md:` 3, `lg:` 19, `xl:` 7,
  `2xl:` 0) plus 26 media queries. Real responsiveness is a separate workstream, best built on
  container queries given the resizable-pane app shell (`html`/`body` are both `overflow: hidden`).
