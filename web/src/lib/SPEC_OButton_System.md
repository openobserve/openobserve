# Component Spec: OButton System (with Group & Dropdown)
## Replacing: `q-btn` + `q-btn-group` + `q-menu` (as dropdown trigger)

_Spec authored: April 24, 2026_

---

## 1. Why This Exists

`q-btn` is the **highest file-count component in the entire codebase** — 299 files. It is also deeply entangled with two companion components:

1. **`q-btn-group`** — groups multiple buttons together, merging their borders into a segmented control (17 files)
2. **`q-menu` inside `q-btn`** — the "dropdown button" pattern where a button triggers a floating menu (26 files, 38 compound instances using both)

The existing `OButton` in `web/src/lib/core/Button/` covers the basic button variants. This spec defines what's **missing** to fully replace Quasar's button ecosystem:

- `q-btn` **variant/shape props** that OButton doesn't yet have (`flat`, `round`, `dense`, `icon-only`, `unelevated`, `no-caps`)
- `q-btn-group` → new `OButtonGroup` component
- `q-menu` as dropdown trigger → new `ODropdown` component (wraps btn + floating menu)
- The `v-close-popup` directive needed inside menus → `ODropdownItem` helper

---

## 2. Real Usage Inventory

### q-btn (133 instances counted on single-line tags; 299 files total)

| Prop / Boolean | Uses | Notes |
|----------------|------|-------|
| `flat` | **88** | No background, no shadow — most common variant |
| `round` | **50** | Circular shape — always icon-only |
| `dense` | **45** | Compact size |
| `no-caps` | **24** | No text-transform — very common |
| `icon` | 50 | Material icon name |
| `label` | 40 | Button text |
| `size` | 36 | `"xs"`, `"sm"`, `"md"` overrides |
| `color` | 31 | Quasar color name (primary, grey, red…) |
| `unelevated` | 11 | Removes shadow from filled button |
| `padding` | 8 | Custom padding string (`"xs"`, `"4px"`) |
| `disable` / `:disable` | 6 | Programmatic disable |
| `loading` / `:loading` | 2 | Loading spinner state |
| `outline` | 1 | Outlined style |
| `square` | 1 | Square shape |
| `type="submit"` | present | Form submission |
| `@click` | near-universal | Click handler |
| `to` prop (router) | seen in some | Router navigation |

**Most-used combination:** `flat dense no-caps icon="..." size="sm"` — the icon-action button pattern used throughout dashboards and tables.

### q-btn-group (10 instances, 17 files)

| Prop | Uses | Notes |
|------|------|-------|
| `flat` | 3 | Matching btn style inside group |
| class only | majority | No special Quasar props — just layout grouping |
| Contains `q-btn` children | always | Always wraps q-btn elements |
| Contains `q-menu` inside a btn | at least 1 | Compound: group + btn + dropdown |
| Draggable | **many** | `@dragstart`, `@drop`, `@dragenter` — used for dashboard axis fields |

**Key insight:** `q-btn-group` in this codebase is used in two distinct ways:
1. **Segmented control** — two/three buttons as a radio-like selection (e.g. "by Dashboard / by URL")
2. **Draggable field chip** — represents a draggable field on the dashboard query builder (has its own context menu)

### q-menu as dropdown inside q-btn (26 files)

| Prop | Uses | Notes |
|------|------|-------|
| No props (bare) | majority | Opens below its trigger by default |
| `anchor` + `self` | 10 | Custom positioning |
| `offset` | 2 | Pixel offset from trigger |
| `fit` | 2 | Min-width matches trigger width |
| `transition-show/hide` | 2 | Custom enter/exit animations |
| `auto-close` | 1 | Closes when any item is clicked |
| `v-model` | **1** (Group.vue) | Programmatic open/close |
| Content: `q-list` + `q-item` | majority | Standard list menu |
| Content: custom `<div>` | ~4 | Rich content popover (date picker, label editor) |

**`v-close-popup` usage:** 264 total across the codebase. These are inside `q-item` elements within `q-menu`, to close the menu when an item is clicked. Our `ODropdown` must provide an equivalent mechanism.

---

## 3. Component Architecture

### New components needed

