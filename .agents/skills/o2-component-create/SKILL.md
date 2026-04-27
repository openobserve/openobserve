---
name: o2-component-create
description: Create, audit, and refactor O2 internal Vue 3 component library components inside the OpenObserve web project. Use when asked to create a new UI component, replace a Quasar component with a standardized O2 component, audit an existing component for consistency, or build headless-first components with Tailwind CSS v4 design tokens. This skill enforces strict TypeScript, uniform design standards, and prevents UI prop leakage (no rounded/sharp border toggles etc.).
---

# O2 Component Create Skill

Use this skill when **creating**, **auditing**, **refactoring**, or **migrating** UI components in the O2 component library.

## Key Facts

- **Project**: `web/` inside the OpenObserve monorepo
- **Framework**: Vue 3 (Composition API, `<script setup lang="ts">`)
- **Styling**: Tailwind CSS v4 with `tw:` prefix (e.g. `tw:flex tw:items-center`) — **no SCSS, ever**
- **Tokens**: 3-layer design token system — base → semantic → component (see [references/design-tokens.md](references/design-tokens.md))
- **Dark mode**: Every component MUST support both light and dark mode via token pairs — see [references/design-tokens.md](references/design-tokens.md) § Dark Mode
- **Headless**: **Reka UI** (`reka-ui`) is the approved headless primitive library — use it for ARIA-complex components (Dialog, Tabs, Select, Popover, etc.)
- **TypeScript**: Strict — see [references/typescript-rules.md](references/typescript-rules.md)
- **Testing**: Vitest + `@vue/test-utils`
- **Headless libraries**: Only Reka UI and @tanstack/vue-form confirmed — **NEVER install others without user confirmation** — see [references/headless-libraries.md](references/headless-libraries.md)

## Library Location

```
web/src/lib/
├── core/          # Button (+ButtonGroup), Badge, Tag, Card, Avatar, Icon
├── forms/         # Input, Textarea, Select (+SelectItem), Checkbox (+CheckboxGroup), Radio (+RadioGroup), Switch, Slider, DatePicker, FileUpload, Label
├── navigation/    # Tabs (+Tab, +RouteTab, +TabPanels, +TabPanel), Breadcrumbs, Pagination, Sidebar
├── feedback/      # Toast, Alert, Spinner, Progress
├── overlay/       # Modal (+Header+Body+Footer), Tooltip, Dropdown (+Item+Separator), Popover
├── data/          # Table (+TableColumn), List, Tree
└── styles/        # Design token CSS files (base, semantic, component, dark)
```

> **Why `lib/`?** The existing `web/src/components/` folder contains app-level Quasar components. The O2 library lives in `web/src/lib/` to avoid conflicts and clearly separate generic reusable primitives from app-specific components.

## Component Families Rule

**A compound component family must always be built and shipped together** — never ship only part of a family.

Examples:

- **Tabs**: `OTabs` + `OTab` + `ORouteTab` + `OTabPanels` + `OTabPanel`
- **Button**: `OButton` + `OButtonGroup`
- **Modal**: `OModal` + `OModalHeader` + `OModalBody` + `OModalFooter`
- **Dropdown**: `ODropdown` + `ODropdownItem` + `ODropdownGroup` + `ODropdownSeparator`

All family members co-locate in the same folder. See [references/component-guide.md](references/component-guide.md) § Component Families for full table and folder layout.

## Component Scope Rule

**Library components must be generic — zero app-specific logic.**

- No API calls, no Pinia store imports, no Vue Router imports, no i18n keys
- Components accept data via props and communicate via emits only
- If a feature needs multiple library components composed with app logic, that composition belongs in `web/src/components/` (app-level), not in `web/src/lib/`
- Existing `web/src/components/` files must **not** be modified as part of library work

## Folder Contract

**Every component in a family gets its own `.types.ts` and `.spec.ts` file — never share them across components.**

