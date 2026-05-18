# q-avatar Migration — Design Doc

Tracks replacement of all `<q-avatar>` usages in `web/src` with plain `<div>` + `<OIcon>` / `<img>`. **No new component** will be introduced — every observed usage collapses cleanly into a Tailwind-styled `<div>` wrapper.

---

## TL;DR

- **8 template usages** across **7 files**, all reducible to one of three patterns:
  - **Drag-handle grip** in splitter `#separator` (5 usages, identical) — circular icon container.
  - **Logo wrapper** (1 usage) — circular `<img>` container.
  - **Theme-aware avatar with icon** (1 usage) — circular icon container with gradient background.
  - **Inline info bullet** (1 usage) — circular icon container in a dialog body.
- **No semantic justification for a dedicated `OAvatar` component.** Quasar's `q-avatar` is essentially `border-radius:50%` + `display:inline-flex` + fixed size — fully expressible in 3–4 Tailwind utilities. Building a wrapper component for ~8 usages adds indirection without value.
- All required icons (`drag-indicator`, `info`, `person`) already exist in `OIcon.icons.ts`.
- The two gradient backgrounds on the chat user avatar move from SCSS classes to inline gradients (or stay as SCSS — non-blocking).

---

## Replacement strategy

### Pattern A — Circular icon container (`<div>` + `<OIcon>`)

For `<q-avatar icon="X" color="primary" text-color="white" size="..." />`:

```html
<div
  class="bg-primary text-white tw:inline-flex tw:items-center tw:justify-center tw:rounded-full tw:w-5 tw:h-5"
>
  <OIcon name="x" size="xs" />
</div>
```

| `q-avatar` size | Tailwind utility | OIcon size |
|---|---|---|
| `20px` / `1.25rem` | `tw:w-5 tw:h-5` | `xs` |
| `24px` | `tw:w-6 tw:h-6` | `sm` |

**Important:** use Quasar's global `bg-primary` / `text-white` classes (no `tw:` prefix) — they map to `var(--q-primary)` which is the themed primary color. The Tailwind palette only defines `--color-primary-500` etc., so `tw:bg-primary` produces no style. Mixing one Quasar bg/text class with Tailwind sizing/layout is intentional.

### Pattern B — Image wrapper (`<div>` + `<img>`)

For `<q-avatar size="24px"><img :src="..." /></q-avatar>`:

```html
<div class="tw:inline-flex tw:w-6 tw:h-6 tw:rounded-full tw:overflow-hidden">
  <img :src="..." class="tw:w-full tw:h-full tw:object-cover" />
</div>
```

`overflow-hidden` clips the image to the circle; `object-cover` preserves aspect.

### Pattern C — Theme-aware avatar with icon (gradient background)

For the chat user avatar (only one occurrence — keep the existing SCSS classes as-is, just swap the wrapper element):

```html
<div
  class="tw:inline-flex tw:items-center tw:justify-center tw:w-6 tw:h-6 tw:rounded-full"
  :class="store.state.theme === 'dark' ? 'dark-user-avatar' : 'light-user-avatar'"
>
  <OIcon name="person" size="sm" />
</div>
```

The `.light-user-avatar` / `.dark-user-avatar` SCSS classes (gradient backgrounds) at [O2AIChat.vue:6233-6241](web/src/components/O2AIChat.vue:6233) remain untouched.

---

## Capability audit — why no OAvatar component

| `q-avatar` feature | Used in codebase? | Tailwind equivalent | Verdict |
|---|---|---|---|
| `size` prop | Yes (`20px`, `24px`, `1.25rem`) | `tw:w-N tw:h-N` | Inline utility |
| `color` (bg) | Yes (only `primary`) | `tw:bg-primary` | Inline utility |
| `text-color` (fg) | Yes (only `white`) | `tw:text-white` | Inline utility |
| `icon` prop | Yes | Default-slot `<OIcon>` | Native |
| Default slot (image/icon) | Yes | Default-slot child | Native |
| `font-size` | No | n/a | Not needed |
| `rounded` (square) | No | n/a | Not needed |
| `square` (no rounding) | No | n/a | Not needed |

