# O2 Component — Full Implementation Guide

## Component Grouping

```
web/src/lib/
├── core/          # Button, Badge, Tag, Card, Avatar, Icon
├── forms/         # Input, Textarea, Select, Checkbox, Radio, Switch, Slider, DatePicker, FileUpload, Label
├── navigation/    # Tabs, Breadcrumbs, Pagination, Sidebar, Timeline
├── feedback/      # Toast, Alert, Spinner, Progress
├── overlay/       # Modal, Tooltip, Dropdown, Popover
├── data/          # Table, List, Tree
└── styles/        # Design token CSS files
    └── tokens/
        ├── base.css
        ├── semantic.css
        ├── component.css
        └── dark.css
```

- One group per component, no cross-group imports.
- Shared composables/utilities live in `web/src/lib/shared/`.

---

## Component Families

Some O2 components are **compound families** — a set of related sub-components that always ship together and live in the same folder. When building or migrating one member of a family, **all family members must be implemented together**. Never ship only part of a family.

| Family             | Members (all co-located in same folder)                              | Replaces                                         |
| ------------------ | -------------------------------------------------------------------- | ------------------------------------------------ |
| **Tabs**           | `OTabs`, `OTab`, `ORouteTab`, `OTabPanels`, `OTabPanel`              | `q-tabs`, `q-tab`, `q-tab-panels`, `q-tab-panel` |
| **Button**         | `OButton`, `OButtonGroup`                                            | `q-btn`, `q-btn-group`                           |
| **Modal / Dialog** | `OModal`, `OModalHeader`, `OModalBody`, `OModalFooter`               | `q-dialog` + layout                              |
| **Select**         | `OSelect`, `OSelectItem`, `OSelectGroup`                             | `q-select`                                       |
| **Tooltip**        | `OTooltip` (wraps trigger + content)                                 | `q-tooltip`                                      |
| **Dropdown**       | `ODropdown`, `ODropdownItem`, `ODropdownGroup`, `ODropdownSeparator` | `q-menu`                                         |
| **Checklist**      | `OCheckbox`, `OCheckboxGroup`                                        | `q-checkbox`                                     |
| **Radio**          | `ORadio`, `ORadioGroup`                                              | `q-radio`                                        |
| **Breadcrumbs**    | `OBreadcrumbs`, `OBreadcrumbItem`                                    | `q-breadcrumbs`, `q-breadcrumbs-el`              |
| **Table**          | `OTable`, `OTableColumn`                                             | `q-table`                                        |
| **Form**           | `OForm`, `OFormField`, `OFormLabel`, `OFormError`                    | `q-form` + `q-field`                             |

### Folder layout for a family (Tabs example)

```
web/src/lib/navigation/Tabs/
├── OTabs.vue
├── OTabs.types.ts
├── OTabs.spec.ts
├── OTab.vue
├── OTab.types.ts
├── OTab.spec.ts
├── ORouteTab.vue
├── ORouteTab.types.ts
├── OTabPanels.vue
├── OTabPanels.types.ts
├── OTabPanels.spec.ts
├── OTabPanel.vue
├── OTabPanel.types.ts
└── OTabPanel.spec.ts
```

All family members share a context (e.g. `TABS_CONTEXT_KEY`) via Vue's `provide`/`inject` pattern. The context is defined in the root member's `.types.ts`.

---

## Vue 3 SFC Template

### `{ComponentName}.vue` — with Variants

Variants are implemented as a computed record of class arrays keyed by variant/size values. No CVA (React library) — pure Vue computed + TypeScript.

**Button example** (shows variant + size pattern to follow for all components with visual variants):

