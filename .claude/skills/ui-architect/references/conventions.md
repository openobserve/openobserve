# Layout, O2 usage & structural conventions

> Extracted from the ui-architect contract (see ../SKILL.md § Structural decisions). Spacing patterns, driving O2 components, the cancel/save standard, project layering, and the form-container split.

## Spacing, Alignment & Layout Patterns

All spacing uses **bare Tailwind utilities** (`flex flex-col gap-*`, `p-*`,
`mb-*`), never inline `style`, never `tw:`/`q-*`. The rem-based scale keeps every
screen on the same rhythm: `gap-2` = 0.5rem, `gap-4` = 1rem, `gap-5` = 1.25rem,
`gap-6` = 1.5rem, `p-6` = 1.5rem.

### Listing Pages (OTable, Lists, Grids)

A listing/table page is **full-bleed**, not a padded card: root `flex flex-col
h-full p-0`, the `AppPageHeader` owns the padding (`shrink-0 px-4 border-b`), and
the table wrapper runs flush (`card-container flex-1 min-h-0 overflow-hidden`
around `<OTable :frame="false">`). **Reserve `p-6`/`gap-6` for form/detail
views** — a page inset breaks the flush table. The full skeleton, the mandatory
search · refresh · column-toggle toolbar, and the empty-state contract are in
[§ Page anatomy & the listing-page recipe](#page-anatomy--the-listing-page-recipe)
and [references/page-recipes.md](page-recipes.md).

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

Pages register shortcuts in the **shortcut registry** (`shortcutRegistry.ts`), never
inline `keydown`. The full registry→i18n→handler recipe (with `isInputFocused()`
guards and `focusSearchInput()`) lives in
[references/keyboard-shortcuts.md](keyboard-shortcuts.md) — see also
[§ Keyboard shortcuts](#keyboard-shortcuts) below.

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
[references/creating-components.md](creating-components.md). Read it
before writing a new `O*` component.

---

## Choosing components & structure

The rules above cover *how* you style. This section covers *what* to reach for
and *where the code lives* — the recurring decisions that otherwise get answered
differently on every screen.

### Page anatomy & the listing-page recipe

Lay out a whole page from a recipe, not from scratch — full recipes in
[references/page-recipes.md](page-recipes.md). The essentials:

- **Every page** = `AppPageHeader` on top (primary New/Add action in `#actions`).
- **A listing/table page is full-bleed**, laid out as a full-height flex column
  where the **header carries the padding** and the **table runs flush** to the
  content edges — root `flex flex-col h-full p-0`, header
  `shrink-0 px-4 border-b border-border-default`, table wrapper
  `card-container flex-1 min-h-0 overflow-hidden` around `<OTable :frame="false">`.
  **Not** a `gap-6 p-6` padded container (that's for form/detail views).
- **A listing/table page always carries three toolbar affordances** on its
  `OTable` — don't ship a list without them:
  - **Search (+ filters)** — put the search box and any filter controls
    (`OToggleGroup`, dropdowns) together in the `#toolbar` slot with
    `:show-global-filter="false"`. Only a search-only list with no other filters
    uses the built-in `show-global-filter` + `v-model:global-filter`.
  - **Refresh** — an `OButton variant="outline" size="icon-sm" icon-left="refresh"
    :loading` in the `#toolbar-trailing` slot, wired to the fetch fn, with a
    tooltip carrying the `r` shortcut.
  - **Column show/hide toggle** — `OTable` **auto-injects** it (between `#toolbar`
    and `#toolbar-trailing`) when `:persist-columns="true"` + a stable `table-id` +
    at least one non-action column marked `hideable: true` are all present. Omit
    any of the three and the button silently won't appear.
- **Hide non-essential columns by default** via `:column-visibility="{ id: false }"`
  (keep name/status visible; hide timestamps/ids/counts) — the user can re-show
  them and the choice persists per `table-id`.
- **Empty state = one `OEmptyState`** in `#empty` with a `preset` + `:filtered`
  prop; it swaps to "No results found" + Clear-filters automatically when search/a
  filter is active. Provide `#error` too if fetch can fail. Put row actions in an
  `isAction` column, register `n`/`/`/`r` shortcuts.
- **Register the page in navigation** (route + rail item / Settings sub-page /
  flyout child) and **gate it** for the right env/role — a page that renders but
  isn't wired into the nav is unreachable. Full how-to in
  [references/navigation-menus.md](navigation-menus.md).

### Tables → `OTable`

**What.** All tabular data uses `OTable`
(`@/lib/core/Table/OTable.vue`). Legacy `q-table` is fully retired (zero usages
left) — never reintroduce one.

**How.** Columns are `OTableColumnDef[]` (`:columns` + `:data`); reuse the shared
width constants (`COL.*`, `TABLE_INDEX_COL_SIZE`) and the prebuilt cell renderers
(`OTimeCell`, `OUserCell`, `ONumberCell`, `OCodeCell`, `ODataBarCell`) rather than
hand-formatting values. `OTable` paginates/sorts/filters **client-side by
default** — switch to `pagination="server"` / `sorting="server"` **only** when the
backend paginates a dataset too large to fetch whole; don't wire server mode for a
list you fetched entire. For user-facing lists set `persist-columns` + a stable
`tableId`. Render a listing table **flush**: `:frame="false"` (already its
default) and **never** wrap it in a bordered/`bg-*` box — that double-frames it, so
fix a stray border by removing the parent's, not by adding a frame. The full
prop/slot/emit list and the cell renderers are in
[references/core-controls-table.md](core-controls-table.md).

**Why.** One table component means one behavior for sort, resize, pin, empty,
loading, and dark mode — a hand-built `<table>` or a fresh `q-table` re-answers all
of that inconsistently and re-implements pagination you'd then have to retest.

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

### Registering a new page in navigation

**What.** A new page isn't reachable until it's (1) registered as a **route** and
(2) surfaced in **exactly one** navigation surface, and (3) **gated** for the
right environment and role. All three are data-driven — never hand-roll a
`<router-link>` sidebar entry or a bespoke menu. Full how-to (file paths, data
shapes, gating expressions, checklists) in
[references/navigation-menus.md](navigation-menus.md).

**How — pick the surface by what the page is:**

| The page is… | Surface | Edit |
| --- | --- | --- |
| A top-level product area | plain **left-rail item** | `linksList` in `web/src/layouts/MainLayout.vue` |
| One of several related data destinations | **hover-flyout child** under a rail group | `NAV_GROUPS` in `web/src/lib/core/Navbar/navGroups.ts` |
| An admin/config screen | **Settings sub-page** (SectionRail) | `settingsItems` in `web/src/components/settings/index.vue` |
| An access-control screen | **IAM sub-page** (SectionRail) | `web/src/views/IdentityAccessManagement.vue` |

Plus a **route** (lazy `component`, `meta.title`, `beforeEnter: routeGuard`) in the
composable that owns the domain, and a **gate** built from `config.isEnterprise` /
`config.isCloud` (`web/src/aws-exports.ts`) and `store.state.zoConfig.*` runtime
flags (`rbac_enabled`, `actions_enabled`, `meta_org`, …). The **route condition**,
the **nav entry's gate**, and the page's SectionRail **`visible`** must all express
the **same** rule — otherwise the nav offers a link the page hides (`OSS`/RBAC leak
in the other direction). The exact route composables, the canonical gating
expression, and `custom_hide_menus` are in
[references/navigation-menus.md](navigation-menus.md).

**Why.** Every navigation surface reads from one data file so the whole IA is
decidable in one place and stays consistent; the gating rules keep a cloud- or
enterprise-only page from leaking into OSS builds (or an RBAC page appearing
without RBAC). A hand-rolled sidebar link bypasses the flyout reshaping, the
`router.hasRoute` dead-link filtering, and the gate mirroring — and drifts.

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
examples is in [references/forms-validation.md](forms-validation.md);
read it before building a form. The non-negotiables:

- **Single source of truth** — every control inside `<OForm>` is an `OForm*`
  addressed **only by `name=`**; the TanStack form owns the value. No
  `v-model`-to-a-`ref`, no parallel `formData` (a mirror `ref` synced by a `watch`
  is the #1 form bug here — drift, post-save "required" flashes). Read the
  validated `value` in `@submit`; write fields with `form.setFieldValue(...)`.
- **Colocate the schema** — a sibling `<Form>.schema.ts` exports a `make…Schema(t)`
  Zod factory, the `z.infer` type, and typed defaults; never an inline
  `:default-values` literal. Field `name`s match schema keys, so no per-field rules.
- **Convert every control** to its `OForm*` variant (optional ones too →
  `.optional()`); mark required with the **`required` prop**, never a literal `*`.
  Only genuine non-form widgets (Monaco, `<query-editor>`) stay bare, bridged in
  once via `setFieldValue`.
- **Submit & loading are automatic** — inline Save is `type="submit"`; an overlay
  footer uses `<OForm id="x">` + the overlay's `form-id="x"`. Delete any
  `useLoading`/`:loading`, and **never** disable Save on invalid (submitting an
  invalid form is what reveals the errors).
- **Build the payload with explicit keys**, never `{ ...value }` (it leaks
  `.optional()` helper fields and string-typed numbers — `OFormInput` emits
  strings, so coerce with `Number(...)` / `z.coerce.number()`).
- **Conditional rendering off form state** — the component that *owns* `<OForm>`
  creates it with `useOForm({ defaultValues, schema, onSubmit })` and passes
  `<OForm :form>`; a child *inside* uses `inject(FORM_CONTEXT_KEY)` +
  `form.useStore`. Both read the one form — never mirror it.
- **Field arrays** use `z.array` + indexed names (`rows[${i}].key`) and
  **`:key="index"` — never a `uuid`** (a stable-id key blanks inputs on a mid-list
  delete). Ship a delete-a-non-last-row test that asserts the *rendered* inputs.

### Keyboard shortcuts

Shortcuts are **registry-driven** — one system, not ad-hoc `keydown` listeners.
Full guide in [references/keyboard-shortcuts.md](keyboard-shortcuts.md).
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