Of 8 usages, 5 are identical splitter grips (clear candidate for a single shared CSS class if duplication itches), 1 logo wrapper, 1 chat user avatar, 1 dialog info icon. Building a wrapper would mean owning a Vue file + types + spec for what amounts to `<div class="tw:rounded-full ...">`.

---

## Occurrence inventory

> Total: **8 template usages**, **7 files**. All replacement targets compile to one of the three patterns above.

### Splitter drag-handle grips (Pattern A — 5 usages)

| Status | File | Line | Current | Replacement |
|---|---|---|---|---|
| `[x]` | `plugins/traces/TraceHeader.vue` | 36 | `<q-avatar color="primary" text-color="white" size="1.25rem" icon="drag_indicator" class="resize-btn" @mousedown="handleMouseDown" data-test="trace-header-resize-btn" />` | `<div class="resize-btn tw:inline-flex tw:items-center tw:justify-center tw:w-5 tw:h-5 tw:rounded-full tw:bg-primary tw:text-white" @mousedown="handleMouseDown" data-test="trace-header-resize-btn"><OIcon name="drag-indicator" size="xs" /></div>` |
| `[x]` | `components/rum/ErrorsList.vue` | 30 | `<q-avatar color="primary" text-color="white" size="1.25rem" icon="drag_indicator" class="tw:top-[0.625rem]" />` | `<div class="tw:inline-flex tw:items-center tw:justify-center tw:w-5 tw:h-5 tw:rounded-full tw:bg-primary tw:text-white tw:top-[0.625rem]"><OIcon name="drag-indicator" size="xs" /></div>` |
| `[x]` | `components/dashboards/addPanel/CustomHTMLEditor.vue` | 40 | `<q-avatar color="primary" text-color="white" size="20px" icon="drag_indicator" style="top: 10px; left: 3.5px" data-test="dashboard-html-editor-drag-indicator" />` | `<div class="tw:inline-flex tw:items-center tw:justify-center tw:w-5 tw:h-5 tw:rounded-full tw:bg-primary tw:text-white" style="top: 10px; left: 3.5px" data-test="dashboard-html-editor-drag-indicator"><OIcon name="drag-indicator" size="xs" /></div>` |
| `[x]` | `components/dashboards/addPanel/CustomMarkdownEditor.vue` | 43 | same pattern with `data-test="dashboard-markdown-editor-drag-indicator"` | same pattern, swap data-test |
| `[x]` | `components/dashboards/PanelEditor/PanelEditor.vue` | 552 | same pattern with `data-test="panel-editor-custom-chart-drag-indicator"` | same pattern, swap data-test |

> **Note:** The `resize-btn` SCSS class in `TraceHeader.vue:184` (`position: absolute; right: -0.625rem; top: -0.125rem; z-index: 10; cursor: col-resize;`) stays — preserves splitter handle positioning.

### Logo wrapper (Pattern B — 1 usage)

| Status | File | Line | Current | Replacement |
|---|---|---|---|---|
| `[x]` | `components/O2AIChat.vue` | 22 | `<q-avatar size="24px"><img :src="o2AiTitleLogo" /></q-avatar>` | `<div class="tw:inline-flex tw:w-6 tw:h-6 tw:rounded-full tw:overflow-hidden"><img :src="o2AiTitleLogo" class="tw:w-full tw:h-full tw:object-cover" /></div>` |

### Theme-aware avatar with icon (Pattern C — 1 usage)

