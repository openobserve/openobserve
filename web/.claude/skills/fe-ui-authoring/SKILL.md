---
name: fe-ui-authoring
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
  web/src/locales/languages/en.json. It also settles the recurring
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
  fits (create one in web/src/lib instead of assembling divs and classes), or
  whether something belongs in a dialog or a drawer — even if they don't mention
  these rules by name. If you are
  about to type <template>, q-page, a page title, a hex color, a px value, or
  <style scoped>, this skill applies.
---

# Frontend UI Authoring Guardrails (OpenObserve `web/`)

Use this skill whenever you build or modify user-facing UI in `web/`. It is a
**pre-flight contract**: apply it before and while you write template markup, not
as a cleanup pass afterward. The goal is that every new screen looks like it was
built by the same team on the same day — one header, one component library, one
token system, one spacing scale.

This skill governs **feature/app UI** — views under `web/src/views` and
components under `web/src/components` — built from the shared **O2 component
library** in `web/src/lib`. It is self-contained: the five styling rules, the
structural decisions (tables, layering, form containers), and a **full
per-component catalog** (what each O2 component is, when to reach for it, and how
to use it) all live here.

The catalog is split across the [`references/`](references/) files — see
[§ Component catalog](#component-catalog) for the scenario→component index and
which reference file to open for any given component.

---

## The house rules

Each rule below states **what**, **why**, and **how**. The "why" matters: these
aren't arbitrary — each one exists because breaking it produces a specific,
recurring class of bug or drift in this codebase.

### 1. Every page/module header is `AppPageHeader`

**What.** The top of any routed view or module screen (title + icon + actions,
optionally tabs/breadcrumb/back) is rendered by `AppPageHeader`, never a
hand-rolled `<div class="header">…<h1>…` or a bespoke `q-toolbar`.

```vue
<script setup lang="ts">
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import OButton from "@/lib/core/Button/OButton.vue";
</script>

<template>
  <AppPageHeader
    :title="t('dashboard.header')"
    icon="dashboard"
    :subtitle="t('dashboard.subtitle')"
  >
    <template #actions>
      <OButton variant="primary" size="sm" icon-left="add" @click="addDashboard">
        {{ t("dashboard.add") }}
      </OButton>
    </template>
  </AppPageHeader>
</template>
```

**Why.** `AppPageHeader` encodes a single header contract used app-wide: row 1 is
a fixed-height band (icon tile + `<h1>` + right-aligned actions); row 2 shows
**exactly one** of peer tabs, an ancestor breadcrumb, or a plain tagline. Every
hand-built header silently re-litigates title font size, icon tile geometry,
back-button placement, and the tab underline — and drifts. Reusing the component
keeps the title's X/Y position identical as a user navigates list → detail →
edit, which is the whole point.

**How.**
- The component is `AppPageHeader`, at
  `web/src/components/common/AppPageHeader.vue`. Its full API — props, slots, and
  the one-row-content contract — is documented in this rule (below), so you can
  use it correctly without opening the file.
- Props: `title`, `subtitle`, `icon` (an `IconName` from
  `@/lib/core/Icon/OIcon.icons`), `breadcrumb` (`BreadcrumbItem[]`),
  `breadcrumbMaxInline`, `back` (`{ label, to | onClick, dataTest }`),
  `tabsBelow`.
- Slots: `title-prefix`, `title`, `subtitle`, `title-trail`, `actions`, `tabs`,
  `back`.
- Put page actions in `#actions` using O2 components. Do not add your own
  `border-b`, height, or padding around it — the header owns its own chrome.
- **Do not** style `AppPageHeader` from the outside with utility classes or a
  wrapper trying to change its internals. If it can't express what a page needs,
  that's a change to `AppPageHeader` itself, not a per-page override.

### 2. Build from O2 components in `web/src/lib`

**What.** Compose UI out of the O2 library (`O*` components in
`web/src/lib/**`). Do not reach for a Quasar primitive (`q-btn`, `q-input`,
`q-select`, `q-dialog`, `q-table`, `q-tabs`, …) or a bare HTML control
(`<button>`, `<input>`, `<select>`, `<textarea>`, `<a>` used as a button) when an
O2 equivalent exists.

**Why.** O2 components have design decisions baked in — radius, color, focus
ring, dark-mode tokens, spacing, disabled/loading states. A raw `q-btn` or
`<button>` re-introduces all of those as per-call-site choices, which is exactly
how a UI ends up with nine slightly different buttons. Baked-in design is the
feature, not a limitation.

**How.**
- Pick the right component from the [§ Component catalog](#component-catalog) —
  it maps scenarios to components and links the reference file with each one's
  props, slots, and a usage example.
- The `web/src/lib` folder is the ultimate source of truth. To confirm a
  component exists or read its exact props, check its `.types.ts`:
  ```bash
  find web/src/lib -name 'OButton.vue'     # locate a component
  # then read the sibling OButton.types.ts for its real prop/variant/size list
  ```
- Import by full path — there is no barrel:
  `import OButton from "@/lib/core/Button/OButton.vue";`
- Pass only documented props (check `O{Name}.types.ts`) — typically `size`,
  `variant`, and state props (`disabled`, `loading`). Do **not** hunt for a
  `rounded`/`color`/`flat` prop to reshape it; those overrides don't exist by
  design (see [§ Working with O2 components](#working-with-o2-components)).
- **If no O2 equivalent exists:** do NOT drop to a bare `<div>`/`<button>` to
  fake it, and do NOT hand-assemble the element from utility classes. When
  migrating, keep the existing Quasar component (or native element) in place and
  flag that a new O2 component is needed. When building **new** UI, create a
  reusable component instead — see
  [§ No component fits? Build a reusable one](#no-component-fits-build-a-reusable-one--dont-assemble-raw-classes).
  An unstyled `div` is worse than an honest `q-btn`.

### 3. No hardcoded `px`

**What.** Never size anything in `px`. Use `rem` for type/spacing/dimensions,
`%` for parent-relative sizing, `vh`/`vw` for viewport-relative sizing — or,
preferably, Tailwind's spacing/size utilities (which are already rem-based).

```vue
<!-- avoid --> <div style="width: 320px; margin-top: 12px">
<!-- prefer --> <div class="w-80 mt-3">        <!-- 20rem / 0.75rem -->
<!-- or   -->  <div class="w-[20rem] mt-[0.75rem]">
```

**Why.** `px` ignores the user's root font size and breaks the app's ability to
scale type and density consistently. The whole spacing system is rem-based; a
stray `px` value is a value that won't move when everything else does. Tailwind's
numeric scale (`p-3`, `w-80`, `gap-2`) already maps to rem, so preferring
utilities usually removes the temptation entirely.

**How.**
- Reach for a Tailwind utility first — **bare, no `tw:` prefix** (`p-3`, `w-80`,
  `gap-2`). The numeric scale is `0.25rem`-based: `2 → 0.5rem`, `4 → 1rem`, etc.
- Need an exact value not on the scale? Use a **rem** arbitrary value:
  `h-[1.375rem]`, never `h-[22px]`. This applies **inside class strings**
  too — a `px` unit in a Tailwind arbitrary value (`w-[320px]`, `text-[13px]`,
  `gap-[6px]`) is just as banned as a `px` in a `style=""`. Convert to rem
  (divide by 16: `320px → 20rem`, `22px → 1.375rem`, `6px → 0.375rem`).
- **The only accepted `px` is a `1px` hairline border/divider.** Every other `px`
  — inline, in a `<style>` block, or in a class arbitrary value — is a smell.

### 4. No scoped CSS — style with bare Tailwind utilities

**What.** Do not add `<style scoped>` blocks. Style layout/spacing with **bare
Tailwind utility classes** (`flex flex-col gap-4 p-6`). **Two things are banned:**
- ❌ the **`tw:` prefix** — it was removed from this project; `tw:flex` no longer
  resolves. Write `flex`, not `tw:flex`.
- ❌ **Quasar utilities** — `q-pa-md`, `q-gutter-lg`, `q-mb-sm`, `row`, `col`,
  `text-weight-bold`, `items-center` as a Quasar class, etc. are NOT available.

Prefer utility classes over inline `style=""`. Reserve inline `style` for the
rare dynamic value that must be computed in JS (and even then, prefer a bound
class or CSS custom property).

**Why.** Scoped CSS is a per-file invisible override that forks the design system
one component at a time. Utility classes keep spacing on one rem-based scale and
read the same across every screen. Inline `style` blocks carry no token and beat
everything — they're the last resort, not the default.

**How.**
- **Layout & spacing**: bare Tailwind utilities on the element:
  ```vue
  <div class="flex flex-col gap-4 p-6">
    <div class="flex items-center justify-between gap-2">Content</div>
  </div>
  ```
  This is the exact pattern real components use (e.g. `ModelPricingEditor.vue`,
  `AddRegexPattern.vue`): `class="flex flex-col gap-4"`, `class="flex items-center gap-2"`.
- **Colors**: use token-backed utilities (`bg-surface-subtle`,
  `text-text-secondary`, `border-border-default`) or, when a raw value is
  unavoidable, the CSS custom property `var(--color-*)`. Never a hex/rgb literal.
- **Form field spacing**: put `class="flex flex-col gap-5"` (or `gap-6`) on the
  `<OForm>` — `class`/`style` fall through to its root `<form>`, so its direct
  children (the `OFormInput`/`OFormSelect` fields) get even vertical spacing.
  **Without a gap class on OForm, fields render flush with no spacing** — this is
  the #1 cause of "the dialog/drawer has no spacing".
- **Never use**:
  - ❌ `tw:flex`, `tw:gap-2`, `tw:p-4` — the `tw:` prefix is dead; drop it → `flex gap-2 p-4`
  - ❌ `q-pa-md`, `q-gutter-lg`, `row`, `col`, `text-weight-bold` (Quasar — not available)
  - ❌ `#fff`, `rgb(...)` literals (use token utilities or `var(--color-*)`)
  - ❌ `px` for sizing except `1px` borders (use the rem-based scale)
- **For O2 components**: pass only `variant` / `size` props — never patch
  appearance with inline styles or ad-hoc classes.

### 5. No hardcoded colors or sizes — use registered tokens

**What.** Never write a literal color (`#2b2d30`, `rgb(...)`, `rgba(...)`,
`hsl(...)`, named colors) or a magic dimension inline. Use the project's design
tokens. If the token you need doesn't exist, **register it** in the token CSS
first, then use it.

**Why.** Tokens are what make the app theme-aware. A literal `#fff` is invisible
in dark mode and can't be retuned globally; a token (`text-text-primary`,
`bg-surface-base`, `var(--color-*)`) resolves to the right value in both themes
and changes everywhere at once when design updates it. Hardcoding a color is
opting a single element out of theming permanently.

**How — using tokens.**
- Prefer **token-backed Tailwind utilities**: `text-text-primary`,
  `bg-surface-base`, `bg-surface-subtle`, `border-border-default`,
  `text-text-secondary`, `text-text-muted` — theme-aware by construction.
- When a raw variable is unavoidable, use the modern CSS custom property
  `var(--color-*)` (e.g. in a bound `:style` for a computed value).
- **Only `--color-*` tokens** — see the `--o2-*` ban below.

**How — registering a NEW token / the `--o2-*` ban.** Full details, the token-file
layout, the 3-step registration, and the `--o2-*` → `--color-*` migration map are
in [references/design-tokens.md](references/design-tokens.md). The rules that must
stay top-of-mind:

- New tokens are **`--color-*` only** — light value in `:root`, registered in the
  same file's `@theme inline` block, dark override in `dark.css` under `.dark`
  (never `.body--dark`). Token files live in `web/src/lib/styles/tokens/`.
- **The `--o2-*` vocabulary is banned — never use it, never add to it.** No
  `var(--o2-*)` (not in a `<style>` block, not in a Tailwind arbitrary value like
  `bg-[var(--o2-card-bg)]`, not in `:style`); no new `--o2-*` definition; no
  `.body--dark` block. It is a legacy set being deleted, with lint/CI that fails
  the build on any `--o2-*`.
- **If you touch code that references an `--o2-*` token, migrate it** to its
  `--color-*` equivalent (the map is in the reference — e.g. `--o2-text-primary` →
  `--color-text-primary`, `--o2-border` → `--color-border-default`,
  `--o2-primary-background` → `--color-surface-base`). If a mapping is unclear,
  flag it rather than leaving the `--o2-*`.

### 6. No hardcoded user-facing text — use i18n

**What.** Every string a user can read — page titles, field labels, button text,
placeholders, tooltips, empty-state copy, toast/notification messages, and
validation messages — comes from the i18n layer via `useI18n()`'s `t()`, keyed
into `web/src/locales/languages/en.json`. Never write a display string literally
in a template or script.

**Why.** The app ships in many languages; a hardcoded string is invisible to
translation and silently serves English to every locale. Centralizing copy in
`en.json` also keeps wording consistent and reviewable. It's the same principle as
tokens and variants — a user-facing value lives in one shared place, never
scattered as a literal at the call site.

**How.**
- `const { t } = useI18n()` in setup; `{{ t('module.key') }}` in templates,
  `t('module.key')` in script. Group keys under a sensible namespace
  (e.g. `notificationChannels.title`).
- Add new keys **only** to `web/src/locales/languages/en.json` — the other
  language files follow from there; never hand-edit them.
- **Validation messages** get localized too: pass `t` into the Zod schema factory
  (`make…Schema(t)`) so rule messages come from `en.json` — see
  [references/forms-validation.md](references/forms-validation.md).
- **Shortcut descriptions** are i18n keys (`shortcuts.actions.*`) — see
  [references/keyboard-shortcuts.md](references/keyboard-shortcuts.md).
- Not user-facing text, so these stay literal: `data-test` values, `name=` field
  keys, icon names, CSS/utility classes, and developer-only console logs.

---

## Spacing, Alignment & Layout Patterns

All spacing uses **bare Tailwind utilities** (`flex flex-col gap-*`, `p-*`,
`mb-*`), never inline `style`, never `tw:`/`q-*`. The rem-based scale keeps every
screen on the same rhythm: `gap-2` = 0.5rem, `gap-4` = 1rem, `gap-5` = 1.25rem,
`gap-6` = 1.5rem, `p-6` = 1.5rem.

### Listing Pages (OTable, Lists, Grids)

- Page container: `class="flex flex-col gap-6 p-6"` — one padding, one gap for
  the whole page. Sections (header, table) sit as direct children.
- Action columns: keep tight — `class="flex gap-1"` around small icon buttons.
  Don't bloat rows with wide gaps.
- Headers use `AppPageHeader` — no custom title styling.
- Table columns: left-align text, center-align toggles/badges/counts (via the
  column `meta.align`).
- **No border or background around the table.** The table renders flush — no
  outer box. Pass `:frame="false"` on the `<OTable>` (its default, but be
  explicit) and don't wrap it in a bordered or `bg-*` card. A parent border or
  background double-frames it. See the **Tables → OTable** rule below for detail.
- Search + refresh + new: group in the header `#actions` slot with
  `class="flex items-center gap-2"`. Never wrap the search input in its own card.

### Dialog Spacing (`ODialog`)

- Title comes from the `:title` prop — don't render a manual `<h*>` title.
- ODialog already pads its body — **don't add a wrapper with extra padding.**
- **Field spacing lives on `<OForm>`:** `class="flex flex-col gap-5"`. Its
  `class` falls through to the root `<form>`, so the `OFormInput`/`OFormSelect`
  children space evenly. **Omitting this is why a dialog looks cramped with no
  spacing between fields** — the single most common bug.
- Tight sub-groups (a label + its custom control, header key/value rows): wrap in
  `class="flex flex-col gap-2"` or `class="flex items-end gap-2"`.
- Footer: use ODialog's `:primary-button-label` / `:secondary-button-label` +
  `:form-id` — never hand-roll or restyle footer buttons.

### Drawer Spacing (`ODrawer`)

- **Detail (read-only) section** at the top: group facts in token-backed cards —
  `class="flex flex-col gap-1.5 p-3 rounded-md bg-surface-subtle"` per card
  (label + value). Only distinct groups get a background; don't shade every line.
- **Separate detail from the edit form** with a divider on the detail wrapper:
  `class="… mb-8 pb-8 border-b border-border-default"`.
- **Section heading** for the form: `class="text-base font-semibold mb-4"`.
- **Edit form**: same as a dialog — `class="flex flex-col gap-5"` on `<OForm>`.
- Footer: same `:primary-button-label` / `:secondary-button-label` + `:form-id`
  pattern as ODialog. Don't restyle the buttons.

### Keyboard Shortcuts Pattern

All pages that need shortcuts must register them in the **shortcut registry** (`shortcutRegistry.ts`), not inline:

1. **Add to registry** (`web/src/lib/vue-shortcut-manager/shortcutRegistry.ts`):
   ```typescript
   {
     pageKey: "shortcuts.pages.yourPage",
     scope: "your-page-scope",
     shortcuts: [
       { id: "yourPageNew", key: "n", descriptionKey: "shortcuts.actions.yourPageNew" },
       { id: "yourPageSearch", key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
       { id: "yourPageRefresh", key: "r", descriptionKey: "shortcuts.actions.yourPageRefresh" },
     ],
   }
   ```

2. **Add i18n keys** (`web/src/locales/languages/en.json` → `shortcuts.pages` and `shortcuts.actions`):
   ```json
   "pages": { "yourPage": "Your Page Name" },
   "actions": {
     "yourPageNew": "Create new item",
     "yourPageRefresh": "Refresh list"
   }
   ```

3. **Register handlers in component** using `useShortcuts()` with guards:
   ```typescript
   import { useShortcuts } from "@/lib/vue-shortcut-manager";
   import { isInputFocused, focusSearchInput } from "@/utils/keyboardShortcuts";
   
   useShortcuts([
     {
       id: "yourPageNew",
       handler: () => {
         if (isInputFocused()) return;  // Guard: don't trigger in text inputs
         openNewForm();
       },
     },
     {
       id: "yourPageSearch",
       handler: () => {
         focusSearchInput("your-page-search-input");  // Use helper to focus search
       },
     },
     {
       id: "yourPageRefresh",
       handler: () => {
         if (isInputFocused()) return;
         refresh();
       },
     },
   ]);
   ```

**Key patterns:**
- Single-letter shortcuts (n, r, h) must guard with `isInputFocused()` to avoid stealing keystrokes
- Use `focusSearchInput(dataTest)` helper to focus search fields consistently
- All shortcuts must have descriptions in i18n for the help cheatsheet
- Platform-specific combos use `keyForWindows`/`keyForMac` pair (e.g., Ctrl/⌘)

---

## Working with O2 components

O2 components carry their design internally. That changes how you drive them:
pass **intent** (`variant`, `size`, state), never **appearance** (color, radius,
padding). These rules keep the library coherent.

### Pass only documented props

Check `O{Name}.types.ts` for what a component accepts — usually `variant`,
`size`, and state props (`disabled`, `loading`, `modelValue`). There is
deliberately **no** `color`, `rounded`, `flat`, or `sharp` prop. If you're
looking for one to reshape a component, that's the signal you need a new
**variant** on the component, not a prop that doesn't exist.

### No appearance overrides at the call site

The visual of an O2 component is produced by its own `variant`/`size`, never by
patching it from outside. Banned on an O2 component:

| Banned | Why | Instead |
| --- | --- | --- |
| `style="color: #fff; padding: 10px"` | hardcoded colors/px, bypasses tokens | use `variant` / `size` / component design |
| `class="tw:px-2 tw:text-sm"` (`tw:` prefix) | prefix removed — `tw:*` doesn't resolve | use component `variant`/`size` props |
| `class="q-pa-md text-weight-bold"` (Quasar) | Quasar utilities not available | use component `variant`/`size` props |
| `<style scoped>` targeting its class | invisible fork of the design system | move the intent into a `variant` |
| `class="q-ml-sm"` / `q-mr-sm` for spacing | Quasar spacing leak | bare `gap-*` on the parent container |

Decision flow for any visual that differs from the default:
1. Expressible via `variant` / `size`? → use the prop.
2. No variant covers it? → add a new named variant to the component source, then
   use it.
3. Layout/position only (`margin`, `flex-shrink`, a parent-hover reveal)? → wrap
   in a plain `<span>`/`<div>` and put the rule on the **wrapper**, never on the
   O2 component.

### Cancel / Save button standard (mandatory)

Every cancel/save pair in a form, dialog, or drawer follows this exact shape —
it's what makes action rows look identical everywhere:

```vue
<div class="flex gap-2">
  <OButton variant="outline" size="sm-action" @click="cancel">
    {{ t("common.cancel") }}
  </OButton>
  <OButton variant="primary" size="sm-action" type="submit" @click="save">
    {{ t("common.save") }}
  </OButton>
</div>
```

- Cancel is **always** `variant="outline"` — never `secondary` or
  `ghost-primary`. Save/Submit/OK is **always** `variant="primary"`.
- Both use `size="sm-action"`. Space them with `gap-2` on the parent — never
  `q-ml-*`/`q-mr-*` on the button, never a `<q-space />` between them.
- Other actions in the same row (Delete, Reject) keep their own `variant`
  (e.g. `destructive`) but match `size="sm-action"` for alignment.
- When the button row lives in an `ODialog`/`ODrawer` footer, prefer the
  overlay's built-in `primary`/`secondary`/`neutralButtonLabel` props, which
  already apply this standard.

### Dark mode is automatic

Every O2 component and every token resolves correctly in both themes. Do **not**
write `store.state.appTheme === 'dark' ? … : …` conditionals, dark-only classes,
or duplicate styles for dark mode around an O2 component. If something looks
wrong in dark mode, the fix is a token value in `dark.css`, not a per-component
conditional.

### No component fits? Build a reusable one — don't assemble raw classes

When you need a UI element and **no existing component matches it**, the answer
is to **create a new reusable component**, not to hand-assemble a
`<div class="…">` block at the call site. A bag of divs + utility classes is
invisible to the design system: it can't be reused, it drifts the moment someone
copies it, and it's where inconsistency and one-off `px`/color hacks creep back
in. If a pattern is worth building once, it's worth building as a component.

Decide where it lives:

- **Generic, app-agnostic primitive** (a new kind of button, a stat tile, a
  labeled value, a badge variant, an icon chip — no store/router/i18n/API
  inside) → build it in **`web/src/lib/<group>/<Name>/`** as an `O*` component,
  following the neighboring components' conventions: an `O{Name}.types.ts`, a
  `.spec.ts`, tokens for all colors, `variant`/`size` props for visual
  differences (never appearance props), dark mode via tokens, `data-test`s. If
  it belongs to a family, ship the family together. Then add it to the catalog so
  the next person finds it.
- **Reusable but app-specific composition** (composes O2 components with app data
  or logic — e.g. a stream picker that fetches streams) → build it as a named
  component in **`web/src/components/…`**, itself made of O2 components. Still a
  real component with a name and props, not inline markup.

The trigger is simple: *if you're about to write a self-contained UI element —
especially one you'd repeat — stop and make it a component.* Inline utility
classes are for **layout/composition** of components (flex, grid, gap, spacing),
never for reconstructing a component the library should own. This is the same
reason a missing **variant** becomes a new variant and a missing **token**
becomes a registered token: the fix always lands in the shared thing, never as a
private pile of classes at the call site.

**How to actually build it** — the folder contract (`O{Name}.vue` +
`.types.ts` + `.spec.ts`), families that ship together, headless-first with
`reka-ui`, the no-UI-prop-leakage rule (`variant`/`size` only), strict TypeScript,
token registration, the `OX` + `OFormX` form-wrapper pattern, and the
Analysis → Design → Implement → Test → Validate workflow — is in
[references/creating-components.md](references/creating-components.md). Read it
before writing a new `O*` component.

---

## Choosing components & structure

The rules above cover *how* you style. This section covers *what* to reach for
and *where the code lives* — the recurring decisions that otherwise get answered
differently on every screen.

### Page anatomy & the listing-page recipe

Lay out a whole page from a recipe, not from scratch — full recipes in
[references/page-recipes.md](references/page-recipes.md). The essentials:

- **Every page** = `AppPageHeader` on top (primary New/Add action in `#actions`)
  + a body in a `flex flex-col min-h-0` container.
- **A listing/table page always carries three toolbar affordances** on its
  `OTable` — don't ship a list without them:
  - **Search** — built-in `show-global-filter` (+ `v-model:global-filter`), or a
    custom `OInput` in the `#toolbar` slot for server-driven search.
  - **Refresh** — an `OButton size="icon-sm" icon-left="refresh" :loading` in the
    `#toolbar-trailing` slot, wired to the fetch fn, with a tooltip carrying the
    `r` shortcut.
  - **Column show/hide toggle** — `OTable` renders it **automatically** when
    `:persist-columns="true"` + a stable `table-id` + at least one non-action
    column marked `hideable: true` are all present. Omit any of the three and the
    button silently won't appear.
- **Hide non-essential columns by default** via `:column-visibility="{ id: false }"`
  (keep name/status visible; hide timestamps/ids/counts) — the user can re-show
  them and the choice persists per `table-id`.
- Provide `#empty`/`#error` states, put row actions in an `isAction` column, and
  register `n`/`/`/`r` shortcuts.

### Tables → `OTable`

**What.** All tabular data uses `OTable`
(`@/lib/core/Table/OTable.vue`). Legacy `q-table` is fully retired (zero usages
left) — never reintroduce one.

**How.**
- Define columns as `OTableColumnDef[]` (a `ref` or `computed`) and pass
  `:columns` + `:data`. Reuse the shared width constants (`COL.*`,
  `TABLE_INDEX_COL_SIZE`) and the prebuilt cell renderers (`OTimeCell`,
  `OUserCell`, `ONumberCell`, `OCodeCell`, `ODataBarCell`) instead of
  hand-formatting values.
- **Client vs server mode:** `OTable` does pagination/sorting/filtering
  **client-side by default** — correct when you already hold the full list in
  memory. Switch to `pagination="server"` / `sorting="server"` (driving
  `currentPage`/`totalCount`/`sortBy` via v-model + the emitted events) **only**
  when the backend paginates a dataset too large to fetch at once. Don't wire
  server mode for a list you fetched whole.
- For user-facing lists, set `persist-columns` + a stable `tableId` so column
  sizing/visibility survive reloads. Custom rendering goes through the `#cell`
  slot; an actions column is an `isAction` column rendering O2 buttons.
- **No outer border/frame.** A listing table renders **flush** — no box border
  around it. `OTable`'s `frame` defaults to `false`, so a plain `<OTable>` is
  already borderless; row-bottom dividers (`bordered`, default on) stay for
  readability. Pass `:frame="false"` **explicitly** on listing tables to lock the
  intent (the prop's doc-comment still says "default true", so being explicit
  guards against drift). Only set `:frame="true"` for a table deliberately boxed
  inside a card. And **never wrap the table in a bordered or `bg-*` container** —
  that double-frames it. If you see a border "around" the table, remove the
  parent's border/background; don't reach for a frame.

**Why.** One table component means one behavior for sort, resize, pin, empty,
loading, streaming, and dark mode. A hand-built `<table>` or a fresh `q-table`
re-answers all of those inconsistently — and re-implements pagination you'd then
have to test again.

### Where code goes (project layering)

For a list/table screen the flow is:

```
view (src/views)
  → [optional] composable (src/composables/use*)  OR  helper (utils/commons.ts)
  → service (src/services/<domain>.ts, via the http.ts wrapper)
  → Vuex store (shared/cacheable data)   +   local refs (ephemeral render data)
```

**How.**
- **Never call `http`/axios directly from a component.** Fetch through the
  domain service in `src/services` (e.g. `dashboardService.list(...)`). Get
  `org_identifier` from `store.state.selectedOrganization` — don't thread it down
  through props.
- **Composables (`use*`)** are optional thin wrappers that inject the org and
  wrap service calls. Add one when 2+ components share the same fetch/transform;
  otherwise calling the service straight from the view is the accepted norm here.
- **State placement:** genuinely shared/cached org data (streams, dashboards,
  folders, …) goes in a namespaced Vuex module. Per-screen table rows and column
  defs stay in local `ref`/`computed` — don't push throwaway view state into
  Vuex.
- **Keep views thin:** fetch + wire only. Heavy transforms belong in the
  service, composable, or a `utils` helper, not inline in the template's script.

**Why.** The layer boundary is what lets a second screen reuse a fetch, lets a
test mock a service, and keeps the store from silting up with ephemeral state. A
component that calls axios directly can't be reused or tested without a network.

### Forms: dialog vs drawer vs full page

Match the container to the **weight** of the interaction. This is the
established split in the codebase, not a preference:

| Interaction | Container | Typical size |
| --- | --- | --- |
| Confirmation / destructive-action prompt | `ConfirmDialog` (`@/components/ConfirmDialog.vue`) + `useConfirmDialog` (`@/composables/useConfirmDialog`) | — |
| Short, atomic form — one to a few fields, single decision (rename, clone, add-stream, create-link) | `ODialog` | `sm` / `md` |
| Small detail or preview popup | `ODialog` | `sm` / `md` |
| Medium-to-large form or config panel needing vertical room, or where seeing page context helps (pipeline node config, schema/regex/query editor) | `ODrawer` (side `right`) | `md` / `lg` or `:width` vw override |
| Detail / inspector panel (trace details, job detail) | `ODrawer` | `lg` / `xl` |
| Large **primary** multi-section create/edit flow (e.g. Add/Edit Alert) | full **in-page view** swapped with `v-if` — NOT an overlay | — |

Rules of thumb:
- Reach for `ODialog` first for anything short and modal-by-nature. Reach for
  `ODrawer` when the form is tall/multi-field or the user benefits from side
  context. Promote to a full page when it's the screen's *primary* task and has
  multiple sections.
- Don't cram a tall multi-section form into a dialog (it scrolls awkwardly
  against the viewport), and don't use a drawer for a yes/no confirmation (too
  heavy for the decision).
- **Use the built-ins, don't hand-roll:** `persistent` on forms (prevents
  accidental dismissal), `formId` for Enter-to-submit, and the built-in
  `primary` / `secondary` / `neutralButtonLabel` footer API instead of a manual
  button row — while still honoring the cancel=`outline` / save=`primary`
  standard (see [§ Working with O2 components](#working-with-o2-components)).
- Never use `q-dialog` / `q-drawer` — retired.

**Why.** Users learn a spatial grammar: a small ask is a centered modal, a
working surface is a side drawer, a big task gets its own page. Mixing those up
makes the same app feel like three different ones.

### Form validation & binding

Any form with validation uses **`OForm` + a Zod schema** — never hand-rolled
error refs, per-field `:rules`, or a manual `validate()`. The full ruleset with
examples is in [references/forms-validation.md](references/forms-validation.md);
read it before building a form. The non-negotiables:

- **Single source of truth.** Every control inside `<OForm>` is an `OForm*`
  wrapper addressed **only by `name=`** — the TanStack form owns the value. No
  `v-model`-to-a-`ref`, no parallel `formData` object. The `@submit` handler
  reads the validated `value`; write fields with `form.setFieldValue(...)`. A
  mirror `ref` synced by a `watch` is the #1 source of form bugs here (drift,
  post-save "required" flashes).
- **Colocate the schema.** A sibling `<Form>.schema.ts` exports a
  `make…Schema(t)` factory (Zod), the `z.infer` type, and typed defaults — never
  an inline `:default-values` literal. Field `name`s match schema keys, so fields
  need no per-field validators.
- **Convert every control** inside `<OForm>` to its `OForm*` variant (even
  optional ones → `.optional()`). Mark required with the **`required` prop**,
  never a hardcoded `*`. If a wrapper is missing, author a thin one modeled on
  `OFormSelect`. Only genuine non-form widgets (Monaco, `<query-editor>`) stay
  bare, bridged in once via `setFieldValue`.
- **Submit & loading are automatic.** Inline Save is `type="submit"`; an
  overlay's footer Save uses `<OForm id="x">` + the overlay's `form-id="x"`.
  `OForm` awaits `@submit`, so the Save spinner is automatic — delete any
  `useLoading`/`:loading`, and **never** disable Save on invalid (submitting an
  invalid form reveals the errors).
- **Build the payload with explicit keys**, never `{ ...value }` (it leaks
  `.optional()` helper fields and ships string-typed numbers). `OFormInput`
  emits strings — coerce numerics with `Number(...)` / `z.coerce.number()`.
- **Owner-vs-descendant conditional rendering:** a component that *owns*
  `<OForm>` and must read form state for `v-if`/`OStepper` creates it with
  `useOForm({ defaultValues, schema, onSubmit })` and passes `<OForm :form>`; a
  child *inside* `<OForm>` uses `inject(FORM_CONTEXT_KEY)` + `form.useStore`.
  Both read the one form — never mirror it.
- **Field arrays** (repeatable rows) use `z.array` + indexed names
  (`rows[${i}].key`) and **`:key="index"` — never a `uuid`** (a stable-id key
  shifts/blanks inputs on a mid-list delete while the data stays correct). Ship a
  delete-a-non-last-row test that asserts the *rendered* inputs.

### Keyboard shortcuts

Shortcuts are **registry-driven** — one system, not ad-hoc `keydown` listeners.
Full guide in [references/keyboard-shortcuts.md](references/keyboard-shortcuts.md).
The essentials:

- **Register, then bind, then display.** Declare the shortcut once in
  `shortcutRegistry.ts` (`@/lib/vue-shortcut-manager`) with an `id`, its
  key(s)/platform variants, and an i18n `descriptionKey`. Bind behavior in
  `setup()` with `useShortcuts([{ id, handler }])`. Display the keycap with
  `<OShortcut id>` or a `shortcut-id` prop on `ODropdownItem`/`OTooltip`.
- **Never hand-roll** `window.addEventListener("keydown", …)` for an app
  shortcut, and never hardcode `⌘N` text in a template — the registry owns key,
  platform mapping, scope, cheatsheet entry, and display.
- Scope auto-activates while the component is mounted; guard bare-letter handlers
  with a focus check so they don't fire while the user is typing.

---

## Component catalog

Every O2 component, grouped by concern, with what it's for. Open the linked
reference file for exact props, slots, emits, and a usage example before writing
markup — don't guess a prop name.

### Reference files

| File | Covers |
| --- | --- |
| [references/core-display.md](references/core-display.md) | Badge/Tag/DimensionChip, Card, Code, Collapsible, EmptyState, Icon, Separator, Shortcut, **Text (typography)**, VirtualScroll |
| [references/core-controls-table.md](references/core-controls-table.md) | **Button**/ButtonGroup, Navbar, RefreshButton, Splitter, ToggleGroup, **Table** (+ cell renderers) |
| [references/forms-inputs.md](references/forms-inputs.md) | Input/Textarea, Select, Combobox, SearchInput, Checkbox, Radio, Switch, OptionGroup |
| [references/forms-specialized.md](references/forms-specialized.md) | **Form + useOForm**, Color, Date, DateTimeRange, Time, File, Range, Slider |
| [references/forms-validation.md](references/forms-validation.md) | **Validating a form: OForm + Zod schema, binding rules, submit/loading, conditional rendering, field arrays, testing** |
| [references/keyboard-shortcuts.md](references/keyboard-shortcuts.md) | **Keyboard shortcuts: registry, `useShortcut`/`useShortcuts`, display via `OShortcut`/`shortcut-id`, cheatsheet** |
| [references/creating-components.md](references/creating-components.md) | **Building a NEW O2 component: lib vs components, folder contract, families, headless-first (reka-ui), no-UI-prop-leakage, strict TS, tokens, form wrappers, workflow, testing** |
| [references/design-tokens.md](references/design-tokens.md) | **Design tokens: using `--color-*`, the token files, registering a new token, the `--o2-*` ban + full `--o2-*` → `--color-*` migration map** |
| [references/page-recipes.md](references/page-recipes.md) | **Whole-page layouts: the listing/table page (header + OTable with mandatory search · refresh · column-visibility toggle, default-hidden columns) and the detail/editor page** |
| [references/overlay-navigation.md](references/overlay-navigation.md) | Dialog, Drawer, Dropdown, Popover, Tooltip · Pagination, Stepper, Tabs |
| [references/feedback-data.md](references/feedback-data.md) | Banner, Toast (+ useToast), Spinner, Skeleton, InnerLoading · ProgressBar, Timeline, Tree · FieldList |

> **Headless vs form-bound.** Most form controls come as a pair: `OInput`
> (headless, `v-model` only) and `OFormInput` (adds label / error / required /
> help). Inside an `OForm`, reach for the `OForm*` variant; for a bare control
> with no label chrome, use the headless one. Details in the forms references.

### Scenario → component

| I need to… | Use | Reference |
| --- | --- | --- |
| Trigger an action (submit, add, open) | `OButton` (`OButtonGroup` for a set) | core-controls-table |
| Show a page/module header | `AppPageHeader` (rule 1) | — |
| Render tabular data | `OTable` + `OTableColumnDef[]` | core-controls-table |
| Show a status label / count / tag | `OBadge`, `OTag`, `ODimensionChip` | core-display |
| Group content in a surface | `OCard` (+ `OCardSection`, `OCardActions`) | core-display |
| Body / heading / muted text | `OText` (pick the `variant`) | core-display |
| Show an icon | `OIcon` (`name` from the icon registry) | core-display |
| A divider / hairline | `OSeparator` | core-display |
| Show code / a code block | `OCode`, `OCodeBlock` | core-display |
| Expand/collapse a section | `OCollapsible` | core-display |
| Empty "no data" state | `OEmptyState` | core-display |
| Render a huge list performantly | `OVirtualScroll` | core-display |
| Single-line / multiline text entry | `OInput` / `OTextarea` (`OForm*` in a form) | forms-inputs |
| Pick one/many from a fixed list | `OSelect` (+ `OSelectItem`) | forms-inputs |
| Typeahead / free-entry combobox | `OCombobox` | forms-inputs |
| A search box | `OSearchInput` | forms-inputs |
| Boolean checkbox / group | `OCheckbox` / `OCheckboxGroup` | forms-inputs |
| Mutually exclusive choice | `ORadioGroup` (few) / `OSelect` (many) | forms-inputs |
| Instant on/off toggle | `OSwitch` | forms-inputs |
| Segmented control | `OToggleGroup` | core-controls-table |
| Build a validated form | `OForm` + Zod schema (binding rules) | **forms-validation** |
| Read form state for conditional rendering | `useOForm` (owner) / `inject`+`useStore` (child) | forms-validation |
| Add repeatable/dynamic field rows | `z.array` + indexed `name`, `:key="index"` | forms-validation |
| Pick a color | `OColor` | forms-specialized |
| Pick a date / date-time range / time | `ODate` / `ODateTimeRange` / `OTime` | forms-specialized |
| Upload a file | `OFile` | forms-specialized |
| Numeric slider / range | `OSlider` / `ORange` | forms-specialized |
| Modal task / short form | `ODialog` (see form-container rule) | overlay-navigation |
| Side panel / large or contextual form | `ODrawer` | overlay-navigation |
| Menu of actions | `ODropdown` (+ `ODropdownItem`) | overlay-navigation |
| Freeform floating content | `OPopover` | overlay-navigation |
| Hover hint | `OTooltip` | overlay-navigation |
| Switch between content sections | `OTabs` (+ `OTab`/`OTabPanel`); `ORouteTab` for route-driven | overlay-navigation |
| Multi-step wizard | `OStepper` (+ `OStep`) | overlay-navigation |
| Paginate a list | `OPagination` | overlay-navigation |
| Persistent inline message | `OBanner` | feedback-data |
| Transient notification (replaces `q-notify`) | `useToast()` (+ `OToastProvider` at root) | feedback-data |
| Loading state | `OSkeleton` (placeholder) / `OSpinner` (bare) / `OInnerLoading` (over a container) | feedback-data |
| Progress indicator | `OProgressBar` | feedback-data |
| Event timeline | `OTimeline` (+ `OTimelineItem`) | feedback-data |
| Hierarchical / tree data | `OTree` (+ `OTreeNode`) | feedback-data |
| Label–value detail rows | `OFieldList` (+ `OFieldRow`, `OFieldLabel`) | feedback-data |
| Confirm / destructive prompt | `ConfirmDialog` + `useConfirmDialog` (app-level, `@/components` + `@/composables`) | — |
| Add a keyboard shortcut | registry entry + `useShortcuts([{ id, handler }])`; display via `OShortcut`/`shortcut-id` | keyboard-shortcuts |
| Build a NEW component (nothing fits) | new `O*` in `web/src/lib` (generic) or named component in `web/src/components` (app-specific) — never inline classes | **creating-components** |

If a scenario isn't covered by anything above, re-check the reference files
before assuming a component is missing — the list is complete as of this skill's
authoring. If it's genuinely absent, follow the missing-component guidance in
[§ When a rule can't be satisfied](#when-a-rule-cant-be-satisfied).

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
- [ ] Listing page has all three toolbar affordances: **search**, **refresh**
      (`#toolbar-trailing`, wired to fetch), and the **column show/hide toggle**
      (`:persist-columns` + `table-id` + a `hideable` column). Non-essential
      columns hidden by default via `:column-visibility`; `#empty` state present.
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
      `web/src/locales/languages/en.json`.
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
  [§ No component fits?](#no-component-fits-build-a-reusable-one--dont-assemble-raw-classes).
- Missing O2 variant → add the variant to the component source, then use it.
- Missing token → register it in the token CSS (rule 5), then use it.
- `AppPageHeader` can't express the header → change `AppPageHeader`, not the page.

If you genuinely believe a rule shouldn't apply to a specific case, say so
explicitly and explain why, rather than silently introducing a `px`, a hex, or a
scoped style.
