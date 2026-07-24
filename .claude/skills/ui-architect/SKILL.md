---
name: ui-architect
description: >-
  Authoring guardrails for building ANY new frontend UI in the OpenObserve web
  app (web/) — new views, pages, panels, dialogs, feature components, or edits
  to existing ones. Enforce six house rules the moment you write Vue/template
  markup: (1) use OPageHeader for every page/module header, (2) build UI from
  O2 library components in web/src/lib — never bare HTML controls when an O2
  equivalent exists, (3) no hardcoded px anywhere — including inside
  Tailwind class arbitrary values ([320px]) — size with rem/%/vh/vw or Tailwind's
  rem-based scale, and corner radius uses only the two-tier scale rounded-default
  (4px controls) / rounded-surface (12px surfaces) / rounded-full — never
  rounded-[..] or the retired rounded-sm/md/lg/xl, (4) no scoped-CSS blocks and no
  inline style="", (5) never hardcode colors/sizes and never reach a token by raw
  var() in a component — use the modern registered --color-* design tokens through
  their utility class (bg-x/text-x), register a new --color-* token if one is
  missing; the legacy --o2-* token vocabulary is BANNED (never write var(--o2-*),
  never define one, never add a .body--dark block — migrate any --o2-* you touch to
  its --color-* equivalent); all of this is CI-enforced and fails the build,
  (6) no hardcoded user-facing text — every label, title, placeholder, and
  message comes from i18n (useI18n t()) with keys added to
  web/src/locales/languages/en-US.json. It also settles the recurring
  structural decisions: use OTable for any tabular data, follow the
  view → service → Vuex/local-ref layering for fetching list data, choose the
  right form container (ConfirmDialog vs ODialog vs ODrawer vs a full in-page
  view) by the weight of the interaction, and build every validated form with
  OForm + a colocated Zod schema (single-source-of-truth name-bound fields, no
  v-model/ref mirrors, automatic submit/loading, correct field-array keys).
  Trigger this whenever the user asks to create, add, build, scaffold, lay out,
  validate, or restyle any screen, component, header, table, list, dialog,
  drawer, form, field, or panel in the web frontend, or asks where a
  form/table/fetch should live, how to validate a form, how to add a keyboard
  shortcut, how to build a new reusable/common O2 component when nothing existing
  fits (create one in web/src/lib instead of assembling divs and classes),
  whether something belongs in a dialog or a drawer, or where a new page should be
  listed in navigation — the left-rail menu, a Settings/IAM sub-menu, or a
  hover-flyout — how to register its route, and how to gate it for cloud /
  enterprise / RBAC — even if they don't mention
  these rules by name. If you are
  about to type <template>, a page title, a hex color, a px value, or
  <style scoped>, this skill applies.
---

# UI Architect — Frontend UI Guardrails (OpenObserve `web/`)

Use this skill whenever you build or modify user-facing UI in `web/`. It is a
**pre-flight contract**: apply it before and while you write template markup, not
as a cleanup pass afterward. The goal is that every new screen looks like it was
built by the same team on the same day — one header, one component library, one
token system, one spacing scale.

This skill governs **feature/app UI** — views under `web/src/views` and components
under `web/src/components` — built from the shared **O2 component library** in
`web/src/lib`. This page is the **contract + map**: the six laws and the
recurring structural decisions, each in a line or two, each pointing to the
reference that carries the full rationale, examples, and per-component detail.
Open the linked reference before you implement that specific thing — don't guess a
prop, a class string, or a path.

---

## The six house rules

The always-true laws. Each is stated here in brief; the full **what / why / how +
code** for all six is in [references/house-rules.md](references/house-rules.md) —
read it once, it is the backbone of everything below.

1. **Every page/module header is `OPageHeader`** — never a hand-rolled
   `<div class="header">…<h1>` or a `q-toolbar`. One header contract keeps the
   title in the same place across list → detail → edit.
2. **Build from O2 components in `web/src/lib`** — never a bare HTML control
   (`<button>`, `<input>`) or a third-party UI primitive when an `O*` equivalent
   exists. Drive them by **intent**
   (`variant` / `size` / state), never by appearance overrides.
