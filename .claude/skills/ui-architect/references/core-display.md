# Core — Display & Content Components

Reference for the O2 display and content primitives under `@/lib/core/*`. Each entry is derived from the component's `.types.ts` and `<script setup>` — props, variants, sizes, slots, and emits are exactly what the source declares.

## Contents

- [OBadge](#obadge)
- [OTag](#otag)
- [ODimensionChip](#odimensionchip)
- [OCard](#ocard)
- [OCardSection](#ocardsection)
- [OCardActions](#ocardactions)
- [OCode](#ocode)
- [OCodeBlock](#ocodeblock)
- [OCollapsible](#ocollapsible)
- [OEmptyState](#oemptystate)
- [OIcon](#oicon)
- [OSeparator](#oseparator)
- [OShortcut](#oshortcut)
- [OText](#otext)
- [OVirtualScroll](#ovirtualscroll)

---

### OBadge
**Import:** `@/lib/core/Badge/OBadge.vue`
**Use when:** You need the low-level badge renderer with full manual control over variant, size, shape, dot, icon, count, and interactivity. In app code you almost never reach for this directly.
**Don't use for:** Application-level badges — use `OTag` instead (it wraps OBadge and adds registry-driven semantic colours/labels). OBadge is used only *inside* OTag.
**Key props:**
- `variant` (default `"default"`) — one of: `default`, `primary`, `success`, `warning`, `error`, `default-outline`, `primary-outline`, `success-outline`, `warning-outline`, `error-outline`, `info-outline`, `purple-outline`, `default-soft`, `primary-soft`, `success-soft`, `warning-soft`, `error-soft`, `teal`, `teal-outline`, `teal-soft`, `orange`, `orange-outline`, `orange-soft`, `lime`, `lime-outline`, `lime-soft`, `amber`, `amber-outline`, `amber-soft`, `cyan`, `cyan-outline`, `cyan-soft`, `blue`, `blue-outline`, `blue-soft`, `purple`, `purple-soft`, `indigo`, `indigo-outline`, `indigo-soft`
- `size` (`xs` | `sm` | `md` — default `md`)
- `shape` (`pill` | `rounded` | `square` — default `pill`)
- `icon` (string — Material icon or OIcon registry name; overridden by `#icon` slot)
- `count` (number — trailing segment; `0` still renders unless `hideZeroCount`)
- `hideZeroCount` (boolean — suppress trailing segment when count is 0)
- `dot` (boolean, default `false` — leading status dot in the badge's foreground colour)
- `clickable` (boolean, default `false` — makes it a keyboard-focusable button that emits `click`)
- `disabled` (boolean, default `false`)

**Slots:** `default` (label), `icon` (custom left content, overrides `icon` prop), `trailing` (custom right content, overrides `count`)
**Emits:** `click` (`[e: MouseEvent | KeyboardEvent]`) — only when `clickable`
**Example:**
```vue
<OBadge variant="success-soft" dot>Active</OBadge>
```
**Family:** Rendered internally by `OTag`. Standalone otherwise.

---

### OTag
**Import:** `@/lib/core/Badge/OTag.vue`
**Use when:** This is THE badge for application code. Use it for any status pill, type chip, or label — either semantic (pass `type` + `value` to resolve colour/icon/dot/label from the badge registry) or manual (pass `variant`/slots like OBadge).
**Don't use for:** Two-segment `key=value` dimension chips — use `ODimensionChip`. Don't reach past it to `OBadge`.
**Key props:**
- `type` (`BadgeGroupName | string` — registry group e.g. `"alertType"`; omit for a manual badge)
- `value` (unknown — raw value resolved against the group)
- `size` (`xs` | `sm` | `md` — precedence: prop → registry → `sm`)
- `shape` (`pill` | `rounded` | `square` — precedence: prop → registry → `pill`)
- `label` (string — override resolved label)
- `variant` (`BadgeVariant` — override resolved colour; same enum as OBadge)
- `icon` (string — override resolved OIcon name; `""` suppresses)
- `dot` (boolean — override leading dot; defaults to registry dot for typed groups)
- `count` (number — trailing count, OBadge passthrough)
- `hideZeroCount` (boolean)
- `clickable` (boolean)
- `disabled` (boolean)
- `emptyLabel` (string, default `"—"` — shown when a typed value is empty)

**Slots:** `default` (label content — wins over `label`), `icon`, `trailing`
**Emits:** `click` (`[e: MouseEvent | KeyboardEvent]`)
**Example:**
```vue
<!-- semantic: colour + icon resolved from the registry -->
<OTag type="alertStatus" value="active" />
<!-- manual passthrough -->
<OTag variant="primary-soft" :count="12">Steps</OTag>
```
**Family:** Wraps `OBadge`. Sibling `ODimensionChip` for key=value chips.

---

### ODimensionChip
**Import:** `@/lib/core/Badge/ODimensionChip.vue`
**Use when:** Displaying a two-segment `key=value` dimension chip (e.g. `service=openobserve`, `k8s-cluster=prod`). Colour is derived from the key via `dimensionVariant()` (exact → substring → stable hash) so the same dimension is the same colour everywhere.
**Don't use for:** Single-label status/type chips — use `OTag`. Do not pass `type="dimensionKey"` to OTag for prefixed keys (it only exact-matches).
**Key props:**
- `dimKey` (string, required — drives the colour)
- `value` (string | number, required — shown in the bold segment)
- `keyLabel` (string — display override for the key segment)
- `tooltip` (boolean, default `false` — show a `key=value` hover tooltip)

**Slots:** none
**Emits:** none
**Example:**
```vue
<ODimensionChip dim-key="k8s-cluster" key-label="cluster" :value="clusterName" tooltip />
```
**Family:** Composes `OTag` + `OTooltip`. Standalone at the call site.

---

### OCard
**Import:** `@/lib/core/Card/OCard.vue`
**Use when:** You need a flat surface container. Always flat — no elevation/variant props. Compose `OCardSection`, `OSeparator`, and `OCardActions` inside it.
**Don't use for:** A raised/modal surface — those are handled by dialog/overlay components. Don't add padding directly; use `OCardSection`.
**Key props:** none (use `class` for layout and sizing)
**Slots:** `default` (card content)
**Emits:** none
**Example:**
```vue
<OCard class="w-full">
  <OCardSection role="header">Title</OCardSection>
  <OSeparator />
  <OCardSection role="body">Content</OCardSection>
</OCard>
```
**Family:** Use with `OCardSection`, `OCardActions`, and `OSeparator`.

---

### OCardSection
**Import:** `@/lib/core/Card/OCardSection.vue`
**Use when:** Defining a semantic zone inside an `OCard`. `role` bundles the correct padding, flex-grow/shrink, and layout for the three standard zones.
**Don't use for:** Action button rows — use `OCardActions`. Outside a card, apply your own classes rather than a role.
**Key props:**
- `role` (`header` | `body` | `footer` — omit for a plain unstyled section)
- `scrollable` (boolean, default `false` — adds `overflow-y: auto`; only meaningful with `role="body"`)

**Slots:** `default`
**Emits:** none
**Example:**
```vue
<OCardSection role="body" scrollable>
  <OText variant="body">Scrollable card content…</OText>
</OCardSection>
```
**Family:** Child of `OCard`. Sibling `OCardActions`.

---

### OCardActions
**Import:** `@/lib/core/Card/OCardActions.vue`
**Use when:** Laying out the action button row (typically `OButton`s) at the bottom of an `OCard`.
**Don't use for:** General card content — use `OCardSection`.
**Key props:**
- `align` (`left` | `center` | `right` | `between` — default `right`)

**Slots:** `default` (action buttons)
**Emits:** none
**Example:**
```vue
<OCardActions align="between">
  <OButton variant="ghost">Cancel</OButton>
  <OButton variant="primary">Save</OButton>
</OCardActions>
```
**Family:** Child of `OCard`. Sibling `OCardSection`.

---

### OCode
**Import:** `@/lib/core/Code/OCode.vue`
**Use when:** Displaying short monospace code — cron expressions, stream/resource IDs, SQL/PromQL/VRL snippets, config values, paths, terminal commands. Inline chip by default; `block` for a scrollable pre/code.
**Don't use for:** Syntax-highlighted multi-line blocks with chrome/masking — use `OCodeBlock`. For non-executable identifiers shown as plain text, prefer `<OText variant="mono">`.
**Key props:**
- `block` (boolean, default `false` — full-width scrollable block vs inline chip)
- `copyable` (boolean, default `false` — shows a copy-to-clipboard button)
- `truncate` (boolean, default `false` — ellipsis; inline mode only)

**Slots:** `default` (code content)
**Emits:** none
**Example:**
```vue
<OCode copyable>0 0 * * *</OCode>
```
**Family:** Standalone. Sibling `OCodeBlock` for highlighted blocks.

---

### OCodeBlock
**Import:** `@/lib/core/Code/OCodeBlock.vue`
**Use when:** Rendering a syntax-highlighted block of code (highlight.js) with a copy button, optional secret masking (Reveal/Hide), and optional window chrome. Copy always copies the raw `code` prop.
**Don't use for:** Short inline code or simple non-highlighted blocks — use `OCode`.
**Key props:**
- `code` (string, required — raw code; copy uses this)
- `lang` (string — fence language, auto-detected when omitted)
- `codeMasked` (string — masked variant shown by default with a Reveal/Hide toggle)
- `chrome` (`terminal` | `editor` — terminal traffic-lights + "Terminal" label, or a filename tab; omit for a plain language label)
- `filename` (string — shown in `editor` chrome, falls back to `lang`)
- `copyable` (boolean, default `true`)
- `copyMessage` (string, default `"Copied to clipboard!"`)
- `revealTooltip` (string, default `"Reveal"`)
- `hideTooltip` (string, default `"Hide"`)
- `dataTest` (string, default `"code-block"` — prefix for toolbar button test ids)

**Slots:** `actions` (extra toolbar actions, rendered left of the copy button)
**Emits:** `copy` (fired after the raw code is copied)
**Example:**
```vue
<OCodeBlock :code="installCmd" lang="bash" chrome="terminal" @copy="onCopied" />
```
**Family:** Composes `OButton`, `OIcon`, `OTooltip`. Sibling `OCode`.

---

### OCollapsible
**Import:** `@/lib/core/Collapsible/OCollapsible.vue`
**Use when:** A show/hide content section with an animated trigger row. Supports uncontrolled (`defaultOpen`), controlled (`v-model`), and accordion (`group`) modes. Two layouts: general content sections and sidebar/config panels.
**Don't use for:** Non-collapsing card sections — use `OCardSection`.
**Key props:**
- `label` (string — trigger label when no `#trigger` slot)
- `icon` (string — Material or OIcon name before the label)
- `caption` (string — secondary text below the label)
- `defaultOpen` (boolean, default `false` — uncontrolled initial state)
- `modelValue` (boolean — controlled state via `v-model`; takes precedence over `defaultOpen`)
- `group` (string — accordion group name; only one open at a time)
- `variant` (`default` | `sidebar` — default `default`; `default` = right chevron/rounded trigger, `sidebar` = left chevron/flush trigger)
- `triggerClass` (string — extra classes on the trigger button)

**Slots:** `default` (body content), `trigger` (custom trigger row, exposes `{ open: boolean }`; hides the built-in chevron)
**Emits:** `update:modelValue` (boolean), `open`, `opened`, `close`, `closed`
**Example:**
```vue
<OCollapsible label="Advanced settings" icon="settings" caption="Optional">
  <OText variant="body">Body content…</OText>
</OCollapsible>
```
**Family:** Built on reka-ui `Collapsible*` + `OIcon`; accordion coordination via `useCollapsibleGroup`. Standalone.

---

### OEmptyState
**Import:** `@/lib/core/EmptyState/OEmptyState.vue`
**Use when:** The app-wide empty-state primitive for "no data / no results" contexts. Driven by a named `preset` (fills illustration + copy + actions) or by props/slots. Three sizes for the three contexts: full page/section (`hero`), inside a card/panel (`block`), inside a table/dropdown (`inline`).
**Don't use for:** Loading/skeleton states, or inline validation errors.
**Key props:**
- `preset` (`EmptyStatePresetName` — named scenario from the catalog; see `EmptyState/presets.ts`)
- `size` (`hero` | `block` | `inline` — default `block`)
- `variant` (`EmptyStateVariant` — tone; defaults from preset, else `neutral`)
- `illustration` (`IllustrationName` — ignored if a preset or `#illustration` slot is set)
- `icon` (`IconName` — compact icon for `inline` size when no illustration)
- `title` (string — overrides preset copy)
- `description` (string — overrides preset copy)
- `actions` (`EmptyStateAction[]` — rich action cards; overrides preset actions)
- `actionLabel` (string — simple primary button; emits `action`)
- `actionIcon` (`IconName`)
- `secondaryActionLabel` (string — emits `secondaryAction`)
- `hideAction` (boolean — suppress preset actions)
- `filtered` (boolean — switches to a "no results" treatment with a Clear-filters action)
- `backdrop` (boolean — force the dot-grid backdrop on/off; default on for hero/block)

**Slots:** `illustration`, `title`, `description`, `actions`, `extra`
**Emits:** `action` (`(id?: string)`), `secondaryAction`
**Example:**
```vue
<OEmptyState preset="no-search-results" filtered @action="clearFilters" />
```
**Family:** Composes `OButton`, `OIcon`, `EmptyStateActionCard`, illustrations, and presets. Standalone.

---

### OIcon
**Import:** `@/lib/core/Icon/OIcon.vue`
**Use when:** Rendering any icon. `name` is an `IconName` from the registry (Material Symbols), or an `img:<path>` string for an external image.
**Don't use for:** Decorative illustrations in empty states — those come from `OEmptyState`.
**Key props:**
- `name` (`IconName | string`, required — registry name or `img:<path>`). There are several hundred registry names; discover them in `@/lib/core/Icon/OIcon.icons.ts` (the exported `iconRegistry` / `IconName` type). Do not guess — check the registry.
- `size` (`xs` | `sm` | `md` | `lg` | `xl` — default `md`; xs=12px, sm=16px, md=24px, lg=32px, xl=40px)
- `label` (string — accessible label; sets `role="img"`, otherwise the icon is `aria-hidden`)

Note: delete/bin icon names render in the destructive (red) colour by default; override with a `text-*` class.
**Slots:** `default` (optional — e.g. to co-locate an `OTooltip`)
**Emits:** none
**Example:**
```vue
<OIcon name="settings" size="sm" label="Settings" />
```
**Family:** Standalone. Used inside most other core components.

---

### OSeparator
**Import:** `@/lib/core/Separator/OSeparator.vue`
**Use when:** Drawing a horizontal or vertical divider line (reka-ui `Separator`, token-coloured).
**Don't use for:** Spacing only — use layout/margin utilities.
**Key props:**
- `vertical` (boolean, default `false` — renders a vertical line instead of horizontal)

**Slots:** none
**Emits:** none
**Example:**
```vue
<OSeparator />
<OSeparator vertical />
```
**Family:** Commonly used inside `OCard`. Standalone.

---

### OShortcut
**Import:** `@/lib/core/Shortcut/OShortcut.vue`
**Use when:** Rendering keyboard shortcut keycaps. Modifier tokens are symbolised and made platform-aware automatically (`ctrl` → `⌘` on Mac / `Ctrl` on Windows, `shift` → `⇧`, `enter` → `↵`, …).
**Don't use for:** Displaying arbitrary code/text — use `OCode` or `OText variant="mono"`.
**Key props:**
- `keys` (`string | string[]` — a combo string like `"ctrl+enter"` renders as ONE keycap; an array renders one keycap per element. Optional when `id` is given)
- `id` (string — registry shortcut id, resolves keys from `shortcutRegistry.ts`; ignored when `keys` is provided)
- `size` (`sm` | `md` — default `sm`)

**Slots:** none
**Emits:** none
**Example:**
```vue
<OShortcut keys="ctrl+enter" />
<OShortcut :keys="['g', 'l']" size="md" />
```
**Family:** Resolves ids via `shortcutRegistry`. Standalone.

---

### OText
**Import:** `@/lib/core/Typography/OText.vue`
**Use when:** The main text component. Pick a `variant` by semantic intent — each maps to a fixed font-size/weight/colour and a default HTML element (overridable via `as`).
**Don't use for:** Executable code/query content — use `OCode` (even for the `mono` case where the text is real code).
**Key props:**
- `variant` (default `"body"`) — one of:
  - `page-title` — 14px medium, page-title colour, `<span>` default (use `as="h1"` for the single page heading)
  - `section` — ~11.5px medium, section colour, `<h2>` default (group labels/eyebrows)
  - `panel-title` — 12px medium, primary colour, `<h3>` default (card/panel headers)
  - `body` — 14px normal, `<p>` default (readable text)
  - `body-strong` — 14px medium, `<strong>` default (emphasized inline)
  - `label` — 12px medium, `<span>` default (form/column sub-labels)
  - `meta` — 12px normal secondary, `<span>` default (timestamps, counts, hints)
  - `mono` — 12px IBM Plex Mono, `<span>` default (cron, IDs, field names — non-linked)
- `as` (string — override the rendered element)
- `truncate` (boolean, default `false` — ellipsis on overflow)
- `nowrap` (boolean, default `false` — prevent wrapping)

**Slots:** `default`
**Emits:** none
**Example:**
```vue
<OText variant="page-title" as="h1">Dashboards</OText>
<OText variant="meta">Updated 2m ago</OText>
```
**Family:** Built on reka-ui `Primitive`. Standalone.

---

### OVirtualScroll
**Import:** `@/lib/core/VirtualScroll/OVirtualScroll.vue`
**Use when:** Rendering a long list efficiently by only mounting visible rows. Generic over the item type; supports fixed or dynamic row heights and an internal or external scroll container.
**Don't use for:** Short lists that fit on screen — render them directly. For full data tables, use the table component.
**Key props:**
- `items` (`T[]`, required — the full array to virtualize)
- `estimateSize` (number, default `40` — estimated per-item height in px)
- `overscan` (number, default `5` — extra items rendered above/below the viewport)
- `scrollTarget` (`HTMLElement | null` — external scroll container; omit/`null` to use the internal one)
- `height` (string — CSS height of the internal container, e.g. `"25rem"` / `"50vh"` (never `px`); default `"100%"`, used only when `scrollTarget` is unset)
- `dynamicRowHeight` (boolean, default `false` — per-element ResizeObserver measurement for variable heights)

**Slots:** `default` (scoped — receives `{ item: T, index: number }`; the positioning wrapper is provided for you)
**Emits:** `virtual-scroll` (`{ startIndex, endIndex, visibleStartIndex, visibleEndIndex }`)
**Exposes:** `scrollToIndex`, `scrollToTop`, `measure`, and `measureElement` (when `dynamicRowHeight`)
**Example:**
```vue
<OVirtualScroll :items="rows" :estimate-size="36" height="24rem" v-slot="{ item }">
  <OText variant="body">{{ item.name }}</OText>
</OVirtualScroll>
```
**Family:** Backed by `useVirtualScroll`. Standalone.
