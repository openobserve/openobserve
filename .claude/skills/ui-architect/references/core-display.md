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
- [OSettingRow](#osettingrow)
- [OSettingRowPair](#osettingrowpair)
- [OShortcut](#oshortcut)
- [OText](#otext)
- [OTruncatedText](#otruncatedtext) — cut text ("…") + full-text tooltip only when cut
- [OVirtualScroll](#ovirtualscroll)

---

### OBadge

**Import:** `@/lib/core/Badge/OBadge.vue`
**Use when:** You need the low-level badge renderer with full manual control over variant, size, shape, dot, icon, count, and interactivity. In app code you almost never reach for this directly.
**Don't use for:** Application-level badges — use `OTag` instead (it wraps OBadge and adds registry-driven semantic colours/labels). OBadge is used only _inside_ OTag.
**Key props:**

- `variant` (default `"default"`) — one of: `default`, `primary`, `success`, `warning`, `error`, `default-outline`, `primary-outline`, `success-outline`, `warning-outline`, `error-outline`, `info-outline`, `purple-outline`, `default-soft`, `primary-soft`, `success-soft`, `warning-soft`, `error-soft`, `teal`, `teal-outline`, `teal-soft`, `orange`, `orange-outline`, `orange-soft`, `lime`, `lime-outline`, `lime-soft`, `amber`, `amber-outline`, `amber-soft`, `cyan`, `cyan-outline`, `cyan-soft`, `blue`, `blue-outline`, `blue-soft`, `purple`, `purple-soft`, `indigo`, `indigo-outline`, `indigo-soft`
- `size` (`xs` | `sm` | `md` — default `md`)
- `shape` (`pill` | `rounded` | `square` — default `pill`).
  **Strict: badges are `pill` by default and STAY pill.** Do not pass `rounded`
  or `square` — never pick a badge shape by eye. Only set another shape when a
  design explicitly calls for it, and for a typed `OTag` that shape lives in the
  badge-registry group (`badgeGroups.ts`), never as a call-site prop.
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

> **Rule (strict) — styling lives in the registry, never at the call site.**
> A semantic `<OTag>` in application code carries **only `type` + `value`** (plus
> `label`/`count`/`#default` for genuinely dynamic *content* the registry cannot
> enumerate — a version string, an instance name, a live count). Every VISUAL
> decision — `variant`, `size`, `shape`, `icon`, `dot` — belongs in the group's
> entry in `badgeGroups.ts`, **not** as a per-call prop, so one edit restyles
> every use and the look cannot drift between call sites. The style-override props
> listed below exist for the low-level library and one-off *manual* passthrough
> badges (no `type`) only — do not use them to re-style a typed badge.
>
> A badge that must look different **in a different context** gets its own
> registry **group** (e.g. a distinct `type`), not a call-site override. If you
> find yourself writing `<OTag type="x" value="y" size="md" shape="pill">`, the
> size/shape belong in group `x` (or a new group), not on the tag.
**Key props:**

- `type` (`BadgeGroupName | string` — registry group e.g. `"alertType"`; omit for a manual badge)
- `value` (unknown — raw value resolved against the group)
- `size` (`xs` | `sm` | `md` — precedence: prop → registry → `sm`)
- `shape` (`pill` | `rounded` | `square` — precedence: prop → registry → `pill`).
  Default is `pill` and stays pill; a group sets `rounded`/`square` in
  `badgeGroups.ts` only when a design explicitly calls for it — never a call-site
  shape override.
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
- `tooltip` (boolean, default `false` — show an always-on `key=value` hover tooltip instead of the value's own one)
- `valueTooltip` (boolean, default `true` — a cut value shows its full text on hover; set `false` when an enclosing element already explains the chip, e.g. a row whose `title` holds the full sentence, so only one bubble opens)

**Slots:** none
**Emits:** none
**Example:**

```vue
<ODimensionChip
  dim-key="k8s-cluster"
  key-label="cluster"
  :value="clusterName"
  tooltip
/>
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
- `truncate` (boolean, default `false` — ellipsis; inline mode only). A cut value shows its full text on hover, only while it is cut.
- `tooltip` (I18nText | `false` — with `truncate`: hover text when cut, defaults to the value; **`false` for secrets** such as API keys and tokens, which must never show on hover)

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

**Rich list row** — one item per row: name + status on line 1, the detail on one
truncated line, the full detail when opened (copy-and-values.md § One line per item).
The `#trigger` slot hides the built-in chevron, so draw one and rotate it on `open`;
hide the truncated line while open so it is not said twice.

```vue
<OCollapsible>
  <template #trigger="{ open }">
    <span class="flex min-w-0 flex-1 flex-col gap-1">
      <span class="flex items-baseline gap-x-3 max-md:flex-col">
        <OText variant="body-strong" as="span" class="min-w-0 md:flex-1">{{ row.label }}</OText>
        <OText variant="meta" as="span" nowrap>{{ row.status }}</OText>
      </span>
      <OText v-if="!open" variant="meta" truncate>{{ row.detail }}</OText>
    </span>
    <OIcon
      name="expand-more"
      size="sm"
      class="text-text-secondary shrink-0 transition-transform duration-200"
      :class="open ? 'rotate-180' : 'rotate-0'"
    />
  </template>
  <p class="px-2 pb-2 leading-5 break-words">
    <OText variant="meta">{{ row.detail }}</OText>
  </p>
</OCollapsible>
```

- **A control beside the trigger:** the body renders inside the root, so a sibling
  placed after an `OCollapsible` sits beside the whole open body, not the trigger.
  When a control must stay on the trigger's line (an info button beside "38 panels
  hidden"), use an `OButton` toggle (`icon-right` `expand-more`/`expand-less`,
  `:aria-expanded`, `aria-controls`) and render the body below with `v-if`.
- **Nothing interactive inside `#trigger`** — it is already a button. A Set-up
  action for a row goes beside the `OCollapsible`, not in its trigger.
- **In specs**, open an uncontrolled one by clicking its trigger `button`;
  `setValue(true)` on the component does nothing without a bound `v-model`.

**Family:** Built on reka-ui `Collapsible*` + `OIcon`; accordion coordination via `useCollapsibleGroup`. Standalone.

---

### OEmptyState

**Import:** `@/lib/core/EmptyState/OEmptyState.vue`
**Use when:** The app-wide empty-state primitive for "no data / no results" contexts. Driven by a named `preset` (fills illustration + copy + actions) or by props/slots. Three sizes for the three contexts: full page/section (`hero`), inside a card/panel (`block`), inside a table/dropdown (`inline`).
**Don't use for:** Loading/skeleton states, or inline validation errors.

> **Rule (strict) — every empty state IS `OEmptyState`.** Never hand-roll a
> "no data / no results / nothing here yet" state from a bare `<div>` with
> centered text and a button. ANY empty/zero state — a table with no rows, a
> panel or tab with nothing yet, a filtered list with no matches — renders
> through `OEmptyState` (illustration + title + description). **Actions use the
> ONE standard layout:** a rich action **card** — `EmptyStateActionCard` via the
> `actions` prop or the `#actions` slot — for a primary next-step CTA (icon chip
> + label + sublabel + chevron, the same card the empty dashboard uses), or
> `actionLabel` + `@action` for a simple button. Never a hand-placed button row
> or a custom card. So every empty state across the app reads as one system.
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
**In a scroll pane:** the root is `overflow-hidden`, so as a flex child of a
`flex-col overflow-y-auto` pane it shrinks and clips its own `#extra` list instead of
letting the pane scroll — pass `class="shrink-0"` and centre with
`justify-center-safe` on the pane. A list in `#extra` follows "one line per item".
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
  - **A wrong name fails SILENTLY — nothing renders, no error, no warning.** The
    `| string` in the prop type (needed for `img:<path>`) collapses the union, so
    a typo type-checks. Registry keys are **kebab-case**; Material Symbols'
    snake_case names are NOT valid. The SLO module shipped `format_list_bulleted`,
    `gpp_maybe`, `timelapse`, `hourglass_empty`, `restart_alt` and `data_usage` —
    six blank icons across four files, one of which left a filter row where only
    one of four options had a glyph.
  - **So type the literal, don't rely on the prop.** When icon names live in a
    data array, annotate it so the strings are checked against the union:
    ```ts
    import type { IconName } from "@/lib/core/Icon/OIcon.icons";
    const options = computed<{ value: string; label: I18nText; icon: IconName }[]>(() => [
      { value: "all", label: t("x.all"), icon: "format-list-bulleted" },
    ]);
    ```
    Without the annotation TS infers `icon: string` and the typo survives to
    production. To audit an existing file, grep its icon literals against
    `iconRegistry`'s keys.
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

### OSettingRow
**Import:** `@/lib/core/SettingRow/OSettingRow.vue`
**Use when:** One labelled setting inside a settings card — name and one-line description on the left, the control on the right, hairline rule between rows (the last row drops its own).
**Don't use for:** Form fields with a label above the control — use `OFormInput` directly.
**Key props:**
- `label` (`I18nText`, required — the setting's name)
- `description` (`I18nText` — one line saying what the setting does or what a special value means)
- `disabled` (boolean, default `false` — renders the row muted only; the control owns its own disabled state)
- `dataTest` (string)

**Slots:** `default` — the control on the right
**Emits:** none
**Example:**
```vue
<OSettingRow
  :label="t('passwordPolicy.minLength')"
  :description="t('passwordPolicy.minLengthDesc')"
  data-test="settings-password-policy-min-length"
>
  <OFormInput name="min_length" type="number" width="xs" />
</OSettingRow>
```
**Family:** Pair with `OFormSection`, which supplies the card.

---

### OSettingRowPair
**Import:** `@/lib/core/SettingRow/OSettingRowPair.vue`
**Use when:** Two related settings — a min/max, a period and its warning — on one row; the pair owns the hairline and padding so the two cells read as one row.
**Don't use for:** More than two controls, or unrelated settings that only happen to be adjacent.
**Key props:**
- `dataTest` (string)

**Slots:** `default` — exactly two `OSettingRow`; `footer` — a full-width message under both cells (a cross-field validation error)
**Emits:** none
**Example:**
```vue
<OSettingRowPair data-test="settings-password-policy-pair-length">
  <OSettingRow :label="t('passwordPolicy.minLength')" data-test="settings-password-policy-min-length">
    <OFormInput name="min_length" type="number" width="xs" />
  </OSettingRow>
  <OSettingRow :label="t('passwordPolicy.maxLength')" data-test="settings-password-policy-max-length">
    <OFormInput name="max_length" type="number" width="xs">
      <template #error />
    </OFormInput>
  </OSettingRow>
  <template v-if="maxLengthError" #footer>
    <p class="text-input-error-text text-xs" role="alert">{{ maxLengthError }}</p>
  </template>
</OSettingRowPair>
```
**Family:** `OSettingRow`, `OFormSection`.

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
- `as` (string — override the rendered element). There is **no `tag` prop**: `<OText tag="h2">` renders the variant's default element (a `<p>` for `body`) and passes `tag` through as a dead attribute, so a "heading" is not one.
- `truncate` (boolean, default `false` — ellipsis on overflow; the full text shows on hover only while it is cut)
- `tooltip` (I18nText | `false` — with `truncate`: hover text when cut, defaults to the text; `false` for none. It cuts only as a block or flex item)
- `nowrap` (boolean, default `false` — prevent wrapping)

**Slots:** `default`
**Emits:** none
**No class merging.** OText applies its variant's size, weight, colour and leading as plain classes and does not merge yours, so `class="text-xl"` on a `body` OText fights its `text-sm` by stylesheet order. Change the `variant`; when no variant fits, set the property on a wrapping element the OText inherits from (`<p class="leading-5"><OText variant="mono">…</OText></p>`).
**Example:**

```vue
<OText variant="page-title" as="h1">Dashboards</OText>
<OText variant="meta">Updated 2m ago</OText>
```

**Family:** Built on reka-ui `Primitive`. Standalone.

---

### OTruncatedText

**Import:** `@/lib/core/Typography/OTruncatedText.vue`
**Use when:** Any text that may not fit and is cut with "…" — names, IDs, URLs, descriptions, previews. **Write `<OTruncatedText>` wherever you would write `truncate` or `line-clamp-*`.** It cuts the text and shows the full value in a tooltip **only while the text is actually cut**; text that fits shows nothing.
**Don't use for:** Executable code (use `OCode` with `truncate`). Plain text in an `OTable` cell needs nothing — the table already shows a cut cell's full text (see [core-controls-table](core-controls-table.md)).
**Key props:**

- `as` (string, default `"span"` — keep the element the call site used, e.g. `h2`, `code`, `div`, so layout doesn't shift. It must be a **block or a flex/grid item**: inline text cannot cut)
- `lines` (`1`–`6`, default `1` — lines shown before "…"; `1` = `truncate`, more = `line-clamp-N`)
- `tooltip` (I18nText | `false` — custom tooltip text, e.g. `raw(name)` when the element also holds other markup; **`false` = no tooltip**)

**Slots:** `default` (the text)
**Emits:** none
**Example:**

```vue
<!-- cut text with a full-text tooltip when cut -->
<OTruncatedText class="text-text-heading font-medium">{{ dashboard.name }}</OTruncatedText>

<!-- two lines, then "…" -->
<OTruncatedText :lines="2" class="text-text-secondary text-xs">{{ row.description }}</OTruncatedText>

<!-- deliberately no tooltip -->
<OTruncatedText :tooltip="false" class="font-mono">{{ token }}</OTruncatedText>
```

**No tooltip (`:tooltip="false"`) when:**
- the value is a **secret** — token, API/access key, password, webhook or signed URL, connection string, a URL that can carry secret values — a tooltip would print it in full;
- the full text is **already readable another way** — printed right below, a click/expand reveals it, or a side panel shows it. Huge values (log lines, JSON, prompts) belong here.

Outside a table, `:tooltip="false"` and a plain `truncate` behave the same; use the component anyway so "no tooltip" reads as a decision. **Inside an `OTable` cell a plain `truncate` is NOT enough** — the table's own tooltip would still show the value; `:tooltip="false"` marks the element so the table stays out too.

**Never repeat the visible text** in a `title` or an `OTooltip` next to it (two bubbles, or an always-on bubble for text that fits). Add a tooltip only when it shows *more* than the text on screen.

**Several parts in one cut box** (tags, label pairs, value + delta): the tooltip reads the raw text, which has no separators (`trace0annotation0manual1`). Either
- **list of tags** → wrap them: `<OTruncatedText as="div" class="flex flex-nowrap items-center gap-1" :tooltip="raw(tags.join(', '))">`, or
- **one long text + small badges** → put `OTruncatedText` on the text only and give the badges `class="shrink-0"`, so the text cuts and the badges stay visible.

**Gotchas:**
- The parent row must let it shrink: a flex parent needs `min-w-0` (and so does every flex ancestor up to the box with the fixed width).
- Directly inside a block container (not a flex row), use `as="div"` — an inline `span` never measures as cut.
- Inside a non-hoverable bubble (an `OTooltip #content`), a nested `OTruncatedText` can't be hovered; give that content its own wrapping instead.

**Family:** Wraps `OTooltip` (`overflow-only`). Related: `OText` / `OCode` (`truncate` + `tooltip` props), `OTable`'s shared cut-cell tooltip.

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
<OVirtualScroll
  :items="rows"
  :estimate-size="36"
  height="24rem"
  v-slot="{ item }"
>
  <OText variant="body">{{ item.name }}</OText>
</OVirtualScroll>
```

**Family:** Backed by `useVirtualScroll`. Standalone.