| Quasar pattern | O2 component | What it does |
|----------------|-------------|-------------|
| `q-btn` (extended) | **Extend `OButton`** | Add `flat`, `round`, `dense`, `no-caps`, `unelevated` variants + icon-only mode |
| `q-btn-group` | **`OButtonGroup`** | Merges child OButton borders into segmented control |
| `q-btn` + `q-menu` compound | **`ODropdown`** | Button-triggered floating menu (wraps trigger + panel) |
| `q-item` + `v-close-popup` | **`ODropdownItem`** | Clickable menu item that auto-closes the dropdown |

### Files to create

```
web/src/lib/core/Button/        (existing — extend only)
├── Button.vue                  ← add new variant/shape props
├── Button.types.ts             ← add new types

web/src/lib/core/ButtonGroup/
├── ButtonGroup.vue
├── ButtonGroup.types.ts
└── ButtonGroup.spec.ts

web/src/lib/overlay/Dropdown/
├── Dropdown.vue               ← the compound trigger+panel
├── Dropdown.types.ts
├── Dropdown.spec.ts
├── DropdownItem.vue           ← auto-closing menu item
├── DropdownItem.types.ts
└── DropdownItem.spec.ts
```

---

## 4. OButton Extensions (additions to existing component)

The current `OButton` has: `primary`, `secondary`, `outline`, `ghost`, `destructive` variants + sizes `sm`, `md`, `lg`, `icon`.

The following are needed to cover all `q-btn` usage:

### New `shape` prop

```ts
export type ButtonShape = 'default' | 'round' | 'square'
```

- `round` → `tw:rounded-full tw:p-0` (+ fixed size from `size` prop)
- `square` → `tw:rounded-none`
- `default` → existing rounded behavior

### New `flat` variant mapping

`q-btn flat` → maps to existing `ghost` variant. No new variant needed — migration just substitutes `variant="ghost"`.

### New `dense` prop

```ts
dense?: boolean   // default: false — reduces height from size token to a compact value
```

Dense sizes:
- `sm` dense → `h-7` instead of `h-8`
- `md` dense → `h-8` instead of `h-10`
- Combined with `size="icon"` → `size-7` instead of `size-9`

### `noCaps` prop

```ts
noCaps?: boolean   // default: false — disables text-transform: uppercase (Quasar adds this by default; we don't, so this prop is effectively a no-op in O2 but included for migration compatibility)
```

### `unelevated` prop

```ts
unelevated?: boolean   // already implicit in O2 (no shadows by default) — kept as a no-op prop for migration compatibility
```

### Icon-only shorthand

When `size="icon"` is used with no label slot and only an icon slot — already supported. Document this clearly.

---

## 5. OButtonGroup Props Specification

```ts
interface ButtonGroupProps {
  /**
   * Visual style applied to ALL child buttons.
   * Children should not set their own variant when inside a group.
   * Maps to: q-btn-group[flat]
   */
  variant?: 'outline' | 'filled' | 'ghost'   // default: 'outline'

  /**
   * Orientation of the group.
   * Vertical is not used in current codebase but included for completeness.
   */
  orientation?: 'horizontal' | 'vertical'    // default: 'horizontal'
}

interface ButtonGroupSlots {
  default: () => unknown   // OButton children
}
```

**Visual behaviour:**
- Children buttons have their border-radius zeroed on the joining edges
- Only the first child gets `rounded-l` and the last gets `rounded-r`
- Adjacent button borders collapse to 1 px (no double border)
- The active/selected state is communicated externally via the parent binding the button's `variant` (e.g. one button gets `ghost`, others get `outline`)

**Note on "segmented control" pattern:** `OButtonGroup` is purely layout. The selected-state logic stays in the consuming component. This is intentional — OButtonGroup does not manage selection state.

---

## 6. ODropdown Props Specification

`ODropdown` is a **compound component**: it renders a trigger (any element, typically `OButton`) and a floating panel. The panel is positioned relative to the trigger using CSS absolute/fixed positioning.

