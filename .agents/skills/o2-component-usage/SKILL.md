---
name: o2-component-usage
description: Use O2 internal component library components in the OpenObserve web application. Use this skill when writing new views or features, or deciding which O2 component to use for a UI element. Ensures consistent UI by always using O2 components instead of Quasar primitives for standard UI elements.
---

# O2 Component Usage Skill

> **⚠️ DRAFT** — The O2 component library is being built incrementally. This skill only lists components that have been built and confirmed. Do not invent or assume a component exists.

Use this skill when **using** or **composing** O2 components in views, layouts, or feature components.

## Core Principle

**O2 components are the only correct way to render standard UI elements.** Never use a Quasar primitive (`q-btn`, `q-input`, `q-dialog`, etc.) when an O2 equivalent exists.

## Import Pattern

```ts
// Direct import by path (no index.ts per component)
import OButton from '@/lib/core/Button/Button.vue'
import type { ButtonProps } from '@/lib/core/Button/Button.types'
```

All O2 components use the `O` prefix (e.g. `OButton`, `OInput`, `OModal`).

## Available Components

> Only components listed here have been built. For anything not listed, see **"Component Not Available"** below.

| Component | Import path | Status |
|-----------|------------|--------|
| `OButton` | `@/lib/core/Button/Button.vue` | ✅ Built |
| `OSeparator` | `@/lib/core/Separator/Separator.vue` | ✅ Built |

_This table must be updated each time a new component is built and merged._

## Component Not Available?

If the component you need is not in the table above:

1. **Do NOT use a Quasar fallback** (`q-btn`, `q-input`, etc.)
2. **Do NOT use a raw HTML element** without design tokens
3. **Use the `o2-component-create` skill** to build the component first
4. Once built, add it to the table above and then use it

## Usage Rules

1. **No UI decision overrides** — O2 components have baked-in design. Do not try to override border radius, color, or shape through props that don't exist.
2. **Pass only documented props** — check `ComponentName.types.ts` for accepted props.
3. **Use slots as documented** — check the component file for slot names (`icon-left`, `icon-right`, `default`, etc.).

## References

| When | File |
|------|------|
| Full catalog of built components (updated as library grows) | [references/component-catalog.md](references/component-catalog.md) |

