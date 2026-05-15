# Quasar Card & Expansion ΓåÆ O2 / Reka UI Migration Guide

> Covers: `q-card`, `q-card-section`, `q-card-actions`, `q-expansion-item`  
> Source data from: `web/docs/quasar-card-expansion-audit.md` (614 Vue files scanned)

---

## Status Overview

| Quasar Component | O2 Component | Reka UI Primitive | Usages | O2 Status |
|---|---|---|---|---|
| `q-card` | `OCard` | None (plain `<div>`) | 382 | ΓÅ│ To Build |
| `q-card-section` | `OCardSection` | None (plain `<div>`) | 550 | ΓÅ│ To Build |
| `q-card-actions` | `OCardActions` | None (plain `<div>`) | 142 | ΓÅ│ To Build |
| `q-expansion-item` | `OCollapsible` | `CollapsibleRoot` from `reka-ui` | 98 | ΓÅ│ To Build |

> All O2 layout components will live in `web/src/lib/core/`. Each will be registered in `web/.agents/skills/o2-component-usage/references/component-catalog.md` once built.

---

## Migration Order (Recommended)

Build and migrate in this order ΓÇö smallest API surface first:

```
Tier 1 ΓÇö Card family (build as a unit, migrate together)
1.  OCard          (replaces q-card)          382 usages
2.  OCardSection   (replaces q-card-section)  550 usages  ΓåÉ most usages
3.  OCardActions   (replaces q-card-actions)  142 usages

Tier 2 ΓÇö Collapsible
4.  OCollapsible   (replaces q-expansion-item)  98 usages  ΓåÉ ConfigPanel has 40
```

> **Migrate OCard, OCardSection, and OCardActions together per file** ΓÇö they always appear
> as a compound structure. Migrating only one component in a file leaves inconsistent markup.  
> **OCollapsible** can be migrated independently; it rarely co-appears with the card family.

---

## Component-by-Component Guide

---

### 1. `q-card` ΓåÆ `OCard`

**Family**: `OCard` + `OCardSection` + `OCardActions` (build and migrate as a unit)  
**Location**: `web/src/lib/core/Card/`  
**Headless base**: None ΓÇö plain `<div>` with design token CSS variables

**Why no Reka UI**: Cards are static containers ΓÇö no accessibility primitive or keyboard behavior is needed. A plain `<div>` with design tokens is sufficient.

#### Prop Mapping

| Quasar prop / pattern | O2 equivalent | Action |
|---|---|---|
| _(default, no props)_ | `<OCard>` | Direct |
| `flat` | `<OCard>` | **Drop** |
| `flat bordered` | `<OCard>` | **Drop both** ΓÇö borders are not carried over |
| `bordered` (standalone) | `<OCard>` | **Drop** ΓÇö borders are not carried over |
| `dark` | ΓÇö | **Drop** ΓÇö CSS variables handle dark mode |
| `square` | ΓÇö | **Drop** ΓÇö border-radius is a design token |
| `style="min-width: 500px"` | `style="min-width: 500px"` | Pass-through ΓÇö no width prop ever |
| `class="column full-height"` | `class="tw:flex tw:flex-col tw:h-full"` | Migrate Quasar layout class to Tailwind |
| `class="q-mb-md"` | `class="tw:mb-4"` | Migrate Quasar spacing to Tailwind |
| `data-test="..."` | `data-test="..."` | Pass-through (inherited attrs) |

> **OCard has no props.** Always flat. All `flat`, `bordered`, `flat bordered` become `<OCard>` ΓÇö no border classes added.

#### Event Mapping

`q-card` emits no events. No event migration needed.

#### Slot Mapping

| Quasar slot | O2 slot | Action |
|---|---|---|
| `#default` | `#default` | Direct ΓÇö renders OCardSection / OCardActions children |

#### Code Examples

**Dialog shell (most common pattern):**

