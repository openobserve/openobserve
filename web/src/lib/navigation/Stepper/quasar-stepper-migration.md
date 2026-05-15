# Quasar Stepper Components ΓåÆ O2 Migration Guide

> Covers: `q-stepper`, `q-step`, `q-stepper-navigation`  
> Source data from: `web/quasar-stepper-audit.md` (5 Vue files using stepper components)

---

## Status Overview

| Quasar Component       | O2 Replacement                                | Reka UI Primitive | Usages           | O2 Status            |
| ---------------------- | --------------------------------------------- | ----------------- | ---------------- | -------------------- |
| `q-stepper`            | `OStepper`                                    | `StepperRoot`     | 5 files          | ΓÅ│ Pending build     |
| `q-step`               | `OStep`                                       | `StepperItem`     | 9 step instances | ΓÅ│ Pending build     |
| `q-stepper-navigation` | **Removed** ΓÇö buttons go outside `<OStepper>` | ΓÇö                 | 9 instances      | N/A ΓÇö pattern change |

> All O2 stepper components will live in `web/src/lib/navigation/Stepper/`.

---

## Architecture Decision ΓÇö Navigation Placement

The biggest structural change in the O2 migration is **where navigation buttons live**.

Quasar places navigation inside `<q-stepper-navigation>` which is a slot inside each `<q-step>`. The O2 pattern (already adopted by `OrgStorageEditor` and `CreateDestinationForm`) places navigation **outside and below** the `<OStepper>` block entirely.

```
ΓöîΓöÇ BEFORE (Quasar)                 ΓöîΓöÇ AFTER (O2)
Γöé  <q-stepper v-model="step">      Γöé  <OStepper v-model="step">
Γöé    <q-step :name="1">            Γöé    <OStep :name="1">
Γöé      <!-- content -->            Γöé      <!-- content -->
Γöé      <q-stepper-navigation>      Γöé    </OStep>
Γöé        <OButton @click="step=2"> Γöé    <OStep :name="2">
Γöé      </q-stepper-navigation>     Γöé      <!-- content -->
Γöé    </q-step>                     Γöé    </OStep>
Γöé    <q-step :name="2"> ... </q-step> Γöé  </OStepper>
Γöé  </q-stepper>                    Γöé
Γöé                                  Γöé  <!-- navigation BELOW stepper -->
Γöé                                  Γöé  <div class="tw:flex tw:gap-2 ...">
Γöé                                  Γöé    <OButton v-if="step > 1" @click="step--">Back</OButton>
Γöé                                  Γöé    <OButton v-if="!isLastStep" @click="step++">Continue</OButton>
Γöé                                  Γöé    <OButton v-if="isLastStep" @click="save">Save</OButton>
Γöé                                  Γöé  </div>
```

This approach:

- Keeps step content focused on data entry only
- Makes navigation button logic visible at the file's top level
- Avoids re-declaring navigation inside every single step
- Aligns with the pattern already used in the two horizontal-layout files

---

## Component-by-Component Guide

---

### 1. `q-stepper` ΓåÆ `OStepper`

**Family**: `OStepper` + `OStep` (compound ΓÇö build together)  
**Location**: `web/src/lib/navigation/Stepper/`  
**Headless base**: `StepperRoot` from `reka-ui`

```ts
import {
  StepperRoot,
  StepperItem,
  StepperTrigger,
  StepperIndicator,
  StepperTitle,
  StepperDescription,
  StepperSeparator,
} from "reka-ui"
```

**Why Reka UI**: `StepperRoot` provides WAI-ARIA `role="group"` with step state management, keyboard navigation between steps, and correct `aria-current="step"` on the active step out of the box.

#### Prop Mapping

| Quasar prop        | O2 prop                  | Action                                                |
| ------------------ | ------------------------ | ----------------------------------------------------- |
| `v-model` (number) | `v-model` (number)       | Direct ΓÇö current step index                           |
| `vertical`         | `orientation="vertical"` | Rename ΓÇö `"horizontal"` is default                    |
| `animated`         | `animated`               | Direct ΓÇö `true` by default in O2                      |
| `flat`             | ΓÇö                        | **Drop** ΓÇö O2 has one clean style (no raised variant) |
| `header-nav`       | `navigable`              | Rename ΓÇö allows clicking completed step headers       |
| `color`            | ΓÇö                        | **Drop** ΓÇö design tokens control indicator color      |
| `ref`              | `ref`                    | Direct ΓÇö same template ref pattern                    |
| `class`            | `class`                  | Direct pass-through                                   |

#### Removed Props (with reason)

