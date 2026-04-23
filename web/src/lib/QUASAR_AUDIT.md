# Quasar Full Audit — OpenObserve Web Frontend

_Audited: April 24, 2026_

---

## Scale Overview

| Metric | Number |
|--------|--------|
| Total `.vue` files | **588** |
| Files using any Quasar component tag (`<q-*`) | **408 (69%)** |
| Total component tag instances | **3,243** |
| Distinct component types | **55** |
| Files using `useQuasar` / `$q` | **~498** |
| `$q.notify` / `Notify.create` calls | **594** |
| `$q.dialog` / `Dialog.create` calls | **10** |
| `v-close-popup` directive usages | **264** |
| `v-ripple` directive usages | **14** |
| Quasar spacing utilities (`q-pa-`, `q-ml-`, etc.) in templates | **2,795 lines in 389 files** |
| CSS overrides targeting `.q-*` classes (`:deep`, scoped) | **2,107 instances, 218 unique classes** |
| Files with direct `from 'quasar'` imports | **135** |
| `copyToClipboard` (Quasar util) | **62 files** |

---

## Group 1 — Layout & Structure

| Component | Instances | Files | Props Used | CSS Overrides | Complexity | Priority |
|-----------|-----------|-------|------------|---------------|------------|----------|
| `q-page` | 43 | 47 | basic wrapper | `.q-page` | Low | Low — layout, rarely overridden |
| `q-card` | 153 | 106 | minimal | many `.q-card*` | Medium | **High — 106 files, core layout** |
| `q-card-section` | 250 | 96 | `horizontal` | `.q-card__section` | Low | Medium — always with q-card |
| `q-card-actions` | 69 | 47 | `align` | `.q-card__actions` | Low | Medium — always with q-card |
| `q-separator` | 255 | 134 | `vertical`, `inset`, `spaced`, `color` | few | Low | Medium — ✅ OSeparator already built |
| `q-space` | 36 | 30 | none | none | Trivial | Low |
| `q-splitter` | 1 | ~1 | complex | few | High | Low — 1 file |
| `q-banner` | 5 | 9 | minimal | few | Low | Low |

---

## Group 2 — Lists & Navigation Items

| Component | Instances | Files | Props Used | CSS Overrides | Complexity | Priority |
|-----------|-----------|-------|------------|---------------|------------|----------|
| `q-list` | 58 | 37 | `dense`, `bordered`, `padding` | `.q-list` | Low | Medium — always compound with q-item |
| `q-item` | 102 | 77 | `clickable`, `v-ripple`, `dense`, `to`, `tag`, `disable` | heavy `.q-item*` | Medium | **Medium-High** |
| `q-item-section` | 275 | 74 | `side`, `top`, `avatar`, `thumbnail`, `no-wrap` | `.q-item__section` | Low | Medium — depends on q-item |
| `q-item-label` | 124 | 54 | `overline`, `caption`, `header`, `lines` | `.q-item__label` | Low | Low |

---

## Group 3 — Buttons & Actions

| Component | Instances | Files | Props Used | CSS Overrides | Complexity | Priority |
|-----------|-----------|-------|------------|---------------|------------|----------|
| `q-btn` | 133 | 299 | `flat`(88×), `round`(50×), `dense`(45×), `no-caps`(24×), `icon`, `label`, `size`, `color`, `unelevated`, `loading`, `disable` | heavy `.q-btn*` (135 overrides) | Medium | **🔴 Highest file count — 299 files** |
| `q-btn-group` | 10 | 17 | `outline`, `spread`, `push`, `flat` | few | Low | Medium |
| `q-menu` (often inside btn) | 17 | 25 (38 as btn+menu compound) | `anchor`, `self`, `offset`, `persistent` | `.q-menu` (43 overrides) | High | **High — dropdown pattern, tied to v-close-popup** |
| `q-popup-proxy` | 2 | 5 | `cover`, `breakpoint` | few | Medium | Low |

---

## Group 4 — Overlay & Feedback