```vue
<!-- BEFORE (Quasar) -->
<q-card style="min-width: 500px">
  <q-card-section class="row items-center q-pb-none">
    <div class="text-h6">{{ title }}</div>
    <q-space />
    <q-btn icon="close" flat round dense @click="close" />
  </q-card-section>
  <q-card-section class="q-pt-md">
    <!-- form content -->
  </q-card-section>
  <q-card-actions align="right" class="q-pa-md tw:gap-2">
    <q-btn flat label="Cancel" @click="close" />
    <q-btn color="primary" label="Save" @click="save" />
  </q-card-actions>
</q-card>

<!-- AFTER (O2) -->
<OCard style="min-width: 500px">
  <OCardSection role="header">
    <div class="tw:text-base tw:font-semibold">{{ title }}</div>
    <div class="tw:flex-1" />
    <OButton variant="ghost" size="sm" :icon-left="XIcon" @click="close" />
  </OCardSection>
  <OCardSection role="body">
    <!-- form content -->
  </OCardSection>
  <OCardActions>
    <OButton variant="outline" @click="close">Cancel</OButton>
    <OButton variant="primary" @click="save">Save</OButton>
  </OCardActions>
</OCard>
```

**Flat bordered info card:**

```vue
<!-- BEFORE -->
<q-card flat bordered class="q-pa-sm">
  <!-- content -->
</q-card>

<!-- AFTER ΓÇö bordered is dropped, all cards are flat -->
<OCard class="tw:p-2">
  <!-- content -->
</OCard>
```

**Full-height drawer shell:**

```vue
<!-- BEFORE -->
<q-card class="column full-height no-wrap">
  <q-card-section class="q-px-md q-py-md">
    <!-- header -->
  </q-card-section>
  <q-card-section class="q-pa-md tw:flex-1 tw:overflow-y-auto">
    <!-- scrollable body -->
  </q-card-section>
</q-card>

<!-- AFTER -->
<OCard class="tw:flex tw:flex-col tw:h-full tw:overflow-hidden">
  <OCardSection role="header">
    <!-- header -->
  </OCardSection>
  <OCardSection role="body" scrollable>
    <!-- scrollable body -->
  </OCardSection>
</OCard>
```

**Stat / info tile (flat, no sections):**

```vue
<!-- BEFORE -->
<q-card flat bordered class="q-pa-sm summary-card">
  <!-- inline stat content -->
</q-card>

<!-- AFTER ΓÇö bordered is dropped -->
<OCard class="tw:p-2 summary-card">
  <!-- inline stat content -->
</OCard>
```

**Import**:

```ts
import OCard from "@/lib/core/Card/OCard.vue";
```

---

### 2. `q-card-section` ΓåÆ `OCardSection`

**Family**: `OCard` + `OCardSection` + `OCardActions` (build and migrate as a unit)  
**Location**: `web/src/lib/core/Card/`  
**Headless base**: None ΓÇö plain `<div>` with semantic role-based padding tokens

> **Design principle**: `role` is the only prop most usages need. It bundles padding, flex-grow, flex-shrink, and layout direction into a single semantic value ΓÇö eliminating the need for `horizontal`, `padding`, `grow`, and `shrink` as separate props. Use `class` passthrough for the rare edge case that deviates.

#### Prop Mapping

| Quasar prop / class pattern | O2 prop | Action |
|---|---|---|
| _(dialog header section)_ | `role="header"` | Bundles: `flex items-center`, non-growing, standard header padding |
| _(main content section)_ | `role="body"` | Bundles: `grow`, `padding-md` |
| _(scrollable body)_ | `role="body" scrollable` | `role` + single `scrollable` prop ΓÇö replaces `tw:flex-1 tw:overflow-y-auto` |
| _(footer / meta section)_ | `role="footer"` | Bundles: `shrink`, bottom-biased padding |
| _(plain section, no opinion)_ | _(no role)_ | Plain div ΓÇö use `class` for all layout |
| `class="q-pa-none"` / `:deep(.q-card__section){padding:0}` | `class="tw:p-0"` | Pass class directly ΓÇö no dedicated `padding` prop |
| `class="q-pa-sm"` | `class="tw:p-2"` | Pass class directly |
| `class="row items-center"` (non-header) | `class="tw:flex tw:items-center"` | Pass class directly ΓÇö only header role does this automatically |
| `class="tw:flex-shrink-0"` (non-footer) | `class="tw:shrink-0"` | Pass class directly |
| `style="max-height: calc(100vh - 100px); overflow-y: auto"` | `scrollable style="max-height: calc(100vh - 100px)"` | `scrollable` handles overflow; keep inline max-height |

> **OCardSection has only 2 props**: `role` and `scrollable`. Every other layout need is handled by passing `class` or `style` directly.

#### Event Mapping

`q-card-section` emits no events. No event migration needed.

#### Slot Mapping

| Quasar slot | O2 slot | Action |
|---|---|---|
| `#default` | `#default` | Direct |

#### Code Examples

**Dialog header section:**

