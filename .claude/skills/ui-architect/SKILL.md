---
name: ui-architect
description: >-
  Authoring guardrails for building ANY new frontend UI in the OpenObserve web
  app (web/) — new views, pages, panels, dialogs, feature components, or edits
  to existing ones. Enforce six house rules the moment you write Vue/template
  markup: (1) use AppPageHeader for every page/module header, (2) build UI from
  O2 library components in web/src/lib — never raw Quasar or bare HTML controls
  when an O2 equivalent exists, (3) no hardcoded px anywhere — including inside
  Tailwind class arbitrary values ([320px]) — size with rem/%/vh/vw or Tailwind's
  rem-based scale, (4) no scoped-CSS blocks and no inline style="", (5) never
  hardcode colors/sizes — use the modern registered --color-* design tokens and
  register a new --color-* token if one is missing; the legacy --o2-* token
  vocabulary is BANNED (never write var(--o2-*), never define one, never add a
  .body--dark block — migrate any --o2-* you touch to its --color-* equivalent),
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
  about to type <template>, q-page, a page title, a hex color, a px value, or
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

1. **Every page/module header is `AppPageHeader`** — never a hand-rolled
   `<div class="header">…<h1>` or a `q-toolbar`. One header contract keeps the
   title in the same place across list → detail → edit.
2. **Build from O2 components in `web/src/lib`** — never a Quasar primitive
   (`q-btn`, `q-input`, `q-select`, `q-table`, …) or a bare HTML control
   (`<button>`, `<input>`) when an `O*` equivalent exists. Drive them by **intent**
   (`variant` / `size` / state), never by appearance overrides.
3. **No hardcoded `px`** — size with `rem` / `%` / `vh` / `vw`, or Tailwind's
   rem-based scale. This applies **inside class arbitrary values too** (`w-[320px]`,
   `text-[13px]`, `gap-[6px]` are all banned — convert to `rem`). The only allowed
   `px` is a `1px` hairline border/divider.
4. **No `<style scoped>` and no inline `style=""`** — style with **bare** Tailwind
   utilities (no `tw:` prefix — it was removed; no Quasar `q-*` utilities — not
   available). Form-field spacing is `class="flex flex-col gap-5"` on `<OForm>`;
   omit it and fields render cramped with no spacing (the #1 "dialog looks broken"
   bug).
5. **No literal colors or sizes** — use the registered `--color-*` design tokens
   (token-backed utilities like `bg-surface-base` / `text-text-secondary`, or
   `var(--color-*)`); register a new `--color-*` if one is missing. The legacy
   **`--o2-*` vocabulary is BANNED** — never `var(--o2-*)`, never a new `--o2-*`,
   never a `.body--dark` block; migrate any `--o2-*` you touch. Token files are
   maintained on the tokens branch — see
   [references/design-tokens.md](references/design-tokens.md).
6. **No hardcoded user-facing text** — every label, title, placeholder, tooltip,
   empty-state, toast, and validation message comes from `useI18n()`'s `t()`, with
   keys added to `web/src/locales/languages/en-US.json` (other locales follow from
   there — never hand-edit them).

## Structural decisions

*What* to reach for and *where the code lives* — the recurring calls that
otherwise get answered differently on every screen. One line each; the full
reasoning, spacing patterns, the cancel/save standard, layering, and the
form-container split are in [references/conventions.md](references/conventions.md),
and each domain has its own reference below.