| Component | Instances | Files | Props Used | CSS Overrides | Complexity | Priority |
|-----------|-----------|-------|------------|---------------|------------|----------|
| `q-dialog` | 94 | 93 | `persistent`(14×), `position`(13×), `maximized`(11×), `full-height`(10×) | few | **Very High** — focus trap, portal | **High priority, High risk** |
| `q-tooltip` | 375 | 138 | `anchor`(65×), `self`(63×), `delay`(38×), `max-width`(37×), `offset`(8×) | minimal | Medium — floating UI | **🟡 Best POC candidate** |
| `q-spinner-hourglass` | 49 | 55 | `color`, `size` | few | Low | Medium |
| `q-spinner` | 24 | 86 | `color`, `size` | few | Low | Medium |
| `q-spinner-dots` | 15 | 13 | `color`, `size` | few | Low | Low |
| `q-skeleton` | 6 | 3 | `type`, `animation` | few | Low | Low |

---

## Group 5 — Forms & Inputs

| Component | Instances | Files | Props Used | CSS Overrides | Complexity | Priority |
|-----------|-----------|-------|------------|---------------|------------|----------|
| `q-select` | ~200 | 114 | `dense`(131×), `borderless`(112×), `emit-value`(55×), `map-options`(39×), `use-input`(29×), `multiple`(14×), `stack-label`(54×), `filled`(27×), `outlined`(19×), `option-label`(26×), `option-value`(26×), `filter`(5×), scoped slots `#option` + `#selected-item` used in 55 files | **Heaviest**: 148 `.q-field__*` overrides | **Very High** | Highest complexity — Week 3 |
| `q-input` | 19 | 168 | `dense`(19×), `type`(10×), `placeholder`(7×), `disable`(6×), `borderless`(5×), `outlined`(2×), `clearable`, `debounce` | heavy `.q-field*` | **High** | High — 168 files |
| `q-form` | 43 | 47 | `@submit`, `greedy`, `@validation-error` | few | Medium | Medium |
| `q-checkbox` | 35 | 56 | `size`(most), `color`(5×), `dark`(2×), `disable`(1×) | few | Low-Medium | **Medium** |
| `q-radio` | 3 | 6 | `val`, `label`, `color` | few | Low | Low |
| `q-color` | 2 | 2 | `no-header`, `format-model` | few | High | Low — 2 files |
| `q-time` | 2 | 2 | complex | few | High | Low — 2 files |

---

## Group 6 — Tabs

| Component | Instances | Files | Props Used | CSS Overrides | Complexity | Priority |
|-----------|-----------|-------|------------|---------------|------------|----------|
| `q-tabs` | 8 | 41 | `dense`, `no-caps`, `inline-label`, `shrink`, `align` | `.q-tab*` (37 overrides) | Medium | **High — 41 files, compound** |
| `q-tab` | 32 | 95 | `name`, `label`, `icon` | | Low | Medium — depends on q-tabs |
| `q-tab-panels` | 10 | 17 | `animated`, `swipeable` | | Low | Low |
| `q-tab-panel` | 37 | 17 | `name` | | Low | Low |

> **Note:** `q-tab` appears in 95 files but most are combined with `q-tabs` + `q-tab-panels` + `q-tab-panel`. Migrating these 4 together as one "Tabs system" is cleaner than doing them separately.

---

## Group 7 — Data Display

| Component | Instances | Files | Props Used | CSS Overrides | Complexity | Priority |
|-----------|-----------|-------|------------|---------------|------------|----------|
| `q-icon` | 661 | 260 | `name`, `size`, `color`, `left`, `right` | **193 CSS overrides** | Medium — coupled to icon library | **🔴 Highest instance count** |
| `q-badge` | 27 | 28 | `color`(25×), `label`(17×), `outline`(4×), `rounded`(1×) | few | **Low** | **🟢 Good POC candidate** |
| `q-chip` | 9 | 22 | `outline`, `color`, `icon`, `removable`, `dense`, `label` | few | Low-Medium | Medium |
| `q-table` | 4 | 55 | full API | **Heaviest** | **Very High** | High risk — Week 3 |
| `q-td` / `q-tr` / `q-th` | 219 | 54/38/26 | standard | `.q-table` (96 overrides) | Medium | High — all tied to q-table |
| `q-markup-table` | 3 | 3 | | few | Low | Low |
| `q-avatar` | 4 | 7 | `size`, `color`, `text-color`, `font-size`, `icon` | few | Low | Low |
| `q-toolbar` | 3 | 3 | | few | Low | Low |