3. **No hardcoded `px`** — size with `rem` / `%` / `vh` / `vw`, or Tailwind's
   rem-based scale. This applies **inside class arbitrary values too** (`w-[320px]`,
   `text-[13px]`, `gap-[6px]` are all banned — convert to `rem`). The only allowed
   `px` is a `1px` hairline border/divider.
   - **Font size — never `text-[..px/rem]`; pick the type-scale utility by role:**

     | Utility | px | Use for |
     |---|---|---|
     | `text-3xs` | 10 | chart axis micro-labels, dense table sub-text (charts only) |
     | `text-2xs` | 11 | tiny labels, chips, badge text |
     | `text-xs` | 12 | captions, metadata, timestamps |
     | `text-compact` | 13 | dense body / data tables |
     | `text-sm` | 14 | **default body text** (start here) |
     | `text-base` | 16 | comfortable body, form inputs |
     | `text-lg` | 18 | card / panel titles |
     | `text-xl` | 20 | section headings |
     | `text-2xl` | 24 | page / modal titles |
     | `text-3xl` | 30 | hero numbers / large display |
     | `text-4xl` | 36 | display |

     Default to `text-sm` for body. Go smaller only for genuinely dense/secondary UI,
     larger only for titles. If a design needs a size not on the scale, snap to the
     nearest step — do **not** reintroduce an arbitrary `text-[..]`.
   - **Corner radius — exactly two tiers + circle, never an arbitrary value:**
     `rounded-default` (**4px** — controls: buttons, inputs, chips, small icon
     buttons), `rounded-surface` (**12px** — surfaces: dialogs, drawers, cards,
     panels, the app-shell content area), `rounded-full` (pills / avatars / dots).
     Per-corner variants use the same names (`rounded-t-surface`, `rounded-s-default`).
     **Banned:** bare `rounded`, arbitrary `rounded-[10px]`, and the retired
     `rounded-{sm,md,lg,xl}` / `var(--radius-{sm,md,lg,xl})` (deleted — they were
     five names for one value). Pick the tier by role, not by eye.
4. **No `<style scoped>` and no inline `style=""`** — style with **bare** Tailwind
   utilities (no `tw:` prefix — it was removed). Form-field spacing is
   `class="flex flex-col gap-5"` on `<OForm>`;
   omit it and fields render cramped with no spacing (the #1 "dialog looks broken"
   bug).
5. **No literal colors or sizes — reach every value through a registered token,
   via its utility class.** Colour comes from a `--color-*` token's **token-backed
   utility** (`bg-surface-base`, `text-text-secondary`, `border-border-default`) —
   **not** a raw `var(--color-*)` in a `.vue` template/`<style>` block. A raw
   `var()` in a component is a counted bypass (`rawVarInComponent`) and is allowed
   **only** in the sanctioned residue: `:deep()`, `@keyframes`, `color-mix()`,
   `calc()`, SVG `fill`/`stroke`, and `v-html`/JS-generated markup. If a token has
   no utility, register it (`@theme inline`) rather than reaching for `var()`.
   **One knob per decision:** reuse an existing token before minting one, and never
   add a second name for a value that already has one — an alias is a decision made
   twice that silently splits adoption. The legacy **`--o2-*` vocabulary is
   BANNED** — never `var(--o2-*)`, never a new `--o2-*`, never a `.body--dark`
   block; migrate any `--o2-*` you touch. Raw Tailwind palette (`bg-gray-400`,
   `text-red-500`) does not even compile (`palette-reset.css`), and British
   `grey-*`/`primary-*` primitives in feature code are a ratcheted bypass
   (`rawProjectRamp`) — use a semantic token (`text-text-secondary`, `bg-accent`),
   not the ramp. See [references/design-tokens.md](references/design-tokens.md).

   > **All of §3–§5 are CI-enforced and FAIL the build** — `lint:design:strict`
   > (hardcoded hex/px, arbitrary radius, retired aliases, raw palette/ramp, raw
   > `var()`, un-justified `<style>`, literal font stacks), `lint:tokens`,
   > `lint:token-purity`, and `lint:styles` (stylelint) run on every PR. The strict
   > ratchet leaves **no headroom**: a bypass count can only shrink, so new
   > raw-token usage fails even in a file that still carries old debt. The
   > counters scan **raw text, comments included** — a `16px` or `#fff` in a
   > `<style>`-block comment, or a banned class quoted verbatim in a template/JS
   > comment, counts as debt; word comments in rem/plain English instead. Fix the
   > cause; don't try to raise the baseline. The flip side: a PR that *reduces*
   > debt fails strict mode with "baseline is STALE" until you lock the win in —
   > `cd web && node scripts/check-design-consistency.mjs --baseline` and commit
   > the tightened `scripts/design-debt-baseline.json` with your change.
