# Headless Libraries — Confirmed Safe List

This file tracks headless libraries explicitly confirmed by the project owner for use in the O2 component library.

---

## Confirmation Requirement

**NEVER install or import a headless library without explicit user confirmation.**

Before using any headless primitive, ask:

> "I need headless behavior for [specific behavior]. I recommend using [library name] because [reason]. Can I install and use it?"

Only after the user says **yes** — proceed.

---

## Confirmed Libraries

| Library              | Provides                                                                                                                                                                                                        | Confirmed |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `reka-ui`            | Accessible headless component primitives for Vue 3 — Dialog, DropdownMenu, Select, Tooltip, Popover, Tabs, Combobox, DatePicker, and more. **Preferred headless base for overlay and ARIA-complex components.** | ✅        |
| `@tanstack/vue-form` | Headless form state management (validation, field state, submission)                                                                                                                                            | ✅        |

---

## Reka UI — Usage Rules

`reka-ui` (formerly Radix Vue) provides WAI-ARIA compliant headless primitives. Use it when:

- Building dialogs, drawers, or sheets that require a focus trap
- Building popovers, dropdowns, tooltips, or command menus with floating positioning
- Building accessible Select, Combobox, or DatePicker with keyboard navigation
- Building Tab sets that must comply strictly with the ARIA Tabs pattern

### Import pattern

```ts
import { TabsRoot, TabsList, TabsTrigger, TabsContent } from "reka-ui";
import {
  DialogRoot,
  DialogPortal,
  DialogOverlay,
  DialogContent,
} from "reka-ui";
```

### Style rule

Reka UI components are **unstyled** by default. All visual styling must still come from O2 design tokens and the `tw:` Tailwind prefix. Never import Reka theme CSS.

### DO NOT use Reka UI for:

- Simple toggle buttons, badges, or chips (no headless behavior needed)
- Components already built without it (do not refactor just to add Reka)
- Any Reka primitives not yet confirmed in this file

> All other headless behavior (dropdown positioning, dialogs, virtual scroll, etc.) must be **built from scratch** unless the user confirms a new library.

---

## Build Your Own — Guidance

Use `reka-ui` before building from scratch for ARIA-complex behaviors. For anything not covered by confirmed libraries:

| Behavior               | First check                                         | Fallback approach                                                                    |
| ---------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Accessible Tabs (ARIA) | `reka-ui` TabsRoot/TabsList/TabsTrigger/TabsContent | Manual ARIA role=tablist + keyboard handling                                         |
| Dialog / focus trap    | `reka-ui` DialogRoot                                | `querySelectorAll(focusableSelectors)`                                               |
| Dropdown / popover     | `reka-ui` PopoverRoot                               | `getBoundingClientRect()` + Vue `Teleport`                                           |
| Select / Combobox      | `reka-ui` SelectRoot / ComboboxRoot                 | `getBoundingClientRect()` + listbox ARIA                                             |
| Tooltip                | `reka-ui` TooltipRoot                               | CSS `:hover` + `Teleport`                                                            |
| Click outside          | —                                                   | `onMounted` + `document.addEventListener('click', ...)`, cleaned up in `onUnmounted` |
| Virtual scroll         | `@tanstack/vue-virtual`                             | —                                                                                    |
| Controlled open/close  | —                                                   | Internal `ref<boolean>` + `v-model` pattern                                          |

---

## Already in Project (Still Require Confirmation for `lib/` Use)

| Package                 | Notes                                                    |
| ----------------------- | -------------------------------------------------------- |
| `@tanstack/vue-virtual` | Already installed — confirm before adding to lib/        |
| `lucide-vue-next`       | Icon library — already installed, fine to use directly   |
| `date-fns`              | Date utilities — already installed, fine to use directly |
