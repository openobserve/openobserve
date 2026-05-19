# Quasar List Components → O2 / Native Migration Guide

> Covers: `q-list`, `q-item`, `q-item-section`, `q-item-label`  
> Source data from: `quasar-list-components-audit.md` (48 Vue files scanned)

---

## Status Overview

| Quasar Component                   | O2 Replacement                                       | Context                                         | O2 Status               |
| ---------------------------------- | ---------------------------------------------------- | ----------------------------------------------- | ----------------------- |
| `q-list` (in `q-menu`)             | **None needed** — delete it                          | `ODropdown` default slot renders items directly | ✅ ODropdown built      |
| `q-list` (standalone)              | Native `<ul>` / `<div>`                              | No O2 equivalent needed                         | ✅ Native               |
| `q-item` (in `q-menu`, clickable)  | `ODropdownItem`                                      | Popup menu items                                | ✅ ODropdownItem built  |
| `q-item` (in `q-select` `#option`) | OSelect `#option` slot API                           | Handled by OSelect migration                    | ✅ OSelect built        |
| `q-item` (display row)             | Native `<li>` / `<div>`                              | No O2 equivalent needed                         | ✅ Native               |
| `q-item` (nav link)                | Native `<router-link>`                               | Navigation rewrite (long-term)                  | ✅ Native               |
| `q-item-section`                   | Tailwind flex `<div>`                                | Layout utility — no component needed            | ✅ Native               |
| `q-item-label` (default)           | Plain text / `<span>`                                | Text content — no component needed              | ✅ Native               |
| `q-item-label caption`             | `<span class="tw:text-xs tw:text-muted-foreground">` | Secondary text                                  | ✅ Native               |
| `q-item-label header`              | `ODropdownGroup` `:label` prop                       | Section heading inside a dropdown               | ✅ ODropdownGroup built |

> **Key point:** Unlike the form components migration, **no new O2 components need to be built**. All replacements use existing O2 components (`ODropdownItem`, `ODropdownGroup`, `ODropdownSeparator`, `OSelect`) or native HTML + Tailwind.

---

## O2 Dropdown Family — Quick Reference

All dropdown-context replacements come from the `ODropdown` family located at `web/src/lib/overlay/Dropdown/`.

| O2 Component         | Import path                                     | Reka UI base                               | Replaces                             |
| -------------------- | ----------------------------------------------- | ------------------------------------------ | ------------------------------------ |
| `ODropdown`          | `@/lib/overlay/Dropdown/ODropdown.vue`          | `DropdownMenuRoot` + `DropdownMenuContent` | `q-menu`                             |
| `ODropdownItem`      | `@/lib/overlay/Dropdown/ODropdownItem.vue`      | `DropdownMenuItem`                         | `q-item[clickable]` inside `q-menu`  |
| `ODropdownGroup`     | `@/lib/overlay/Dropdown/ODropdownGroup.vue`     | `DropdownMenuGroup` + `DropdownMenuLabel`  | `q-item-label[header]` group wrapper |
| `ODropdownSeparator` | `@/lib/overlay/Dropdown/ODropdownSeparator.vue` | `DropdownMenuSeparator`                    | `q-separator` inside `q-menu`        |

---

## Migration Order (Recommended)

```
Context A — q-menu → ODropdown  (10 files, direct 1:1 mapping, highest value, unblocked) — DONE
Context D — display rows → native HTML + Tailwind  (30 files, no new API needed) — DONE
Context B — OSelect / q-select #option slots  (9 files, coordinate with the OSelect option-slot cleanup) — DONE
Context C — navigation (MenuLink.vue only)  (1 file) — DONE via lightweight `<router-link>` / `<a>` + `.nav-menu-item*` CSS rename (no full nav rework needed)
```

---

## Component-by-Component Guide

---

### 1. `q-list` → Delete (dropdown) / `<ul>` (display)

`q-list` is a pure layout container with no semantic meaning. It renders as a `<div role="list">` with CSS classes in Quasar.

**When inside `q-menu` (Context A):**
Delete `q-list` entirely. `ODropdown`'s default slot renders `ODropdownItem` children directly — no wrapper needed.

**When standalone display list (Context D):**
Replace with native `<ul>` or `<div>`. Apply `separator` → `tw:divide-y tw:divide-border`, `bordered` → `tw:border tw:rounded-md`, `dense` → no action (children control their own padding).

#### Prop Mapping

