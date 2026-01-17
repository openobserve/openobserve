# Data-Test Attributes Implementation Status

## ✅ Completed - Already in Components

### Variable Settings (VariableSettings.vue)
- ✅ `dashboard-add-variable-btn` - Add Variable button
- ✅ `dashboard-variable-dependencies-btn` - Show Dependencies button

### Add/Edit Variable (AddSettingVariable.vue)
- ✅ `dashboard-variable-name` - Variable name input
- ✅ `dashboard-variable-label` - Variable label input
- ✅ `dashboard-variable-type-select` - Variable type selector
- ✅ `dashboard-variable-stream-type-select` - Stream type selector
- ✅ `dashboard-variable-stream-select` - Stream name selector
- ✅ `dashboard-variable-field-select` - Field selector
- ✅ `dashboard-variable-scope-select` - Scope selector (Global/Selected Tabs/Selected Panels)
- ✅ `dashboard-variable-save-btn` - Save button
- ✅ `dashboard-query-values-filter-name-selector` - Filter field name
- ✅ `dashboard-query-values-filter-operator-selector` - Filter operator

### Just Added (2026-01-01)
- ✅ `dashboard-variable-assign-tabs-${tabId}` - Tab assignment checkboxes
- ✅ `dashboard-variable-assign-panels-${panelId}` - Panel assignment checkboxes

---

## ⚠️ Missing - Need to Be Added

### 1. Variable Dependencies Section
**Status:** ❌ Not implemented in UI yet

The tests expect these attributes:
- `dashboard-variable-add-dependency-btn` - Button to add a dependency
- `dashboard-variable-dependency-select` - Dropdown to select which variable this depends on

**Where to add:** In `AddSettingVariable.vue`, need to add a section that allows users to:
1. Click "Add Dependency" button
2. Select from available variables (filtered by scope rules)
3. Show circular dependency errors

**Scope Rules for Dependencies:**
- **Tab variables** can only depend on **Global variables**
- **Panel variables** can depend on **Global + Current Tab variables**
- **No circular dependencies** allowed

### 2. Variable Display on Dashboard
**Status:** ❌ Need to add to ViewDashboard.vue

The tests expect:
- `dashboard-variable-${variableName}` - Variable container
- `dashboard-variable-${variableName}-loading` - Loading indicator
- `dashboard-variable-${variableName}-error` - Error indicator
- `dashboard-variable-${variableName}-state` - State attribute (data-state="loading|loaded|error|partial")

**Where to add:** In the component that renders variables on the dashboard (likely VariablesValueSelector.vue or ViewDashboard.vue)

### 3. Refresh Buttons & Indicators
**Status:** ❌ Need to add to ViewDashboard.vue

The tests expect:
- `dashboard-global-refresh-btn` with `data-needs-refresh` attribute
- `dashboard-panel-${panelId}-refresh-btn` with `data-needs-refresh` attribute
- `dashboard-panel-${panelId}-refresh-warning` - Warning icon when panel needs refresh

**Logic needed:**
- Track when variable values change (live vs committed)
- Show indicator on refresh button when changes exist
- Clear indicator after refresh completes

### 4. Circular Dependency Error
**Status:** ❌ Need to add error display

The tests expect:
- `dashboard-circular-dependency-error` - Error message when circular dependency detected

**Where to add:** In AddSettingVariable.vue, when attempting to save a variable with circular dependency

### 5. Deleted Tab/Panel Labels
**Status:** ❌ Need to add deleted scope indicators

The tests expect:
- `dashboard-variable-tabs-${tabId}-deleted` - Shows "(deleted)" for deleted tabs
- `dashboard-variable-panels-${panelId}-deleted` - Shows "(deleted)" for deleted panels

**Where to add:** In AddSettingVariable.vue or VariableSettings.vue, when displaying assigned tabs/panels that no longer exist

### 6. Settings Variable Tab
**Status:** ❓ Need to verify

The tests expect:
- `dashboard-settings-variable-tab` - The Variables tab button in settings