6. **No hardcoded user-facing text** — every label, title, placeholder, tooltip,
   empty-state, toast, and validation message comes from `useI18n()`'s `t()`, with
   keys added to `web/src/locales/languages/en-US.json` (other locales follow from
   there — never hand-edit them).

   > **Three ESLint rules in `eslint.config.js` enforce this (all ERROR — they fail
   > `lint:ci`), and you see every one as you type (editor squiggles) + in
   > `npm run lint`:**
   > - **`@intlify/vue-i18n/no-missing-keys`** — a `t('some.key')` whose key is
   >   absent from `en-US.json` (it would render the literal `some.key` at runtime).
   >   When you add a `t('x.y')`, add `x.y` to `en-US.json` in the *same* change.
   >   Keys resolve against **en-US only** (the other locales are generated).
   >   Dynamically-built keys (`t(varName)`) are ignored — the rule only checks literals.
   > - **`vue/no-bare-strings-in-template`** — a hardcoded string in a `<template>`,
   >   covering both **text nodes** (`<div>Save</div>`) and **static text props**
   >   (`<OButton label="Save" />`).
   > - **`local/no-bare-bound-text-props`** (custom, in `eslint.config.js`) — hardcoded
   >   text the two rules above can't see: a **bound literal** prop (`:label="'Save'"`),
   >   a **v-text / v-html literal** (`v-text="'Save'"`), or a **mustache literal**
   >   (`{{ 'Save' }}`). So you can't dodge the check by adding a `:`, a `v-text`, or
   >   `{{ }}`. Only *bare* literals are caught — composed expressions (concatenation
   >   like `'a' + b`, ternaries, or `${…}` template interpolation) are a separate,
   >   not-yet-enforced gap.
   >
   > **The component-prop standard:** because the app is built from O2 components (not
   > raw HTML), user-facing text usually arrives through a *prop* — `label`,
   > `placeholder`, `hint`, `tooltip`, `message`, `content`, `help-text`,
   > `*-button-label`, … The exact set lives in **one place**, the `TEXT_ATTRS` array
   > in `eslint.config.js`, and feeds both the static and bound rules. **When you add
   > a component prop that carries user-facing text, add its name to `TEXT_ATTRS`** —
   > that is how the linter learns a new prop needs translating. Correct usage is
   > always `:prop="t('key')"` (or `<Comp>{{ t('key') }}</Comp>` for slots); a
   > variable binding (`:label="row.name"`) and punctuation/number/emoji-only literals
   > pass. **Non-translatable tokens** (code / units / symbols) — handle in this order:
   > (1) a letter-free glyph/number passes automatically **only in a bound / mustache /
   > v-text position** (`{{ '×' }}`, `:label="'1'"`, `v-text="'●'"`) — the bound rule
   > ignores letter-free literals. **In a plain text node or static attr it is still
   > flagged** (the built-in rule flags any char outside its allowlist, so a bare `5` or
   > `●` in `<span>…</span>` fails) — move it into `{{ … }}` or use (2); (2) a
   > **recurring** universal token — a unit (`px`, `ms`), a symbol (`×`, `→`, `$`, `fx`),
   > a decorative glyph/emoji (`●`, `🕑`), or a specific literal token (`{rows}`,
   > `./.env`, `1000`) — goes in the shared **`NON_TRANSLATABLE`** list in
   > `eslint.config.js`: one curated,
   > commented place read by BOTH rules, so no per-use comment is needed; (3) a whole
   > code-example file (SQL/PromQL syntax guide) is exempted by path; (4) only a genuine
   > one-off code token that can't move, isn't universal, and lives in a **mixed** file
   > (real UI + a few example tokens) falls back to an inline
   > `<!-- eslint-disable-next-line <rule> -->` — for a **text node**, a
   > `<!-- eslint-disable <rule> -->` … `<!-- eslint-enable <rule> -->` block instead,
   > since `disable-next-line` reports at the comment's line and misses text nodes.
   > Prefer (2) for anything that repeats; **never** exempt real UI text.