| Quasar prop | In dropdown context | In display context                               |
| ----------- | ------------------- | ------------------------------------------------ |
| `dense`     | — (delete `q-list`) | Drop — items control their own padding           |
| `separator` | — (delete `q-list`) | `class="tw:divide-y tw:divide-border"` on `<ul>` |
| `bordered`  | — (delete `q-list`) | `class="tw:border tw:rounded-md"` on `<ul>`      |
| `style`     | — (delete `q-list`) | Inline style on native element                   |
| `data-test` | — (delete `q-list`) | `data-test` on native element                    |

#### Code Example

```vue
<!-- BEFORE — inside q-menu -->
<q-menu>
  <q-list>
    <q-item clickable @click="openDocs">...</q-item>
  </q-list>
</q-menu>

<!-- AFTER — ODropdown needs no list wrapper -->
<ODropdown>
  <template #trigger>...</template>
  <ODropdownItem @select="openDocs">...</ODropdownItem>
</ODropdown>
```

```vue
<!-- BEFORE — standalone display list -->
<q-list separator bordered>
  <q-item>...</q-item>
  <q-item>...</q-item>
</q-list>

<!-- AFTER — native <ul> with Tailwind -->
<ul
  class="tw:flex tw:flex-col tw:divide-y tw:divide-border tw:border tw:rounded-md"
>
  <li>...</li>
  <li>...</li>
</ul>
```

---

### 2. `q-item` → `ODropdownItem` (dropdown) / `<li>` (display)

#### 2a. Clickable menu item (Context A) → `ODropdownItem`

`ODropdownItem` wraps Reka UI's `DropdownMenuItem`. It provides keyboard navigation, ARIA `role="menuitem"`, focus management, and a `destructive` variant for dangerous actions.

**Important:** `ODropdownItem` **must** be used inside an `ODropdown` default slot. It cannot be used as a standalone component.

##### Prop Mapping

| Quasar prop   | O2 prop        | Action                                          |
| ------------- | -------------- | ----------------------------------------------- |
| `clickable`   | —              | **Drop** — `ODropdownItem` is always clickable  |
| `dense`       | —              | **Drop** — baked into design tokens             |
| `v-ripple`    | —              | **Drop** — no ripple in O2                      |
| `tag="label"` | —              | **Drop** — wrap in a native `<label>` if needed |
| `:disable`    | `:disabled`    | Rename                                          |
| `style`       | Native `style` | Pass-through via `$attrs`                       |
| `class`       | Native `class` | Pass-through                                    |
| `data-test`   | `data-test`    | Pass-through                                    |

##### Event Mapping

| Quasar          | O2        | Notes                                                                      |
| --------------- | --------- | -------------------------------------------------------------------------- |
| `@click`        | `@select` | Renamed — fires when the item is activated (click or keyboard Enter/Space) |
| `v-close-popup` | —         | **Drop** — ODropdown closes automatically on item select                   |

##### Slot Mapping

| Quasar pattern                      | O2 slot       | Notes                        |
| ----------------------------------- | ------------- | ---------------------------- |
| `<q-item-section avatar>` with icon | `#icon-left`  | Icon placed before the label |
| `<q-item-section side>` with icon   | `#icon-right` | Icon placed after the label  |
| `<q-item-section>` main text        | `#default`    | The item label text          |

##### Code Example

```vue
<!-- BEFORE -->
<q-item clickable @click="openDocs">
  <q-item-section avatar>
    <q-icon name="book" size="16px" />
  </q-item-section>
  <q-item-section>
    <q-item-label>{{ t('menu.docs') }}</q-item-label>
  </q-item-section>
</q-item>

<!-- AFTER -->
<ODropdownItem @select="openDocs">
  <template #icon-left>
    <q-icon name="book" size="16px" />
  </template>
  {{ t('menu.docs') }}
</ODropdownItem>
```

**Destructive variant** (Delete / Remove actions):

```vue
<!-- BEFORE -->
<q-item clickable @click="deleteItem" class="text-negative">
  <q-item-section>
    <q-item-label>{{ t('common.delete') }}</q-item-label>
  </q-item-section>
</q-item>

<!-- AFTER -->
<ODropdownItem variant="destructive" @select="deleteItem">
  {{ t('common.delete') }}
</ODropdownItem>
```

**Import:**

```ts
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue"
```

---

#### 2b. Option slot item (Context B) → OSelect `#option` slot or `:options` prop

