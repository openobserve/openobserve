# Component Spec: OTabs System
## Replacing: `q-tabs` + `q-tab` + `q-tab-panels` + `q-tab-panel`

_Spec authored: April 24, 2026_

---

## 1. Why This Exists

Quasar's tab system (`q-tabs`, `q-tab`, `q-tab-panels`, `q-tab-panel`) is used across **95 files** (tab items) and **41 files** (tab bars) in the OpenObserve frontend. It is a compound component system — all four components must be replaced together because they share a binding mechanism via `v-model` on the active tab name.

Current coupling to Quasar:
- `q-tabs` / `q-tab` CSS internals (`.q-tabs`, `.q-tab__label`, `.q-tab__indicator`, `.q-tab__icon`, `.q-tabs__content`) are overridden in **34 places**
- `indicator-color`, `active-color` style props tie us to Quasar's color system
- `v-ripple` is used on `q-tab` items (14 total), which is a Quasar directive

---

## 2. Real Usage Inventory

### q-tabs (41 files, ~49 instances)

| Prop | Uses | Notes |
|------|------|-------|
| `v-model` | 100% | Always present — the active tab name/value |
| `dense` | 23 | Reduces tab height |
| `inline-label` | 32 | Shows icon + label side by side instead of stacked |
| `indicator-color` | 27 | Sets the active underline color (majority: `"transparent"` or `"primary"`) |
| `active-color` | 9 | Active tab text color |
| `no-caps` | 4 | Disables text-transform: uppercase |
| `align` | 10 | `"left"` (8×), `"right"` (1×), `"center"` (1×) |
| `outside-arrows` | 4 | Scroll arrows outside the tab bar |
| `narrow-indicator` | 2 | Indicator same width as label |
| `vertical` | **20** | Vertical tab bar layout (used in Dashboards, FolderList) |
| `shrink` | 2 | Tab bar shrinks to content width |
| `@update:model-value` | 3 | Change event handler (CorrelationSettings, RouteTabs, ServiceIdentitySetup) |

### q-tab (32 named props, 95 files)

| Prop | Uses | Notes |
|------|------|-------|
| `name` | 132 | **Required** — uniquely identifies this tab, bound to q-tabs v-model |
| `label` | 119 | Text label (often i18n translated) |
| `icon` | 9 | Material icon name alongside label |
| `no-caps` | 12 | Per-tab text transform override |
| `ripple=false` | 2 | Disabling Quasar's ripple (our replacement needn't worry about this) |
| `content-class` | 2 | CSS class on inner content wrapper |
| **Default slot** | **~8 files** | Custom content inside tab trigger (see below) |
| `v-for` dynamic | ~15 files | Tabs rendered from arrays |

**Critical: Custom slot content in q-tab (8 files)**

Some tabs contain rich content instead of just `name` + `label`:

1. **Badge inside tab** — tab shows a count badge (e.g. "alertTriggers (3)")
2. **Icon with tooltip** — tab has a visibility icon that triggers an action
3. **Remove/close icon** — tab has an `×` delete icon to remove it
4. **Full custom layout** — folder name + hover action buttons (edit/delete)
5. **Component icon** — SVG component icon + text + badge

These are all in the **default slot** of `<q-tab>`. Our `OTab` must support a default slot in addition to `name`/`label`/`icon` props.

### q-tab-panels (17 files, 10 instances)

| Prop | Uses | Notes |
|------|------|-------|
| `v-model` | 100% | Synced with q-tabs v-model |
| `animated` | 11 | Slide transition between panels |
| `swipeable` | 1 | Touch swipe support |
| `keep-alive` | 1 | Keeps panel DOM alive when switching |
| `class` | various | Layout classes (`tw:flex-1`, etc.) |

### q-tab-panel (37 instances, 17 files)

| Prop | Uses | Notes |
|------|------|-------|
| `name` | 100% | Must match q-tab's `name` |
| `class` | many | Always used for padding/layout (often `tw:p-0` to remove default Quasar padding) |
| Default slot | 100% | The panel content itself |

---

## 3. Component Architecture

### Naming

| Quasar | O2 |
|--------|----|
| `q-tabs` | `OTabs` |
| `q-tab` | `OTab` |
| `q-tab-panels` | `OTabPanels` |
| `q-tab-panel` | `OTabPanel` |