| Quasar prop                                | Reason for removal                                                 |
| ------------------------------------------ | ------------------------------------------------------------------ |
| `flat`                                     | O2 uses a borderless design by default ΓÇö no raised / flat variants |
| `color`                                    | Design tokens (`--o2-color-primary`) control the indicator color   |
| `keep-color`                               | Design tokens always active                                        |
| `contracted`                               | Not needed ΓÇö O2 uses a clean compact header design                 |
| `active-icon` / `done-icon` / `error-icon` | Replaced by design-token-driven icon slots on `OStep`              |
| `alternative-labels`                       | O2 always renders title below indicator (consistent layout)        |
| `dark`                                     | Handled by `data-theme` on the root HTML element                   |

---

### 2. `q-step` ΓåÆ `OStep`

#### Prop Mapping

| Quasar prop        | O2 prop                    | Action                                                |
| ------------------ | -------------------------- | ----------------------------------------------------- |
| `:name`            | `:name`                    | Direct ΓÇö step index number                            |
| `:title` / `title` | `:title`                   | Direct                                                |
| `icon`             | `:icon` (Lucide component) | **See Icon Migration below**                          |
| `:done`            | `:done`                    | Direct ΓÇö pass `step > N` expression                   |
| `data-test`        | `data-test`                | Direct pass-through                                   |
| `:header-nav`      | `:navigable`               | Rename ΓÇö per-step override of root `navigable`        |
| `v-if`             | `v-if`                     | Direct ΓÇö conditional steps work the same way          |
| `caption`          | `description`              | Rename ΓÇö subtitle below the step title in header      |
| `class`            | `class`                    | Direct pass-through                                   |
| `error`            | `error`                    | Direct ΓÇö shows error state in header indicator        |
| `error-icon`       | ΓÇö                          | **Drop** ΓÇö error icon is baked into the design        |
| `active-icon`      | ΓÇö                          | **Drop** ΓÇö active state icon is baked into the design |
| `done-icon`        | ΓÇö                          | **Drop** ΓÇö done state icon (checkmark) is baked in    |

#### Icon Migration

Quasar uses Material icon name strings (`icon="schedule"`). O2 uses Lucide icon components. Migration approach:

| Material icon string           | Lucide equivalent | Import            |
| ------------------------------ | ----------------- | ----------------- |
| `outlinedDashboard`            | `LayoutDashboard` | `lucide-vue-next` |
| `"schedule"` / `"access_time"` | `Clock`           | `lucide-vue-next` |
| `"lock"`                       | `Lock`            | `lucide-vue-next` |
| `"cloud"`                      | `Cloud`           | `lucide-vue-next` |
| `"settings_ethernet"`          | `Network`         | `lucide-vue-next` |
| `"category"`                   | `Layers`          | `lucide-vue-next` |
| `"mail"`                       | `Mail`            | `lucide-vue-next` |
| `"addition"` / `"add"`         | `Plus`            | `lucide-vue-next` |

Pass the Lucide component to `OStep` via the `:icon` prop:

```vue
<!-- BEFORE -->
<q-step :name="2" title="Schedule" icon="schedule" :done="step > 2">

<!-- AFTER -->
<OStep :name="2" title="Schedule" :icon="Clock" :done="step > 2">
```

---

### 3. `q-stepper-navigation` ΓåÆ **Remove** (no O2 equivalent)

`<q-stepper-navigation>` has no O2 equivalent. Navigation buttons move outside the `<OStepper>` block.

**Pattern for files currently using `q-stepper-navigation`** (EditScript, AddCipherKey, CreateReport):

```vue
<!-- BEFORE ΓÇö buttons inside each q-step via q-stepper-navigation -->
<q-step :name="1" ...>
  <!-- step content -->
  <q-stepper-navigation>
    <OButton @click="step = 2">Continue</OButton>
  </q-stepper-navigation>
</q-step>

<q-step :name="2" ...>
  <!-- step content -->
  <q-stepper-navigation>
    <OButton @click="step = 1">Back</OButton>
    <OButton @click="step = 3">Continue</OButton>
  </q-stepper-navigation>
</q-step>

<!-- AFTER ΓÇö single navigation block below OStepper -->
<OStepper v-model="step" orientation="vertical" navigable>
  <OStep :name="1" ...><!-- content only --></OStep>
  <OStep :name="2" ...><!-- content only --></OStep>
</OStepper>

<div class="tw:flex tw:gap-2 tw:mt-4">
  <OButton v-if="step > 1" variant="outline" size="sm" @click="step--">Back</OButton>
  <OButton v-if="step < totalSteps" variant="primary" size="sm" @click="step++">Continue</OButton>
</div>
```