```vue
<!-- BEFORE -->
<q-card-section class="row items-center q-pb-none">
  <div class="text-h6">{{ title }}</div>
  <q-space />
  <q-btn icon="close" flat round dense v-close-popup />
</q-card-section>

<!-- AFTER -->
<OCardSection role="header">
  <span class="tw:text-base tw:font-semibold">{{ title }}</span>
  <div class="tw:flex-1" />
  <OButton variant="ghost" size="sm" :icon-left="XIcon" @click="$emit('close')" />
</OCardSection>
```

**Scrollable body section:**

```vue
<!-- BEFORE -->
<q-card-section class="q-pa-md tw:flex-1 tw:overflow-y-auto">
  <!-- content -->
</q-card-section>

<!-- AFTER -->
<OCardSection role="body" scrollable>
  <!-- content -->
</OCardSection>
```

**Zero-padding section (replaces `:deep()` override):**

```vue
<!-- BEFORE -->
<q-card-section>
  <!-- content -->
</q-card-section>
<style scoped>
:deep(.q-card__section) { padding: 0; }
</style>

<!-- AFTER ΓÇö pass class directly, delete the deep override -->
<OCardSection class="tw:p-0">
  <!-- content -->
</OCardSection>
```

**Sticky non-growing footer section:**

```vue
<!-- BEFORE -->
<q-card-section class="q-pa-md tw:flex-shrink-0">
  <!-- always visible footer content -->
</q-card-section>

<!-- AFTER -->
<OCardSection role="footer">
  <!-- always visible footer content -->
</OCardSection>
```

**Import**:

```ts
import OCardSection from "@/lib/core/Card/OCardSection.vue";
```

---

### 3. `q-card-actions` ΓåÆ `OCardActions`

**Family**: `OCard` + `OCardSection` + `OCardActions` (build and migrate as a unit)  
**Location**: `web/src/lib/core/Card/`  
**Headless base**: None ΓÇö plain `<div>` with design token padding

**Key design decision**: `align="right"` is the default (it is used in 85%+ of all usages). Center-aligned actions are the minority and require an explicit prop.

**Key class absorptions**: The following global/utility classes are **baked into OCardActions defaults** and must be removed:
- `confirmActions` ΓÇö absorbed (standard gap + horizontal padding)
- `class="tw:gap-2"` ΓÇö absorbed (gap is the default)
- `class="q-pa-md"` ΓÇö absorbed (standard padding is the default)

> **Design principle**: OCardActions has at most 1 meaningful prop (`align`) and it only needs to be written when you want `center` or `left`. The default right-alignment, button gap, and padding are all baked in ΓÇö every class pattern below maps to nothing (just delete it).

#### Prop Mapping

| Quasar prop / class pattern | O2 prop | Action |
|---|---|---|
| `align="right"` | ΓÇö | **Drop** ΓÇö right-align is the default, no prop needed |
| `align="center"` | `align="center"` | Keep ΓÇö only prop you ever write |
| `align="left"` | `align="left"` | Keep |
| `class="confirmActions"` | ΓÇö | **Drop** ΓÇö absorbed into defaults |
| `class="confirmActions tw:gap-2"` | ΓÇö | **Drop** ΓÇö absorbed |
| `class="confirmActionsLogStream tw:gap-2"` | ΓÇö | **Drop** ΓÇö absorbed |
| `class="q-pa-md tw:gap-2"` | ΓÇö | **Drop** ΓÇö absorbed |
| `class="q-pa-md"` | ΓÇö | **Drop** ΓÇö absorbed |
| `class="tw:gap-2"` | ΓÇö | **Drop** ΓÇö absorbed |
| `class="q-pt-none q-pb-md q-px-md tw:gap-2"` | ΓÇö | **Drop** ΓÇö absorbed |
| `class="tw:flex tw:flex-center tw:gap-2"` | `align="center"` | Use align prop |
| `class="tw:flex-shrink-0"` | `class="tw:shrink-0"` | Pass class directly ΓÇö no dedicated `shrink` prop |

> **OCardActions has only 1 prop**: `align`. If you are not centering or left-aligning, write `<OCardActions>` with no props at all.

#### Event Mapping

`q-card-actions` emits no events. No event migration needed.

#### Slot Mapping

| Quasar slot | O2 slot | Action |
|---|---|---|
| `#default` | `#default` | Direct ΓÇö place `OButton` components here |

#### Code Examples

**Standard dialog confirm/cancel (most common):**

