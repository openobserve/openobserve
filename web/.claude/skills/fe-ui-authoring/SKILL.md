---
name: fe-ui-authoring
description: >-
  Authoring guardrails for building ANY new frontend UI in the OpenObserve web
  app (web/) — new views, pages, panels, dialogs, feature components, or edits
  to existing ones. Enforce five house rules the moment you write Vue/template
  markup: (1) use AppPageHeader for every page/module header, (2) build UI from
  O2 library components in web/src/lib — never raw Quasar or bare HTML controls
  when an O2 equivalent exists, (3) no hardcoded px — size with rem/%/vh/vw or
  Tailwind's rem-based scale, (4) no scoped-CSS blocks and no inline style="",
  (5) never hardcode colors/sizes — use registered design tokens, and register a
  new token in the token CSS if one is missing. It also settles the recurring
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
  shortcut, or whether something belongs in a dialog or a drawer — even if they
  don't mention these rules by name. If you are
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

## The five rules

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
- Source of truth: [`web/src/components/common/AppPageHeader.vue`](../../../src/components/common/AppPageHeader.vue).
  Read its top-of-file doc comment before using it — it documents the row
  contract in detail.
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
  fake it. Keep the existing Quasar component (or native element) in place and
  flag that a new O2 component is needed — build it following the patterns of the
  neighboring components in `web/src/lib`. An unstyled `div` is worse than an
  honest `q-btn`.

### 3. No hardcoded `px`

**What.** Never size anything in `px`. Use `rem` for type/spacing/dimensions,
`%` for parent-relative sizing, `vh`/`vw` for viewport-relative sizing — or,
preferably, Tailwind's spacing/size utilities (which are already rem-based).

```vue
<!-- avoid --> <div style="width: 320px; margin-top: 12px">
<!-- prefer --> <div class="tw:w-80 tw:mt-3">        <!-- 20rem / 0.75rem -->
<!-- or   -->  <div class="tw:w-[20rem] tw:mt-[0.75rem]">
```

**Why.** `px` ignores the user's root font size and breaks the app's ability to
scale type and density consistently. The whole spacing system is rem-based; a
stray `px` value is a value that won't move when everything else does. Tailwind's
numeric scale (`p-3`, `w-80`, `gap-2`) already maps to rem, so preferring
utilities usually removes the temptation entirely.

**How.**
- Reach for a Tailwind utility first (`tw:` prefix in this project). The numeric
  scale is `0.25rem`-based: `2 → 0.5rem`, `4 → 1rem`, etc.
- Need an exact value not on the scale? Use a rem arbitrary value:
  `tw:h-[1.375rem]`, not `tw:h-[22px]`.
- **The only accepted `px` is a `1px` hairline border/divider.** Everything else
  is a smell.

### 4. No scoped CSS, no inline styles

**What.** Do not add `<style scoped>` blocks and do not write `style="…"`
attributes on elements. Style with Tailwind utilities and design-token-backed
classes in the template.

**Why.** Scoped CSS and inline styles are per-file, invisible overrides — they
fork the design system one component at a time and are the primary source of
"why does this button look different here?" On O2 components specifically, a
scoped rule targeting the component's class is a design-system violation: the
intent belongs in a component **variant**, not a local override that the next
person can't discover. Inline `style` is even worse — it beats everything and
carries no token.

**How.**
- Layout, spacing, flex/grid, sizing → Tailwind utilities on the element.
- A visual difference on an O2 component that a utility can't (legitimately)
  express → it's a missing **variant**; add the variant to the component source,
  then use the prop. Never patch it at the call site. See
  [§ Working with O2 components](#working-with-o2-components) for the decision
  flow.
- Genuinely layout-only positioning around an O2 component (e.g. `margin`,
  `flex-shrink`, a parent-hover reveal) → put it on a plain wrapper
  `<span>`/`<div>`, never as scoped CSS on the O2 component itself.
- Dynamic values that truly must be computed at runtime (e.g. a computed
  pixel-free width from JS) → bind a CSS custom property via `:style` only if
  there is no class-based way, and prefer a token. This is the rare exception,
  not a license to reintroduce inline styling.

### 5. No hardcoded colors or sizes — use registered tokens

**What.** Never write a literal color (`#2b2d30`, `rgb(...)`, `rgba(...)`,
`hsl(...)`, named colors) or a magic dimension inline. Use the project's design
tokens. If the token you need doesn't exist, **register it** in the token CSS
first, then use it.

**Why.** Tokens are what make the app theme-aware. A literal `#fff` is invisible
in dark mode and can't be retuned globally; a token (`text-text-primary`,
`bg-surface-base`, `var(--o2-*)`) resolves to the right value in both themes and
changes everywhere at once when design updates it. Hardcoding a color is opting a
single element out of theming permanently.