| Status | File | Line | Current | Replacement |
|---|---|---|---|---|
| `[x]` | `components/O2AIChat.vue` | 334 | `<q-avatar v-if="message.role === 'user'" size="24px" :class="store.state.theme == 'dark' ? 'dark-user-avatar' : 'light-user-avatar'"><OIcon size="sm" name="person" :color="..." /></q-avatar>` | `<div v-if="message.role === 'user'" class="tw:inline-flex tw:items-center tw:justify-center tw:w-6 tw:h-6 tw:rounded-full" :class="store.state.theme == 'dark' ? 'dark-user-avatar' : 'light-user-avatar'"><OIcon size="sm" name="person" :color="..." /></div>` |

> **Note:** `.light-user-avatar` / `.dark-user-avatar` gradient classes stay in `<style>` block.

### Inline info bullet (Pattern A — 1 usage)

| Status | File | Line | Current | Replacement |
|---|---|---|---|---|
| `[x]` | `components/iam/users/AddUser.vue` | 234 | `<q-avatar icon="info" color="primary" text-color="white" />` | `<div class="tw:inline-flex tw:items-center tw:justify-center tw:w-10 tw:h-10 tw:rounded-full tw:bg-primary tw:text-white"><OIcon name="info" size="md" /></div>` |

> **Note:** No explicit size on the original — Quasar's `q-avatar` defaults to 48px when no `size` prop is set. `w-10 h-10` (40px) ≈ default visual weight; verify against the dialog mock to pick the right size.

---

## Icon name mapping

| `q-avatar icon` (Material) | `OIcon name` (kebab-case) | Already in OIcon.icons.ts? |
|---|---|---|
| `drag_indicator` | `drag-indicator` | ✅ line 473 |
| `info` | `info` | ✅ line 323 |
| `person` (slot usage only) | `person` | ✅ line 345 |

No new icons need to be registered.

---

## Out-of-scope / not migrating

| File | Reason |
|---|---|
| `src/layouts/MainLayout.vue:150,228` | Imports `QAvatar` from quasar + registers as global component. Leave registration intact until all template usages are gone, then drop the import. |
| `src/components/rum/SessionsList.spec.ts:134` | Test fixture uses `<q-avatar data-test="avatar" />` as a stub. Update after the parent component (if any) is migrated; not a real usage. |
| `src/components/dashboards/PanelEditor/PanelEditor.spec.ts:284` | Test stub `QAvatar: true` — remove after parent template is migrated. |
| `src/views/RUM/AppSessions.spec.ts:215,660,804` | Test stubs `QAvatar: { template: "<div><slot /></div>" }` — these already prove the migration is mechanical. Remove after parent templates migrate. |

---

## Post-migration cleanup

After all 8 template usages are migrated:

1. Remove the `QAvatar` import and component registration in `src/layouts/MainLayout.vue:150` and `:228`.
2. Remove `QAvatar` stubs/mocks from all `*.spec.ts` files listed above.
3. Add `q-avatar` to the ESLint `vue/no-restricted-syntax` rule alongside `q-badge` / `q-chip` to prevent re-introduction.
4. Optional: extract the 5 identical drag-grip blocks into a single `class="o-drag-grip"` SCSS utility class if duplication becomes a maintenance concern. Not necessary for correctness.

---

## Status legend

| Symbol | Meaning |
|---|---|
| `[x]` | Not started |
| `[x]` | Done |
| `[!]` | Special handling — see note |

## Progress summary

| Pattern | Total usages | Done | Remaining |
|---|---|---|---|
| A — Circular icon container | 6 | 0 | 6 |
| B — Image wrapper | 1 | 0 | 1 |
| C — Theme-aware gradient avatar | 1 | 0 | 1 |
| **Total** | **8** | **0** | **8** |

| Cleanup | Status |
|---|---|
| Drop `QAvatar` from `MainLayout.vue` | `[x]` |
| Remove `QAvatar` test stubs (4 files) | `[x]` |
| Add `q-avatar` to ESLint restricted-syntax | `[x]` |

_Update this table as files are completed._