```vue
<!-- BEFORE -->
<q-card-actions align="right" class="q-pa-md tw:gap-2">
  <q-btn flat label="Cancel" @click="close" />
  <q-btn color="primary" label="Save" @click="save" />
</q-card-actions>

<!-- AFTER ΓÇö align="right" is the default, padding + gap are baked in -->
<OCardActions>
  <OButton variant="outline" @click="close">Cancel</OButton>
  <OButton variant="primary" @click="save">Save</OButton>
</OCardActions>
```

**Confirm/delete dialog (was using `confirmActions` class):**

```vue
<!-- BEFORE -->
<q-card-actions class="confirmActions tw:gap-2">
  <q-btn flat label="Cancel" @click="close" />
  <q-btn color="negative" label="Delete" @click="deleteItem" />
</q-card-actions>

<!-- AFTER ΓÇö confirmActions class is absorbed -->
<OCardActions>
  <OButton variant="outline" @click="close">Cancel</OButton>
  <OButton variant="destructive" @click="deleteItem">Delete</OButton>
</OCardActions>
```

**Centered actions (e.g. ServiceAccountsList):**

```vue
<!-- BEFORE -->
<q-card-actions align="center">
  <q-btn color="primary" label="Add Account" />
</q-card-actions>

<!-- AFTER -->
<OCardActions align="center">
  <OButton variant="primary">Add Account</OButton>
</OCardActions>
```

**Sticky shrinking footer in flex card:**

```vue
<!-- BEFORE -->
<q-card-actions align="right" class="q-pa-md tw:flex-shrink-0 tw:gap-2">
  <q-btn flat label="Cancel" @click="close" />
  <q-btn color="primary" label="Apply" @click="apply" />
</q-card-actions>

<!-- AFTER ΓÇö pass shrink-0 as class, everything else absorbed -->
<OCardActions class="tw:shrink-0">
  <OButton variant="outline" @click="close">Cancel</OButton>
  <OButton variant="primary" @click="apply">Apply</OButton>
</OCardActions>
```

**Import**:

```ts
import OCardActions from "@/lib/core/Card/OCardActions.vue";
```

---

### 4. `q-expansion-item` ΓåÆ `OCollapsible`

**Family**: `OCollapsible` (single component ΓÇö self-contained)  
**Location**: `web/src/lib/core/Collapsible/`  
**Headless base**: `CollapsibleRoot` + `CollapsibleTrigger` + `CollapsibleContent` from `reka-ui`

```ts
import {
  CollapsibleRoot,
  CollapsibleTrigger,
  CollapsibleContent,
} from "reka-ui";
```

**Why Reka UI**: `CollapsibleRoot` provides `aria-expanded`, `aria-controls` association, keyboard activation (Enter/Space on trigger), and animation hooks via `data-state` ΓÇö without coupling to Quasar's internal DOM structure that `:deep()` hacks target.

**Key structural change**: Expansion content that currently wraps `q-card > q-card-section` for padding control should wrap the default slot content in a `<div class="tw:p-...">` ΓÇö eliminating the inner card wrapper entirely.

> **Design principle**: Replace the Quasar prop explosion with 3 strategies ΓÇö (1) rename to camelCase, (2) use the `#trigger` slot for custom trigger layout/icons, (3) wrap slot content in a `<div>` for content padding instead of a prop. Result: OCollapsible has 6 props instead of Quasar's 20+.

#### Prop Mapping

| Quasar prop | O2 prop | Action |
|---|---|---|
| `label` / `:label` | `label` / `:label` | Direct |
| `icon` / `:icon` | `icon` / `:icon` | Direct ΓÇö string icon name, unchanged |
| `caption` / `:caption` | `caption` | Direct |
| `default-opened` / `:default-opened` | `defaultOpen` | Rename (camelCase) |
| `v-model` | `v-model` | Direct |
| `:model-value` + `@update:model-value` | `:model-value` + `@update:modelValue` | Direct (camelCase event) |
| `expand-separator` | Place `<OSeparator>` between items | **No prop** ΓÇö compose with `OSeparator` |
| `header-class` | Use `#trigger` slot | **No prop** ΓÇö apply classes directly inside slot |
| `expand-icon-class` | Use `#trigger` slot | **No prop** ΓÇö icon lives inside trigger slot |
| `switch-toggle-side` | Use `#trigger` slot with `class="tw:flex-row-reverse"` | **No prop** ΓÇö layout via Tailwind inside slot |
| `group` | `group` | Direct |
| `hide-expand-icon` | Use `#trigger` slot | **No prop** ΓÇö slot presence suppresses default chevron |
| `expand-icon` / `expanded-icon` | Use `#trigger` slot | **No props** ΓÇö put your icon in the trigger slot |
| `dense` / `bordered` / `color` / `dark` / `dense-toggle` | ΓÇö | **Drop** ΓÇö not needed |
| Inner `<q-card><q-card-section>` for padding | `<div class="tw:p-...">` wrapping slot content | **No prop** ΓÇö wrap default slot content in a div |
| `class` | `class` | Pass-through |
| `data-test` | `data-test` | Pass-through |