```vue
<script setup lang="ts">
import type { ButtonProps, ButtonEmits } from "./Button.types";
import { computed } from "vue";

const props = withDefaults(defineProps<ButtonProps>(), {
  variant: "primary",
  size: "md",
  type: "button",
});

const emit = defineEmits<ButtonEmits>();

// Variant class map — each entry is a full token-based class list
const variantClasses: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: [
    "tw:bg-button-primary tw:text-button-primary-foreground",
    "tw:enabled:hover:bg-button-primary-hover",
    "tw:enabled:active:bg-button-primary-active",
    "tw:focus-visible:ring-4 tw:focus-visible:ring-button-primary-focus-ring",
    "tw:disabled:bg-button-primary-disabled tw:disabled:text-button-primary-foreground",
  ].join(" "),
  secondary: [
    "tw:bg-button-secondary tw:text-button-secondary-foreground",
    "tw:enabled:hover:bg-button-secondary-hover",
    "tw:enabled:active:bg-button-secondary-active",
    "tw:focus-visible:ring-4 tw:focus-visible:ring-button-secondary-focus-ring",
    "tw:disabled:bg-button-secondary-disabled tw:disabled:text-text-disabled",
  ].join(" "),
  outline: [
    "tw:bg-transparent tw:text-button-outline-text tw:border tw:border-button-outline-border",
    "tw:enabled:hover:bg-button-outline-hover-bg tw:enabled:hover:border-button-outline-hover-border",
    "tw:enabled:active:bg-button-outline-active-bg",
    "tw:focus-visible:ring-4 tw:focus-visible:ring-button-outline-focus-ring",
    "tw:disabled:opacity-50",
  ].join(" "),
  ghost: [
    "tw:bg-transparent tw:text-button-ghost-text tw:border-0",
    "tw:enabled:hover:bg-button-ghost-hover-bg",
    "tw:enabled:active:bg-button-ghost-active-bg",
    "tw:focus-visible:ring-4 tw:focus-visible:ring-button-ghost-focus-ring",
    "tw:disabled:text-text-disabled",
  ].join(" "),
  destructive: [
    "tw:bg-button-destructive tw:text-button-destructive-foreground",
    "tw:enabled:hover:bg-button-destructive-hover",
    "tw:focus-visible:ring-4 tw:focus-visible:ring-error-700",
    "tw:disabled:bg-button-destructive-disabled",
  ].join(" "),
};

const sizeClasses: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "tw:h-8 tw:ps-3 tw:pe-3 tw:text-sm tw:gap-1.5 tw:rounded-md",
  md: "tw:h-10 tw:ps-4 tw:pe-4 tw:text-sm tw:gap-2 tw:rounded-lg",
  lg: "tw:h-12 tw:ps-6 tw:pe-6 tw:text-base tw:gap-3 tw:rounded-lg",
  icon: "tw:size-9 tw:p-0 tw:rounded-lg",
};

const classes = computed(() => [
  // Base — layout + typography + interaction
  "tw:inline-flex tw:items-center tw:justify-center tw:whitespace-nowrap",
  "tw:font-medium tw:transition-colors tw:duration-150",
  "tw:outline-none tw:focus-visible:outline-none",
  "tw:disabled:cursor-not-allowed tw:enabled:cursor-pointer",
  // Variant + size
  variantClasses[props.variant ?? "primary"],
  sizeClasses[props.size ?? "md"],
]);

function handleClick(event: MouseEvent) {
  if (props.disabled || props.loading) return;
  emit("click", event);
}
</script>

<template>
  <button
    :class="classes"
    :type="type"
    :disabled="disabled || loading"
    :aria-disabled="disabled || loading"
    :aria-busy="loading || undefined"
    v-bind="$attrs"
    @click="handleClick"
  >
    <slot name="icon-left" />
    <slot />
    <slot name="icon-right" />
  </button>
</template>
```

### `{ComponentName}.types.ts`

```ts
// Button.types.ts — single source of truth for all public types

/** Visual style variant — baked-in design, no style override props */
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "destructive";

/** Size controls height, padding, and font size only */
export type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonProps {
  /** Visual style variant */
  variant?: ButtonVariant;
  /** Component size */
  size?: ButtonSize;
  /** Disables interaction */
  disabled?: boolean;
  /** Shows loading state, disables interaction */
  loading?: boolean;
  /** Native button type */
  type?: "button" | "submit" | "reset";
}

export interface ButtonEmits {
  (e: "click", event: MouseEvent): void;
}
```

Rules:

- ALL types in `.types.ts` — never inline in `.vue`
- Use `interface` for prop objects, `type` for unions/aliases
- JSDoc comment on every prop
- Export only what consumers need
- No `any`, no `Function`, no implicit any

---

## v-model Pattern (Vue 3)

Vue's `v-model` is the standard way to handle two-way binding. There is no separate "controlled/uncontrolled" concept — Vue's reactivity system handles both naturally.

**Simple v-model** (the standard pattern):

```ts
// Input.types.ts
export interface InputProps {
  modelValue?: string;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
}

export interface InputEmits {
  (e: "update:modelValue", value: string): void;
}
```

```vue
<!-- Input.vue -->
<script setup lang="ts">
import type { InputProps, InputEmits } from "./Input.types";

const props = withDefaults(defineProps<InputProps>(), {
  modelValue: "",
  disabled: false,
});

const emit = defineEmits<InputEmits>();

function handleInput(event: Event) {
  emit("update:modelValue", (event.target as HTMLInputElement).value);
}
</script>

<template>
  <input
    :value="modelValue"
    :disabled="disabled"
    :placeholder="placeholder"
    :aria-invalid="!!error"
    v-bind="$attrs"
    @input="handleInput"
  />
</template>
```