**Where to check:** In the Dashboard Settings component (likely DashboardSettings.vue or similar)

### 7. Tab Navigation
**Status:** ❓ Need to verify

The tests expect:
- `dashboard-tab-${tabId}` - Tab navigation buttons

**Where to check:** In ViewDashboard.vue where tabs are rendered

### 8. Panel Elements
**Status:** ❓ Need to verify

The tests expect:
- `dashboard-panel-${panelId}` - Panel container
- `data-panel-id="${panelId}"` - Panel ID attribute

**Where to check:** In the panel rendering component (likely in ViewDashboard.vue)

### 9. Multi-Select & Custom Values
**Status:** ❓ Need to verify

The tests expect:
- `dashboard-query_values-show_multiple_values` - Multi-select checkbox
- `dashboard-multi-select-default-value-toggle-custom` - Custom value toggle
- `dashboard-add-custom-value-btn` - Add custom value button
- `dashboard-variable-custom-value-0` - Custom value input (index-based)
- `dashboard-variable-hide_on_dashboard` - Hide on dashboard checkbox
- `common-auto-complete` - Autocomplete input for filters

**Where to check:** In AddSettingVariable.vue (may already exist but need to verify)

---

## 🔍 Files to Check/Update

### Priority 1 (Critical for tests to work)
1. **AddSettingVariable.vue** ✅ Partially done
   - ✅ Tab/Panel checkboxes (DONE)
   - ❌ Add dependency section (MISSING)
   - ❌ Circular dependency error (MISSING)
   - ❌ Deleted scope labels (MISSING)

2. **ViewDashboard.vue** (or VariablesValueSelector.vue)
   - ❌ Variable display containers
   - ❌ Variable loading/error states
   - ❌ Refresh buttons with indicators
   - ❌ Tab navigation buttons
   - ❌ Panel containers with IDs

### Priority 2 (Important for full coverage)
3. **DashboardSettings.vue** (or parent settings component)
   - ❓ Variable tab button (`dashboard-settings-variable-tab`)

4. **VariableSettings.vue**
   - ❓ Edit variable buttons with variable name

---

## 📝 Implementation Notes

### Tab/Panel Assignment (COMPLETED ✅)
**File:** `AddSettingVariable.vue`
**Lines:** 628, 690

Added `data-test` attributes to checkboxes:
```vue
<!-- Tab checkbox -->
<q-checkbox
  :data-test="`dashboard-variable-assign-tabs-${opt.value}`"
  ...
/>

<!-- Panel checkbox -->
<q-checkbox
  :data-test="`dashboard-variable-assign-panels-${opt.value}`"
  ...
/>
```

### Variable Dependencies (TODO ❌)
Need to add a section in AddSettingVariable.vue:

```vue
<div class="dependencies-section">
  <div class="text-bold">Variable Dependencies</div>
  <q-btn
    label="Add Dependency"
    data-test="dashboard-variable-add-dependency-btn"
    @click="addDependency"
  />

  <div v-for="(dep, index) in variableData.dependencies" :key="index">
    <q-select
      v-model="variableData.dependencies[index]"
      :options="availableVariablesForDependency"
      label="Depends on"
      data-test="dashboard-variable-dependency-select"
    />
  </div>
</div>
```

### Circular Dependency Error (TODO ❌)
Add error display in AddSettingVariable.vue:

```vue
<div
  v-if="hasCircularDependency"
  data-test="dashboard-circular-dependency-error"
  class="text-negative q-pa-md bg-negative-light"
>
  ❌ Circular dependency detected! Variables cannot depend on each other in a loop.
</div>
```

---

## 🧪 Testing After Implementation

Once all data-test attributes are added, run:

```bash
cd tests/ui-testing
npx playwright test playwright-tests/dashboards/dashboard-variables-global.spec.js --headed
```

Start with one test file at a time to verify implementation.

---

**Last Updated:** 2026-01-01
**Status:** Partial implementation complete, dependencies and refresh features still needed