When `q-item` appears inside a `q-select`'s `#option` slot (identified by `v-bind="scope.itemProps"` or `v-bind="props.itemProps"`), the entire `q-item` + `q-item-section` + `q-item-label` tree is replaced as part of the `q-select → OSelect` migration.

**Simple case — use `:options` with `labelKey` / `valueKey`:**

```vue
<!-- BEFORE -->
<q-select
  :options="streamOptions"
  emit-value
  map-options
  option-label="name"
  option-value="value"
  v-model="selected"
>
  <template v-slot:option="scope">
    <q-item v-bind="scope.itemProps">
      <q-item-section>
        <q-item-label>{{ scope.opt.name }}</q-item-label>
      </q-item-section>
    </q-item>
  </template>
</q-select>

<!-- AFTER — OSelect handles rendering automatically -->
<OSelect
  v-model="selected"
  :options="streamOptions"
  label-key="name"
  value-key="value"
/>
```

**Custom rendering case — use OSelect `#option` slot:**

```vue
<!-- BEFORE -->
<q-select :options="colorOptions" v-model="mode">
  <template v-slot:option="scope">
    <q-item v-bind="scope.itemProps">
      <q-item-section>
        <q-item-label>{{ scope.opt.label }}</q-item-label>
        <q-item-label caption>{{ scope.opt.subLabel }}</q-item-label>
      </q-item-section>
    </q-item>
  </template>
</q-select>

<!-- AFTER -->
<OSelect v-model="mode" :options="colorOptions">
  <template #option="{ option }">
    <div class="tw:flex tw:flex-col tw:px-3 tw:py-1.5">
      <span class="tw:text-sm">{{ option.label }}</span>
      <span class="tw:text-xs tw:text-muted-foreground">{{ option.subLabel }}</span>
    </div>
  </template>
</OSelect>
```

> See `quasar-form-components-migration.md` for the full `q-select → OSelect` guide.

---

#### 2c. Display row (Context D) → native `<li>` / `<div>`

Non-interactive `q-item` rows (info panels, key-value metadata, diff rows) are replaced with native elements and Tailwind flex utilities.

```vue
<!-- BEFORE -->
<q-item>
  <q-item-section avatar>
    <q-icon name="schedule" size="sm" />
  </q-item-section>
  <q-item-section>
    <q-item-label>Created</q-item-label>
    <q-item-label caption>{{ formatDate(item.createdAt) }}</q-item-label>
  </q-item-section>
</q-item>

<!-- AFTER -->
<li class="tw:flex tw:items-center tw:gap-3 tw:px-3 tw:py-2">
  <q-icon name="schedule" size="sm" class="tw:shrink-0 tw:text-muted-foreground" />
  <div class="tw:flex tw:flex-col tw:min-w-0">
    <span class="tw:text-sm">Created</span>
    <span class="tw:text-xs tw:text-muted-foreground">{{ formatDate(item.createdAt) }}</span>
  </div>
</li>
```

---

### 3. `q-item-section` → Tailwind flex children

`q-item-section` is a flex child with no semantic meaning. Replace entirely with `<div>` + Tailwind.

#### Prop / Role Mapping

| Quasar usage                         | Replacement                                                    |
| ------------------------------------ | -------------------------------------------------------------- |
| `<q-item-section>` (main content)    | `<div class="tw:flex tw:flex-col tw:flex-1 tw:min-w-0">`       |
| `<q-item-section avatar>`            | `<div class="tw:flex tw:items-center tw:shrink-0">`            |
| `<q-item-section side>`              | `<div class="tw:flex tw:items-center tw:shrink-0 tw:ms-auto">` |
| `<q-item-section top>`               | Add `tw:self-start` to the main content div                    |
| `<q-item-section dense>`             | Drop — child elements control their own padding                |
| When inside `ODropdownItem` avatar → | Use `#icon-left` slot on `ODropdownItem`                       |
| When inside `ODropdownItem` side →   | Use `#icon-right` slot on `ODropdownItem`                      |

#### Event Mapping

| Quasar pattern                   | Replacement                                                     |
| -------------------------------- | --------------------------------------------------------------- |
| `<q-item-section @click.stop>`   | `<div @click.stop>`                                             |
| `<q-item-section v-close-popup>` | Drop — ODropdown closes automatically on `ODropdownItem` select |

---

### 4. `q-item-label` → native text elements

`q-item-label` is a text renderer. Replace with `<span>` / `<p>` + Tailwind based on which prop was set.