```ts
interface DropdownProps {
  /**
   * Controls whether the dropdown panel is open.
   * Supports v-model for programmatic control.
   * Maps to: q-menu[v-model]
   */
  modelValue?: boolean    // default: undefined (uncontrolled)

  /**
   * Where the panel attaches to the trigger.
   * Format: "<v-position> <h-position>"
   * Maps to: q-menu[anchor]
   */
  anchor?: 'bottom left' | 'bottom right' | 'bottom middle'
         | 'top left' | 'top right' | 'top middle'
         | 'center left' | 'center right'   // default: 'bottom left'

  /**
   * Which point of the panel aligns to the anchor.
   * Maps to: q-menu[self]
   */
  self?: 'top left' | 'top right' | 'top middle'
       | 'bottom left' | 'bottom right' | 'bottom middle'  // default: 'top left'

  /**
   * Pixel offset [x, y] from the computed position.
   * Maps to: q-menu[offset]
   */
  offset?: [number, number]

  /**
   * Whether the panel min-width matches the trigger width.
   * Maps to: q-menu[fit]
   */
  fit?: boolean    // default: false

  /**
   * Whether clicking outside closes the panel.
   * Maps to: q-menu[persistent] = !closeOnClickOutside
   */
  closeOnClickOutside?: boolean   // default: true

  /**
   * Whether clicking any ODropdownItem auto-closes the panel.
   * Maps to: implicit via v-close-popup in children
   */
  closeOnItemClick?: boolean      // default: true
}

interface DropdownEmits {
  (e: 'update:modelValue', value: boolean): void
  (e: 'show'): void
  (e: 'hide'): void
}

interface DropdownSlots {
  /**
   * The trigger element. Receives { open, close, toggle, isOpen }.
   * Maps to: the q-btn that contains q-menu
   */
  trigger: (scope: { open: () => void; close: () => void; toggle: () => void; isOpen: boolean }) => unknown

  /**
   * The panel content (typically ODropdownItem list).
   * Maps to: the content inside q-menu
   */
  default: (scope: { close: () => void }) => unknown
}
```

---

## 7. ODropdownItem Props Specification

```ts
interface DropdownItemProps {
  /** Disables click and mutes styling */
  disable?: boolean    // default: false
  /** If false, clicking this item does NOT close the dropdown */
  closeOnClick?: boolean  // default: true
}

interface DropdownItemEmits {
  (e: 'click', event: MouseEvent): void
}

interface DropdownItemSlots {
  default: () => unknown   // item content (text, icon, etc.)
}
```

`ODropdownItem` automatically injects the parent `ODropdown`'s `close()` function via `inject`, and calls it on click unless `closeOnClick=false`. This replaces `v-close-popup`.

---

## 8. Visual Design

### OButtonGroup — Segmented control

```
┌──────────┬──────────┬──────────┐
│  Option1 │  Option2 │  Option3 │  ← buttons joined, no gap
└──────────┴──────────┴──────────┘
```

- Outer border-radius from `--radius-md`
- Inner dividers: `1px solid --color-border-default`
- Active button: `variant="primary"` or `"filled"`, others: `variant="outline"`

### ODropdown — Floating panel

```
┌────────────────────┐
│  [Trigger Button]  │  ← any slot content
└────────────────────┘
        ↓ (opens)
┌────────────────────┐
│  Menu item 1       │
│  Menu item 2       │
│  ─────────────     │
│  Menu item 3       │
└────────────────────┘
```

- Panel: `--color-surface-overlay`, `--shadow-md`, `--radius-md`, `border border-border-default`
- Min-width: `120px` (overridden by `fit` prop)
- Z-index: `var(--z-dropdown)` (new token)
- Positioning: CSS `position: fixed` on panel, computed via `getBoundingClientRect()` of trigger
- Flip: if panel would overflow viewport bottom → open upward automatically

### ODropdownItem

```
┌────────────────────────────────┐
│  ○  Label text                 │  ← 40px height default, 32px dense
└────────────────────────────────┘
```

- Hover: `--color-grey-50` background
- Active: `--color-grey-100`
- Disabled: 40% opacity, `cursor-not-allowed`

---

## 9. Token Requirements

```css
/* ---- ButtonGroup ---- */
--color-btn-group-divider:    var(--color-border-default);

/* ---- Dropdown ---- */
--color-dropdown-bg:          var(--color-surface-overlay);
--color-dropdown-border:      var(--color-border-default);
--color-dropdown-item-hover:  var(--color-grey-50);
--color-dropdown-item-active: var(--color-grey-100);
--color-dropdown-item-text:   var(--color-text-primary);
--shadow-dropdown:            var(--shadow-md);
--z-dropdown:                 1000;

/* ---- Button dense modifier ---- */
--spacing-btn-height-sm-dense: 1.75rem;   /* 28px */
--spacing-btn-height-md-dense: 2rem;      /* 32px */
```

