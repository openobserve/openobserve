# Core — Display & Content Components

Reference for the O2 display and content primitives under `@/lib/core/*`. Each entry is derived from the component's `.types.ts` and `<script setup>` — props, variants, sizes, slots, and emits are exactly what the source declares.

## Contents

- [OBadge](#obadge)
- [OTag](#otag)
- [OPriority · OSeverity · OCountBadge](#opriority--oseverity--ocountbadge)
- [ODimensionChip](#odimensionchip)
- [OCard (the panel)](#ocard)
- [OCode](#ocode)
- [OCodeBlock](#ocodeblock)
- [OJsonViewer](#ojsonviewer)
- [OCollapsible](#ocollapsible)
- [OEmptyState](#oemptystate)
- [OAvatar · OAvatarGroup](#oavatar--oavatargroup)
- [OIcon](#oicon)
- [OSeparator](#oseparator)
- [OSettingRow](#osettingrow)
- [OShortcut](#oshortcut)
- [OText](#otext)
- [OTruncatedText](#otruncatedtext) — cut text ("…") + full-text tooltip only when cut
- [OVirtualScroll](#ovirtualscroll)

---

### OBadge

**Import:** `@/lib/core/Badge/OBadge.vue`
**Use when:** You need the low-level chip renderer. In app code you almost never reach for it directly.
**Don't use for:** Application chips — use `OTag`, which wraps OBadge and adds the registry.
**Key props** (shared with OTag; types `ChipTone` / `ChipSize` in `OBadge.types.ts`):

- `tone` (default `neutral`) — `neutral` | `outline` | `accent` | `ok` | `warn` | `err` | `crit` | `info`.
  Status tones (ok, warn, err, crit, info) are the soft triplet: text, fill and a 1 px edge (C2).
  `accent` is the selected look, `outline` a transparent chip with a border, `neutral` a grey
  fill with secondary text. There are no decorative hues: categories are `neutral` or
  `outline` (C1, C3).
- `size` (default `sm`) — `sm` 20 px inside text and tables, `md` 24 px in a 24 px row (S1).
  Radius is always `rounded-chip`, text `text-xs` medium. There is no `shape`.
- `icon` (OIcon name, 12 px) · `dot` (6 px; unset means automatic: a status tone without an
  icon gets a dot, so status never reads by colour alone, C2) · `mono` (identifiers, T4)
- `toggle` + `pressed` — a 24 px `<button aria-pressed>`: a chip that selects something
  (KB4). A chip that only acts is an `OButton`, not a chip.
- `removable` + `removeLabel` (✕ that emits `remove`) · `disabled`

**Slots:** `default` (text), `icon`, `trailing` (a segment after a divider, e.g. a count)
**Emits:** `click` (only when `toggle`), `remove`
**Removed:** `variant` → `tone`, `shape`, `clickable` → `toggle`/`removable`/`OButton`,
`count`/`hideZeroCount` → `#trailing` or `OCountBadge`, sizes `xs`/`lg`. `local/o2-display-api`
rejects them and any class that restyles a chip (`uppercase`, `h-*`, `py-*`, `rounded*`, text
sizes).
**Example:**

```vue
<OBadge tone="ok">Active</OBadge>
```

**Family:** Rendered internally by `OTag`. Standalone otherwise.

---

### OTag

**Import:** `@/lib/core/Badge/OTag.vue`
**Use when:** This is THE chip for application code: any status, type or label chip —
semantic (`type` + `value` resolve tone/icon/dot/label from `badgeGroups.ts`) or manual
(`tone` + slots, as OBadge).
**Don't use for:** `key=value` chips (`ODimensionChip`), priorities (`OPriority`), log levels
(`OSeverity`), counts on tabs or nav (`OCountBadge`), or anything that acts (`OButton`).

> **Rule (strict) — styling lives in the registry, never at the call site.** A semantic
> `<OTag>` carries only `type` + `value` (plus `label` / `#default` for dynamic content the
> registry cannot enumerate). Every visual decision — `tone`, `size`, `icon`, `dot` — lives
> in the group's entry in `badgeGroups.ts`, so one edit restyles every use. A chip that must
> look different in another context gets its own group.
>
> **Colour the exception, not the norm (C3).** The healthy majority is a `neutral` chip or
> plain text; `ok`/`warn`/`err`/`crit` mark the rows that need attention. Grey is "never or
> unknown", amber only "went quiet" (C5). No uppercase chip text (T5).
**Key props:**

- `type` (`BadgeGroupName | string`) · `value` (raw value resolved against the group)
- `tone` · `size` (`sm` default, `md`) · `icon` (`""` suppresses) · `dot` · `mono` — as OBadge
- `label` (I18nText — dynamic text) · `emptyLabel` (default "—", for an empty typed value, C4)
- `toggle` + `pressed` · `removable` + `removeLabel` · `disabled`

**Slots:** `default` (wins over `label`), `icon`, `trailing`
**Emits:** `click` (toggle only), `remove`
**Example:**

```vue
<!-- semantic: tone + dot resolved from the registry -->
<OTag type="alertStatus" value="active" />
<!-- manual: a count in the trailing segment -->
<OTag tone="accent">Steps<template #trailing>12</template></OTag>
<!-- toggle chip -->
<OTag toggle :pressed="onlyMine" @click="onlyMine = !onlyMine">{{ t("alerts.mine") }}</OTag>
```

**Family:** Wraps `OBadge`. Siblings `OPriority`, `OSeverity`, `OCountBadge`, `ODimensionChip`.

---

### OPriority · OSeverity · OCountBadge

**Import:** `@/lib/core/Badge/OPriority.vue` · `OSeverity.vue` · `OCountBadge.vue`

- **`OPriority`** `level` 1 | 2 | 3 — P1 solid strong, P2 outlined, P3 quiet: priority reads by
  weight, never by hue. Priorities beyond P3 stay a typed `OTag`.
- **`OSeverity`** `level` `fatal` | `error` | `warn` | `info` | `debug`, optional `mark` (3 px
  bar) and `label` — mono 11 px text in the status colour (T4, C2). `toSeverityLevel()` in
  `severityLevel.ts` maps raw log levels. Read-only; a severity that opens a menu is a toggle
  `OTag`.
- **`OCountBadge`** `count`, `tone` `neutral` (default) | `accent` | `err`, `max` (default 99 →
  "99+"): a 16 px round count. Red only for firing counts (C3).

---

### ODimensionChip

**Import:** `@/lib/core/Badge/ODimensionChip.vue`
**Use when:** Displaying a two-segment `key=value` dimension chip (e.g. `service=openobserve`, `k8s-cluster=prod`): a mono key on a subtle fill, then the mono value in strong text. It carries no hue; an optional `tone` from the chip tones marks a status.
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
**Use when:** The one panel frame: overview tiles, settings sections, side panels, dashboard
tiles. 1 px `border-border-default`, `rounded-surface` (10), surface fill, no shadow. Panels
stack 12 apart (L4).
**Don't use for:** A table that already has a frame — never a card inside a card (D8); a raised
or modal surface (dialogs, drawers).
**Key props:**

- `title` · `meta` (I18nText) — the 40 px header shows when `title` or `#header` is set:
  title 13/600 strong, meta 12 tertiary, `border-b border-border-subtle`.
- `flush` (boolean) — no body padding, for a table or chart; the body is `p-3`, 13 px otherwise.
- `loading` (boolean) — skeleton body; the frame and header stay.

**Slots:** `default` (body), `#actions` (header end, `sm` 28 px controls only), `#header` (a
custom header line, still 40 px), `#footer` (right-aligned row under the body)
**Removed:** `variant` (panel / outlined / glass), and `OCardSection` / `OCardActions` (fold
into `title`, the body and `#footer`). `local/o2-display-api` rejects classes that restyle the
frame (`rounded-*`, `shadow-*`, padding, `card-container`).
**Example:**

```vue
<OCard :title="t('usage.requestsByStatus')" :meta="t('common.lastHour')" flush>
  <template #actions><OButton size="sm" variant="ghost">{{ t("common.viewAll") }}</OButton></template>
  <OTable :data="rows" :columns="columns" />
</OCard>
```

---

### OCode

**Import:** `@/lib/core/Code/OCode.vue`
**Use when:** Inline code — a cron expression, a stream or resource id, a path: a 4 px mono
12 px chip (T4).
**Don't use for:** A block of code — every block is `OCodeBlock` (the `block` prop is gone). For
non-executable identifiers shown as plain text, prefer `<OText variant="mono">`.
**Key props:**

- `copyable` (boolean, default `false` — an `OCopyButton` after the chip copies the rendered text)
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
**Use when:** Any read-only block of code: snippets, install commands, credentials, configs,
stack traces (T4). One 36 px head — file name (mono) and language, then Reveal, Wrap and a
labelled `OCopyButton` ("Copy", inline check, no toast: K1). The frame is `rounded-default`,
12 px mono on an 18 px line, `p-3`. Copy always copies the raw `code`.
**Don't use for:** Editing (queries and functions use the code editor) or inline code (`OCode`).
**Key props:**

- `code` (string, required) · `lang` (auto-detected when omitted) · `filename`
- `codeMasked` (string) + `sensitive` — the secret is masked by default behind Reveal; Copy
  works without revealing. Never show a secret unmasked by default.
- `copyable` (default `true`) · `wrap` (initial state; the head offers Wrap when a line is long)
- `maxLines` (default 12) — longer code collapses behind "Show all N lines"
- `lineNumbers` (ignored while wrapped) · `dataTest` (prefix: `<prefix>-copy-btn`, `-reveal-btn`,
  `-wrap-btn`, `-show-all`) · `tokenName` + `@token-click` (credential picker link)

**Slots:** `actions` (extra `sm` head actions, before Copy)
**Emits:** `copy` (`{ partial }` — after a whole-block copy or a selection copy), `token-click`
**Removed:** `chrome`, `padded`, `inset`, `copyMessage`, `revealTooltip`, `hideTooltip`.
**Example:**

```vue
<OCodeBlock :code="installCmd" lang="bash" filename="install.sh" @copy="onCopied" />
```

**Family:** Composes `OButton`, `OCopyButton`, `OTooltip`. Siblings `OCode`, `OJsonViewer`.

---

### OJsonViewer

**Import:** `@/lib/core/Code/OJsonViewer.vue`
**Use when:** Showing a JSON value or record read-only: 24 px rows, keys secondary, values
coloured by type from the syntax tokens, objects past `expandDepth` (default 2) collapsed to
"{ N fields }". Each leaf row offers, on hover and always on touch, include, exclude and copy.
**Don't use for:** Editing JSON (code editor) or comparing records (a table).
**Key props:** `value` (unknown), `expandDepth`, `dataTest` (row ids are
`<prefix>-row-<path>`, paths like `http.status` and `tags[0]`)
**Emits:** `include(path, value)` and `exclude(path, value)` — each action shows only when its
listener is bound; feed them to the filter chips (F5) — and `copy(path, value)`.

```vue
<OJsonViewer :value="record" @include="addFilter" @exclude="addExclusion" />
```

---

### OCollapsible

**Import:** `@/lib/core/Collapsible/OCollapsible.vue`
**Use when:** Optional detail inside a form or panel, or one expandable row. ONE look: a 32 px
trigger (`min-h-control-md`) with a leading chevron that turns when open, the title 13/500 and an
optional summary on the end edge ("3 rules", "none"); the body indents under the title (`ps-6`).
Uncontrolled (`defaultOpen`), controlled (`v-model:open`), accordion (`group`).
**Don't use for:** Hiding required fields — "Advanced" is not a dumping ground.
**Key props:**

- `title` · `summary` (I18nText)
- `open` (boolean, `v-model:open`) · `defaultOpen` (boolean)
- `group` (string — accordion: one open at a time)
- `persistKey` (string — remembers the open state in local storage, where it matters: N6)

**Slots:** `default` (body), `trigger` (custom content in place of title and summary, exposes
`{ open }`; the chevron stays)
**Emits:** `update:open`, `open`, `opened`, `close`, `closed`
**Removed:** `label` → `title`, `caption` → `summary`, `icon`, `variant`
(default / sidebar / config), `triggerClass`, `modelValue` → `open`. `local/o2-display-api`
flags a bare `v-model` on it.
**Example:**

```vue
<OCollapsible v-model:open="advancedOpen" :title="t('pipeline.advancedOptions')" :summary="t('common.ruleCount', { count: 3 }, 3)">
  <OText variant="body">Body content…</OText>
</OCollapsible>
```

**Rich list row** — one item per row: name + status on line 1, the detail on one
truncated line, the full detail when opened (copy-and-values.md § One line per item).
Hide the truncated line while open so it is not said twice; do not draw a second chevron.

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
  </template>
  <p class="px-2 pb-2 leading-5 break-words">
    <OText variant="meta">{{ row.detail }}</OText>
  </p>
</OCollapsible>
```

- **A control beside the trigger:** the body renders inside the root, so a sibling
  placed after an `OCollapsible` sits beside the whole open body, not the trigger.
  When a control must stay on the trigger's line (an info button beside "38 panels
  hidden"), use an `OButton` toggle (`icon-end` `expand-more`/`expand-less`,
  `:aria-expanded`, `aria-controls`) and render the body below with `v-if`.
- **Nothing interactive inside `#trigger`** — it is already a button. A Set-up
  action for a row goes beside the `OCollapsible`, not in its trigger.
- **In specs**, open an uncontrolled one by clicking its trigger `button`;
  `setValue(true)` on the component does nothing without a bound `v-model:open`.

**Family:** Built on reka-ui `Collapsible*` + `OIcon`; accordion coordination via `useCollapsibleGroup`. Standalone.

---

### OEmptyState

**Import:** `@/lib/core/EmptyState/OEmptyState.vue`
**Use when:** Every empty state, inside the table body or panel that is empty (never instead
of the frame). Four kinds in one component (K5), each telling the one next step:

| `kind` | Says | Action |
| --- | --- | --- |
| `first-run` (default) | What this is and why you would use it | One primary, the header's words: "New alert" (H6) |
| `filtered` | No rows match; which filters are on | Clear filters (default label) (F5) |
| `denied` | No access, and who can grant it (`contact`) | None, or "Request access" |
| `error` | What failed, in plain words (K6) | Retry (default label, refresh icon) |

**A failed load is `error`, never `first-run` (K5).** No pager under an empty table (D5).
**Don't use for:** Loading (skeletons, K4) or field validation errors (inline, K2).
**Key props:**

- `kind` (above) · `size` (`page` default: 40 px icon tile, 16/600 title, 14 px text at 44ch;
  `inline`: 32 px tile, 14 px title, 13 px text — inside a table body, list or dropdown)
- `title` · `text` (I18nText) · `icon` (IconName; the kind sets a default; the tile is neutral,
  red-tinted only for `error`)
- `actionLabel` + `@action` (an `lg` 36 px button: primary for first-run, secondary otherwise) ·
  `secondaryActionLabel` + `@secondary-action`. With a listener and no label, `error` shows
  Retry and `filtered` shows Clear filters.
- `requestId` (string, mono under an error) · `contact` (I18nText, denied)

**Slots:** `#text` (rich text), `#actions` (onboarding cards such as `EmptyStateIngestionCard`
in place of the buttons), `#extra` (content below)
**Emits:** `action`, `secondary-action` (no payload)
**Removed:** `preset` (and `presets.ts`) → `kind` + `title`/`text`; `illustration` (and the 35
SVGs), `backdrop`, `toneIcon` → `icon`; `variant`, `filtered` → `kind`; `hideAction`; `actions`
cards → the two action labels; `actionIcon`; `description` → `text`; sizes hero/block/compact →
`page`, slim → `inline`. `local/o2-display-api` rejects all of them.
**In a scroll pane:** pass `class="shrink-0"` so it does not clip its own `#extra` list, and
centre with `justify-center-safe` on the pane.
**Example:**

```vue
<OEmptyState
  :kind="search ? 'filtered' : 'first-run'"
  :title="search ? t('alerts.noMatch') : t('alerts.emptyTitle')"
  :text="search ? undefined : t('alerts.emptyText')"
  :action-label="search ? undefined : t('alerts.newAlert')"
  @action="search ? (search = '') : openCreate()"
/>
<OEmptyState v-if="isError" kind="error" :title="t('alerts.loadFailed')" @action="refetch" />
```

**Family:** Composes `OButton`, `OIcon`. Standalone.

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

### OFormSection
**Import:** `@/lib/core/FormSection/OFormSection.vue`
**Use when:** One titled section of a multi-section form — a bordered card with a heading and the section's fields or `OSettingRow`s inside.
**Don't use for:** A page's own content inset (use `OContent`), or a section wrapped around a single control — except where the heading is that control's label, and the danger zone.
**Key props:**
- `title` (`I18nText`, required — the section heading)
- `variant` (`"accent" | "plain"`, default `"accent"` — `"plain"` drops the accent bar, gives the header a tinted band above its divider and renders the heading as an `h2`; Settings and IAM pages use it)
- `description` (`I18nText` — one line under the heading, either variant)
- `tone` (`"default" | "danger"`, default `"default"` — `"danger"` applies to `variant="plain"` only: error-coloured heading with a warning icon and an error-coloured card border, for a destructive section)
- `info` (`I18nText` — tooltip on an info icon after the heading)
- `required` (boolean — appends the required marker to the heading)
- `dataTest` (string)

**Slots:** `default` — the section body; `actions` — controls at the end of the header (an in-section adder); `description` — replaces the `description` text when the line needs markup, such as a tooltip
**Emits:** none
**Example:**
```vue
<OFormSection
  variant="plain"
  :title="t('settings.retentionTitle')"
  :description="t('settings.retentionDescription')"
  data-test="settings-retention-section"
>
  <OSettingRow :label="t('settings.retentionDays')" data-test="settings-retention-days">
    <OFormInput name="retention_days" type="number" width="s" />
  </OSettingRow>
</OFormSection>

<OFormSection
  variant="plain"
  tone="danger"
  :title="t('settings.dangerZone')"
  data-test="settings-danger-zone-section"
>
  …
</OFormSection>
```
**Family:** `OSettingRow` for the rows inside. One `h1` (the page title) above the plain sections' `h2`s.

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
**Use when:** One labelled setting inside a settings card — name and one-line description on the left, the control on the right, hairline rule between rows (the last row drops its own). Pass `name` (or `error`) and the field's error takes the description's place, so nothing moves. Pass `loading` while the value is pending. `control-at="end"` pins a fixed control column to the row's end; Settings forms use it.
**Don't use for:** Form fields with a label above the control — use `OFormInput` directly.
**Key props:**
- `label` (`I18nText`, required — the setting's name)
- `description` (`I18nText` — one line saying what the setting does or what a special value means)
- `disabled` (boolean, default `false` — renders the row muted only; the control owns its own disabled state)
- `dataTest` (string)
- `errorDataTest` (string, default `<dataTest>-error` — selector of the printed error text; pass it to keep a selector the field's own error had)
- `loading` (boolean, default `false` — one static skeleton replaces the control; label and description stay)
- `name` (string — field path in the enclosing `OForm`; the row prints that field's error and the `OForm*` control with the same `name` keeps its red border but prints nothing)
- `error` (`I18nText` — same place, for pages without `OForm`; wins over `name`)
- `controlAt` (`"label" | "end"`, default `"label"` — `"end"`: the label grows and a fixed control column sits at the row's end; it stacks when the row is narrower than 42rem)

**Slots:** `default` — the control on the right. A single control gets `aria-describedby` for the shown error automatically; when the control sits inside other markup, bind the slot prop yourself: `#default="{ describedBy }"`. `description` — rich help (a bold name inside a sentence) in place of the `description` text.
**Emits:** none
**Example:**
```vue
<OSettingRow
  :label="t('passwordPolicy.minLength')"
  :description="t('passwordPolicy.minLengthDesc')"
  data-test="settings-password-policy-min-length"
>
  <OFormInput name="min_length" type="number" width="s" />
</OSettingRow>
```
**Family:** Pair with `OFormSection`, which supplies the card. On Settings and IAM pages use `variant="plain"`: one heading level, no accent bar, no section over a single control.

---

### OShortcut

**Import:** `@/lib/core/Shortcut/OShortcut.vue`
**Use when:** The Kbd key cap. ONE size: 18 px caps (11 px mono, `rounded-chip`, 2 px bottom
edge), one cap per key, 3 px apart, no "+". Modifiers are platform-aware (`ctrl` → `⌘` on Mac
/ `Ctrl` elsewhere, `enter` → `↵`). Shown in tooltips, menus and the palette; on a button only
for Run and the palette trigger (B6, KB3).
**Don't use for:** Arbitrary code or text — use `OCode` or `OText variant="mono"`.
**Key props:**

- `id` (string — registry shortcut id; preferred, so the cap is always the real binding, KB3)
- `keys` (`string | string[]` — only when there is no binding; `"ctrl+enter"` → `Ctrl` `↵`)

**Removed:** `size` (one size). Renders nothing when no key resolves.
**Example:**

```vue
<OShortcut id="logsRunQuery" />
<OShortcut keys="/" />
```

**Family:** Resolves ids via `shortcutRegistry`. Rendered by `OTooltip`, `ODropdownItem`,
`OContextMenuItem` and `OSearchInput`.

---

### OAvatar · OAvatarGroup

**Import:** `@/lib/core/Avatar/OAvatar.vue` · `OAvatarGroup.vue`
**Use when:** On-call rosters and people pickers only: initials in a circle whose tone is
derived from the identity. Owner and user cells stay plain text (OUserCell), on purpose.
**Key props:** `OAvatar` `value` (email or name), `name`, `size` `sm` 20 | `md` 24 (default) |
`lg` 32, `tooltip` (default `true`). `OAvatarGroup` `people` (`{ value, name? }[]`), `max`,
`size`; the rest collapse into a "+N" neutral chip.

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