```
web/src/lib/{group}/{FamilyName}/
├── OFoo.vue                  # Root component
├── OFoo.types.ts             # OFoo types only — re-exports sub-component types for convenience
├── OFoo.spec.ts              # OFoo tests only
├── OFooItem.vue              # Sub-component
├── OFooItem.types.ts         # OFooItem types only (NEW — separate file)
├── OFooItem.spec.ts          # OFooItem tests only (NEW — separate file)
├── OFooGroup.vue
├── OFooGroup.types.ts        # OFooGroup types only
├── OFooGroup.spec.ts         # OFooGroup tests only
└── OFooSeparator.vue
    OFooSeparator.types.ts    # OFooSeparator types only
    OFooSeparator.spec.ts     # OFooSeparator tests only
```

The root `.types.ts` re-exports sub-component types so callers can still import everything from one place if needed:

```ts
// ODropdown.types.ts
export type {
  DropdownItemProps,
  DropdownItemEmits,
  DropdownItemSlots,
} from "./ODropdownItem.types"
export type {
  DropdownGroupProps,
  DropdownGroupSlots,
} from "./ODropdownGroup.types"
```

**Why one file per component?** When a sub-component changes (e.g. new prop on `ODropdownItem`), you edit only `ODropdownItem.types.ts` and `ODropdownItem.spec.ts` — no risk of accidentally breaking the root component's types or tests.

**No `index.ts` per component.** Import directly by path:

```ts
import OButton from "@/lib/core/Button/OButton.vue"
import type { ButtonProps } from "@/lib/core/Button/OButton.types"
```

A group-level barrel (`web/src/lib/core/index.ts`) is optional and added only once a group has multiple built components.

- One component per folder. Compound sub-components co-locate in the same folder.
- No extra files. Exception: large compound components may have a co-located composable (e.g. `useTable.ts`).

## Workflow: Create a New Component

### Step 1 — Scan Existing Code

Before writing any code, scan for existing implementations:

```
grep_search for similar component names across web/src/components/
grep_search for usage patterns in web/src/views/ and web/src/components/
```

- Identify all Quasar usages of the equivalent component (`q-btn`, `q-input`, etc.)
- Note what props and behaviors are actually used
- Build a compatibility surface that covers all real usage, not just ideal usage
- If this is a **family component**, identify all family members that need to be built

### Step 2 — Decide Design Tokens

- List every visual property the component needs
- Map to existing semantic tokens where possible
- Create new component tokens only for values unique to this component
- **Add tokens to BOTH** `web/src/lib/styles/tokens/component.css` (light) AND `web/src/lib/styles/tokens/dark.css` (dark overrides)
- See [references/design-tokens.md](references/design-tokens.md) for naming conventions and dark mode pairing rules

### Step 3 — Check Headless Library Need

- For ARIA-complex behavior: prefer **Reka UI** primitives — it is already confirmed
- For other complex headless behavior (virtual scroll, form state):
  - Check [references/headless-libraries.md](references/headless-libraries.md) for confirmed libraries
  - **STOP** if the library is not confirmed — ask the user before installing
  - Only proceed after explicit confirmation

### Step 4 — Implement

- Follow the Vue 3 SFC templates in [references/component-guide.md](references/component-guide.md)
- All types in `.types.ts`, none inline in `.vue`
- Strict TypeScript — no `any`, no implicit any
- Every Tailwind class with `tw:` prefix
- **`tw:` prefix with variant modifiers**: write the prefix **once** before the entire `variant:utility` string. `tw:data-[state=on]:bg-token` Γ£à ΓÇö `tw:data-[state=on]:tw:bg-token` Γ¥î. Confirm against `OTab.vue` as the ground-truth reference.
- RTL logical properties: `tw:ps-*`/`tw:pe-*`, not `tw:pl-*`/`tw:pr-*`; **and `tw:rounded-e-*`/`tw:rounded-s-*` for horizontal grouping**, not `tw:rounded-r-*`/`tw:rounded-l-*`. Vertical grouping (`rounded-t-*`/`rounded-b-*`) is fine as-is.
- **Focus ring tokens**: `ring-*` utility classes must also go through the component token layer ΓÇö never reference base tokens directly in templates (e.g. use `ring-button-destructive-focus-ring`, not `ring-error-700`)
- No SCSS. No `var(--*)` in templates. No hardcoded colors.
- Variants via computed class map — see [references/component-guide.md](references/component-guide.md) § Variants
- Accessibility: keyboard navigation, ARIA attributes, visible focus indicator
- **Dark mode**: verify all token states look correct with `.dark` class on `<html>`