#### Event Mapping

| Quasar event | O2 event | Action |
|---|---|---|
| `@update:model-value` | `@update:modelValue` | Direct |
| `@before-show` | `@open` | Rename |
| `@show` | `@opened` | Rename |
| `@before-hide` | `@close` | Rename |
| `@hide` | `@closed` | Rename |

#### Slot Mapping

| Quasar slot | O2 slot | Action |
|---|---|---|
| `#default` | `#default` | Direct ΓÇö expansion body content |
| `#header` | `#trigger` | Rename ΓÇö custom trigger row content |

#### Code Examples

**Uncontrolled (default-opened):**

```vue
<!-- BEFORE -->
<q-expansion-item
  :label="category"
  default-opened
  header-class="text-weight-medium"
  expand-separator
>
  <div><!-- content --></div>
</q-expansion-item>

<!-- AFTER ΓÇö separator moved outside, header-class ΓåÆ #trigger slot -->
<OCollapsible :label="category" defaultOpen>
  <template #trigger="{ open }">
    <div class="tw:flex tw:items-center tw:gap-2 tw:font-medium tw:w-full">
      <span>{{ category }}</span>
      <q-icon :name="open ? 'expand_less' : 'expand_more'" class="tw:ml-auto" />
    </div>
  </template>
  <div><!-- content --></div>
</OCollapsible>
<OSeparator />
```

**Two-way bound (v-model):**

```vue
<!-- BEFORE -->
<q-expansion-item v-model="showAdvanced" icon="settings" label="Advanced Options">
  <!-- options -->
</q-expansion-item>

<!-- AFTER -->
<OCollapsible v-model="showAdvanced" :icon="SettingsIcon" label="Advanced Options">
  <!-- options -->
</OCollapsible>
```

**Fully controlled (ConfigPanel pattern ΓÇö ├ù40):**

```vue
<!-- BEFORE -->
<q-expansion-item
  v-show="isSectionVisible('axis')"
  :model-value="isExpanded('axis')"
  @update:model-value="(v) => { expandedSections.axis = v; }"
  :label="t('panel.axis')"
  dense
>
  <!-- config fields -->
</q-expansion-item>

<!-- AFTER ΓÇö dense dropped -->
<OCollapsible
  v-show="isSectionVisible('axis')"
  :model-value="isExpanded('axis')"
  @update:modelValue="(v) => { expandedSections.axis = v; }"
  :label="t('panel.axis')"
>
  <!-- config fields -->
</OCollapsible>
```

**Field list with inner card (Expansion Field List pattern):**

```vue
<!-- BEFORE ΓÇö inner q-card used only to strip expansion body padding -->
<q-expansion-item
  dense
  switch-toggle-side
  :label="field.name"
  expand-icon-class="field-expansion-icon"
  expand-icon="expand_more"
  expanded-icon="expand_less"
  @before-show="handleBeforeShow"
>
  <q-card>
    <q-card-section class="q-pl-md q-pr-xs q-py-xs">
      <!-- field values -->
    </q-card-section>
  </q-card>
</q-expansion-item>

<!-- AFTER ΓÇö
  - switch-toggle-side + expand-icon-class + expand-icon/expanded-icon ΓåÆ #trigger slot
  - inner q-card wrapper ΓåÆ <div> with Tailwind classes inside default slot
  - dense dropped
-->
<OCollapsible
  @open="handleBeforeShow"
>
  <template #trigger="{ open }">
    <div class="tw:flex tw:flex-row-reverse tw:items-center tw:gap-2 tw:w-full field-expansion-icon">
      <q-icon :name="open ? 'expand_less' : 'expand_more'" />
      <span>{{ field.name }}</span>
    </div>
  </template>
  <div class="tw:pl-4 tw:pr-1 tw:py-1">
    <!-- field values -->
  </div>
</OCollapsible>
```

