# Creating a New O2 Component

How to build a new reusable component in the O2 library (`web/src/lib/`) — the folder contract, API rules, tokens, forms, and the build workflow.

## Table of Contents

1. [Where it lives: `lib/` vs `components/`](#1-where-it-lives-lib-vs-components)
2. [Folder contract](#2-folder-contract)
3. [Component families ship together](#3-component-families-ship-together)
4. [Headless-first (reka-ui / vue-form)](#4-headless-first)
5. [No UI-prop leakage — variant + size only](#5-no-ui-prop-leakage)
6. [Strict TypeScript](#6-strict-typescript)
7. [Design tokens for a new component](#7-design-tokens)
8. [Form components: `OX` + `OFormX`](#8-form-components)
9. [Build workflow](#9-build-workflow)
10. [Testing](#10-testing)
11. [After building](#11-after-building)

---

## 1. Where it lives: `lib/` vs `components/`

**`web/src/lib/` — generic, zero app logic.** A library component knows nothing about the app. No Vuex store, no Vue Router, no `useI18n`, no service/API imports, no cross-import from `web/src/components/`. It receives data through props and communicates through emits only.

**`web/src/components/` — app-specific compositions.** The moment a UI needs a store, a route, i18n text, or an API call, it is an app composition — build it in `web/src/components/` (or a view) by composing O2 primitives. Do not push that logic down into `lib/`.

Groups under `lib/`: `core/`, `forms/`, `navigation/`, `overlay/`, `feedback/`, `data/`, `lists/`. Never cross-import between groups.

---

## 2. Folder contract

**New** components — and every member of a family — get their own three files, co-located in the family folder, all `O`-prefixed. (A few older components predate this and carry an `index.ts` barrel or declare props inline in the `.vue` — e.g. `OEmptyState`; follow the contract below for anything new rather than copying those.)

```
web/src/lib/{group}/{Family}/
├── O{Name}.vue          # the component
├── O{Name}.types.ts     # its props/emits/slots types — this component only
└── O{Name}.spec.ts      # its tests — this component only
```

Real example — `web/src/lib/core/Button/`:

```
OButton.vue      OButton.types.ts      OButton.spec.ts
OButtonGroup.vue OButtonGroup.types.ts OButtonGroup.spec.ts
```

Rules:

- **Never share** a `.types.ts` or `.spec.ts` across two components. A change to `OButtonGroup` touches only its own three files.
- **All types live in `.types.ts`** — never declare a props/emits interface inline in the `.vue`.
- **No per-component `index.ts` barrel.** Import by full path:
  ```ts
  import OButton from "@/lib/core/Button/OButton.vue";
  import type { ButtonProps } from "@/lib/core/Button/OButton.types";
  ```
- A large compound component may co-locate one helper (e.g. `useOForm.ts`, `fieldError.ts`) — that's the only permitted extra file.

---

## 3. Component families ship together

A compound family is one folder with multiple members that share a `provide`/`inject` context. **Build and ship the whole family — never half of one.** Existing families:

| Family | Members (co-located) |
| --- | --- |
| Button | `OButton`, `OButtonGroup` |
| Tabs | `OTabs`, `OTab`, `ORouteTab`, `OTabPanels`, `OTabPanel` |
| Select | `OSelect`, `OSelectItem`, `OSelectGroup` (+ `OFormSelect`) |
| Dropdown | `ODropdown` + item/group/separator members |

The shared context (its `InjectionKey`) is defined in the root member's `.types.ts` and provided by the root, injected by children.

---

## 4. Headless-first

For ARIA-complex behavior (Dialog, Drawer, Tabs, Select, Popover, Combobox, Dropdown, Tooltip — focus traps, listbox keyboard nav, floating positioning), build on **`reka-ui`** primitives rather than hand-rolling ARIA. `ODialog`, `OSelect`, `OSelectGroup`/`OSelectItem` all import from `reka-ui` today.

- Forms use **`@tanstack/vue-form`** (via `OForm`) — see §8.
- Reka primitives are **unstyled** — all appearance still comes from O2 tokens + bare Tailwind utilities. Never import a Reka theme CSS.
- Simple components (Badge, Separator, a plain button) need **no** reka — don't add it just to add it.
- **`reka-ui` and `@tanstack/vue-form` are the only approved headless libs.** Never install another (or pull a new reka behavior you're unsure about) without explicit user confirmation.

---

## 5. No UI-prop leakage

A component bakes its design in. It exposes **intent**, never **appearance**. Only three prop categories are allowed:

| Category | Examples | Why |
| --- | --- | --- |
| Semantic **variant** | `variant="primary" \| "ghost" \| "outline"` | communicates intent |
| Semantic **size** | `size="sm" \| "md" \| "lg"` | adapts without exposing pixels |
| **State** | `disabled`, `loading`, `readonly` | behavioral flags |

**Banned props** — anything whose only job is to change a CSS value:

- shape/radius toggles (`rounded`, `pill`, `square`, `sharp`)
- color overrides (`color`, `text-color`, `bg-color`, `flat`)
- border toggles (`bordered`, `no-border`)
- spacing overrides (`dense`, `padding`, `compact`)
- pass-through `class`/`style` for restyling

A genuinely new visual need = **a new named `variant`**, not a style escape hatch. If a real usage can't be expressed with the current variants, stop and add a variant to the component before shipping the usage.

Implement variants as a computed class map keyed by the variant/size value (no CVA — plain Vue `computed` + TS):

```ts
const variantClasses: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-button-primary text-button-primary-foreground hover:bg-button-primary-hover",
  ghost:   "bg-transparent text-button-ghost-text hover:bg-button-ghost-hover-bg",
};
```

---

## 6. Strict TypeScript

- `<script setup lang="ts">` always. **No `// @ts-nocheck`.**
- Props/emits via generics — `defineProps<ButtonProps>()`, `defineEmits<ButtonEmits>()` — never the runtime object form (`defineProps({ size: String })`).
- **All** interfaces/types in the `.types.ts`; import them with `import type`.
- **No `any`, no `as any`, no implicit any.** Type every parameter, return, and template ref (`ref<HTMLInputElement | null>(null)`).
- Prefer unions over broad strings (`"sm" | "md" | "lg"`, not `string`). Use `interface` for prop objects, `type` for unions. JSDoc each prop.
- Use `withDefaults(defineProps<...>(), { ... })` for optional props with defaults.

```ts
// OButton.types.ts
export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonProps {
  /** Visual style variant */
  variant?: ButtonVariant;
  /** Controls height, padding, font size */
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
}
export interface ButtonEmits {
  (e: "click", event: MouseEvent): void;
}
```

Two-way binding uses the standard `modelValue` prop + `update:modelValue` emit (`v-model`).

---

## 7. Design tokens

**Every color and every dimension is a token — no hardcoded values anywhere.**
(Full token guide, registration steps, and the `--o2-*` → `--color-*` map:
[design-tokens.md](design-tokens.md).)

- **Colors: only the modern `--color-*` tokens.** Reach them through token utilities (`bg-surface-panel`, `text-text-heading`, `bg-button-primary`) or `var(--color-*)` in a CSS file / component-token block (never a raw `var()` in the `.vue` template — see next bullet). The legacy `--o2-*` vocabulary is **banned** — never use it, never define it, and never add a `.body--dark` block. Retired aliases `text-text-primary`/`-caption` → `text-text-heading`/`-secondary`.
- **Corner radius: `rounded-default` (controls) / `rounded-surface` (card/panel surfaces) / `rounded-full`** — never `rounded-[..]` or the retired `rounded-{sm,md,lg,xl}`. A reusable card/panel component rounds with `rounded-surface`.
- **No hardcoded px anywhere** — including inside Tailwind arbitrary values. `w-[320px]` is banned. Use the rem-based scale (`w-80`, `h-10`, `px-4`) or `rem` / `%` / `vh` / `vw`. `1px` hairline borders are the only exception.
- **No `var(--*)` in `.vue` templates** and **no hex in components** — go through token utilities.

Token files live in `web/src/lib/styles/tokens/`:

| File | Layer |
| --- | --- |
| `base.css` | raw palette (`:root`) — the only place literal hex lives; never referenced in components |
| `semantic.css` | `@theme inline` — shared meaning (`--color-text-primary`, `--color-surface-panel`, `--color-border-default`) |
| `component.css` | `@theme inline` — per-component tokens (`--color-button-primary`) |
| `dark.css` | dark overrides under `.dark` |

**Adding a new component token:** define it in `component.css` inside `@theme inline`, referencing a semantic/base token (never a raw value):

```css
/* component.css */
@theme inline {
  --color-mywidget-bg: var(--color-surface-panel);
  --color-mywidget-accent: var(--color-primary-600);
}
```

Then add a dark override in `dark.css` **only if** the token uses base-palette values that must flip for dark — a token that already points at a semantic token inherits dark mode for free:

```css
/* dark.css — the real selector, no .dark-theme, no .body--dark */
:root.dark,
.dark :root,
.dark {
  --color-mywidget-accent: var(--color-primary-400);
}
```

> The registration is Tailwind v4 `@theme inline`, so `--color-mywidget-bg` becomes usable as `bg-mywidget-bg`. Use RTL logical utilities (`ps-*`/`pe-*`, `rounded-s-*`/`rounded-e-*`).

---

## 8. Form components

A form field ships as **two** components (see `forms-validation.md` for the full binding contract):

1. **`OX`** — the headless, form-unaware field (e.g. `OInput`, `OSelect`). Takes `modelValue`, `error`, `errorMessage`, emits `update:modelValue` and `blur`. Reusable anywhere.
2. **`OFormX`** — the form-bound wrapper (e.g. `OFormInput`, `OFormSelect`), co-located in the same folder. It:
   - `inject(FORM_CONTEXT_KEY, null)` from `web/src/lib/forms/Form/OForm.types` (the key `OForm` provides),
   - renders the TanStack `form.Field` via `<component :is="form.Field" :name="props.name">`,
   - binds `:model-value="field.state.value"`, `@update:model-value="field.handleChange"`, `@blur="field.handleBlur"`,
   - surfaces validation with `firstFieldError(field.state.meta.errors)` from `../Form/fieldError`, passing it down as `:error` / `:error-message`,
   - forwards the presentational slots of `OX` so the bound version keeps every affordance.

Model the new `OFormX` on `web/src/lib/forms/Input/OFormInput.vue`. Never mirror form state into a local `ref`/`v-model` — the name-bound field is the single source of truth.

---

## 9. Build workflow

Ordered, but lightweight. **No code before analysis.**

1. **Analysis** — confirm the component doesn't already exist in `lib/`; if you're replacing an existing element, grep every usage/prop/slot/variant across `web/src/` and list them. The goal: enumerate every real visual pattern so the variant set covers them all.
2. **Design** — from the analysis, define the minimal `variant`/`size`/state prop set (§5), scope the full family (§3), and write the `.types.ts` contract first. Every observed visual pattern must map to a named variant or be an intentionally dropped prop.
3. **Implement** — write the `.vue` with token utilities and the computed variant map; register any new tokens (§7); reach for `reka-ui` on ARIA-complex behavior (§4). Add a `data-test` (`<module>-<file>-<descriptor>`, kebab-case) to every interactive/key element.
4. **Test** — write the `.spec.ts` (§10).
5. **Validate** — run the checklist: no banned props, no px, no hex, no `var(--*)` in template, no `--o2-*`, family complete, dark mode reads correctly, a11y (keyboard + focus ring + ARIA) verified.

---

## 10. Testing

Vitest + `@vue/test-utils`, one `.spec.ts` per component (co-located). Test **behavior, a11y, variants, and dark-mode-via-tokens** — not snapshots.

```ts
// OButton.spec.ts
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OButton from "./OButton.vue";

describe("OButton", () => {
  it("should emit click when enabled", async () => {
    const wrapper = mount(OButton, { slots: { default: "Save" } });
    await wrapper.trigger("click");
    expect(wrapper.emitted("click")).toHaveLength(1);
  });

  it("should not emit click when disabled", async () => {
    const wrapper = mount(OButton, { props: { disabled: true } });
    await wrapper.trigger("click");
    expect(wrapper.emitted("click")).toBeUndefined();
  });

  it("should set aria-disabled when disabled", () => {
    const wrapper = mount(OButton, { props: { disabled: true } });
    expect(wrapper.attributes("aria-disabled")).toBe("true");
  });

  it("should apply the ghost variant classes", () => {
    const wrapper = mount(OButton, { props: { variant: "ghost" } });
    expect(wrapper.classes().join(" ")).toContain("bg-transparent");
  });
});
```

- **reka-ui context:** a child that needs its root's provided context can't mount standalone — render it inside an open parent (a `mountItemInParent()` helper). Import `h` from `"vue"`, never from `"vitest"`.
- Assert specific values, not just `.toBeDefined()`. Query only by `data-test`.
- Run: `cd web && npm run test:unit -- src/lib/{group}/{Family}/O{Name}.spec.ts`

---

## 11. After building

1. **Add the component to this skill's catalog** — the sibling reference files in this folder are grouped by domain: `core-controls-table.md`, `core-display.md`, `forms-inputs.md`, `forms-specialized.md`, `forms-validation.md`, `feedback-data.md`, `overlay-navigation.md`, `keyboard-shortcuts.md`. Document the new component (props, variants, usage) in the matching file so consumers can find it.
2. **Lint + type-check** (from `web/`): `npm run lint` then `npm run type-check`. Fix everything before declaring done. Do **not** run `npm run build`.