## Structural decisions

*What* to reach for and *where the code lives* — the recurring calls that
otherwise get answered differently on every screen. One line each; the full
reasoning, spacing patterns, the cancel/save standard, layering, and the
form-container split are in [references/conventions.md](references/conventions.md),
and each domain has its own reference below.

| Decision | The rule | Detail |
| --- | --- | --- |
| **Tabular data** | `OTable` + `OTableColumnDef[]`; client-side pagination unless the backend paginates a set too large to fetch whole | [core-controls-table](references/core-controls-table.md) |
| **Whole-page layout** | **Every routed view is a `OPageLayout`.** It's the ONE page component — it owns the full-height column, the header (from `:title`/`:icon`/`:subtitle`/`:back` props + `#actions`/`#header-tabs`), an optional `#subnav` strip, an optional `#sidebar` rail (fixed or `resizable`), and the body's inset. You plug in data; there's no place to hand-roll a padded `<div>`. Body is inset to the page-edge grid by default — pass **`bleed`** for a full-bleed body (an `OTable`, a chart, a `router-view` shell), or **`constrained`** for a centered reading column (forms). The `#header` slot is a rare escape hatch only. | [page-recipes](references/page-recipes.md) |
| **Content inset** | `OPageLayout` already insets the body. Anywhere else (a panel, a dialog section, one tab's content) wrap it in **`OContent`** (bakes the one `px-page-edge` grid line, the primitive `OPageLayout` uses internally) instead of hand-picking `px-2`/`px-4`/`p-2.5`; pass `bleed` (or `bleed-x`/`bleed-y`) for full-bleed content that owns its own edge — same escape-hatch idea as `ODrawer`/`ODialog` `bleed`. Never hand-roll a content inset. | [conventions](references/conventions.md) |
| **Tab strips** | an `OTabs` strip needs **no** horizontal wrapper padding — the first tab's label self-aligns to the `px-page-edge` grid, so it lines up with the `OContent` body below it. Put the strip's bottom divider on the strip (`border-b`) and give it no `px-*`; wrapping a tab strip in `px-page-edge` double-insets the labels. | [conventions](references/conventions.md) |
| **Listing toolbar** | every list carries three affordances — search + filters (`#toolbar`), refresh (`#toolbar-trailing`), and the auto-injected column-visibility toggle; empty state is one `OEmptyState` with `:filtered` | [page-recipes](references/page-recipes.md) |
| **Data fetching** | view → domain service (`src/services`, via the `http.ts` wrapper) → Vuex (shared/cached) or local `ref` (ephemeral); never call `http`/axios from a component | [conventions](references/conventions.md) |
| **Form container** | confirm → `ConfirmDialog`; short form → `ODialog`; tall or contextual form → `ODrawer`; primary multi-section flow → a full in-page view. Use `ODialog` / `ODrawer` for these | [conventions](references/conventions.md) |
| **Form validation** | `OForm` + a colocated Zod `<Form>.schema.ts`; fields are `OForm*` bound **only by `name=`** (no `v-model`/`ref` mirror, no `formData`); submit + loading automatic; payload built with explicit keys; field arrays use `:key="index"` | [forms-validation](references/forms-validation.md) |
| **New page in nav** | a route **+ exactly one** surface (rail item / flyout child / Settings / IAM sub-page) **+** an env/role gate — the route condition, the nav-entry gate, and the SectionRail `visible` all express the same rule | [navigation-menus](references/navigation-menus.md) |
| **Keyboard shortcuts** | registry-driven — declare in `shortcutRegistry.ts`, bind with `useShortcuts([{ id, handler }])`; never an ad-hoc `keydown` listener or a hardcoded `⌘N` in a template | [keyboard-shortcuts](references/keyboard-shortcuts.md) |
| **Cancel / Save row** | cancel = `variant="outline"`, save = `variant="primary"`, both `size="sm-action"`, spaced with `gap-2` on the parent | [conventions](references/conventions.md) |
| **Nothing fits** | build a reusable component — generic primitive → a new `O*` in `web/src/lib`; app-specific composition → a named component in `web/src/components`. Never hand-assemble `<div>` + utility classes to fake a component | [creating-components](references/creating-components.md) |

**Dark mode is automatic** — every O2 component and token resolves correctly in
both themes. Never branch on `store.state.appTheme` around an O2 component; if
something looks wrong in dark mode, the fix is a token value in `dark.css`, not a
per-component conditional.

## Colour that means something — the "Calm Signal" language

`design-tokens.md` (rule 5) is *how* to colour; this is *when* and *what*. One
rule: **colour is information, never decoration** — a calm neutral canvas, with
saturated colour spent only on the one signal each screen exists to surface.
Which signal that is changes by page type (**monitoring** = state/severity;
**catalog** = category/recency/ownership; **access** = role; **forms** =
progress/validity), and you colour it with the shared toolkit — `OStatStrip` /
`OStatCard` summary tiles (optionally filter tiles, via `OTable`'s `#subheader`
slot), `OTag` chips from `badgeGroups.ts`, a row state rail + light
exception-only highlight, recency-aware `OTimeCell`, `OUserCell` avatars. Keep
everything else quiet: highlight exceptions not the norm, muted `0`/`—`,
border-not-fill selection, one primary action, no layout shift. Full playbook +
per-archetype recipes: [references/calm-signal.md](references/calm-signal.md).
Reference implementation: the Alerts list
(`web/src/components/alerts/AlertList.vue`).

## Pick a component

The **scenario → component** index and the per-file catalog (what each `O*` is,
when to reach for it, and which reference holds its exact props / slots / emits)
are in [references/component-catalog.md](references/component-catalog.md). Open the
relevant reference before writing markup — the props are the source of truth,
don't guess a name.

---

## Pre-flight checklist

Run this in your head before writing template markup, and again before
considering the UI done:

- [ ] Page/module header is `OPageHeader` (not a hand-built header bar).
- [ ] Every interactive control is an O2 component if one exists in
      `web/src/lib` — no bare HTML controls or third-party primitives with an O2 equivalent.
- [ ] A self-contained/repeated UI element with no matching component was
      **built as a reusable component** (generic → `O*` in `web/src/lib`;
      app-specific → named component in `web/src/components`), not hand-assembled
      from `<div>` + utility classes. Classes are for layout only.
- [ ] Tabular data uses `OTable` with `OTableColumnDef[]` columns; server mode
      only for backend-paginated data.
- [ ] Listing page uses the **full-height flush skeleton** (root
      `flex flex-col h-full p-0`, header `shrink-0 border-b` — OPageHeader bakes
      in its own `px-page-edge`, never add a `px-*`, table wrapper
      `card-container flex-1 min-h-0 overflow-hidden`, `OTable :frame="false"`) —
      not a `p-6` padded container; table runs flush.
- [ ] Listing page has all three toolbar affordances: **search + filters**
      (`#toolbar`, `:show-global-filter="false"`), **refresh**
      (`#toolbar-trailing`, wired to fetch), and the **column show/hide toggle**
      (`:persist-columns` + `table-id` + a `hideable` column). Non-essential
      columns hidden by default via `:column-visibility`.
- [ ] Empty state is a single `OEmptyState` with a `preset` + **`:filtered`**
      (search/filter active) + `@action` resetting on `clear-filters`; `#error` if
      fetch can fail.
- [ ] Page is **registered in navigation** (route + one of rail item / Settings
      sub-page / flyout child) and **gated** for env/role
      (`config.isEnterprise` / `config.isCloud` / `zoConfig.*`), with the route,
      nav-entry gate, and SectionRail `visible` all in sync
      (see [navigation-menus.md](references/navigation-menus.md)).
- [ ] Data fetched through a domain service (`src/services`), not raw `http` in
      the component; shared data in Vuex, ephemeral data in local refs.
- [ ] Form container matches weight: confirm → `ConfirmDialog`, short form →
      `ODialog`, large/contextual form → `ODrawer`, primary multi-section flow →
      full page.
- [ ] Validated form uses `OForm` + a colocated Zod `<Form>.schema.ts`; every
      control inside is an `OForm*` addressed only by `name=` (no `v-model`/`ref`
      mirror, no `formData`), required via the `required` prop.
- [ ] Save is `type="submit"` (inline) or `form-id`↔`OForm id` (overlay); no
      manual `useLoading`/`:loading` and Save is not disabled on invalid.
- [ ] Payload built with explicit keys (not `{ ...value }`); numeric inputs
      coerced. Field arrays use `:key="index"` + a non-last-row delete test.
- [ ] Zero `px` values (except a `1px` hairline) — including inside class
      arbitrary values (`w-[320px]`, `text-[13px]`). Sizes use rem / % / vh / vw
      or Tailwind's rem scale.
- [ ] **Spacing copies a sibling, never invented per page** — padding/margins/
      gaps and card surface classes are taken verbatim from the sibling panel
      family the screen joins (`card-container` alone styles nothing — cards
      need explicit `bg-* border-* rounded-*` classes). A page of stacked
      panels uses the full-height split (`flex-1 min-h-0` cards + fill-height
      tables) so the page itself never scrolls — see
      [conventions § Cards & stacked-panel pages](references/conventions.md).
- [ ] Corner radius is `rounded-default` / `rounded-surface` / `rounded-full`
      only — no bare `rounded`, no `rounded-[..]`, no retired
      `rounded-{sm,md,lg,xl}`.
- [ ] No `<style scoped>` block added. No `style="…"` attribute added.
- [ ] No literal colors anywhere. Colours come from `--color-*` token **utilities**
      (`bg-surface-base`, `text-text-secondary`) — not a raw `var(--color-*)` in a
      component (that's a `rawVarInComponent` bypass, allowed only in `:deep`,
      keyframes, `color-mix`, `calc`, SVG `fill`/`stroke`, `v-html`). No raw
      Tailwind palette (`bg-gray-*`) and no raw `grey-*`/`primary-*` ramp — use a
      semantic token.
- [ ] **Calm Signal** — the screen's *primary signal* is coloured (state /
      category / role / progress) via the shared toolkit (`OStatStrip`/`OStatCard`,
      `OTag` chips, row rail + exception tint, relative `OTimeCell`), and the rest
      stays calm: exceptions highlighted not the norm, muted `0`/`—`,
      border-not-fill selection, no layout shift. See
      [references/calm-signal.md](references/calm-signal.md).