**Node stats accordion with separator (Nodes.vue / TraceDetailsSidebar pattern):**

```vue
<!-- BEFORE -->
<q-expansion-item expand-separator :label="t('nodes.cpuusage')" class="q-mt-sm nodes-filter-list">
  <!-- chart content -->
</q-expansion-item>
<q-expansion-item expand-separator :label="t('nodes.memoryusage')" class="q-mt-sm nodes-filter-list">
  <!-- chart content -->
</q-expansion-item>

<!-- AFTER ΓÇö separator is a sibling OSeparator, not a prop -->
<OCollapsible :label="t('nodes.cpuusage')" class="tw:mt-2 nodes-filter-list">
  <!-- chart content -->
</OCollapsible>
<OSeparator />
<OCollapsible :label="t('nodes.memoryusage')" class="tw:mt-2 nodes-filter-list">
  <!-- chart content -->
</OCollapsible>
```

**Bordered accordion item (replaces `expanstion-item-o2` typo-class):**

```vue
<!-- BEFORE ΓÇö manual border via typo class -->
<q-expansion-item
  class="expanstion-item-o2 tw:mb-4 tw:rounded-lg tw:border tw:border-solid"
  :label="item.name"
>
  <!-- content -->
</q-expansion-item>

<!-- AFTER ΓÇö pass border classes directly -->
<OCollapsible
  class="tw:mb-4 tw:rounded-lg tw:border tw:border-solid"
  :label="item.name"
>
  <!-- content -->
</OCollapsible>
```

**Custom trigger slot (full trigger replacement):**

```vue
<!-- BEFORE -->
<q-expansion-item hide-expand-icon>
  <template #header>
    <div class="tw:flex tw:items-center tw:gap-2 tw:w-full">
      <span>Custom header</span>
      <OButton size="sm" variant="ghost">Action</OButton>
    </div>
  </template>
  <!-- content -->
</q-expansion-item>

<!-- AFTER ΓÇö no hideChevron prop needed:
  using #trigger slot automatically suppresses the default chevron trigger -->
<OCollapsible>
  <template #trigger>
    <div class="tw:flex tw:items-center tw:gap-2 tw:w-full">
      <span>Custom header</span>
      <OButton size="sm" variant="ghost">Action</OButton>
    </div>
  </template>
  <!-- content -->
</OCollapsible>
```

**Import**:

```ts
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
```

---

## CSS Override Elimination Reference

Every `:deep()` hack currently in the codebase is eliminated by a specific O2 prop:

| File | Current override | O2 replacement |
|---|---|---|
| `O2AIChat.vue` | `.q-card__section { padding: 0 }` | `class="tw:p-0"` on `<OCardSection>` |
| `common/JsonEditor.vue` | `:deep(.q-card__section) { ... }` | `class="tw:p-0"` on `<OCardSection>` |
| `functions/EnrichmentSchema.vue` | `.q-card__section--vert { ... }` | `class="tw:py-2"` on `<OCardSection>` |
| `ingestion/AWSIntegrationTile.vue` | `.q-card__section, .q-card__actions { padding: ... }` | `class` on OCardSection + OCardActions |
| `ingestion/AzureIntegrationTile.vue` | `.q-card__section, .q-card__actions { ... }` | `class` on OCardSection + OCardActions |
| `traces/metrics/TracesAnalysisDashboard.vue` | `.q-card__section--vert { ... }` | `class="tw:py-2"` on `<OCardSection>` |
| `Dashboards/DashboardJsonEditor.vue` | `:deep(.q-card__section) { padding: 0 }` | `class="tw:p-0"` on `<OCardSection>` |
| `settings/ServiceIdentityConfig.vue` | `:deep(.q-expansion-item__content) { padding-top: 0 }` | Wrap default slot content in `<div class="tw:pt-0">` |
| `logs/components/FieldExpansion.vue` | `:deep(.q-expansion-item__container .q-item) { ... }` | Use `#trigger` slot with Tailwind classes |
| `traces/TraceEvaluationsView.vue` | `:deep(.q-expansion-item__container) { border-radius: ... }` | `class="tw:rounded-..."` on `<OCollapsible>` |
| `actionScripts/EditScript.vue` | `.q-expansion-item .q-item { ... }` | `triggerClass="..."` on `<OCollapsible>` |
| `logstream/schema.vue` | `.q-card__section--vert { ... }` | `class="tw:py-2"` on `<OCardSection>` |