### Step 5 — Write Tests

- See [references/component-guide.md](references/component-guide.md) § Tests for template
- Cover: props, slots, emits, keyboard navigation, ARIA
- **Reka UI context requirement**: components that require a root context (e.g. `DropdownMenuItem` inside `DropdownMenuRoot`) cannot be mounted standalone. Wrap them inside their open parent component in tests ΓÇö create a helper like `mountItemInDropdown()` that renders an open `ODropdown` with the item as a child.
- **`h()` import**: always import `h` from `'vue'`, never from `'vitest'`.

### Step 6 — Validate

Run through the checklist in [references/component-guide.md](references/component-guide.md) § Completion Checklist before declaring done.

## Workflow: Audit / Refactor

1. **Structure** — Correct `lib/` folder/file names, no `index.ts` per component?
2. **Family completeness** — Are all family members built? (e.g. if OTabs exists, do OTab/OTabPanel/OTabPanels exist?)
3. **TypeScript** — No `any`, all types in `.types.ts`?
4. **Tokens** — No hardcoded colors or px values in token definitions, no SCSS, no `var(--*)` in templates?
5. **Dark mode** — Every component token has a dark.css override? Tested in dark mode?
6. **Quasar removal** — No `q-*` components inside library components?
7. **Generic** — No app-specific logic (no store, router, API imports)?
8. **Accessibility** — ARIA, keyboard, focus ring?
9. **Tests** — Coverage, no snapshot-only?

## Critical Rules

- **NEVER** use Quasar components (`q-btn`, `q-input`, etc.) inside O2 library components
- **NEVER** expose UI decision props (e.g. `rounded?: boolean`, `bordered?: boolean`) — design is baked in
- **NEVER** use `var(--*)` in templates — Tailwind utilities only
- **NEVER** use hardcoded colors (`tw:bg-[#4f46e5]`)
- **NEVER** use hardcoded px values in token definitions — e.g. `--spacing-foo: 40px` → must be `var(--spacing-10)` referencing a `base.css` primitive
- **NEVER** use SCSS — only `.css` token files and Tailwind
- **NEVER** ship a component without dark mode token coverage
- **NEVER** ship half a family (e.g. OTabs without OTab, OTabPanel, OTabPanels)
- **NEVER** install a headless library (other than reka-ui / @tanstack/vue-form) without user confirmation
- **NEVER** cross-import between library groups
- **NEVER** import from `web/src/components/`, stores, router, or services inside `lib/`
- **ALWAYS** use `tw:` prefix on every Tailwind utility
- **ALWAYS** write variant modifiers with a **single** `tw:` prefix before the entire string: `tw:data-[state=on]:bg-token` Γ£à ΓÇö **never** double the prefix: `tw:data-[state=on]:tw:bg-token` Γ¥î
- **ALWAYS** use RTL logical border-radius variants for horizontal grouped elements: `tw:rounded-e-*` / `tw:rounded-s-*`, never `tw:rounded-r-*` / `tw:rounded-l-*`
- **NEVER** reference base tokens in templates for any utility including focus rings ΓÇö always go through the component token layer

## References

| When                                                                          | File                                                                 |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Full folder contract, SFC templates, component families, completion checklist | [references/component-guide.md](references/component-guide.md)       |
| Token layers, naming, dark mode pairing, component.css                        | [references/design-tokens.md](references/design-tokens.md)           |
| Strict TypeScript rules for Vue 3                                             | [references/typescript-rules.md](references/typescript-rules.md)     |
| Reka UI + headless library confirmed-safe list                                | [references/headless-libraries.md](references/headless-libraries.md) |