Usage in app:

```vue
<OInput v-model="searchQuery" placeholder="Search..." />
<!-- equivalent to: :modelValue="searchQuery" @update:modelValue="searchQuery = $event" -->
```

**Optional default value** (when the component can work standalone without a parent binding):

```ts
export interface InputProps {
  modelValue?: string; // parent-controlled when provided
  defaultValue?: string; // initial value when uncontrolled
}
```

```vue
<script setup lang="ts">
const props = defineProps<InputProps>();
const emit = defineEmits<InputEmits>();

// If modelValue is provided, use it (parent-controlled).
// If not, manage state internally.
const internalValue = ref(props.defaultValue ?? "");

const value = computed(() =>
  props.modelValue !== undefined ? props.modelValue : internalValue.value,
);

function handleInput(event: Event) {
  const v = (event.target as HTMLInputElement).value;
  internalValue.value = v;
  emit("update:modelValue", v);
}
</script>
```

---

## Accessibility Requirements

| Requirement     | Details                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| Keyboard nav    | Tab, Enter, Space, Escape, Arrow keys as appropriate                                                     |
| Focus indicator | `tw:focus-visible:ring-2 tw:focus-visible:ring-offset-2` — never `tw:outline-none` without a replacement |
| ARIA role       | Correct semantic HTML element — prefer native elements over `role=`                                      |
| ARIA states     | `aria-disabled`, `aria-expanded`, `aria-selected`, `aria-busy` as needed                                 |
| Screen reader   | No mouse-only interactions                                                                               |

---

## Tests Template

```ts
// Button.spec.ts
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import OButton from "./Button.vue";

describe("OButton", () => {
  it("renders slot content", () => {
    const wrapper = mount(OButton, { slots: { default: "Save" } });
    expect(wrapper.text()).toBe("Save");
  });

  it("emits click event", async () => {
    const wrapper = mount(OButton);
    await wrapper.trigger("click");
    expect(wrapper.emitted("click")).toHaveLength(1);
  });

  it("does not emit click when disabled", async () => {
    const wrapper = mount(OButton, { props: { disabled: true } });
    await wrapper.trigger("click");
    expect(wrapper.emitted("click")).toBeUndefined();
  });

  it("sets aria-disabled when disabled", () => {
    const wrapper = mount(OButton, { props: { disabled: true } });
    expect(wrapper.attributes("aria-disabled")).toBe("true");
  });

  it("sets aria-busy when loading", () => {
    const wrapper = mount(OButton, { props: { loading: true } });
    expect(wrapper.attributes("aria-busy")).toBe("true");
  });

  it("applies primary variant classes by default", () => {
    const wrapper = mount(OButton);
    expect(wrapper.classes().join(" ")).toContain("tw:bg-button-primary");
  });
});
```

- Coverage ≥ 80%
- No snapshot-only tests
- Test: props, slots, emits, keyboard, ARIA, variant class application

---

## Completion Checklist

- [ ] Located in `web/src/lib/{group}/{ComponentName}/`
- [ ] Files: `ComponentName.vue`, `ComponentName.types.ts`, `ComponentName.spec.ts` (no `index.ts` per component)
- [ ] **Component family complete** — all family members implemented (e.g. OTabs + OTab + OTabPanels + OTabPanel)
- [ ] All types in `ComponentName.types.ts`, none inline in `.vue`
- [ ] No `any`, no implicit any, no `Function` type
- [ ] Every Tailwind class uses `tw:` prefix
- [ ] No hardcoded colors (`tw:bg-[#xxx]`)
- [ ] No `var(--*)` in templates
- [ ] No SCSS anywhere
- [ ] Variant class maps use component tokens; shared values use semantic tokens
- [ ] Component tokens added to `web/src/lib/styles/tokens/component.css` (if new tokens needed)
- [ ] **Dark mode** — every component token has a matching override in `dark.css`
- [ ] **Dark mode** — tested visually with `.dark` class active in browser/dev
- [ ] RTL logical properties used (`tw:ps-*`, `tw:pe-*`, `tw:ms-*`, `tw:me-*`)
- [ ] No Quasar components (`q-*`) inside library component
- [ ] No app-specific imports (no store, router, services, i18n)
- [ ] No cross-group imports within `lib/`
- [ ] No UI decision props (no `rounded?: boolean`, no `bordered?: boolean`)
- [ ] v-model via `modelValue` prop + `update:modelValue` emit
- [ ] Accessibility: keyboard nav, ARIA attributes, visible focus ring
- [ ] Tests: props, slots, emits, keyboard, ARIA, variants
