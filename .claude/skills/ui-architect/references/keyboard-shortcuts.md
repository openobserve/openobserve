# Keyboard Shortcuts

Keyboard shortcuts are **registry-driven**. There is one system with three
coordinated parts — don't hand-roll `window.addEventListener("keydown", …)` or
scatter raw key combos through templates:

| Part | Where | Job |
| --- | --- | --- |
| **Registry** | `@/lib/vue-shortcut-manager` → `shortcutRegistry.ts` | Declares every shortcut once by `id`: its key(s), platform variants, i18n description, grouped by module. |
| **Binding** | `useShortcut` / `useShortcuts` composables | Attach behavior to a registered `id` in a component's `setup()`. |
| **Display** | `OShortcut`, and `shortcut-id` on `ODropdownItem` / `OTooltip` | Render the keycaps, resolved from the same registry (platform-aware). |
| **Cheatsheet** | `ShortcutCheatsheet` (mounted once in `MainLayout`) | The global "?" overlay listing all shortcuts. New registry entries appear automatically. |

Because all four read the one registry, a shortcut's key, its label, its keycap
display, and its cheatsheet row never drift apart.

## The workflow: add a shortcut

### 1. Declare it in the registry

Add an entry to the appropriate module group in `shortcutRegistry.ts`. Keys can
be uniform (`key`) or platform-split (`keyForWindows` / `keyForMac`), and the
description is an **i18n key** (add it to `web/src/locales/languages/en-US.json`
under `shortcuts.actions.*`).

```ts
// shortcutRegistry.ts — inside the relevant module's group
{ id: "streamsListAdd",     key: "n",                                          descriptionKey: "shortcuts.actions.streamsListAdd" },
{ id: "streamsListRefresh", keyForWindows: "ctrl+r", keyForMac: "meta+r",      descriptionKey: "shortcuts.actions.streamsListRefresh" },
```

### 2. Bind behavior in the component

In the component's `setup()`, use the **registry-driven `{ id, handler }` form**
— the key(s), scope, and description all come from the registry, so you only
supply the handler:

```ts
import { useShortcuts } from "@/lib/vue-shortcut-manager";

useShortcuts([
  { id: "streamsListAdd",     handler: () => { if (!isInputFocused()) addStream(); } },
  { id: "streamsListRefresh", handler: () => { if (!isInputFocused()) refresh(); } },
]);
```

- `useShortcut(key, handler, options)` binds a **raw key** (`useShortcut("n", …)`)
  — it does **not** resolve a registry `id`, so it skips the registry's platform
  mapping/scope/label. For a single **registry-driven** shortcut use
  `useShortcuts([{ id, handler }])` (the `id` form), and the same for a set.
- **Scope is automatic.** A registry entry's scope is activated while the
  component is mounted and restored on unmount, so page-level shortcuts only fire
  on their page. You rarely pass `scope` explicitly.
- **Guard against firing while typing.** A bare letter shortcut (`n`, `r`, `/`)
  will otherwise trigger mid-word in an input. Gate the handler on a focus check
  (`if (!isInputFocused()) …`), as the existing list views do.

### 3. Display the keycap (where relevant)

Never hardcode `⌘N` text — render from the registry so it stays platform-aware
and in sync:

```vue
<OShortcut id="streamsListAdd" />                  <!-- resolves keys from the registry -->
<ODropdownItem shortcut-id="streamsListAdd" @select="addStream">Add stream</ODropdownItem>
<OTooltip content="Refresh" shortcut-id="streamsListRefresh">…</OTooltip>
```

`OShortcut` also accepts explicit `keys` (`<OShortcut keys="ctrl+enter" />`) for
one-off display not tied to a registered action, but prefer `id`/`shortcut-id`
whenever the shortcut is real and registered.

## Rules

- **Register first, then bind.** A shortcut that isn't in the registry won't show
  in the cheatsheet and can't be displayed by `id`. Prefer the `{ id, handler }`
  binding form over inline `useShortcut("n", …)` raw keys — the registry is the
  single source of truth for key, platform variant, scope, and label.
- **Descriptions are i18n keys** (`shortcuts.actions.*`), never inline English.
- **Don't hand-roll key handling.** No ad-hoc `keydown` listeners for
  app shortcuts — use the manager so scoping, platform mapping, the cheatsheet,
  and conflict handling all work.
- **Display resolves from the registry** — `id` / `shortcut-id`, not literal
  keycap strings in the template.

## Public API (from `@/lib/vue-shortcut-manager`)

- `useShortcut(key, handler, options?)` — bind one shortcut by **raw key** only
  (no registry-`id` resolution; to bind a registered `id`, use
  `useShortcuts([{ id, handler }])`).
- `useShortcuts(inputs[], scope?)` — bind several; each is `{ id, handler }`
  (registry-driven, preferred) or `{ key, handler, … }` (inline).
- `useShortcutList(scope?)` — read the active shortcuts (e.g. to render a custom
  list).
- `ShortcutCheatsheet` — the global cheatsheet component (already mounted app-wide).
- `getShortcutDisplay(id)` / `resolveShortcutKeys(id)` / `getShortcutDef(id)` —
  registry lookups for advanced cases.
- Types: `ShortcutDef`, `ShortcutEntry`, `ShortcutGroup`, `ShortcutModule`, etc.

For `OShortcut`'s display props see [core-display.md](core-display.md#oshortcut);
for `shortcut-id` on menu items and tooltips see
[overlay-navigation.md](overlay-navigation.md).
