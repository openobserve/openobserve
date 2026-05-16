# Quasar Separator ΓåÆ O2 / Reka UI Migration Guide

> Covers: `q-separator`
> Source data from: `web/src/**/*.vue` (140 files scanned)

---

## Status Overview

| Quasar Component | O2 Component | Reka UI Primitive | Usages | O2 Status |
|---|---|---|---|---|
| `q-separator` | `OSeparator` | `Separator` from `reka-ui` | ~250 occurrences in 140 files | Γ£à Built |

> `OSeparator` lives in `web/src/lib/core/Separator/`. It is already registered in the component catalog.

---

## Migration Order (Recommended)

`OSeparator` is a single, atomic component ΓÇö no compound family, no tier structure needed. Migrate all files in one pass, heaviest first:

```
Tier 1 ΓÇö High density (5+ occurrences)
  plugins/logs/SearchBar.vue             (14)
  components/alerts/AlertHistory.vue     (9)
  components/pipelines/PipelineHistory.vue (9)
  components/O2AIChat.vue                (7)
  plugins/pipelines/CustomNode.vue       (6)
  components/dashboards/addPanel/DashboardQueryBuilder.vue (6)
  components/Header.vue                  (5)
  components/rum/ResourceDetailDrawer.vue (5)
  components/logstream/AssociatedRegexPatterns.vue (8)

Tier 2 ΓÇö Medium density (2ΓÇô4 occurrences) ΓÇö ~40 files
Tier 3 ΓÇö Low density (1 occurrence) ΓÇö ~90 files
```

---

## Component Guide

### `q-separator` ΓåÆ `OSeparator`

**Family**: `OSeparator` (single component, no compound family)
**Location**: `web/src/lib/core/Separator/`
**Headless base**: `Separator` from `reka-ui`

```ts
import { Separator } from "reka-ui";
```

**Why Reka UI**: `Separator` renders a native `<div>` with correct `role="separator"` and `aria-orientation` ΓÇö providing accessibility semantics without any implementation overhead.

---

### Prop Mapping

| Quasar prop | OSeparator prop | Action |
|---|---|---|
| `vertical` | `vertical` | Direct |
| `inset` | `class="tw:mx-4"` (horizontal) / `class="tw:my-2"` (vertical) | **Drop prop** ΓÇö use Tailwind class |
| `spaced` | `class="tw:my-2"` (horizontal) / `class="tw:mx-2"` (vertical) | **Drop prop** ΓÇö use Tailwind class |
| `color="grey-4"` or stronger color | `class="tw:bg-separator-strong"` | **Drop prop** ΓÇö use Tailwind class |
| `color="white"` / any other color | `class="tw:bg-[value]"` | **Drop prop** ΓÇö use Tailwind class |
| `size="2px"` | `class="tw:h-[2px]"` | **Drop prop** ΓÇö use Tailwind class |
| `horizontal` | _(default)_ | **Drop** ΓÇö horizontal is the default |
| `dark` | ΓÇö | **Drop** ΓÇö CSS variables handle dark mode |

> **OSeparator has 1 prop**: `vertical`. Everything else ΓÇö spacing, color, size ΓÇö goes on `class` as Tailwind utilities.

---

### Spacing ΓÇö Quasar class ΓåÆ Tailwind class

The most common migration work is converting Quasar spacing classes to Tailwind. All spacing goes on `class` directly ΓÇö not props:

| Quasar class | Tailwind equivalent |
|---|---|
| `class="q-my-sm"` | `class="tw:my-2"` |
| `class="q-my-md"` | `class="tw:my-4"` |
| `class="q-mt-sm"` | `class="tw:mt-2"` |
| `class="q-mt-md"` | `class="tw:mt-4"` |
| `class="q-mb-sm"` | `class="tw:mb-2"` |
| `class="q-mb-md"` | `class="tw:mb-4"` |
| `class="q-mb-xl"` | `class="tw:mb-8"` |
| `class="q-mt-lg q-mb-md"` | `class="tw:mt-6 tw:mb-4"` |
| `class="q-mt-sm q-mb-md"` | `class="tw:mt-2 tw:mb-4"` |
| `class="q-mx-md q-mt-md"` | `class="tw:mx-4 tw:mt-4"` |
| `class="q-mr-sm"` | `class="tw:mr-2"` |
| `class="q-mr-md"` | `class="tw:mr-4"` |
| `class="full-width"` | `class="tw:w-full"` |
| `class="full-height"` | `class="tw:h-full"` |