| Decision | The rule | Detail |
| --- | --- | --- |
| **Tabular data** | `OTable` + `OTableColumnDef[]` (never `q-table`); client-side pagination unless the backend paginates a set too large to fetch whole | [core-controls-table](references/core-controls-table.md) |
| **Whole-page layout** | `AppPageHeader` on top; a listing page is full-bleed — `flex flex-col h-full p-0`, header owns the padding, table runs flush. `p-6`/`gap-6` only for form/detail views | [page-recipes](references/page-recipes.md) |
| **Listing toolbar** | every list carries three affordances — search + filters (`#toolbar`), refresh (`#toolbar-trailing`), and the auto-injected column-visibility toggle; empty state is one `OEmptyState` with `:filtered` | [page-recipes](references/page-recipes.md) |
| **Data fetching** | view → domain service (`src/services`, via the `http.ts` wrapper) → Vuex (shared/cached) or local `ref` (ephemeral); never call `http`/axios from a component | [conventions](references/conventions.md) |
| **Form container** | confirm → `ConfirmDialog`; short form → `ODialog`; tall or contextual form → `ODrawer`; primary multi-section flow → a full in-page view. Never `q-dialog`/`q-drawer` | [conventions](references/conventions.md) |
| **Form validation** | `OForm` + a colocated Zod `<Form>.schema.ts`; fields are `OForm*` bound **only by `name=`** (no `v-model`/`ref` mirror, no `formData`); submit + loading automatic; payload built with explicit keys; field arrays use `:key="index"` | [forms-validation](references/forms-validation.md) |
| **New page in nav** | a route **+ exactly one** surface (rail item / flyout child / Settings / IAM sub-page) **+** an env/role gate — the route condition, the nav-entry gate, and the SectionRail `visible` all express the same rule | [navigation-menus](references/navigation-menus.md) |
| **Keyboard shortcuts** | registry-driven — declare in `shortcutRegistry.ts`, bind with `useShortcuts([{ id, handler }])`; never an ad-hoc `keydown` listener or a hardcoded `⌘N` in a template | [keyboard-shortcuts](references/keyboard-shortcuts.md) |
| **Cancel / Save row** | cancel = `variant="outline"`, save = `variant="primary"`, both `size="sm-action"`, spaced with `gap-2` on the parent (never `q-ml-*`/`<q-space>`) | [conventions](references/conventions.md) |
| **Nothing fits** | build a reusable component — generic primitive → a new `O*` in `web/src/lib`; app-specific composition → a named component in `web/src/components`. Never hand-assemble `<div>` + utility classes to fake a component | [creating-components](references/creating-components.md) |

**Dark mode is automatic** — every O2 component and token resolves correctly in
both themes. Never branch on `store.state.appTheme` around an O2 component; if
something looks wrong in dark mode, the fix is a token value in `dark.css`, not a
per-component conditional.

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

- [ ] Page/module header is `AppPageHeader` (not a hand-built header bar).
- [ ] Every interactive control is an O2 component if one exists in
      `web/src/lib` — no stray `q-*` or bare HTML controls with an O2 equivalent.
- [ ] A self-contained/repeated UI element with no matching component was
      **built as a reusable component** (generic → `O*` in `web/src/lib`;
      app-specific → named component in `web/src/components`), not hand-assembled
      from `<div>` + utility classes. Classes are for layout only.
- [ ] Tabular data uses `OTable` with `OTableColumnDef[]` columns (never
      `q-table`); server mode only for backend-paginated data.
- [ ] Listing page uses the **full-height flush skeleton** (root
      `flex flex-col h-full p-0`, header `shrink-0 px-4 border-b`, table wrapper
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
- [ ] No `<style scoped>` block added. No `style="…"` attribute added.
- [ ] No literal colors anywhere. Colors come from `--color-*` token utilities /
      `var(--color-*)`.
- [ ] **No `--o2-*` anywhere** — no `var(--o2-*)`, no new `--o2-*` definition, no
      `.body--dark` block. Any `--o2-*` in code you touched was migrated to its
      `--color-*` equivalent.
- [ ] Any new color/size needed was **registered as a `--color-*` token** (light
      `:root` + `@theme inline` + dark under `.dark`) before use.
- [ ] No hardcoded user-facing text — every label, title, placeholder, message,
      and validation string uses `t()` with keys added to
      `web/src/locales/languages/en-US.json`.
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
  yet, keep the current Quasar/HTML element in place and flag it. Never
  substitute a bare `<div>`. See
  [references/creating-components.md](references/creating-components.md) and the
  "No component fits?" section of [references/conventions.md](references/conventions.md).
- Missing O2 variant → add the variant to the component source, then use it.
- Missing token → register it in the token CSS (rule 5), then use it.
- `AppPageHeader` can't express the header → change `AppPageHeader`, not the page.

If you genuinely believe a rule shouldn't apply to a specific case, say so
explicitly and explain why, rather than silently introducing a `px`, a hex, or a
scoped style.