**How — using tokens.**
- Prefer Tailwind token utilities generated from the design tokens:
  `tw:bg-surface-base`, `tw:text-text-primary`, `tw:border-border-default`,
  `tw:bg-tabs-active-bg`, etc. Grep existing views for the names in use.
- In the rare case you need the raw variable, use the CSS custom property:
  `var(--o2-text-primary)`, `var(--color-surface-base)` — theme-aware by
  construction.

**How — registering a NEW token (when none fits).** The token system is
plain CSS (Tailwind v4), no SCSS. Files live in
[`web/src/lib/styles/tokens/`](../../../src/lib/styles/tokens/) and load in order
via `web/src/styles/tailwind.css`:

| File | Holds |
| --- | --- |
| `base.css` | raw palette primitives (`--color-grey-*`, radius, shadow) + fonts |
| `semantic.css` | semantic/intent tokens (light `:root`) + legacy `--o2-*` light values |
| `component.css` | per-component tokens |
| `dark.css` | **all** dark-mode overrides |

To add a token (do all three steps, or dark mode / Tailwind utilities silently
break):

1. **Light value** — add it in the appropriate `:root { … }` block (usually
   `semantic.css` for a general token, `component.css` for a component-scoped
   one), pointing at a base palette value:
   `--color-surface-raised: var(--color-grey-50);`
2. **Register for Tailwind** — re-declare it self-referentially inside that same
   file's `@theme inline { … }` block so Tailwind emits utilities for it:
   `--color-surface-raised: var(--color-surface-raised);` — the `inline` keyword
   is what lets the runtime dark override still win.
3. **Dark override** — add the dark value in `dark.css` under the dark selector
   (`:root.dark, .dark :root, .dark { … }`, and the legacy `.body--dark` block if
   it's an `--o2-*` token).

Then use it as a utility (`tw:bg-surface-raised`) or `var(--color-surface-raised)`.
Never inline the literal you would have registered.

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
| `style="color: …"` | bypasses tokens, dead in dark mode | add/choose a `variant` |
| `class="tw:px-2 tw:text-sm tw:font-bold"` to restyle it | ad-hoc patching | use `size` / `variant` |
| `<style scoped>` targeting its class | invisible fork of the design system | move the intent into a `variant` |
| `class="q-ml-sm"` / `q-mr-sm` for spacing | Quasar spacing leak | `tw:gap-*` on the parent container |

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
<div class="tw:flex tw:gap-2">
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
- Both use `size="sm-action"`. Space them with `tw:gap-2` on the parent — never
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

---

## Choosing components & structure

The five rules above cover *how* you style. This section covers *what* to reach
for and *where the code lives* — the recurring decisions that otherwise get
answered differently on every screen.

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
- [ ] Tabular data uses `OTable` with `OTableColumnDef[]` columns (never
      `q-table`); server mode only for backend-paginated data.
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
- [ ] Zero `px` values (except a `1px` hairline). Sizes use rem / % / vh / vw or
      Tailwind's rem scale.
- [ ] No `<style scoped>` block added. No `style="…"` attribute added.
- [ ] No literal colors anywhere. Colors come from token utilities / `var(--o2-*)`.
- [ ] Any new color/size needed was **registered as a token** (light + `@theme
      inline` + dark) before use.
- [ ] `data-test` on every interactive and key output element, pattern
      `<module>-<filename>-<descriptor>` (see the project FE rules).
- [ ] New component uses `<script setup lang="ts">`, no `// @ts-nocheck`.
- [ ] `cd web && npm run lint && npm run type-check` pass.

## When a rule can't be satisfied

Don't quietly break a rule — the fix is almost always "extend the shared thing,
not the call site":

- Missing O2 component → keep the current Quasar/HTML element in place, flag that
  a new O2 component is needed, and build it following the neighboring components
  in `web/src/lib`. Never substitute a bare `<div>`.
- Missing O2 variant → add the variant to the component source, then use it.
- Missing token → register it in the token CSS (rule 5), then use it.
- `AppPageHeader` can't express the header → change `AppPageHeader`, not the page.

If you genuinely believe a rule shouldn't apply to a specific case, say so
explicitly and explain why, rather than silently introducing a `px`, a hex, or a
scoped style.