---

## 10. CSS Override Migration

These `:deep(.q-btn*)` rules must be updated after migration:

| Current class | Count | Replace with |
|---------------|-------|-------------|
| `.q-btn` | 102 | `.o-btn` |
| `.q-btn__content` | 20 | `.o-btn__content` |
| `.q-btn-group` | 7 | `.o-btn-group` |
| `.q-btn--rectangle` | 7 | `.o-btn--default` |
| `.q-btn--flat` | 4 | `.o-btn--ghost` |
| `.q-btn-dropdown__arrow-container` | 3 | `.o-dropdown__arrow` |
| `.q-btn--outline` | 2 | `.o-btn--outline` |

**Total: ~145 CSS override rules across multiple files.**

---

## 11. Migration Pattern

### Flat icon button (most common pattern)

```diff
- <q-btn flat dense round no-caps icon="more_vert" size="sm" @click="handleClick" />
+ <OButton variant="ghost" size="icon" dense @click="handleClick">
+   <template #default><span class="material-icons">more_vert</span></template>
+ </OButton>
```

### Btn group segmented control

```diff
- <q-btn-group>
-   <q-btn :class="type == 'A' ? 'selected' : ''" @click="type = 'A'" label="Option A" />
-   <q-btn :class="type == 'B' ? 'selected' : ''" @click="type = 'B'" label="Option B" />
- </q-btn-group>
+ <OButtonGroup>
+   <OButton :variant="type === 'A' ? 'primary' : 'outline'" @click="type = 'A'">Option A</OButton>
+   <OButton :variant="type === 'B' ? 'primary' : 'outline'" @click="type = 'B'">Option B</OButton>
+ </OButtonGroup>
```

### Btn + dropdown menu

```diff
- <q-btn flat dense icon="more_vert">
-   <q-menu>
-     <q-list dense>
-       <q-item v-close-popup clickable @click="editItem">
-         <q-item-section>Edit</q-item-section>
-       </q-item>
-       <q-item v-close-popup clickable @click="deleteItem">
-         <q-item-section>Delete</q-item-section>
-       </q-item>
-     </q-list>
-   </q-menu>
- </q-btn>
+ <ODropdown>
+   <template #trigger>
+     <OButton variant="ghost" size="icon">
+       <span class="material-icons">more_vert</span>
+     </OButton>
+   </template>
+   <ODropdownItem @click="editItem">Edit</ODropdownItem>
+   <ODropdownItem @click="deleteItem">Delete</ODropdownItem>
+ </ODropdown>
```

---

## 12. Key Decisions to Confirm

Before building, these need team agreement:

1. **`ODropdown` positioning engine** — use pure CSS `position: fixed` + JS `getBoundingClientRect`, or bring in [Floating UI](https://floating-ui.com/) (a ~3KB headless library)? Floating UI handles flip/overflow automatically. **Recommendation: Floating UI** — it's what headless UI libraries use and the skill already documents it as an approved option after user confirmation.

2. **`v-close-popup` replacement strategy** — `provide`/`inject` via `ODropdown` providing `close()` to `ODropdownItem` is the cleanest approach. Directive approach (`v-o2-close`) is an alternative but harder to type-safe.

3. **OButton extension vs new variants** — the `flat`/`round`/`dense` additions modify the existing `OButton`. This must not break existing consumers. Approach: all new props default to `false` so existing usage is unaffected.

---

## 13. Estimated Effort

| Task | Estimate |
|------|----------|
| Extend OButton (shape, dense props) + tests | 1 day |
| OButtonGroup component + tests | 0.5 day |
| ODropdown (positioning + open/close logic) + tests | 2 days |
| ODropdownItem + inject/close + tests | 0.5 day |
| Design tokens | 0.25 day |
| CSS override migration in ~30 files | 1 day |
| Template swap scripted (299 files) | 1 day |
| **Total** | **~6.25 days** |

> **Note:** The 2 days for ODropdown includes the positioning engine. If Floating UI is approved, it drops to ~1.5 days.