### Files to create

```
web/src/lib/navigation/Tabs/
├── OTabs.vue
├── OTabs.types.ts
├── OTabs.spec.ts
├── OTab.vue
├── OTab.types.ts
├── OTab.spec.ts
├── OTabPanels.vue
├── OTabPanels.types.ts
├── OTabPanels.spec.ts
├── OTabPanel.vue
├── OTabPanel.types.ts
└── OTabPanel.spec.ts
```

### State sharing

The active tab value is owned by the parent (`v-model` on `OTabs`). `OTab` needs to know the active value to render its active state. This is done via Vue's `provide`/`inject` — `OTabs` provides `{ modelValue, onTabClick }`, `OTab` injects it.

No Vuex/Pinia — purely local Vue composition.

---

## 4. Props Specification

### OTabs

```ts
interface OTabsProps {
  modelValue: string | number          // required — the active tab name
  orientation?: 'horizontal' | 'vertical'  // default: 'horizontal' (replaces `vertical`)
  align?: 'left' | 'center' | 'right' | 'justify'  // default: 'left'
  dense?: boolean                      // default: false — compact height
  indicatorColor?: string              // CSS token name, default: 'primary'
  activeColor?: string                 // CSS token name for active tab text
  shrink?: boolean                     // default: false
  outsideArrows?: boolean              // default: false — used in dashboards
  narrowIndicator?: boolean            // default: false
}

interface OTabsEmits {
  (e: 'update:modelValue', value: string | number): void
  (e: 'change', value: string | number): void
}

interface OTabsSlots {
  default: () => unknown  // OTab children
}
```

**Dropped from Quasar:** `no-caps` (handle via CSS/class), `inline-label` (layout baked into design), `mobile-arrows` (not used).

### OTab

```ts
interface OTabProps {
  name: string | number           // required — unique identifier
  label?: string                  // display text
  icon?: string                   // icon name (fed to OIcon or named slot)
  disable?: boolean               // default: false
}

interface OTabSlots {
  default?: () => unknown         // custom tab trigger content (badge, icons, custom layout)
  icon?: () => unknown            // custom icon area
}
```

**Dropped from Quasar:** `no-caps` (per-tab override removes consistency), `ripple`, `content-class` (use class attr instead), `alert`, `alert-icon` (not used in codebase).

### OTabPanels

```ts
interface OTabPanelsProps {
  modelValue: string | number     // required — synced with OTabs
  animated?: boolean              // default: false — CSS slide transition
  keepAlive?: boolean             // default: false
}

interface OTabPanelsEmits {
  (e: 'update:modelValue', value: string | number): void
}

interface OTabPanelsSlots {
  default: () => unknown          // OTabPanel children
}
```

**Dropped from Quasar:** `swipeable` (1 usage, mobile-only, out of scope for POC).

### OTabPanel

```ts
interface OTabPanelProps {
  name: string | number           // required — must match OTab name
}

interface OTabPanelSlots {
  default: () => unknown          // panel content
}
```

---

## 5. Visual Design Specification

### Horizontal tabs (default)

```
┌────────────────────────────────┐
│  [Overview] [Activity] [Logs]  │  ← tab bar
│  ─────────╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌  │  ← indicator line under active tab
├────────────────────────────────┤
│                                │
│      Panel content here        │
│                                │
└────────────────────────────────┘
```

- **Active tab**: `text-tabs-active` color, `border-b-2 border-tabs-indicator`
- **Inactive tab**: `text-tabs-inactive` color, hover → `text-tabs-hover`
- **Disabled tab**: 40% opacity, `cursor-not-allowed`
- **Dense mode**: reduces padding/height by 25%
- **No default padding on panels** — panels are `p-0` by default (matches real usage where every consumer adds their own `tw:p-0` or custom padding)

### Vertical tabs

```
┌──────┬──────────────────────┐
│ Fold │                      │
│ ers  │   Panel content      │
│ ──── │                      │
│ Dash │                      │
│ boar │                      │
└──────┴──────────────────────┘
```

- Indicator moves to the right edge of the tab (vertical bar)
- Used in: `FolderList.vue`, `Dashboards.vue` (ingestion section)
- Layout: `flex-row` on the container, tab bar is `flex-col`

