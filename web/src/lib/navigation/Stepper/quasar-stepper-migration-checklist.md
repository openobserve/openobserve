# Quasar Stepper Components — Migration Checklist

Tracks every file that uses a legacy Quasar stepper component and the O2 replacement to use.

## Replacement Map

| Quasar                   | O2 Replacement                                 | Import                                  |
| ------------------------ | ---------------------------------------------- | --------------------------------------- |
| `<q-stepper>`            | `<OStepper>`                                   | `@/lib/navigation/Stepper/OStepper.vue` |
| `<q-step>`               | `<OStep>`                                      | `@/lib/navigation/Stepper/OStep.vue`    |
| `<q-stepper-navigation>` | **Removed** — move buttons below `</OStepper>` | N/A                                     |

> **Rule:** There is no OForm-bound variant for steppers — `OStepper` and `OStep` are always standalone.  
> `<q-stepper-navigation>` has no O2 equivalent. Extract navigation buttons into a single `<div class="tw:flex tw:gap-2">` block placed **after** the closing `</OStepper>` tag.

---

## Key Prop Changes

### q-stepper → OStepper

| q-stepper prop                      | OStepper prop            | Notes                                      |
| ----------------------------------- | ------------------------ | ------------------------------------------ |
| `v-model`                           | `v-model`                | unchanged                                  |
| `vertical`                          | `orientation="vertical"` | renamed — default is `"horizontal"`        |
| `animated`                          | `animated`               | unchanged — defaults to `true` in OStepper |
| `flat`                              | —                        | **Drop** — O2 uses one borderless style    |
| `header-nav`                        | `navigable`              | renamed                                    |
| `color`                             | —                        | **Drop** — design tokens                   |
| `contracted` / `alternative-labels` | —                        | **Drop** — not needed                      |
| `dark`                              | —                        | **Drop** — handled by root `data-theme`    |
| `ref`                               | `ref`                    | unchanged                                  |
| `class`                             | `class`                  | unchanged                                  |

### q-step → OStep

| q-step prop                                | OStep prop                | Notes                                       |
| ------------------------------------------ | ------------------------- | ------------------------------------------- |
| `:name`                                    | `:name`                   | unchanged                                   |
| `:title` / `title`                         | `:title`                  | unchanged                                   |
| `icon="material-name"`                     | `:icon="LucideComponent"` | Material string → Lucide component ref      |
| `:done`                                    | `:done`                   | unchanged                                   |
| `data-test`                                | `data-test`               | unchanged                                   |
| `:header-nav`                              | `:navigable`              | renamed                                     |
| `caption`                                  | `description`             | renamed                                     |
| `error`                                    | `error`                   | unchanged                                   |
| `active-icon` / `done-icon` / `error-icon` | —                         | **Drop** — baked into design                |
| `v-if`                                     | `v-if`                    | unchanged — conditional steps work the same |
| `class`                                    | `class`                   | unchanged                                   |

### Icon Migration (Material → Lucide)

| Material icon string                | Lucide import                            | Notes |
| ----------------------------------- | ---------------------------------------- | ----- |
| `outlinedDashboard` (already a ref) | `LayoutDashboard` from `lucide-vue-next` |       |
| `"schedule"`                        | `Clock` from `lucide-vue-next`           |       |
| `"lock"`                            | `Lock` from `lucide-vue-next`            |       |
| `"cloud"`                           | `Cloud` from `lucide-vue-next`           |       |
| `"settings_ethernet"`               | `Network` from `lucide-vue-next`         |       |
| `"category"`                        | `Layers` from `lucide-vue-next`          |       |
| `"mail"`                            | `Mail` from `lucide-vue-next`            |       |
| `"addition"`                        | `Plus` from `lucide-vue-next`            |       |

---

## Files to Migrate

Legend: `[ ]` = not done · `[x]` = done

---

### Tier 1 — Horizontal steppers (navigation already outside `<q-stepper>`)

These two files already place their navigation buttons outside the stepper — prop changes only.

- [ ] `src/components/pipeline/NodeForm/CreateDestinationForm.vue`
  - Drop: `flat`, `color`, `:deep(.q-stepper__*)` CSS block, `.modern-stepper` CSS overrides
  - Rename: `ref="stepper"` stays, no `header-nav` used in this file
  - Icons: `"category"` → `Layers`, `"settings_ethernet"` → `Network`