Tailwind classes already on `q-separator` (`tw:my-2`, `tw:mb-4`, etc.) carry over unchanged.

---

### Event Mapping

`q-separator` / `OSeparator` emit no events. No event migration needed.

### Slot Mapping

Neither `q-separator` nor `OSeparator` have slots.

---

### Code Examples

**Plain horizontal separator (most common):**

```vue
<!-- BEFORE -->
<q-separator />

<!-- AFTER -->
<OSeparator />
```

**With vertical spacing:**

```vue
<!-- BEFORE -->
<q-separator class="q-my-md" />

<!-- AFTER -->
<OSeparator class="tw:my-4" />
```

**Already using Tailwind (no change needed beyond tag rename):**

```vue
<!-- BEFORE -->
<q-separator class="tw:my-2" />

<!-- AFTER -->
<OSeparator class="tw:my-2" />
```

**Vertical separator:**

```vue
<!-- BEFORE -->
<q-separator vertical />

<!-- AFTER -->
<OSeparator vertical />
```

**Vertical with spacing:**

```vue
<!-- BEFORE -->
<q-separator vertical class="q-mr-md" />

<!-- AFTER -->
<OSeparator vertical class="tw:mr-4" />
```

**Inset (does not span full width):**

```vue
<!-- BEFORE -->
<q-separator inset />
<q-separator horizontal inset />
<q-separator vertical inset />

<!-- AFTER ΓÇö inset via class -->
<OSeparator class="tw:mx-4" />
<OSeparator class="tw:mx-4" />
<OSeparator vertical class="tw:my-2" />
```

**Spaced (adds margin above/below):**

```vue
<!-- BEFORE -->
<q-separator spaced />

<!-- AFTER ΓÇö spaced via class -->
<OSeparator class="tw:my-2" />
```

**Stronger color (grey-4 equivalent):**

```vue
<!-- BEFORE -->
<q-separator color="grey-4" />

<!-- AFTER ΓÇö strong color via class -->
<OSeparator class="tw:bg-separator-strong" />
```

**Arbitrary color (white separator):**

```vue
<!-- BEFORE -->
<q-separator color="white" class="q-mt-xs q-mb-xs" />

<!-- AFTER ΓÇö no color prop, pass Tailwind class directly -->
<OSeparator class="tw:bg-white tw:mt-1 tw:mb-1" />
```

**Custom size:**

```vue
<!-- BEFORE -->
<q-separator class="tw:mb-1 tw:mt-[3px]" size="2px" />

<!-- AFTER ΓÇö size via class, not a prop -->
<OSeparator class="tw:h-[2px] tw:mb-1 tw:mt-[3px]" />
```

**Vertical separator inline (wrapped in flex container):**

```vue
<!-- BEFORE -->
<span class="tw:flex-1"><q-separator /></span>

<!-- AFTER ΓÇö same wrapper pattern -->
<span class="tw:flex-1"><OSeparator /></span>
```

**Custom height vertical separator (button toolbar separator):**

```vue
<!-- BEFORE -->
<q-separator class="tw:h-[29px] tw:w-[1px]" />

<!-- AFTER -->
<OSeparator vertical class="tw:h-[29px]" />
```

**Conditional rendering:**

```vue
<!-- BEFORE -->
<q-separator v-if="!customQuery" />
<q-separator v-if="index < items.length - 1" class="q-my-xs" />

<!-- AFTER -->
<OSeparator v-if="!customQuery" />
<OSeparator v-if="index < items.length - 1" class="tw:my-1" />
```

**With data-test:**

```vue
<!-- BEFORE -->
<q-separator data-test="separator" vertical />

<!-- AFTER -->
<OSeparator data-test="separator" vertical />
```

**Inline style ΓåÆ class migration:**

```vue
<!-- BEFORE -->
<q-separator style="margin-top: -1px; flex-shrink: 0" />
<q-separator style="width: 100%" />

<!-- AFTER -->
<OSeparator class="tw:-mt-px tw:shrink-0" />
<OSeparator class="tw:w-full" />
```

---

**Import**:

```ts
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
```