---

## 6. Token Requirements

New tokens to add to `web/src/lib/styles/tokens/component.css`:

```css
/* ---- Tabs ---- */
--color-tabs-indicator:        var(--color-primary-600);
--color-tabs-active-text:      var(--color-primary-600);
--color-tabs-inactive-text:    var(--color-text-secondary);
--color-tabs-hover-text:       var(--color-text-primary);
--color-tabs-hover-bg:         var(--color-grey-100);
--color-tabs-disabled-text:    var(--color-text-disabled);
--color-tabs-bar-border:       var(--color-border-default);
--spacing-tabs-height:         40px;
--spacing-tabs-height-dense:   32px;
--spacing-tabs-panel-gap:      0px;
```

---

## 7. CSS Override Migration

These `:deep(.q-tab*)` and `.q-tabs` rules must be updated after migration:

| Current class | Files | Replace with |
|---------------|-------|-------------|
| `.q-tabs` | 16 | `.o-tabs` |
| `.q-tab__label` | 6 | `.o-tab__label` |
| `.q-tab__indicator` | 4 | `.o-tab__indicator` |
| `.q-tab__icon` | 2 | `.o-tab__icon` |
| `.q-tabs__content` | 2 | `.o-tabs__content` |

**Total CSS override cleanups: 30 rules across ~15 files.**

---

## 8. Accessibility Requirements

- `OTabs` renders as `<div role="tablist">`
- Each `OTab` renders as `<button role="tab" :aria-selected="isActive" :aria-controls="panelId">`
- Each `OTabPanel` renders as `<div role="tabpanel" :aria-labelledby="tabId">`
- Keyboard navigation: `←` / `→` (horizontal) or `↑` / `↓` (vertical) moves focus between tabs; `Enter` / `Space` activates
- `aria-disabled` on disabled tabs
- Focus indicator must be visible (`:focus-visible` ring)

---

## 9. Migration Pattern

### Before (Quasar)
```vue
<q-tabs v-model="activeTab" dense inline-label active-color="primary" indicator-color="primary" align="left">
  <q-tab name="logs" :label="t('common.logs')" />
  <q-tab name="metrics" :label="t('search.metrics')" />
  <q-tab name="traces" icon="timeline">
    <q-tooltip>Distributed traces</q-tooltip>
  </q-tab>
</q-tabs>

<q-tab-panels v-model="activeTab" animated>
  <q-tab-panel name="logs" class="tw:p-0">
    <LogsView />
  </q-tab-panel>
  <q-tab-panel name="metrics" class="tw:p-0">
    <MetricsView />
  </q-tab-panel>
</q-tab-panels>
```

### After (O2)
```vue
<OTabs v-model="activeTab" dense align="left">
  <OTab name="logs" :label="t('common.logs')" />
  <OTab name="metrics" :label="t('search.metrics')" />
  <OTab name="traces" icon="timeline">
    <OTooltip>Distributed traces</OTooltip>
  </OTab>
</OTabs>

<OTabPanels v-model="activeTab" animated>
  <OTabPanel name="logs">
    <LogsView />
  </OTabPanel>
  <OTabPanel name="metrics">
    <MetricsView />
  </OTabPanel>
</OTabPanels>
```

**What changed:**
- `active-color="primary"` → removed (baked into token `--color-tabs-active-text`)
- `indicator-color="primary"` → removed (baked into token `--color-tabs-indicator`)
- `inline-label` → removed (default layout bakes this in)
- `class="tw:p-0"` on panels → removed (panels are `p-0` by default)

---

## 10. Out of Scope (POC)

The following are noted but **not required** to prove the concept:

- `swipeable` (1 usage only)
- `outside-arrows` / scroll overflow (4 usages — add in follow-up)
- Router-linked tabs (`to` prop on q-tab) — not found in codebase

---

## 11. Estimated Effort

| Task | Estimate |
|------|----------|
| Design tokens | 0.5 day |
| OTab + OTabs components + keyboard nav | 1.5 days |
| OTabPanels + OTabPanel + animation | 0.5 day |
| Unit tests (all 4 components) | 1 day |
| CSS override migration in 15 files | 0.5 day |
| Template swap in 95 files (scripted) | 0.5 day |
| **Total** | **~4.5 days** |
