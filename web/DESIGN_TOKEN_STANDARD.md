# OpenObserve Design-Token Standard & Canonical Allow-List

> **Date:** 2026-07-17 (execution log 2026-07-18) · **Branch:** `fix/token` · **Scope:** `web/`
> **Status:** Tiers 0–1, the **Phase-G structural lock (3.20)**, and safe Tier 3 hygiene
> **EXECUTED** (see the Execution Status section below). What remains of Tier 2 (the coupled
> vocab + `component.css` rewire, brand-architecture decision) and Tier 3 (traceColors
> token-derivation, chart burn-down, `utilities.css`) is design-gated or needs a human visual pass.
>
> **What you asked for:** *"Check all token usage. Goal: tokens we can change and see the change
> across the whole app — text size, text colour, colours, border, corner radius (and anything else
> that drives visual consistency). Are the tokens logical? Prepare a guide: what to change, what to
> add, what to remove, and the definitive list of tokens we must use — the ones that generate the
> equivalent Tailwind utilities, and only those — the ideal standard way of doing design tokens via
> Tailwind."*
>
> This document is the answer: **Part A** is the canonical allow-list (the only tokens feature code
> may use), **Parts C–E** are the change/add/remove lists, **Part F** is the standard, **Part G** is
> the ordered, reviewable execution plan.

---

## Execution Status (2026-07-18)

Verified green after every step: `lint:tokens`, `lint:styles`, `lint:token-purity`,
`lint:design` all pass; `type-check` and `lint:ci` clean; the 3 codemod-touched specs
(221 tests) pass; the app compiles and renders correctly in **both light and dark** in the
dev server, and every retired token resolves to empty / every kept token to its value at
runtime (`--color-text-primary`/`-caption`, `--color-info-*`, `--color-label-chip-ipv4/6/date/time-*`
gone; `--color-primary-950` now JS-generated under a custom theme).

**✅ Shipped (Tier 0 + Tier 1 + safe Tier 3):**
- **Tier 0.1** — `lint:token-purity` + `lint:design` wired into `playwright.yml` (per-PR gate);
  `rawVarInComponent` category added to the design ratchet (counts raw `var(--color-*)` in
  scoped + unscoped `<style>` blocks) and baseline regenerated. (stylelint `color-no-hex` was
  already `error`.)
- **Tier 0.2** — `generatePrimaryPalette` now emits shade **950** (`theme.ts`).
- **Tier 0.3** — registered **47** defined-but-unregistered SOLID domain tokens (brand-\*,
  dag-node-\*, theme-\*, scrollbar, dashboard-placeholder, hover-shadow, pivot-header-border).
  Deliberately did NOT register raw palette ramps, gradient values, the dead `note` chain, or
  runtime `span` colours.
- **Tier 0.4** — registered the full `--text-{xs,sm,base,lg,xl,2xl}` ladder with paired
  line-heights reproducing today's values (deleted the hand-pin in `tailwind.css`); retired
  `--radius-xs/2xl/3xl` (codemod → `sm`/`lg`), `--shadow-xs` (→ `md`); codemodded feature-code
  `border-strong`/`border-subtle` → `border-default` (kept both for O2-library internals).
- **Tier 0.5** — removed the two false `.scss` comments; fixed the `--color-actions-column-shawdow`
  typo. (Stale PLAN/PENDING docs left in place — separate concern.)
- **Tier 1** — killed the `text-primary`→`heading` alias (365 class + 74 var refs) and the
  `text-caption`→`secondary` alias (53 class + 9 var refs); fixed `AppPageHeader`; repointed the
  7 `--color-typography-*` lines (body→`text-body`); merged `info-*`≡`blue-*` and the
  ip/ipv4/ipv6 + ts/date/time chip triplets (all byte-identical in both themes); documented the
  intentional `#a3a3a3` group; added stylelint + design-ratchet bans so the aliases can't return.
- **Tier 3 (safe subset)** — deleted the dead `note` chain (16 tokens, 0 refs) and unused
  `--leading-xs` / `--tracking-tighter` / `--font-black`; corrected the `traceColors.ts` docstring.
  Token count **1052 → 1020**.