> **Exception**: If per-step navigation buttons differ significantly in label or variant (e.g., last step shows "Save" instead of "Continue"), use a `computed` or conditional rendering on the single navigation block rather than duplicating nav inside each step.

---

## Prop Mapping Quick Reference

### `q-stepper` ΓåÆ `OStepper`

| q-stepper    | OStepper                 | Notes                               |
| ------------ | ------------------------ | ----------------------------------- |
| `v-model`    | `v-model`                | unchanged                           |
| `vertical`   | `orientation="vertical"` | renamed ΓÇö default is `"horizontal"` |
| `animated`   | `animated`               | unchanged ΓÇö default `true`          |
| `flat`       | ΓÇö                        | drop                                |
| `header-nav` | `navigable`              | renamed                             |
| `color`      | ΓÇö                        | drop ΓÇö design tokens                |
| `ref`        | `ref`                    | unchanged                           |

### `q-step` ΓåÆ `OStep`

| q-step                                     | OStep                     | Notes                       |
| ------------------------------------------ | ------------------------- | --------------------------- |
| `:name`                                    | `:name`                   | unchanged                   |
| `:title` / `title`                         | `:title`                  | unchanged                   |
| `icon="material-name"`                     | `:icon="LucideComponent"` | icon ΓåÆ Lucide component ref |
| `:done`                                    | `:done`                   | unchanged                   |
| `data-test`                                | `data-test`               | unchanged                   |
| `:header-nav`                              | `:navigable`              | renamed                     |
| `caption`                                  | `description`             | renamed                     |
| `error`                                    | `error`                   | unchanged                   |
| `active-icon` / `done-icon` / `error-icon` | ΓÇö                         | drop ΓÇö baked into design    |
| `v-if`                                     | `v-if`                    | unchanged                   |

### `q-stepper-navigation` ΓåÆ (removed)

| Old pattern                                             | New pattern                                                                  |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `<q-stepper-navigation>` wrapper inside each `<q-step>` | Single `<div class="tw:flex tw:gap-2">` block placed **after** `</OStepper>` |

---

## Code Examples

### Horizontal stepper (replaces `flat` + external navigation)

> Already used by OrgStorageEditor and CreateDestinationForm ΓÇö minimal changes needed.

```vue
<!-- BEFORE -->
<q-stepper
  v-model="step"
  ref="stepper"
  color="primary"
  animated
  flat
  class="modern-stepper"
>
  <q-step :name="1" title="Choose Type" icon="cloud" :done="step > 1" :header-nav="step > 1 && !isEditMode">
    <!-- content -->
  </q-step>
  <q-step :name="2" title="Connection" icon="settings_ethernet" :done="step > 2" :header-nav="step > 2">
    <!-- content -->
  </q-step>
</q-stepper>

<!-- Form buttons (already outside stepper) -->
<div class="tw:flex tw:gap-2">
  <OButton v-if="step === 1" @click="nextStep">Continue</OButton>
  <OButton v-if="step === 2" @click="step--">Back</OButton>
  <OButton v-if="step === 2" @click="save">Save</OButton>
</div>

<!-- AFTER -->
<OStepper v-model="step" ref="stepper" animated>
  <OStep :name="1" title="Choose Type" :icon="Cloud" :done="step > 1" :navigable="step > 1 && !isEditMode">
    <!-- content -->
  </OStep>
  <OStep :name="2" title="Connection" :icon="Network" :done="step > 2" :navigable="step > 2">
    <!-- content -->
  </OStep>
</OStepper>

<!-- Form buttons ΓÇö unchanged, already in correct position -->
<div class="tw:flex tw:gap-2">
  <OButton v-if="step === 1" @click="nextStep">Continue</OButton>
  <OButton v-if="step === 2" @click="step--">Back</OButton>
  <OButton v-if="step === 2" @click="save">Save</OButton>
</div>
```

---

### Vertical stepper with consolidated navigation (replaces `q-stepper-navigation` inside each step)