---

## Group 8 — Plugins, Directives & Utilities (Non-component)

| Feature | Calls / Uses | Files | API Surface Used | Complexity | Priority |
|---------|-------------|-------|------------------|------------|----------|
| `$q.notify` / `Notify.create` | **594** | ~150 | `type`, `message`, `color`, `icon`, `position`, `timeout`, `actions`, `group`, `spinner`, `progress`, `html`, `multiLine` | **High** — imperative, no component | **Critical — highest call count** |
| `$q.dark.isActive` | 18 | ~15 | boolean read | Low | Medium — replace with own theme store |
| `$q.dialog` | 7 | ~7 | programmatic dialog | High | Low — 7 files |
| `v-close-popup` | **264** | ~100 | directive to close parent overlay | Medium | **High — tied to q-menu/q-dialog migration** |
| `v-ripple` | 14 | ~10 | click ripple effect | Low | Low |
| `copyToClipboard` (Quasar util) | ~414 mentions | **62** | single async function | **Low** | Easy — replace with `navigator.clipboard.writeText()` |
| `quasar:date` utility | ~5 | ~5 | date formatting | Low | Low — replace with dayjs/date-fns |

---

## Hidden Coupling — CSS Overrides

This is the **most underestimated part** of the migration. Files override Quasar's internal class names directly, meaning just swapping the component tag is not enough — every `:deep(.q-*)` rule must also be updated.

Top CSS targets needing cleanup after component swap:

| Quasar CSS class | Override count | Belongs to |
|-----------------|---------------|------------|
| `.q-field__control` | 148 | q-input / q-select |
| `.q-icon` | 193 | q-icon |
| `.q-btn` | 135 | q-btn |
| `.q-table` | 96 | q-table |
| `.q-field__native` | 83 | q-input / q-select |
| `.q-field--dense` | 67 | q-input / q-select |
| `.q-item` | 60 | q-item |
| `.q-field` | 59 | q-input / q-select |
| `.q-menu` | 43 | q-menu |
| `.q-tab` | 37 | q-tabs / q-tab |
| `.q-table__top` | 34 | q-table |
| `.q-field__control-container` | 37 | q-input / q-select |
| `.q-field__marginal` | 31 | q-input / q-select |
| `.q-btn__content` | 31 | q-btn |
| `.q-field__append` | 28 | q-input / q-select |
| `.q-table__control` | 27 | q-table |
| `.q-field__input` | 26 | q-input / q-select |
| `.q-field__label` | 25 | q-input / q-select |
| `.q-select` | 22 | q-select |
| `.q-table__bottom` | 23 | q-table |

**Rule:** When a component is migrated, all `:deep(.q-field__*)` rules in those 168 files must be revised to target the new O2 component's class structure.

---

## POC Candidate Evaluation Matrix

| Component | Instances | Files | Replace Complexity | CSS Cleanup Needed | POC Value to Engineering | Verdict |
|-----------|-----------|-------|--------------------|--------------------|--------------------------|---------|
| `q-separator` | 255 | 134 | Low | Minimal | Low | ✅ Done — OSeparator built |
| `q-badge` | 27 | 28 | **Low** | Minimal | **Medium** | 🟢 Quick win |
| **`q-tooltip`** | **375** | **138** | **Medium** | **Minimal** | **High** | ✅ **Best POC pick** |
| `q-checkbox` | 35 | 56 | Medium | Minimal | Medium | Good Week 1 candidate |
| `q-spinner` (all variants) | ~115 | 86 | Low | Minimal | Medium | Quick win |
| `q-tabs` system | ~87 | 95 | Medium | Heavy (37) | High | Week 2 |
| `q-btn` | 133 | **299** | Medium | **Heavy (135)** | Very High | Week 1-2 — extend OButton |
| `q-input` | 19 | 168 | High | Very Heavy | Very High | Week 2 |
| `q-select` | ~200 | 114 | **Very High** | **Heaviest (148)** | Very High | Week 3 |
| `q-dialog` | 94 | 93 | Very High | Medium | Very High | Week 3 |
| `$q.notify` (plugin) | **594** | 150 | High (architectural) | N/A | Critical | Must plan separately |

