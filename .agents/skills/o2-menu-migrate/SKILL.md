---
name: o2-menu-migrate
description: Migrate q-menu usages to OMenu in the OpenObserve web project. Use this skill whenever the user asks to replace q-menu with OMenu, migrate a file or component away from Quasar menus, or migrate menu components. Handles all known q-menu prop variants (anchor, self, offset, v-model, content-style, no-route-dismiss) and wraps trigger elements correctly using the slot-based API.
---

# O2 Menu Migration Skill

Replaces `<q-menu>` with `<OMenu>` across one file, a folder, or the whole `web/src/` tree.

## Component location

```
web/src/lib/overlay/Menu/
├── Menu.vue          # OMenu component
├── Menu.types.ts     # Props / emits types
└── Menu.spec.ts      # Vitest tests
```

Import path:
```ts
import OMenu from '@/lib/overlay/Menu/Menu.vue'
```

---

## Prop mapping — q-menu → OMenu

| `q-menu` prop | `OMenu` prop | Notes |
|---------------|--------------|-------|
| `anchor="bottom left"` | `anchor="bottom left"` | Same value, same type |
| `self="top right"` | `self="top right"` | Same value, same type |
| `:offset="[0, 4]"` | `:offset="[0, 4]"` | Identical |
| `v-model="show"` | `v-model="show"` | Identical |
| `content-style="z-index:10001"` | `content-style="z-index:10001"` | Identical |
| `no-route-dismiss` | `persistent` (NOT equivalent — see note) | Drop it unless `persistent` behavior is needed |
| `class="..."` | pass via `v-bind` or add to panel slot | Classes on `q-menu` styled the panel; on `OMenu` the default slot wraps the trigger |

> **`no-route-dismiss`**: In Quasar this keeps the menu open on route change. OMenu has no router awareness. If the caller just used it as a style class (e.g. `no-route-dismiss` with no router navigation in scope), drop the prop entirely.

---

## Template transformation

`q-menu` is always a **child of its trigger element**. OMenu flips this: the **trigger is a child of OMenu** via the default slot, and content goes in the `#content` named slot.

### Pattern 1 — Simple trigger (button wraps q-menu)

```vue
<!-- BEFORE -->
<q-btn @click="...">
  Open
  <q-menu anchor="bottom left" self="top left">
    <q-list>...</q-list>
  </q-menu>
</q-btn>

<!-- AFTER -->
<OMenu anchor="bottom left" self="top left" v-slot="{ toggle }">
  <OButton @click="toggle">Open</OButton>
  <template #content>
    <q-list>...</q-list>
  </template>
</OMenu>
```

### Pattern 2 — v-model controlled

```vue
<!-- BEFORE -->
<q-btn @click="showMenu = true">
  Open
  <q-menu v-model="showMenu">
    <q-list>...</q-list>
  </q-menu>
</q-btn>

<!-- AFTER -->
<OMenu v-model="showMenu" v-slot="{ toggle }">
  <OButton @click="toggle">Open</OButton>
  <template #content>
    <q-list>...</q-list>
  </template>
</OMenu>
```

### Pattern 3 — Sibling trigger (trigger is NOT the direct parent)

When the trigger and `q-menu` are siblings inside a container, wrap both in `OMenu`:

```vue
<!-- BEFORE -->
<div>
  <q-btn ref="triggerRef">Open</q-btn>
  <q-menu :target="triggerRef" anchor="bottom right" self="top right">
    ...
  </q-menu>
</div>

<!-- AFTER -->
<OMenu anchor="bottom right" self="top right" v-slot="{ toggle }">
  <OButton @click="toggle">Open</OButton>
  <template #content>...</template>
</OMenu>
```

### Pattern 4 — Icon/custom trigger (non-OButton trigger)

Use the scoped slot and wire `toggle` directly:

```vue
<OMenu anchor="bottom right" self="top right" v-slot="{ toggle }">
  <button class="..." @click="toggle" aria-haspopup="true">
    <SomeIcon />
  </button>
  <template #content>
    ...
  </template>
</OMenu>
```

---

## Migration workflow

### Step 1 — Scope

Confirm with the user whether they want:
- A **single file** migrated
- A **folder** (e.g. `web/src/components/`)
- The **whole project** (`web/src/`)

### Step 2 — Audit

For the target scope, search for all `q-menu` occurrences:

```
grep -rn "q-menu" <target-path> --include="*.vue"
```

List each file + line number. Group into:
- **Simple** (trigger directly wraps `q-menu`) — automated transform
- **Complex** (nested, sibling, or `:target` patterns) — manual transform

### Step 3 — Transform

For each file:

1. Add import at the top of `<script setup>`:
   ```ts
   import OMenu from '@/lib/overlay/Menu/Menu.vue'
   ```
2. Apply the correct pattern (see patterns above).
3. Remove any `.q-menu { }` SCSS/CSS overrides in the file's `<style>` block — OMenu uses design tokens, not global Quasar class selectors.
4. If `content-style` was used only to set `z-index`, check whether OMenu's default `tw:z-[9999]` is sufficient. If so, drop the prop.

### Step 4 — Verify

After each file:
- Check that `v-model` binding still compiles (boolean ref, same name).
- Check that `anchor`/`self` values are valid `MenuPosition` strings.
- Check that the `#content` slot receives the same children that were inside `q-menu`.
- Remove any orphaned `q-menu` closing tags.

### Step 5 — Update catalog

After all migrations in a session, update [o2-component-usage/references/component-catalog.md](../o2-component-usage/references/component-catalog.md) if `OMenu` is not yet listed there.

---

## What NOT to change

- Content **inside** the menu (`q-list`, `q-item`, `q-item-section`) — leave those as-is; they are Quasar list primitives unrelated to OMenu.
- CSS class selectors targeting `.q-menu` from **other files** (global stylesheets) — flag these to the user; do not silently delete them.
- Any usage in `web/src/lib/` — library components must never use Quasar; if you find `q-menu` there it is a separate bug to report.

---

## Common mistakes to avoid

- **Do not** put both trigger and content in the default slot — content must go in `#content`.
- **Do not** put `@click` on `OMenu` itself — it goes on the trigger element inside the default slot.
- **Do not** remove `v-model` from the parent's reactive state if it was used elsewhere (e.g. to conditionally render other UI).
- **Do not** add `OMenu` inside another `OMenu` unless the inner menu is genuinely a submenu with its own trigger.

---

## Reference

| File | When to read |
|------|-------------|
| [references/q-menu-prop-table.md](references/q-menu-prop-table.md) | Full list of Quasar q-menu props and their OMenu equivalents / drop status |
| `web/src/lib/overlay/Menu/Menu.types.ts` | Exact TypeScript types for all OMenu props |