#### Prop Mapping

| Quasar prop              | Replacement                                                                                 | Notes                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `(none)` — primary label | `<span class="tw:text-sm tw:leading-tight">` or plain text                                  | Main item text                                                                                     |
| `caption`                | `<span class="tw:block tw:text-xs tw:text-muted-foreground">`                               | Secondary / muted text below main label                                                            |
| `header`                 | **`ODropdownGroup` `:label` prop**                                                          | Section heading above a group of dropdown items — this is the ONLY correct use of `ODropdownGroup` |
| `overline`               | `<span class="tw:block tw:text-xs tw:uppercase tw:tracking-wide tw:text-muted-foreground">` | Eyebrow text — not found in codebase                                                               |
| `lines="1"`              | `class="tw:truncate"` on the span                                                           | Single-line truncation                                                                             |
| `lines="2"`              | `class="tw:line-clamp-2"` on the span                                                       | Two-line clamp                                                                                     |
| `class`                  | Transfer to the replacement `<span>`                                                        | Transfer as-is                                                                                     |

#### Code Example — `q-item-label header`

```vue
<!-- BEFORE — section heading outside any q-item -->
<q-list>
  <q-item-label header>Actions</q-item-label>
  <q-item clickable @click="edit">...</q-item>
  <q-item clickable @click="delete">...</q-item>
</q-list>

<!-- AFTER — ODropdownGroup wraps items under a named section -->
<ODropdownGroup label="Actions">
  <ODropdownItem @select="edit">Edit</ODropdownItem>
  <ODropdownItem variant="destructive" @select="delete">Delete</ODropdownItem>
</ODropdownGroup>
```

**Import:**

```ts
import ODropdownGroup from "@/lib/overlay/Dropdown/ODropdownGroup.vue"
```

---

## Full Dropdown Migration Example

Combining all four components in a real-world `q-menu` replacement:

```vue
<!-- BEFORE — Header.vue user menu -->
<q-menu>
  <q-list style="min-width: 250px">
    <!-- Non-clickable user info row -->
    <q-item>
      <q-item-section avatar>
        <q-avatar size="32px">...</q-avatar>
      </q-item-section>
      <q-item-section>
        <q-item-label>{{ currentUser.name }}</q-item-label>
        <q-item-label caption>{{ currentUser.email }}</q-item-label>
      </q-item-section>
    </q-item>

    <!-- Section heading -->
    <q-item-label header>Settings</q-item-label>

    <q-item clickable @click="manageTheme">
      <q-item-section avatar>
        <q-icon name="palette" />
      </q-item-section>
      <q-item-section>
        <q-item-label>{{ t('common.manageTheme') }}</q-item-label>
      </q-item-section>
    </q-item>

    <q-item clickable @click="signOut" class="text-negative">
      <q-item-section>
        <q-item-label>{{ t('menu.signOut') }}</q-item-label>
      </q-item-section>
    </q-item>
  </q-list>
</q-menu>

<!-- AFTER — ODropdown with native info row + ODropdownGroup + ODropdownItems -->
<ODropdown>
  <template #trigger>
    <OButton variant="ghost" size="icon">...</OButton>
  </template>

  <!-- Non-clickable info row — native HTML, not ODropdownItem -->
  <div class="tw:flex tw:items-center tw:gap-3 tw:px-3 tw:py-2 tw:border-b tw:border-border">
    <q-avatar size="32px">...</q-avatar>
    <div class="tw:flex tw:flex-col tw:min-w-0">
      <span class="tw:text-sm tw:font-medium tw:truncate">{{ currentUser.name }}</span>
      <span class="tw:text-xs tw:text-muted-foreground tw:truncate">{{ currentUser.email }}</span>
    </div>
  </div>

  <!-- Grouped clickable items -->
  <ODropdownGroup label="Settings">
    <ODropdownItem @select="manageTheme">
      <template #icon-left>
        <q-icon name="palette" />
      </template>
      {{ t('common.manageTheme') }}
    </ODropdownItem>
  </ODropdownGroup>

  <ODropdownSeparator />

  <ODropdownItem variant="destructive" @select="signOut">
    {{ t('menu.signOut') }}
  </ODropdownItem>
</ODropdown>
```

**Import block:**

```ts
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue"
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue"
import ODropdownGroup from "@/lib/overlay/Dropdown/ODropdownGroup.vue"
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue"
```