---

## Why `q-tooltip` Is the Recommended POC

1. **375 usages in 138 files** — proves the approach scales
2. **Bounded API surface**: only 5 props ever used (`anchor`, `self`, `delay`, `max-width`, `offset`)
3. **Zero `v-close-popup` involvement** — clean migration, no directive dependency
4. **No CSS override debt** — virtually no `:deep(.q-tooltip*)` hacks in the codebase
5. **ARIA requirements** — `role="tooltip"`, keyboard show/hide, `aria-describedby` linkage — demonstrates production quality
6. **Floating positioning** — requires a real solution (CSS absolute/fixed + flip logic) which proves we can replace Quasar's positioning engine
7. **Used everywhere** — alerts, dashboards, forms, tables, navigation — touches every major feature area

---

## Proposed 3-Week Migration Roadmap

### Week 1 — High volume, low complexity (prove the tooling)
| Component | Files | Notes |
|-----------|-------|-------|
| `q-tooltip` → `OTooltip` | 138 | POC — full ARIA + positioning |
| `q-separator` → `OSeparator` | 134 | ✅ Done |
| `q-badge` → `OBadge` | 28 | |
| `q-spinner` variants → `OSpinner` | 86 | Consolidate 3 variants |
| `q-checkbox` → `OCheckbox` | 56 | |
| `copyToClipboard` → `navigator.clipboard` | 62 | Utility swap |

**Total files touched: ~504**

### Week 2 — Medium complexity, high impact
| Component | Files | Notes |
|-----------|-------|-------|
| `q-btn` extensions → extend `OButton` | 299 | flat/round/dense variants, icon-only |
| `q-tabs` + `q-tab` + `q-tab-panels` + `q-tab-panel` | 95 | Compound system, build together |
| `q-chip` → `OChip` | 22 | |
| `q-avatar` → `OAvatar` | 7 | |
| `q-input` → `OInput` | 168 | Biggest CSS cleanup debt |

**Total files touched: ~591**

### Week 3 — High complexity + architectural
| Component / Feature | Files | Notes |
|--------------------|-------|-------|
| `q-select` → `OSelect` | 114 | Hardest — virtual scroll, filter, slots |
| `q-dialog` → `OModal` | 93 | Focus trap, portal, `$q.dialog` replacement |
| `$q.notify` → `OToast` service | 150 | Imperative API, architectural change |
| `q-list` + `q-item` + `q-item-section` + `q-item-label` | 77 | Compound list system |
| `q-menu` + `v-close-popup` | 25 + 100 | Floating menu + directive replacement |
| `$q.dark` → own theme composable | 15 | |

**Total files touched: ~574**

---

## Key Risk Areas

| Risk | Severity | Mitigation |
|------|----------|-----------|
| `q-select` custom `#option` / `#selected-item` slots in 55 files | 🔴 High | Design scoped slot API carefully before building |
| CSS overrides on `.q-field__*` in 148 places | 🔴 High | O2 Input/Select must expose stable CSS custom properties |
| `v-close-popup` on 264 elements tied to `q-menu` and `q-dialog` | 🟠 Medium | Build an `OOverlayContext` composable or `v-o2-close` directive |
| `$q.notify` is imperative (called from `.ts` service files, not just templates) | 🟠 Medium | Need a singleton `notify()` function, not just a Vue component |
| `quasar:date` used in utility functions | 🟡 Low | Swap to `date-fns` or `dayjs` — already in package.json? |
| Quasar spacing classes (`q-pa-`, `q-ml-` etc.) in 389 files | 🟡 Low | These are cosmetic; Tailwind equivalents exist, migrate opportunistically |