**✅ Shipped — Phase G, the structural lock (Tier 3.20):**
- Migrated the one production file that used Tailwind's default palette
  (`useEventFormatters.ts`: red→error, green→success, gray→text-secondary; blue/purple kept —
  our ramps equal Tailwind's) and updated its spec; re-registered `transparent`/`current`/
  `inherit` (+ existing white/black) and the RUM-badge categorical shades so they survive the reset.
- Added **`styles/palette-reset.css`** (`@theme { --color-*: initial }`) imported after Tailwind,
  before the token files, and wired it in `tailwind.css`. Tailwind's built-in colour palette
  (`bg-gray-400`, `text-red-500`, …) now **no longer compiles** — a raw-palette class is
  structurally impossible, not merely lint-discouraged. **Verified live** in the dev server:
  `--color-red-500`/`--color-gray-400` gone; every project token + `bg-transparent`/`text-white`/
  the RUM chips still resolve; **prose** stays coloured (the typography plugin inlines its own
  oklch defaults, so it does not depend on the killed gray keys); Home + Logs render correctly in
  **both light and dark**; 0 console errors; 317 tests pass.

**✅ Shipped — §6 semantic growth + rewire, and remaining hygiene:**
- **§6 (the "root disease")** — grew the semantic layer with two interaction-state knobs,
  `--color-surface-accent-hover` (light `primary-50` / dark `primary-900`) and
  `--color-surface-accent-active` (light `primary-100` / dark `primary-800`), and repointed the
  **22 component tokens** that conformed to that exact pair in *both* themes (button-ghost family,
  dropdown/select items, tabs-active, datepicker hovers, …). **Verified value-preserving** in the
  dev server: every repointed token resolves to the identical value it had before in light AND dark
  — but the accent hover/active surface is now one knob, not 22 copies. Non-conforming refs
  (`toggle`→`primary-950`, `table-selected`→`d-selected`, and the many where a base shade *is* the
  right level — e.g. a button's `primary-600` brand bg) were correctly left alone.
- **§8.1** — deleted the 16 dead raw-palette ramp ends (`teal-100/200/800/900`, `orange-100/200/800`,
  `lime-100/200/800/900`, `amber-800/900`, `cyan-100/200/800`; `orange-900`/`cyan-900` kept — used).
  Token count now **1009**.
- **§10** — `utilities.css` no longer exists (removed since the audit — the dismantle is moot);
  `traceColors.ts` — the audit's actual bug (docstring lying that it reads the tokens) was fixed in
  the prior pass. Deriving `getSpanColorHex` from `--color-span-*` was deliberately NOT done: it
  feeds the trace **service-colour registry**, so it would silently reassign every service's colour
  with no benefit (both sets are just "distinct colours").

**⏳ Deliberately not shipped — a design decision, not a mechanical edit:**
- **Tier 2.13/2.14 dark overrides for the brand-\* annex (§8.4).** Reviewed all 50 tokens that lack a
  dark override: they are *intentionally* theme-independent per their own authoring comments — the
  brand replicas must look like real Slack/Teams/Email in any app theme, the promo-banner art is
  always-amber, and the language/AI accent tints are translucent (sit fine on light and dark). Adding
  dark treatment would make them *wrong*, so §8.4 is resolved-as-intended, not a defect. The one
  concrete brand bug (`primary-950`) was fixed in Tier 0.
- **Tier 2.15 overlay/soft/chart-palette token sets** — skipped on purpose: minting them without
  migrating the ~360 rgba / chart-hex consumers would create unused tokens, which violates the
  standard's own D18 ("only create what's used").
- **Tier 3.19 chart-hex burn-down** — the ~70 ECharts `.ts` files are hex-in-JS, `tsHex`-allowlisted
  and unaffected by Phase G; converting them to `chartColor()` changes rendered chart palettes and
  needs a human visual pass per chart, not a codemod.

**✅ Final pass — every remaining AUDIT §11 item closed (2026-07-18):**
- **Item 3 (stale docs)** — deleted `O2_TOKEN_MIGRATION_PENDING.md` (its residue items were
  completed or superseded — verified against the live tree); prepended a currency notice to
  `O2_TOKEN_MIGRATION_PLAN.md` (policy sections stay authoritative, counts do not).
- **Item 12 (brand architecture)** — **DECIDED and documented** at both source-of-truth sites
  (`base.css` primary ramp + this doc): the runtime engine is the authority — `constants/themes.ts`
  defines themes, `theme.ts#generatePrimaryPalette` derives the full 50–950 ramp and writes it as
  inline styles; `base.css` holds the DEFAULT O2 theme only (applies when theme.ts clears its
  overrides). Coherent since the Tier-0 `primary-950` fix removed the only ramp desync.
- **Item 14 (overlay/soft mix tokens)** — verified **moot**: the ~360 rgba style-block sites the
  audit measured no longer exist (`styleBlockHex` = 0 in the live baseline; prior style-block
  elimination removed them). Minting the tokens now would create zero-consumer tokens (D18).
- **Item 19 (raw-var burn-down)** — the audit's numbers were stale (91 inline sites → **34** live).
  Converted **all 21 static template `style="…var(--color-*)…"` sites** to registered utilities
  (DbSpanDetails, LLMContentRenderer, PrettyStackTrace, ColorPaletteDropDown, CellActions,
  CrossLinkManager/Dialog, PatternList, CreateBrowserTestSkeleton — value-preserving 1:1 class
  merges). The 13 remaining sites are **sanctioned**: JS-generated ECharts tooltip HTML
  (IncidentServiceGraph — already token-based) and one dynamic severity-computed style
  (IncidentTimeline). Tokenized the 4 `inlineHexStyle` sites (FlameGraph's fixed dark-glass
  tooltip → `--color-flame-tooltip-label/-error`) → **inlineHexStyle now 0**. The style-block
  var() refs that remain live exclusively in **keep()-justified blocks** (`styleKeepComment` = 0
  unjustified) — i.e. the consumption ladder's rule-3 sanctioned residue, ratcheted monotonically
  by `rawVarInComponent`.
- **Item 5 (radius registration)** — superseded by this standard's A5 (measured usage: standardise
  on `sm/md/lg/full`, retire `xs/2xl/3xl` via codemod) — done in Tier 0.4.
- **Items 13/16 (brand dark overrides / traceColors arrays)** — closed as **decided-intentional**,
  recorded above: the brand replicas and the flame/service-colour arrays are deliberately
  theme-independent / behaviour-preserved; the concrete bugs the audit found in them (primary-950,
  the lying docstring) were fixed.

With that, **all 20 recommendations in AUDIT §11 are closed** — 17 implemented, 3 closed by an
explicit recorded decision (5→superseded-by-standard, 13→intentional brand replicas,
16→behaviour-preservation) rather than silence.

Correction found during execution: `--text-3xl` (7 uses) and `--text-4xl` (3 uses) are **not**
dead (the audit's §8.1 "0 uses" was stale) — kept.

---

## How to read this (relationship to the other docs)

There are already six token docs in `web/`. This one does **not** replace them — it consolidates
them into a single decision-ready standard. Trust map:

| Doc | Role | Currency |
|---|---|---|
| **`O2_TOKEN_SYSTEM_AUDIT.md`** | Empirical **diagnosis** of current state (the "why") | ✅ Authoritative (2026-07-17) |
| `O2_STYLE_MIGRATION_PLAN.md` | Style-block elimination execution log | ✅ Current (2026-07-17) |
| `O2_TOKEN_MIGRATION_PLAN.md` §4/§7 | Consumption **ladder** + mapping tables (policy) | ⚠️ Policy current; **counts stale (7/15)** |
| `O2_TOKEN_DECISIONS.md` D1–D20 | Product/design decisions | ⚠️ Decisions stand; per-item sign-offs blank |
| `O2_TOKEN_MIGRATION_PENDING.md` | Residue list | ❌ Stale — regenerate or delete |
| `UI_TOKEN_REGRESSION_AUDIT.md` | Pixel-neutrality test plan | ✅ Plan valid; never executed |
| **`DESIGN_TOKEN_STANDARD.md`** (this) | The **target** — canonical list + standard | New |

Every claim here was re-measured against the live tree. Where evidence matters I cite
`O2_TOKEN_SYSTEM_AUDIT.md` by section (e.g. *AUDIT §5.A*).

---

## 1. Verdict in one paragraph

**The architecture is correct; the vocabulary is too large and partly ambiguous.** You have a clean
4-layer system (base → semantic → component → dark), a correct global element layer, `@theme inline`
registration, **zero `--o2-*` leftovers, zero `text-[..px]`, and a passing debt ratchet.** Feature
templates are genuinely in good shape — `text-text-secondary` ×763, `border-border-default` ×466,
`rounded-*` ×1360. The problems are four:

1. **Too many utility-generating tokens.** **904 `--color-*` defined, 747 registered** as Tailwind
   utilities. A design system needs ~40–60 app-facing knobs, not 747. The bulk are primitives and
   one-off domain colours that should not be reachable as general utilities.
2. **Aliases — a decision made twice.** `text-heading`≡`text-primary`, `text-secondary`≡`text-caption`,
   and a **5-way `#a3a3a3` collapse** (`label`/`disabled`/`placeholder`/`border-strong`/`scrollbar-hover`).
   This is *why* "change the heading colour" only reaches ~40% (AUDIT §5.A, §8.2).
3. **Two source-of-truth splits.** The `--text-*`, `--leading-*`, `--tracking-*`, `--font-weight-*`
   scales are defined in `:root` but **not registered**, so `text-lg`/`leading-lg`/`font-medium`
   utilities silently run on **Tailwind's built-in scale, not your tokens** (AUDIT §8.3). Separately,
   brand colour is written by JS as inline styles on `<html>`, so editing `--color-primary-600` does
   nothing under a custom theme (AUDIT §5.D).
4. **The ratchet doesn't run on PRs.** `lint:design` is `workflow_dispatch`-only; any PR can add
   unlimited hardcoded hex today (AUDIT §4).

Fixing these does **not** mean touching feature code much. It means shrinking and disambiguating the
token layer, registering the scales, and turning the guard on.

---

# PART A — The Canonical Token Allow-List

> **The rule:** In feature code (`views/`, `components/`, `plugins/`, `enterprise/`), the tokens
> below — and **only** these — are the design knobs you consume, via their Tailwind utility. Everything
> else (raw palette shades, Tailwind defaults, hex, rgba, arbitrary px) is off-limits. Component-tier
> tokens (Part B, Ring 2) are for the O2 library internals only.

Legend: **✅ keep** · **➕ add/register** (see Part D) · **⛔ retire** (see Part C).

### A1 · Text colour — `text-*`

| Token | Utility | Light value | Use for | |
|---|---|---|---|---|
| `--color-text-heading` | `text-text-heading` | grey-900 | h1–h6, page/modal/panel titles | ✅ **canonical** |
| `--color-text-primary` | `text-text-primary` | grey-900 | — | ⛔ **retire → heading** |
| `--color-text-body` | `text-text-body` | grey-800 | paragraphs, default body copy | ✅ |
| `--color-text-secondary` | `text-text-secondary` | grey-500 | supporting text, descriptions | ✅ **canonical** |
| `--color-text-caption` | `text-text-caption` | grey-500 | — | ⛔ **retire → secondary** |
| `--color-text-muted` | `text-text-muted` | grey-300 | de-emphasised, hints | ✅ |
| `--color-text-label` | `text-text-label` | grey-400 | form labels, metadata | ✅ (keep intent distinct) |
| `--color-text-disabled` | `text-text-disabled` | grey-400 | disabled control text | ✅ (keep intent distinct) |
| `--color-text-placeholder` | `text-text-placeholder` | grey-400 | input placeholders | ✅ (keep intent distinct) |
| `--color-text-link` | `text-text-link` | primary-600 | links | ✅ |
| `--color-text-link-hover` | `text-text-link-hover` | primary-700 | link hover | ✅ |
| `--color-text-inverse` | `text-text-inverse` | white | text on coloured/dark surfaces | ✅ |
| `--color-text-code` | `text-text-code` | grey-700 | inline code | ✅ |
| `--color-text-soft` | `text-text-soft` | rgba(0,0,0,.75) | soft body on tinted bg | ✅ |

> `label`/`disabled`/`placeholder` share `#a3a3a3` **by accident today** — keep them as three
> separate tokens (different intents must be able to diverge) but they must stop pointing at the same
> literal via copy-paste; route each through the primitive once. See Part C.

### A2 · Surface / background — `bg-*`

| Token | Utility | Use for | |
|---|---|---|---|
| `--color-surface-base` | `bg-surface-base` | cards, primary content surface | ✅ |
| `--color-surface-panel` | `bg-surface-panel` | secondary panels, sidebars | ✅ |
| `--color-surface-overlay` | `bg-surface-overlay` | dialogs, menus, popovers | ✅ |
| `--color-surface-subtle` | `bg-surface-subtle` | zebra rows, wells, chips | ✅ |
| `--color-surface-subtle-hover` | `bg-surface-subtle-hover` | hover on subtle surfaces | ✅ |
| `--color-surface-chrome` | `bg-surface-chrome` | app chrome (top bar, rail, gutter) | ✅ |
| `--color-surface-chrome-deeper` | `bg-surface-chrome-deeper` | chrome accents | ✅ |

### A3 · Border — `border-*`

**One app-facing border knob.** Measured usage: `border-default` **466**, `border-strong` **10**,
`border-subtle` **11**. The three are *not* the same literal (default = grey-200, strong = grey-400,
subtle = grey-150, distinct in dark too) — but feature code overwhelmingly reaches for `default`, and
`strong`/`subtle` earn their keep inside the **O2 library** (checkbox border → strong, table
row-divider / tooltip → subtle), not in views. So keep one knob here and demote the other two to Ring 2.

| Token | Utility | Use for | |
|---|---|---|---|
| `--color-border-default` | `border-border-default` | **the** border/divider colour for app code — all 1px borders, dividers, outlines | ✅ **canonical** (also the global `*` border colour) |
| `--color-border-strong` | `border-border-strong` | emphasised/control borders | ⚠️ **Ring 2 only** — library-internal; feature code uses `border-default`. 10 feature uses → codemod to default. |
| `--color-border-subtle` | `border-border-subtle` | quiet in-list row dividers | ⚠️ **Ring 2 only** — library-internal; 11 feature uses → codemod to default. |

> **Do not add `--color-border-accent`.** It has 0 uses and would collide with the `border-accent`
> utility already produced by `--color-accent` (A8). A focused/active border is `border-accent`
> (the brand knob) — not a second token. *(Reverses the earlier Part D proposal.)*

### A4 · Type scale (font size) — `text-*`

**Must be registered so the utility derives from the token** (today only `3xs`/`2xs`/`compact` are —
AUDIT §8.3). Register the whole ladder and delete the hand-pinned `.text-sm`/`.text-base` block in
`tailwind.css:33-56`.

| Token | Utility | px | Use for | |
|---|---|---|---|---|
| `--text-3xs` | `text-3xs` | 10 | chart micro-labels | ✅ (10px floor) |
| `--text-2xs` | `text-2xs` | 11 | tiny labels, badges | ✅ |
| `--text-xs` | `text-xs` | 12 | captions, metadata | ➕ **register** |
| `--text-compact` | `text-compact` | 13 | dense tables/body | ✅ |
| `--text-sm` | `text-sm` | 14 | **default body** | ➕ **register** |
| `--text-base` | `text-base` | 16 | comfortable body, inputs | ➕ **register** |
| `--text-lg` | `text-lg` | 18 | card/panel titles | ➕ **register** |
| `--text-xl` | `text-xl` | 20 | section headings | ➕ **register** |
| `--text-2xl` | `text-2xl` | 24 | page/modal titles | ➕ **register** |
| `--text-3xl` / `--text-4xl` | — | 30 / 36 | display | ⛔ **remove** (0 uses — AUDIT §8.1) |

### A5 · Corner radius — `rounded-*`

**Standardise on a 4-step scale: `sm / md / lg / full`.** Measured usage makes the case decisively —
`sm` **487**, `md` **336**, `lg` **290**, `full` **184** cover **96%** of all 1352 `rounded-*` uses.
The remaining steps are long-tail noise: `xl` 40, `xs` 10, `2xl` 4, `3xl` 1. Do **not** register the
unregistered ones (reverses the earlier "register xs/2xl/3xl" proposal) — retire them instead.

| Token | Utility | rem | Use for | |
|---|---|---|---|---|
| `--radius-sm` | `rounded-sm` | 0.25 | controls, inputs, chips, small cards | ✅ **canonical** |
| `--radius-md` | `rounded-md` | 0.375 | cards, panels, popovers | ✅ **canonical** |
| `--radius-lg` | `rounded-lg` | 0.5 | dialogs, large containers | ✅ **canonical** |
| `--radius-full` | `rounded-full` | 9999 | pills, avatars, circular | ✅ **canonical** |
| `--radius-xl` | `rounded-xl` | 0.75 | — | ⚠️ **judgement call** (40 uses). Recommend fold into `lg`; keep only if a distinct "extra-large container" step is wanted. |
| `--radius-xs` | `rounded-xs` | — | — | ⛔ **retire** (10 uses → `sm`; never registered) |
| `--radius-2xl` / `--radius-3xl` | — | — | — | ⛔ **retire** (4 + 1 uses → `lg`; never registered) |

> Total churn to reach the standard: **15 feature uses** to codemod (xs→sm, 2xl/3xl→lg), plus a
> decision on `xl`'s 40. Ban bare `rounded` and `rounded-[…]` arbitrary values (already ratcheted).

### A6 · Elevation — `shadow-*`

**Two real elevations, plus one "flat" baseline.** Only `md` and `lg` actually render a shadow —
that is the whole vocabulary the app needs. Measured usage: `shadow-sm` **50**, `shadow-md` **37**,
`shadow-lg` **13**, `shadow-xs` **1**. Note `shadow-sm` is defined as `none` (the hairline-border
philosophy), so those 50 uses paint nothing — it's the explicit "no elevation" token, not a shadow.

| Token | Utility | | Note |
|---|---|---|---|
| `--shadow-sm` | `shadow-sm` | ✅ | the **flat** baseline — intentionally `none` (hairline-border philosophy). Keep as the one way to say "no elevation". |
| `--shadow-md` | `shadow-md` | ✅ **canonical** | dropdowns, menus, popovers |
| `--shadow-lg` | `shadow-lg` | ✅ **canonical** | dialogs, large overlays |
| `--shadow-xs` | `shadow-xs` | ⛔ **retire** | recently registered, **1 use** — redundant between the flat baseline and `md`. Codemod → `md`, unregister. |

### A7 · Status / feedback (semantic, theme-aware)

Use these for status UI — **not** the raw `error-500`/`success-600` ramp shades directly.

| Token(s) | Utility | Use for |
|---|---|---|
| `--color-status-error-text` / `-error-bg` | `text-status-error-text` / `bg-status-error-bg` | error banners, invalid fields |
| `--color-status-success-text` / `-success-bg` | `text-…` / `bg-…` | success states |
| `--color-status-warning-text` / `-warning-bg` | `text-…` / `bg-…` | warnings |
| `--color-status-info-text` / `-info-bg` | `text-…` / `bg-…` | info |
| `--color-status-negative` / `-positive` / `-neutral-text` | `text-…` | metric deltas, health |

> The `--color-error-*` / `-success-*` / `-warning-*` **ramps** remain registered because O2 lib
> components (OBadge, OBanner) need discrete shades, but feature code should reach for the `status-*`
> semantics above. See Ring 2.

### A8 · Accent / brand

| Token | Utility | Use for | |
|---|---|---|---|
| `--color-accent` | `text-accent` / `bg-accent` / `border-accent` | the **one** brand-accent knob for app code | ✅ **canonical** |
| `--color-primary-{50…950}` | `bg-primary-600` … | — | ⚠️ **Ring 3 only** — do not use directly in feature code (AUDIT §5.D: raw `var(--color-primary-*)` used 268×). Route through `--color-accent` or a semantic surface/border token. |
| `--color-theme-accent` | (runtime) | user-customisable accent (JS-driven) | ⚠️ needs the brand-architecture decision (Part C.4) |

### A9 · Font family / weight / leading / tracking

Defined in `base.css` but **unregistered** → `font-medium`, `leading-lg`, `tracking-wide` run on
Tailwind defaults today (AUDIT §8.3). Decide **one** of:

- **(Recommended) Register the used steps** so they become real knobs: `--font-sans`, `--font-mono`,
  `--font-{medium,semibold,bold}`, `--leading-{sm,base,md,lg,xl}`, `--tracking-{tight,normal,wide}`.
- Or **delete the unregistered scale tokens** and consciously adopt Tailwind's defaults (they match
  today), removing the false "source of truth".

Do not leave them half-wired. **Remove** the unused ones regardless: `--font-black`, `--leading-xs`,
`--tracking-tighter` (0 uses — AUDIT §8.1).

### A10 · Icon sizing — `text-icon-*`

Registered and working (`--text-icon-xs…xl` → spacing scale). ✅ Keep. Use `text-icon-md` etc. for
icon box sizing instead of arbitrary `w-[..]`.

---

**Canonical count:** ~**50 app-facing tokens** across A1–A10 (after retiring aliases, demoting
`border-strong`/`-subtle` to Ring 2, and standardising radius to `sm/md/lg/full` + elevation to
`md/lg` over the flat baseline). That is the "use only these" set. Everything below is either
library-internal, data/brand-only, or banned.

---

# PART B — The three rings (who may use what)

| Ring | Tokens | Who consumes | Rule |
|---|---|---|---|
| **Ring 1 — App-facing** | Everything in Part A (~55) | feature code + O2 lib | **Use these.** |
| **Ring 2 — Library-internal** | `--color-button-*`, `--color-toggle-*`, `--color-badge-*`, `--color-banner-*`, `--color-input-*`, `--color-select-*`, `--color-tabs-*`, `--color-separator*`, the `error/success/warning` ramps | **only** `web/src/lib/**` components | Feature code never references these — it uses the O2 component, which reads them internally. |
| **Ring 3 — Data / brand / categorical** | `--color-span-1..50`, `--color-dag-node-*`, `--color-label-chip-*`, `--color-syntax-*`, `--color-field-type-*`, `--color-service-health-*`, `--color-brand-{slack,teams,email,msg-*}`, `--color-gradient-*`, `--color-json-*`, `--color-wildcard-bar-*` | specific domains (traces, logs, charts, code, brand replicas) | Legitimately many and often fixed. Consumed via `bg-(--token)`/`text-(--token)` **or** the `chartColor()` JS seam — never re-hardcoded per file. |
| **⛔ Banned in all app code** | raw base primitives (`grey-500`, `primary-600`, `blue-400`, `teal-600`…) **and** Tailwind defaults (`gray-*`, `blue-*`, `red-*`) | — | Registering primitives as utilities is what lets code skip the semantic layer (AUDIT §6: **61%** of the component layer already reaches past semantics into raw palette). Phase G (Part F) makes this structurally impossible. |

> **Key structural recommendation:** stop registering the raw base palette (`grey-*`, hue ramps) as
> general utilities. They exist to *define* semantic/component tokens, not to be sprayed on elements.
> The only primitives that stay app-reachable are the ones with a genuine categorical need (Ring 3).

---

# PART C — What is illogical → **consolidate / rename** (no new tokens)

These are the "are the tokens logical?" failures. All are **visually risk-free today** because the
two sides are currently identical — which is exactly why they've never been caught.

### C.1 Kill the heading/primary alias — *highest value*
`--color-text-primary` is a documented alias of `--color-text-heading` (identical in light **and**
dark). The alias won adoption ~3:1 (357 vs 105 utility uses). `AppPageHeader.vue:105` — the title of
every module, imported by 87 files — uses the alias, so the heading knob misses every page title.
- **Do:** codemod `text-text-primary` → `text-text-heading` and `var(--color-text-primary)` →
  `var(--color-text-heading)`; delete the `-primary` token; add a lint rule banning it.

### C.2 Kill the caption/secondary alias
`--color-text-caption` ≡ `--color-text-secondary` (grey-500), no distinguishing intent.
- **Do:** codemod `text-text-caption` → `text-text-secondary`; delete `-caption`.

### C.3 Disambiguate the 5-way `#a3a3a3` collapse
`--color-text-label`, `-disabled`, `-placeholder`, `--color-border-strong`,
`--color-scrollbar-thumb-hover` are accidentally the same literal. These are **different intents**.
- **Do:** keep all five tokens but route each explicitly through a primitive (e.g. label→grey-400,
  disabled→grey-400, placeholder→grey-400) so they *can* be tuned independently later, and document
  that they are intentionally-equal-for-now, not aliases.

### C.4 Repoint `--color-typography-*` and resolve the brand dual-source
- `--color-typography-body` points at the **heading** token (`component.css`), so `OText`'s body
  variant ignores `--color-text-body`. Repoint the 7 `--color-typography-*` lines: body→`text-body`,
  titles→`text-heading` (AUDIT §5.C).
- Brand colour has **two sources of truth**: `--color-accent` (CSS, from palette) and
  `--color-theme-accent` (a literal overwritten by `theme.ts` inline styles on `<html>`). Under any
  custom theme, editing `base.css` does nothing (AUDIT §5.D). **Decision required** (Part G, needs
  design input): either generate the palette from `constants/themes.ts` at build time, or have the
  theme engine write a single `--color-brand-base` that CSS derives from via `color-mix()`.
- **Ship the `primary-950` bug fix regardless** — `generatePrimaryPalette` emits 50–900 only, so two
  dark surfaces keep stock teal under custom themes (AUDIT §5.D). One line.

### C.5 Collapse remaining accidental duplicates
`--color-info-*` is a verbatim clone of `--color-blue-*` (5 identical pairs); the label-chip
`ip`/`ipv4`/`ipv6` and `ts`/`date`/`time` triplets are 6 tokens expressing 2 decisions. Merge.

---

# PART D — What to **add** (minimal, only where the audit proves raw usage has nowhere to go)

You asked not to introduce tokens casually. Each addition below exists to *eliminate* a large cluster
of un-themeable raw values — it removes debt, not adds surface.

| Add | Why (what it kills) | Evidence |
|---|---|---|
| **Register ~91 already-defined tokens** (`--color-brand-*`, `--color-dag-node-*`, `--color-syntax-*`, `--color-theme-*`, `--color-gradient-*`) in `@theme inline` | Unblocks the **single largest raw-`var()` cluster** — these have consumers but no utility, forcing `<style>`/arbitrary usage | AUDIT §8.3 (mechanical, zero-risk) |
| **Register the type scale** `--text-{xs,sm,base,lg,xl,2xl}` | Makes the font-size **knobs actually drive the utilities**; lets you delete the hand-pin in `tailwind.css`. *(Radius is **not** registered further — A5 standardises on `sm/md/lg/full` and retires xs/2xl/3xl.)* | AUDIT §5.B, §8.3 |
| **Interaction-state vocabulary** — `--color-surface-accent-subtle`, `--color-focus-ring`, `--color-surface-hover`, `--color-surface-active` | Prerequisite to rewiring the **301** component-layer raw-palette refs — right now there's no semantic token to route `primary-50/100/300` through. *(No separate `--color-border-accent` — an accent border is `border-accent` from A8, see A3.)* | AUDIT §6 |
| **Overlay / alpha scale** — `--color-overlay-*` | Nowhere for ~**360 rgba** overlays to go (`rgba(0,0,0,.05)`, `rgba(255,255,255,.15)` …) | AUDIT §10; offender map (EnterpriseUpgradeDialog 22 rgba) |
| **`-soft` / `-faint` mix tokens** for the repeated `color-mix()` formulas | Converts the largest "legitimately raw" bucket (~330–480 `color-mix()` sites) into ordinary utilities | AUDIT §7 |
| **A chart-palette token set + `chartColor()` usage** | Kills the biggest un-themeable hotspot: ECharts `const colors=['#5470C6',…]` and per-file `isDarkMode ? '#..' : '#..'` in `components/alerts/*`, `components/traces/*`, `enterprise/onlineEvals/*` | offender map hotspots #1–2, #5; AUDIT §10 (`traceColors.ts` divergence) |

---

# PART E — What to **remove** (dead / violates D18 "only create what's used")

| Remove | Count | Evidence |
|---|---|---|
| The `note` subsystem — `--color-note-*` (component + base chain) | **16** tokens, 0 external refs | AUDIT §8.1 |
| Unused palette ramp ends (`teal/orange/lime/amber/cyan-100/-200/-800/-900`, …) | **24** | AUDIT §8.1 |
| Unused type/scale tokens — `--text-3xl`, `--text-4xl`, `--leading-xs`, `--tracking-tighter`, `--font-black` | **8** | AUDIT §8.1 |
| Long-tail radius steps — `--radius-xs`, `--radius-2xl`, `--radius-3xl` (codemod xs→sm, 2xl/3xl→lg first) | 3 tokens, 15 feature uses | A5 (standardise on `sm/md/lg/full`) |
| Redundant elevation — `--shadow-xs` (codemod → `md` first) | 1 token, 1 use | A6 (only `md`/`lg` render) |
| Retired aliases — `--color-text-primary`, `--color-text-caption` (after codemod) | 2 | Part C.1–C.2 |
| Shipped typo — `--color-actions-column-shawdow` (rename → `-shadow`) | 1 | AUDIT §8.3 |
| Two false code comments claiming a `.scss` set / "not imported" | — | AUDIT §9 |

> ⚠️ **Before deleting any token, parse Tailwind v4's `bg-(--token)` / `bg-(image:--token)` syntax** —
> `--color-warning-surface` and `--color-gradient-danger` look dead to grep but are live (AUDIT §8.1).
> `--color-span-1..50` are built at runtime by `traceColors.ts` — not dead.

---

# PART F — The ideal standard (how to create & consume tokens with Tailwind v4)

### F.1 Four layers, one direction of reference
```
base.css      raw palette + type/space/radius scales     ← never referenced in components
   ↓ referenced by
semantic.css  intent: text-*, surface-*, border-*, status-*, accent, interaction-state
   ↓ referenced by
component.css button-*, toggle-*, badge-*, …              ← references semantic, NOT base
dark.css      .dark overrides of semantic/component only  ← never overrides base palette
```
A component token that reaches into `base.css` is a bug (AUDIT §6 found 301). Fix by growing the
semantic layer first (Part D), then rewiring.

### F.2 A token becomes a utility **only** by `@theme inline` registration
- Define the value in a plain `:root` (light) + `.dark` (dark) block.
- Re-export it in `@theme inline { --x: var(--x); }` — `inline` keeps the `var()` unprefixed so dark
  overrides still apply. This is the single gate that turns a token into `bg-x`/`text-x`/`border-x`.
- **Consolidate the four scattered `@theme` blocks** (`semantic.css:63`, `component.css` ×3) into one
  clearly-labelled registration surface per file so "what generates a utility" is readable at a glance.
- **Do not register** a token you don't intend feature code to use (Ring 2/3 stay minimal).

### F.3 The consumption ladder (settled — `O2_TOKEN_MIGRATION_PLAN §4`)
For any colour/size/radius in a component, in order:
1. **Registered semantic utility** — `text-text-secondary`, `bg-surface-base`, `rounded-md`, `text-sm`. *(~90% of cases)*
2. **Registered component/domain utility** — `bg-label-chip-ip-bg`, `text-service-health-critical`.
3. **`var(--color-*)` in a scoped block** — only for `:deep()`, keyframes, `v-html`, `color-mix()`, `calc(--navbar-height)`, SVG `fill`/`stroke`.
4. **A new token** — only when the intent genuinely doesn't exist; add with light+dark+`@theme inline`, never a component-local `--x`.

**Banned everywhere:** raw Tailwind palette (`text-gray-400`), hex/rgba/hsl in `.vue`, theme ternaries
for colour, `text-[..px]`/`rounded-[..]`/`z-[..]`/`w-[..px]` arbitrary values, `tw:` prefix, Quasar
utils, unscoped `<style>`, component-local colour vars, `--o2-*`.

### F.4 One dark-mode mechanism
Tokens auto-handle dark. Genuine dark-only rules use the `dark:` variant (bound to `.dark`). JS
surfaces (canvas/ECharts) read tokens through the **one** `chartColor()` / `useTheme()` seam. Banned:
`.body--dark`, `.light-mode`, raw `store.state.theme === 'dark'`, private `isDark` flags.

### F.5 The structural lock — Phase G
Ship `@theme { --color-*: initial; }` (a `palette-reset.css` imported after Tailwind, before the token
files) so **Tailwind's default palette stops compiling** — `text-gray-400`/`bg-blue-50` become build
errors, not lint warnings. Extend to `--radius-*: initial` / `--text-*: initial`, re-registering only
the sanctioned steps (Part A4/A5). This converts the whole standard from *CI-enforced* to
*structurally enforced*.

### F.6 Enforcement (do this first — it's free)
- Wire `lint:design` **and** `lint:token-purity` into `playwright.yml` (runs on every PR). Today the
  ratchet is `workflow_dispatch`-only — **any PR can regress silently** (AUDIT §4).
- Flip stylelint `color-no-hex` to `error` (or `--max-warnings 0`) — today it warns and exits 0.
- Add a `rawVarInComponent` category to `check-design-consistency.mjs` and count **scoped** blocks —
  the thing you care about most (raw `var()` in components) is currently unmeasured (AUDIT §7).

---

# PART G — Ordered execution plan (review, then run)

Grouped by payoff-to-effort. Tiers 0–1 are near-zero-risk and deliver the "single knob" goal; Tiers
2–3 need design input and burn-down.

### Tier 0 — Free & protective (hours)
1. Wire `lint:design` + `lint:token-purity` into `playwright.yml`; flip stylelint hex to `error`. *(F.6)*
2. Fix the `primary-950` bug in `generatePrimaryPalette`. *(C.4)*
3. Register the ~91 defined-but-unregistered `--color-*` tokens. *(D)*
4. Register the `--text-{xs,sm,base,lg,xl,2xl}` scale; delete the hand-pin in `tailwind.css:33-56`. Do **not** register more radius steps — instead codemod `rounded-xs`→`sm`, `rounded-2xl`/`-3xl`→`lg` and retire those tokens (A5), codemod `shadow-xs`→`md` and retire it (A6), and codemod the ~21 feature `border-strong`/`border-subtle` uses → `border-default` (A3). *(A4/A5/A6/A3, D, E)*
5. Delete the two false `.scss` comments; regenerate or delete the stale PLAN/PENDING docs. *(E, AUDIT §9)*

### Tier 1 — The alias kill (the actual answer to "can I change it in one place?")
6. Codemod `text-text-primary` → `text-text-heading` (+ raw `var()`); delete `-primary`; ban it. *(C.1)*
7. Fix `AppPageHeader.vue:105` → `text-text-heading`. *(C.1)*
8. Repoint the 7 `--color-typography-*` lines. *(C.4)*
9. Codemod `text-text-caption` → `text-text-secondary`; delete `-caption`. *(C.2)*
10. Disambiguate the 5-way `#a3a3a3` collapse; collapse `info-*`≡`blue-*` and the chip triplets. *(C.3, C.5)*

### Tier 2 — Structural (needs design sign-off)
11. Add the interaction-state vocabulary to `semantic.css`. *(D)*
12. Rewire `component.css`'s 301 base-palette refs through the new semantic tokens. *(F.1)*
13. **Decide the brand-colour architecture** (runtime engine vs. token files). *(C.4)* — blocks true "one knob" for brand.
14. Add dark overrides for the 45 semantic-annex tokens; fix the 3 backwards `*-hover` pairs. *(AUDIT §8.4)*
15. Mint `--color-overlay-*` + `-soft`/`-faint` tokens; introduce the chart-palette token set. *(D)*
16. **Stop registering the raw base palette** as general utilities (keep Ring 3 only). *(Part B)*

### Tier 3 — Hygiene & the lock
17. Delete the dead `note` chain + 24 ramp ends + 8 type tokens (~48). *(E)*
18. Fix `traceColors.ts` (derive from tokens); dismantle `utilities.css`'s 54 hex + manual `.dark` pairs. *(AUDIT §10)*
19. Burn down chart-hex hotspots: `components/alerts/*`, `components/traces/*`, `enterprise/onlineEvals/*` → chart-palette tokens + `chartColor()`; then rem/px sizing in `plugins/traces` + `plugins/logs`. *(offender map)*
20. **Ship Phase G** — `@theme { --color-*: initial }`. The final lock. *(F.5)*

---

## Appendix — Measurement snapshot (this audit, live tree)

- Files: 789 `.vue`. `--color-*` tokens **defined 904 / registered 747**. `--o2-*` refs: **0**.
- Adoption (utility uses): `text-text-secondary` 763 · `text-text-primary` **357** (alias) ·
  `border-border-default` 466 · `rounded-*` 1360 · `bg-surface-base` 194.
- Debt ratchet baseline totals (all **passing**, `check-design-consistency.mjs`):
  `tsHex` 463 · `stylePxUnit` 90 · `arbZ` 42 · `rawPalette` 28 · `arbPx` 25 · `unscopedStyle` 8 ·
  `styleBlockHex` 5 · `hexClass` 5 · `bareRounded` 4 · `themeTernary` 2. `text-[..px]`: **0**.
- Un-themeable hotspots (feature `.vue`): chart-colour hex in `components/alerts` (Incident* 33),
  `components/traces` (FlameGraph 12), `enterprise/onlineEvals`; decorative rgba in
  `EnterpriseUpgradeDialog.vue` (22); rem/px sizing in `plugins/traces` (SessionDetails 85) & forms.
- Confirmed shipping bugs: `primary-950` desync; `--color-actions-column-shawdow` typo;
  `traceColors.ts` 50 tokens vs 70-entry hardcoded array (1/50 match).

---

*Prepared for review. No code, tokens, CI config, or docs were modified in producing this document.*
