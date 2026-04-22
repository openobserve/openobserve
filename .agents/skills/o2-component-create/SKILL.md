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
- **TypeScript**: Strict — see [references/typescript-rules.md](references/typescript-rules.md)
- **Testing**: Vitest + `@vue/test-utils`
- **Headless libraries**: **NEVER install without user confirmation** — see [references/headless-libraries.md](references/headless-libraries.md)

## Library Location

```
web/src/lib/
├── core/          # Button, Badge, Tag, Card, Avatar, Icon
├── forms/         # Input, Textarea, Select, Checkbox, Radio, Switch, Slider, DatePicker, FileUpload, Label
├── navigation/    # Tabs, Breadcrumbs, Pagination, Sidebar, Timeline
├── feedback/      # Toast, Alert, Spinner, Progress
├── overlay/       # Modal, Tooltip, Dropdown, Popover
├── data/          # Table, List, Tree
└── styles/        # Design token CSS files (base, semantic, component, dark)
```

> **Why `lib/`?** The existing `web/src/components/` folder contains app-level Quasar components. The O2 library lives in `web/src/lib/` to avoid conflicts and clearly separate generic reusable primitives from app-specific components.

## Component Scope Rule

**Library components must be generic — zero app-specific logic.**

- No API calls, no Pinia store imports, no Vue Router imports, no i18n keys
- Components accept data via props and communicate via emits only
- If a feature needs multiple library components composed with app logic, that composition belongs in `web/src/components/` (app-level), not in `web/src/lib/`
- Existing `web/src/components/` files must **not** be modified as part of library work

## Folder Contract

```
web/src/lib/{group}/{ComponentName}/
├── {ComponentName}.vue          # SFC: template + script setup (no <style> unless pseudo-element CSS is unavoidable)
├── {ComponentName}.types.ts     # ALL public props, emits, slots — single source of truth
└── {ComponentName}.spec.ts      # Vitest + @vue/test-utils tests
```

**No `index.ts` per component.** Import directly by path:
```ts
import OButton from '@/lib/core/Button/Button.vue'
import type { ButtonProps } from '@/lib/core/Button/Button.types'
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

### Step 2 — Decide Design Tokens
- List every visual property the component needs
- Map to existing semantic tokens where possible
- Create new component tokens only for values unique to this component
- Add tokens to `web/src/lib/styles/tokens/component.css`
- See [references/design-tokens.md](references/design-tokens.md) for naming conventions

### Step 3 — Check Headless Library Need
- If the component requires complex behavior (dropdown positioning, date picker calendar, virtual scroll, etc.) that would need a headless library primitive:
  - **STOP** — do NOT install any library
  - Ask the user: "I need a headless primitive for [behavior]. I recommend using [library name]. Can I install it?"
  - Only proceed after explicit confirmation
  - See [references/headless-libraries.md](references/headless-libraries.md) for the confirmed-safe list

### Step 4 — Implement
- Follow the Vue 3 SFC templates in [references/component-guide.md](references/component-guide.md)
- All types in `.types.ts`, none inline in `.vue`
- Strict TypeScript — no `any`, no implicit any
- Every Tailwind class with `tw:` prefix
- RTL logical properties: `tw:ps-*`/`tw:pe-*`, not `tw:pl-*`/`tw:pr-*`
- No SCSS. No `var(--*)` in templates. No hardcoded colors.
- Variants via computed class map — see [references/component-guide.md](references/component-guide.md) § Variants
- Accessibility: keyboard navigation, ARIA attributes, visible focus indicator

### Step 5 — Write Tests
- See [references/component-guide.md](references/component-guide.md) § Tests for template
- Cover: props, slots, emits, keyboard navigation, ARIA

### Step 6 — Validate
Run through the checklist in [references/component-guide.md](references/component-guide.md) § Completion Checklist before declaring done.

## Workflow: Audit / Refactor

1. **Structure** — Correct `lib/` folder/file names, no `index.ts` per component?
2. **TypeScript** — No `any`, all types in `.types.ts`?
3. **Tokens** — No hardcoded colors, no SCSS, no `var(--*)` in templates?
4. **Quasar removal** — No `q-*` components inside library components?
5. **Generic** — No app-specific logic (no store, router, API imports)?
6. **Accessibility** — ARIA, keyboard, focus ring?
7. **Tests** — Coverage, no snapshot-only?

## Critical Rules

- **NEVER** use Quasar components (`q-btn`, `q-input`, etc.) inside O2 library components
- **NEVER** expose UI decision props (e.g. `rounded?: boolean`, `bordered?: boolean`) — design is baked in
- **NEVER** use `var(--*)` in templates — Tailwind utilities only
- **NEVER** use hardcoded colors (`tw:bg-[#4f46e5]`)
- **NEVER** use SCSS — only `.css` token files and Tailwind
- **NEVER** install a headless library without user confirmation
- **NEVER** cross-import between library groups
- **NEVER** import from `web/src/components/`, stores, router, or services inside `lib/`
- **ALWAYS** use `tw:` prefix on every Tailwind utility

## References

| When | File |
|------|------|
| Full folder contract, SFC templates, completion checklist | [references/component-guide.md](references/component-guide.md) |
| Token layers, naming, dark mode, component.css | [references/design-tokens.md](references/design-tokens.md) |
| Strict TypeScript rules for Vue 3 | [references/typescript-rules.md](references/typescript-rules.md) |
| Headless library confirmed-safe list | [references/headless-libraries.md](references/headless-libraries.md) |