```vue
<!-- BEFORE (CreateReport pattern ΓÇö 3 steps, each with q-stepper-navigation) -->
<q-stepper
  v-model="step"
  vertical
  color="primary"
  animated
  class="q-mt-md"
  header-nav
>
  <q-step data-test="add-report-select-dashboard-step" :name="1" title="Select Dashboard"
    :icon="outlinedDashboard" :done="step > 1">
    <!-- dashboard selection content -->
    <q-stepper-navigation>
      <OButton data-test="add-report-step1-continue-btn" variant="primary" size="sm-action"
        @click="step = 2">Continue</OButton>
    </q-stepper-navigation>
  </q-step>

  <q-step data-test="add-report-select-schedule-step" :name="2" title="Schedule"
    icon="schedule" :done="step > 2" class="q-mt-md">
    <!-- schedule content -->
    <q-stepper-navigation>
      <OButton data-test="add-report-step2-back-btn" variant="outline" size="sm-action"
        @click="step = 1">Back</OButton>
      <OButton v-if="!isCachedReport" data-test="add-report-step2-continue-btn"
        variant="primary" size="sm-action" @click="step = 3">Continue</OButton>
    </q-stepper-navigation>
  </q-step>

  <q-step v-if="!isCachedReport" data-test="add-report-share-step" :name="3" title="Share"
    icon="mail" :done="step > 3" class="q-mt-md">
    <!-- share content -->
    <q-stepper-navigation>
      <OButton data-test="add-report-step3-back-btn" variant="outline" size="sm-action"
        @click="step = 2">Back</OButton>
    </q-stepper-navigation>
  </q-step>
</q-stepper>

<!-- AFTER -->
<OStepper v-model="step" orientation="vertical" animated navigable>
  <OStep data-test="add-report-select-dashboard-step" :name="1" title="Select Dashboard"
    :icon="LayoutDashboard" :done="step > 1">
    <!-- dashboard selection content only ΓÇö no navigation here -->
  </OStep>

  <OStep data-test="add-report-select-schedule-step" :name="2" title="Schedule"
    :icon="Clock" :done="step > 2">
    <!-- schedule content only -->
  </OStep>

  <OStep v-if="!isCachedReport" data-test="add-report-share-step" :name="3" title="Share"
    :icon="Mail" :done="step > 3">
    <!-- share content only -->
  </OStep>
</OStepper>

<!-- Consolidated navigation below the stepper -->
<div class="tw:flex tw:gap-2 tw:mt-4">
  <OButton v-if="step > 1" data-test="add-report-back-btn"
    variant="outline" size="sm-action" @click="step--">Back</OButton>
  <OButton v-if="step < (isCachedReport ? 2 : 3)"
    data-test="add-report-continue-btn" variant="primary" size="sm-action"
    @click="step++">Continue</OButton>
</div>
```

**Import**:

```ts
import OStepper from "@/lib/navigation/Stepper/OStepper.vue"
import OStep from "@/lib/navigation/Stepper/OStep.vue"
import {
  Clock,
  Mail,
  LayoutDashboard,
  Network,
  Cloud,
  Lock,
  Layers,
  Plus,
} from "lucide-vue-next"
```

---

## CSS Cleanup

### Remove Quasar class overrides

After migrating a file, remove all `:deep(.q-stepper__*)` and `.q-stepper*` style blocks. These were workarounds for Quasar's internal class structure.

O2 stepper styles are controlled entirely via design tokens and Tailwind classes. The only CSS you may need in a consuming file is layout utilities (e.g., `max-width`, `margin`).

**Classes to remove from all migrated files:**

```scss
// Delete these entire blocks:
:deep(.q-stepper__header) { ... }
:deep(.q-stepper__tab) { ... }
:deep(.q-stepper__tab--active) { ... }
:deep(.q-stepper__tab--done) { ... }
:deep(.q-stepper__dot) { ... }
:deep(.q-stepper__step-inner) { ... }
:deep(.q-stepper__title) { ... }
:deep(.q-stepper__caption) { ... }
.q-stepper--horizontal .q-stepper__step-inner { ... }
.q-stepper { ... }
.modern-stepper .q-stepper__tab { ... }
```

### AddAlert.vue special case

`AddAlert.vue` uses CSS overrides for a q-stepper rendered by a **child component** (the scoped `.alert-wizard-stepper` block). These overrides should be removed from `AddAlert.vue` when the child components that render the q-stepper are migrated. No template change is needed in `AddAlert.vue` itself.

---

## Migration Order (Recommended)

```
Tier 1 ΓÇö Horizontal steppers (smallest blast radius, navigation already outside)
1. CreateDestinationForm.vue   (2 steps, no q-stepper-navigation, flat layout)
2. OrgStorageEditor.vue        (2 steps, no q-stepper-navigation, flat layout)

Tier 2 ΓÇö Vertical steppers (requires consolidating q-stepper-navigation)
3. AddCipherKey.vue            (2 steps ΓÇö simplest vertical case)
4. CreateReport.vue            (3 steps ΓÇö has conditional step 3)
5. EditScript.vue              (4 steps ΓÇö most complex, conditional step 2)

Tier 3 ΓÇö CSS cleanup
6. AddAlert.vue                (CSS-only, remove after Tier 2 child components done)
```
