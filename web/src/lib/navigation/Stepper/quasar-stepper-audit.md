# Quasar Stepper Components ΓÇö Props & Emits Audit

> Scanned all Vue files under `web/src/`.  
> Covers: `q-stepper`, `q-step`, `q-stepper-navigation`.  
> Counts represent occurrences across the codebase.

---

## Table of Contents

- [q-stepper](#q-stepper)
- [q-step](#q-step)
- [q-stepper-navigation](#q-stepper-navigation)
- [CSS-Only References (no template migration)](#css-only-references-no-template-migration)
- [Files Summary](#files-summary)

---

## q-stepper

### Template Props

| Prop              | Count | Files                                                    | Notes                                                           |
| ----------------- | ----- | -------------------------------------------------------- | --------------------------------------------------------------- |
| `v-model`         | 5     | All 5 files                                              | Two-way binding for current step number (`ref<number>`)         |
| `animated`        | 5     | All 5 files                                              | Enables animated transitions between steps                      |
| `color="primary"` | 4     | EditScript, AddCipherKey, OrgStorageEditor, CreateReport | Step indicator / progress color token                           |
| `vertical`        | 3     | EditScript, AddCipherKey, CreateReport                   | Vertical layout ΓÇö steps stacked top-to-bottom                   |
| `flat`            | 2     | OrgStorageEditor, CreateDestinationForm                  | Removes box-shadow and outer border                             |
| `header-nav`      | 3     | EditScript, AddCipherKey, CreateReport                   | Clicking a completed header tab jumps to that step              |
| `ref`             | 2     | OrgStorageEditor, CreateDestinationForm                  | Template ref for programmatic access (`.next()`, `.previous()`) |
| `class`           | 5     | All 5 files                                              | Tailwind / legacy Quasar utility classes                        |

### Events

No custom events are used directly on `<q-stepper>`. All navigation is done by mutating the `step` ref imperatively via `@click` handlers on `OButton` elements:

```vue
@click="step = 2" @click="step = formData.type === 'scheduled' ? 2 : 1"
```

### Ref Methods (used when `ref="stepper"` is present)

| Method        | Files                                                         | Notes                |
| ------------- | ------------------------------------------------------------- | -------------------- |
| `.next()`     | OrgStorageEditor (inferred), CreateDestinationForm (inferred) | Advance to next step |
| `.previous()` | OrgStorageEditor (inferred), CreateDestinationForm (inferred) | Go back one step     |

> These files declare `ref="stepper"` but their navigation buttons call `step++` / `step--` style logic. The ref is available if needed for programmatic validation-gated advancement.

---

## q-step

### Props

| Prop               | Count | Notes                                                                                            |
| ------------------ | ----- | ------------------------------------------------------------------------------------------------ |
| `:name`            | 9     | Required ΓÇö numeric step index (1, 2, 3, 4)                                                       |
| `:title` / `title` | 9     | Step header label ΓÇö static string or dynamic `:title` expression                                 |
| `icon`             | 9     | Material icon name displayed in the step indicator dot                                           |
| `:done`            | 9     | Boolean ΓÇö `step > N` pattern marks step as completed (shows checkmark)                           |
| `data-test`        | 7     | Static test attribute for E2E selectors                                                          |
| `:data-test`       | 0     | Not used ΓÇö only static `data-test`                                                               |
| `:header-nav`      | 2     | On individual step ΓÇö conditionally allows/disallows clicking that step header                    |
| `v-if`             | 2     | Conditional step ΓÇö shown only when certain state is true (e.g., `formData.type === 'scheduled'`) |
| `class`            | 4     | Extra utility classes (e.g., `q-mt-md`) applied to step wrapper                                  |

### Icon Values Used in Codebase

| Icon name (Material)                    | Used in                                               |
| --------------------------------------- | ----------------------------------------------------- |
| `outlinedDashboard` (imported icon ref) | EditScript step 1 & 3                                 |
| `"schedule"`                            | EditScript step 2, CreateReport step 2                |
| `"lock"`                                | EditScript step 4                                     |
| `"addition"`                            | AddCipherKey steps 1 & 2                              |
| `"cloud"`                               | OrgStorageEditor step 1                               |
| `"settings_ethernet"`                   | OrgStorageEditor step 2, CreateDestinationForm step 2 |
| `"category"`                            | CreateDestinationForm step 1                          |
| `outlinedDashboard`                     | CreateReport step 1                                   |
| `"mail"`                                | CreateReport step 3                                   |

---

## q-stepper-navigation

### Usage

`<q-stepper-navigation>` is a thin layout wrapper placed at the bottom of a `<q-step>`'s default slot. It provides no props or events of its own ΓÇö its only purpose is to group the Back / Continue / Save buttons for a given step.

| Attribute           | Count | Notes                                         |
| ------------------- | ----- | --------------------------------------------- |
| `class="q-pa-none"` | 1     | AddCipherKey step 2 ΓÇö removes default padding |
| (no attributes)     | 8     | Plain wrapper with no attributes              |

Total instances: **9** across 3 files (EditScript ├ù4, AddCipherKey ├ù2, CreateReport ├ù3).

> **OrgStorageEditor** and **CreateDestinationForm** do **not** use `<q-stepper-navigation>` ΓÇö their navigation buttons are placed **outside** the `<q-stepper>` block entirely (below the closing `</q-stepper>` tag). This is the preferred pattern for O2 migration.

---

## CSS-Only References (no template migration)

The following files contain `:deep(.q-stepper__*)` style overrides but do **not** render `<q-stepper>` or `<q-step>` in their own template. These CSS blocks must be removed / replaced once the relevant child component is migrated.

| File                                                         | CSS Classes Targeted                                                                                                                                                                                           | Context                                                                                                                                                            |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/components/alerts/AddAlert.vue`                         | `.q-stepper__step-inner`, `.q-stepper__tab`, `.q-stepper__tab--active`, `.q-stepper__tab--done`, `.q-stepper__dot`, `.q-stepper__header`, `.q-stepper__caption`, `.q-stepper__title`, `.q-stepper--horizontal` | Scoped under `.alert-wizard-stepper`. These override styles of a `<q-stepper>` rendered inside a child component. CSS cleanup required post-migration of children. |
| `src/components/pipeline/NodeForm/CreateDestinationForm.vue` | `.q-stepper__header`, `.q-stepper__tab`, `.q-stepper__tab--active`, `.q-stepper__tab--done`, `.q-stepper__dot`, `.q-stepper__step-inner`                                                                       | Scoped under `.modern-stepper` ΓÇö overrides applied to its own `<q-stepper flat class="modern-stepper">`. These will be replaced by Tailwind/O2 design tokens.      |
| `src/components/settings/OrgStorageEditor.vue`               | `.q-stepper`, `.q-stepper__header`, `.q-stepper__tab`, `.q-stepper__tab--active`, `.q-stepper__tab--done`, `.q-stepper__dot`, `.q-stepper__step-inner`                                                         | Same `.modern-stepper` override pattern as CreateDestinationForm.                                                                                                  |

---

## Files Summary

### Files with `<q-stepper>` / `<q-step>` template usage

| File                                                         | Layout            | Steps                                       | Uses `q-stepper-navigation` | Notes                                                                  |
| ------------------------------------------------------------ | ----------------- | ------------------------------------------- | --------------------------- | ---------------------------------------------------------------------- |
| `src/components/actionScripts/EditScript.vue`                | vertical          | 4 (step 2 conditional on `formData.type`)   | Yes (├ù4)                    | `header-nav` enabled, 4-step wizard                                    |
| `src/components/cipherkeys/AddCipherKey.vue`                 | vertical          | 2                                           | Yes (├ù2)                    | `header-nav` enabled, 2-step wizard                                    |
| `src/components/settings/OrgStorageEditor.vue`               | horizontal (flat) | 2                                           | No                          | nav buttons outside stepper, `ref="stepper"`, `header-nav` conditional |
| `src/components/pipeline/NodeForm/CreateDestinationForm.vue` | horizontal (flat) | 2                                           | No                          | nav buttons outside stepper, `ref="stepper"`                           |
| `src/components/reports/CreateReport.vue`                    | vertical          | 3 (step 3 conditional on `!isCachedReport`) | Yes (├ù3)                    | `header-nav` enabled, 3-step wizard                                    |

### Files with CSS-only `q-stepper__*` references

| File                                 | Template migration needed? | Action                                                     |
| ------------------------------------ | -------------------------- | ---------------------------------------------------------- |
| `src/components/alerts/AddAlert.vue` | No                         | Remove scoped CSS overrides post child-component migration |
