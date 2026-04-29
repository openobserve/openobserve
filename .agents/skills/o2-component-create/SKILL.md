---
name: o2-component-create
description: Create, audit, and refactor O2 internal Vue 3 component library components inside the OpenObserve web project. Use when asked to create a new UI component, replace a Quasar component with a standardized O2 component, audit an existing component for consistency, or build headless-first components with Tailwind CSS v4 design tokens. This skill enforces strict TypeScript, uniform design standards, and prevents UI prop leakage (no rounded/sharp border toggles etc.).
---

# O2 Component Create Skill

Use this skill when **creating**, **auditing**, **refactoring**, or **migrating** UI components in the O2 component library.

> **Mandatory workflow**: Analysis → Design → Implement → Test → Validate. Steps cannot be skipped or reordered. No code may be written before the analysis report is complete.

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

## Prop Minimalism Principle

**The smallest API surface wins.** Before adding any prop, ask: "Can the component make this decision internally?"

Only three categories of props are permitted:

| Category             | Examples                                    | Rationale                                 |
| -------------------- | ------------------------------------------- | ----------------------------------------- |
| **Semantic size**    | `size="sm" \| "md" \| "lg"`                 | Adapts to context without exposing pixels |
| **Semantic variant** | `variant="primary" \| "ghost" \| "outline"` | Communicates intent, not style rules      |
| **State**            | `disabled`, `loading`, `readonly`           | Behavioral flags only                     |

**Forbidden props** (design decisions are baked into the component):

- Shape/radius toggles (`rounded`, `pill`, `square`)
- Color overrides (`color`, `text-color`, `bg-color`)
- Border toggles (`bordered`, `no-border`, `outlined` separate from variant)
- Spacing overrides (`dense`, `padding`, `compact`)
- Any prop whose only effect is changing a CSS value

If a genuine design need is not covered by the current variant set, **add a new named variant** — do not expose a raw style prop.

---

## Workflow: Create a New Component

### Step 0 — Pre-Condition Check (MANDATORY)

Before any code is written, confirm:

- [ ] The component does NOT already exist in `web/src/lib/`
- [ ] The equivalent Quasar component(s) have been identified (`q-btn`, `q-tabs`, etc.)
- [ ] The target component family is fully scoped (e.g. "Tabs" means OTabs + OTab + OTabPanel + OTabPanels)

**Do not proceed until all three are confirmed.**

---

### Step 1 — Full Codebase Analysis (MANDATORY — produce a written report)

Scan the entire application before designing anything:

```
grep_search for "<q-{component-name}" across web/src/ to find all usages
grep_search for every variant/modifier of the component (q-tabs, q-tab, q-tab-panels, q-tab-panel)
```

**Required analysis output** — write out each of these before moving to Step 2:

```
## Analysis Report: {ComponentName}

### Quasar equivalents found
- <q-{name}> — {N} usages across {N} files

### All props in active use
| Prop | Values seen | Frequency |
|------|-------------|-----------|
| ...  | ...         | ...       |

### All slots in active use
| Slot name | Usage pattern |
|-----------|---------------|

### All event handlers in active use
| Event | Handler pattern |
|-------|----------------|

### Visual variants identified
List every distinct visual style: flat/ghost, outline, primary-colored, icon-only, dense/compact, etc.

### Behavioral patterns
List any non-trivial interaction: toggle state, routing, lazy-load, etc.

### Proposed O2 variant set
Based on ALL patterns above, the minimum named variants needed are: ...

### Props that will be DROPPED (internal decisions)
List every Quasar prop that will NOT be exposed as an O2 prop and why.
```

**⚠ Safeguard**: If any usage pattern cannot be covered by the proposed variant set, expand the variant set now — never leave a usage that would require a consumer to add inline styles.

---

### Step 2 — Design the Component API

Using the analysis report:

1. Define the minimal prop set (size, variant, state only — see Prop Minimalism Principle)
2. Identify all **family members** that must be built together
3. Write the `.types.ts` interface first — the API contract is reviewed before any `.vue` is created
4. Verify every use-case from the analysis report is covered by the interface

**Validation gate**: Every visual pattern from the analysis report must map to a named variant or be an intentionally dropped prop. No unmapped patterns allowed.

---

### Step 3 — Decide Design Tokens

- List every visual property the component needs
- Map to existing semantic tokens where possible
- Create new component tokens only for values unique to this component
- **Add tokens to BOTH** `web/src/lib/styles/tokens/component.css` (light) AND `web/src/lib/styles/tokens/dark.css` (dark overrides)
- See [references/design-tokens.md](references/design-tokens.md) for naming conventions and dark mode pairing rules

---

### Step 4 — Check Headless Library Need

- For ARIA-complex behavior: prefer **Reka UI** primitives — it is already confirmed
- For other complex headless behavior (virtual scroll, form state):
  - Check [references/headless-libraries.md](references/headless-libraries.md) for confirmed libraries
  - **STOP** if the library is not confirmed — ask the user before installing
  - Only proceed after explicit confirmation

---

### Step 5 — Implement

- Follow the Vue 3 SFC templates in [references/component-guide.md](references/component-guide.md)
- All types in `.types.ts`, none inline in `.vue`
- Strict TypeScript — no `any`, no implicit any
- Every Tailwind class with `tw:` prefix
- **`tw:` prefix with variant modifiers**: write the prefix **once** before the entire `variant:utility` string. `tw:data-[state=on]:bg-token` ✓ — `tw:data-[state=on]:tw:bg-token` ✗. Confirm against `OTab.vue` as the ground-truth reference.
- RTL logical properties: `tw:ps-*`/`tw:pe-*`, not `tw:pl-*`/`tw:pr-*`; **and `tw:rounded-e-*`/`tw:rounded-s-*` for horizontal grouping**, not `tw:rounded-r-*`/`tw:rounded-l-*`. Vertical grouping (`rounded-t-*`/`rounded-b-*`) is fine as-is.
- **Focus ring tokens**: `ring-*` utility classes must also go through the component token layer — never reference base tokens directly in templates
- No SCSS. No `var(--*)` in templates. No hardcoded colors.
- Variants via computed class map — see [references/component-guide.md](references/component-guide.md) § Variants
- Accessibility: keyboard navigation, ARIA attributes, visible focus indicator
- **Dark mode**: verify all token states look correct with `.dark` class on `<html>`