- [ ] `cd web && npm run lint:design:strict` passes (the strict ratchet — no new
      raw-token bypass anywhere, even in files with existing debt).
- [ ] **No `--o2-*` anywhere** — no `var(--o2-*)`, no new `--o2-*` definition, no
      `.body--dark` block. Any `--o2-*` in code you touched was migrated to its
      `--color-*` equivalent.
- [ ] Any new color/size needed was **registered as a `--color-*` token** (light
      `:root` + `@theme inline` + dark under `.dark`) before use.
- [ ] No hardcoded user-facing text **and** no `t()` key missing from the locale
      file — every label, title, placeholder, message, and validation string (whether
      a text node, a static prop `label="…"`, a bound prop `:label="'…'"`, a
      `{{ '…' }}` mustache, or `v-text`) uses
      `t()` with the key added to `web/src/locales/languages/en-US.json` in the same
      change. Enforced by three ESLint rules, all **error** (`no-missing-keys`,
      `vue/no-bare-strings-in-template`, `local/no-bare-bound-text-props`) — a clean
      `cd web && npm run lint`. New text-carrying component prop → add it to
      `TEXT_ATTRS` in `eslint.config.js`.
- [ ] `data-test` on every interactive and key output element, pattern
      `<module>-<filename>-<descriptor>` (see the project FE rules).
- [ ] New component uses `<script setup lang="ts">`, no `// @ts-nocheck`.
- [ ] `cd web && npm run lint && npm run type-check` pass.

## When a rule can't be satisfied

Don't quietly break a rule — the fix is almost always "extend the shared thing,
not the call site":

- Missing O2 component → **build a new reusable component**, don't reconstruct it
  from divs + classes at the call site. Generic primitive → a new `O*` in
  `web/src/lib`; app-specific composition → a named component in
  `web/src/components`. When *migrating* an existing element and can't build it
  yet, keep the current element in place and flag it. Never
  substitute a bare `<div>`. See
  [references/creating-components.md](references/creating-components.md) and the
  "No component fits?" section of [references/conventions.md](references/conventions.md).
- Missing O2 variant → add the variant to the component source, then use it.
- Missing token → register it in the token CSS (rule 5), then use it.
- `OPageHeader` can't express the header → change `OPageHeader`, not the page.

If you genuinely believe a rule shouldn't apply to a specific case, say so
explicitly and explain why, rather than silently introducing a `px`, a hex, or a
scoped style.