- [ ] `src/components/settings/OrgStorageEditor.vue`
  - Drop: `flat`, `color`, `:deep(.q-stepper__*)` CSS block, `.modern-stepper` CSS overrides
  - Rename: `:header-nav="step > 1 && !isEditMode"` → `:navigable="step > 1 && !isEditMode"`
  - Icons: `"cloud"` → `Cloud`, `"settings_ethernet"` → `Network`

---

### Tier 2 — Vertical steppers (must consolidate `q-stepper-navigation` out of each step)

Each step's `<q-stepper-navigation>` block must be removed. A **single** nav row is added below `</OStepper>`.

- [ ] `src/components/cipherkeys/AddCipherKey.vue`
  - Drop: `vertical` → `orientation="vertical"`, `color`, `header-nav` → `navigable`
  - Remove: 2× `<q-stepper-navigation>` blocks (step 1 Continue, step 2 Back)
  - Add: single nav block after `</OStepper>` with `v-if` on Back and Continue
  - Icons: `"addition"` → `Plus` (×2 steps)

- [ ] `src/components/reports/CreateReport.vue`
  - Drop: `vertical` → `orientation="vertical"`, `color`, `header-nav` → `navigable`
  - Remove: 3× `<q-stepper-navigation>` blocks
  - Add: single nav block after `</OStepper>` — note step 3 is conditional on `!isCachedReport`
  - Icons: `outlinedDashboard` → `LayoutDashboard`, `"schedule"` → `Clock`, `"mail"` → `Mail`

- [ ] `src/components/actionScripts/EditScript.vue`
  - Drop: `vertical` → `orientation="vertical"`, `color`, `header-nav` → `navigable`
  - Remove: 4× `<q-stepper-navigation>` blocks
  - Add: single nav block after `</OStepper>` — note step 2 is conditional on `formData.type === 'scheduled'`
  - Icons: `outlinedDashboard` → `LayoutDashboard`, `"schedule"` → `Clock`, `"lock"` → `Lock`
  - Navigation logic: step 3 Back goes to `step = formData.type === 'scheduled' ? 2 : 1` — preserve this

---

### Tier 3 — CSS-only cleanup (no template changes)

These files have `:deep(.q-stepper__*)` overrides but no `<q-stepper>` in their templates. Remove scoped CSS blocks after Tier 2 is complete.

- [ ] `src/components/alerts/AddAlert.vue`
  - No template changes needed
  - Remove: entire `.alert-wizard-stepper` CSS block (lines ~980–1060) which contains all `.q-stepper__*` overrides

---

## Navigation Consolidation Reference

When extracting `<q-stepper-navigation>` into a single block, use this template and adapt per file:

```vue
<!-- Single navigation row placed after </OStepper> -->
<div class="tw:flex tw:gap-2 tw:mt-4">
  <OButton
    v-if="step > 1"
    variant="outline"
    size="sm-action"
    @click="step--"
  >Back</OButton>

  <OButton
    v-if="!isLastStep"
    variant="primary"
    size="sm-action"
    @click="step++"
  >Continue</OButton>
</div>
```

> For files where the Back step index is conditional (e.g., `EditScript.vue` step 3), keep the conditional:  
> `@click="step = formData.type === 'scheduled' ? 2 : 1"`

---

## Summary

| File                                                         | Stepper Type | Steps | Nav inside step? | CSS overrides?          | Priority |
| ------------------------------------------------------------ | ------------ | ----- | ---------------- | ----------------------- | -------- |
| `src/components/pipeline/NodeForm/CreateDestinationForm.vue` | Horizontal   | 2     | No               | Yes (`.modern-stepper`) | Tier 1   |
| `src/components/settings/OrgStorageEditor.vue`               | Horizontal   | 2     | No               | Yes (`.modern-stepper`) | Tier 1   |
| `src/components/cipherkeys/AddCipherKey.vue`                 | Vertical     | 2     | Yes (×2)         | No                      | Tier 2   |
| `src/components/reports/CreateReport.vue`                    | Vertical     | 3     | Yes (×3)         | No                      | Tier 2   |
| `src/components/actionScripts/EditScript.vue`                | Vertical     | 4     | Yes (×4)         | No                      | Tier 2   |
| `src/components/alerts/AddAlert.vue`                         | CSS only     | —     | —                | Yes                     | Tier 3   |