---

### Step 6 — Write Tests

- See [references/component-guide.md](references/component-guide.md) § Tests for template
- Cover: props, slots, emits, keyboard navigation, ARIA
- **Reka UI context requirement**: components that require a root context cannot be mounted standalone. Wrap them inside their open parent component in tests — create a helper like `mountItemInParent()` that renders an open parent with the item as a child.
- **`h()` import**: always import `h` from `'vue'`, never from `'vitest'`.

---

### Step 7 — Validate

Run through the checklist in [references/component-guide.md](references/component-guide.md) § Completion Checklist before declaring done.

**Additional validation: cross-reference analysis report**

Go back to the Step 1 analysis report and confirm:

- [ ] Every visual pattern from the report is covered by a named variant
- [ ] Every in-use prop is either mapped to an O2 prop or documented as intentionally dropped
- [ ] No usage in the codebase requires a consumer to add inline styles or classes to the O2 component
- [ ] All text and icon colours are visually readable at resting state in both light and dark mode

---

## Workflow: Audit / Refactor

1. **Structure** — Correct `lib/` folder/file names, no `index.ts` per component?
2. **Family completeness** — Are all family members built?
3. **Prop minimalism** — Does every prop fall into the three permitted categories (size, variant, state)?
4. **TypeScript** — No `any`, all types in `.types.ts`?
5. **Tokens** — No hardcoded colors or px values in token definitions, no SCSS, no `var(--*)` in templates?
6. **Dark mode** — Every component token has a dark.css override? Tested in dark mode?
7. **Quasar removal** — No `q-*` components inside library components?
8. **Generic** — No app-specific logic (no store, router, API imports)?
9. **Accessibility** — ARIA, keyboard, focus ring?
10. **Tests** — Coverage, no snapshot-only?
11. **Colour visibility** — Open the component in the browser in both light and dark mode and confirm all text labels are readable and icons are clearly visible. Fix by updating the token value, not by adding inline classes.

---

## Iterative Improvement Safeguard

If during migration/replacement a usage pattern is found that the O2 component cannot handle:

1. **STOP the replacement immediately**
2. Go back to Step 1 analysis and add the missing pattern
3. Update the component API (`.types.ts`) with the new variant or prop
4. Implement the new variant in the component
5. Only then resume the replacement

**Never fix a missing case at the usage level** (inline class, style override). The component must be updated first.

---

## Critical Rules

- **NEVER** use Quasar components (`q-btn`, `q-input`, etc.) inside O2 library components
- **NEVER** expose UI decision props (e.g. `rounded?: boolean`, `bordered?: boolean`, `color?: string`) — design is baked in
- **NEVER** use `var(--*)` in templates — Tailwind utilities only
- **NEVER** use hardcoded colors (`tw:bg-[#4f46e5]`)
- **NEVER** use hardcoded px values in token definitions — e.g. `--spacing-foo: 40px` → must be `var(--spacing-10)` referencing a `base.css` primitive
- **NEVER** use SCSS — only `.css` token files and Tailwind
- **NEVER** ship a component where resting/inactive foreground colours are invisible or near-invisible. For interactive labels that must be readable at rest, use `text-primary` or a dedicated component token with sufficient contrast. Icons rendered via `OIcon` use `currentColor` — if the parent token is too light, the icon will be invisible. Always verify resting, hover, active, and disabled states in the browser at 100% zoom in both light and dark modes before shipping.
- **NEVER** ship half a family (e.g. OTabs without OTab, OTabPanel, OTabPanels)
- **NEVER** install a headless library (other than reka-ui / @tanstack/vue-form) without user confirmation
- **NEVER** cross-import between library groups
- **NEVER** import from `web/src/components/`, stores, router, or services inside `lib/`
- **NEVER** ship a component with an incomplete variant set — before finalising, cross-reference every visual style that exists in the codebase for the Quasar equivalent and confirm that every one of those styles is covered by a variant
- **NEVER** skip the Step 1 analysis report — designing without analysis produces components that miss real usage patterns and force consumers into workarounds
- **ALWAYS** use `tw:` prefix on every Tailwind utility
- **ALWAYS** write variant modifiers with a **single** `tw:` prefix before the entire string: `tw:data-[state=on]:bg-token` ✓ — never double the prefix: `tw:data-[state=on]:tw:bg-token` ✗
- **ALWAYS** use RTL logical border-radius variants for horizontal grouped elements: `tw:rounded-e-*` / `tw:rounded-s-*`, never `tw:rounded-r-*` / `tw:rounded-l-*`
- **NEVER** reference base tokens in templates for any utility including focus rings — always go through the component token layer

## References

| When                                                                          | File                                                                 |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Full folder contract, SFC templates, component families, completion checklist | [references/component-guide.md](references/component-guide.md)       |
| Token layers, naming, dark mode pairing, component.css                        | [references/design-tokens.md](references/design-tokens.md)           |
| Strict TypeScript rules for Vue 3                                             | [references/typescript-rules.md](references/typescript-rules.md)     |
| Reka UI + headless library confirmed-safe list                                | [references/headless-libraries.md](references/headless-libraries.md) |
