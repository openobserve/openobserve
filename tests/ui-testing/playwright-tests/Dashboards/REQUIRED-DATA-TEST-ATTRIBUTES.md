# Required Data-Test Attributes for Dashboard Scoped Variables

This document lists all `data-test` attributes that need to be added to the UI components for the scoped variables feature to work with the automated tests.

## Overview

The scoped variables feature requires specific `data-test` attributes to be added to various UI elements. These attributes allow Playwright tests to locate and interact with the components.

---

## 1. Variable Settings Panel

### Variable Tab
```html
<div data-test="dashboard-settings-variable-tab">
  Variable Settings
</div>
```

### Add Variable Button
```html
<button data-test="dashboard-add-variable-btn">
  Add Variable
</button>
```

### Variable Form Fields

#### Variable Name Input
```html
<input
  data-test="dashboard-variable-name"
  placeholder="Variable name"
  v-model="variableName"
/>
```

#### Scope Selector Dropdown
```html
<!-- The dropdown/select element -->
<select data-test="dashboard-variable-scope-select">
  <option>Global</option>
  <option>Selected Tabs</option>
  <option>Selected Panels</option>
</select>

<!-- Or for Quasar q-select -->
<q-select
  data-test="dashboard-variable-scope-select"
  v-model="scope"
  :options="['Global', 'Selected Tabs', 'Selected Panels']"
/>
```

**IMPORTANT:** The option text must be exactly:
- `"Global"` (not "global")
- `"Selected Tabs"` (not "tabs" or "Tab")
- `"Selected Panels"` (not "panels" or "Panel")

---

## 2. Tab and Panel Assignment Checkboxes

These are **critical** for scoped variables to work correctly.

### Tab Assignment Checkboxes
Shown when scope = "Selected Tabs"

```html
<!-- For each tab, create a checkbox with dynamic data-test -->
<checkbox
  v-for="tab in dashboard.tabs"
  :key="tab.id"
  :data-test="`dashboard-variable-assign-tabs-${tab.id}`"
  v-model="selectedTabs"
  :val="tab.id"
>
  {{ tab.name }}
</checkbox>
```

**IMPORTANT:** Use `assign-tabs` (plural), not `assign-tab`

**Example:**
- Tab with id `"tab1"` → `data-test="dashboard-variable-assign-tabs-tab1"`
- Tab with id `"tab2"` → `data-test="dashboard-variable-assign-tabs-tab2"`

### Panel Assignment Checkboxes
Shown when scope = "Selected Panels"

```html
<!-- For each panel, create a checkbox with dynamic data-test -->
<checkbox
  v-for="panel in dashboard.panels"
  :key="panel.id"
  :data-test="`dashboard-variable-assign-panels-${panel.id}`"
  v-model="selectedPanels"
  :val="panel.id"
>
  {{ panel.name }}
</checkbox>
```

**IMPORTANT:** Use `assign-panels` (plural), not `assign-panel`

**Example:**
- Panel with id `"panel_123"` → `data-test="dashboard-variable-assign-panels-panel_123"`

---

## 3. Stream and Field Configuration

### Stream Type Selector
```html
<select data-test="dashboard-variable-stream-type-select">
  <option>logs</option>
  <option>metrics</option>
  <option>traces</option>
</select>
```

### Stream Name Selector
```html
<select
  data-test="dashboard-variable-stream-select"
  v-model="streamName"
  use-input
>
  <!-- Stream options -->
</select>
```

### Field Selector
```html
<select
  data-test="dashboard-variable-field-select"
  v-model="fieldName"
  use-input
>
  <!-- Field options -->
</select>
```

---

## 4. Variable Dependencies

### Add Dependency Button
```html
<button data-test="dashboard-variable-add-dependency-btn">
  Add Dependency
</button>
```

### Dependency Dropdown
```html
<!-- Each dependency dropdown should have this data-test -->
<select
  data-test="dashboard-variable-dependency-select"
  v-model="dependency"
>
  <!-- Should only show variables that are allowed based on scope rules -->
  <option v-for="variable in availableVariables" :value="variable.name">
    {{ variable.name }}
  </option>
</select>
```

**Dependency Rules:**
- **Tab variables** can only depend on **Global variables**
- **Panel variables** can depend on **Global + Current Tab variables**
- No circular dependencies allowed

---

## 5. Filter Configuration

### Add Filter Button
```html
<button data-test="dashboard-add-filter-btn">
  Add Filter
</button>
```

### Filter Field Name
```html
<input data-test="dashboard-query-values-filter-name-selector" />
```

### Filter Operator
```html
<select data-test="dashboard-query-values-filter-operator-selector">
  <option>=</option>
  <option>!=</option>
  <option>contains</option>
  <!-- etc -->
</select>
```

### Filter Value (Autocomplete)
```html
<input data-test="common-auto-complete" />
```

---

## 6. Variable Options

### Multi-Select Toggle
```html
<checkbox data-test="dashboard-query_values-show_multiple_values">
  Show multiple values
</checkbox>
```

### Custom Value Toggle
```html
<checkbox data-test="dashboard-multi-select-default-value-toggle-custom">
  Use custom value
</checkbox>
```

### Add Custom Value Button
```html
<button data-test="dashboard-add-custom-value-btn">
  Add Custom Value
</button>
```

### Custom Value Input
```html
<input
  data-test="dashboard-variable-custom-value-0"
  placeholder="Custom value"
/>
<!-- For multiple custom values, use index: custom-value-0, custom-value-1, etc -->
```

### Hide on Dashboard
```html
<checkbox data-test="dashboard-variable-hide_on_dashboard">
  Hide on dashboard
</checkbox>
```

---

## 7. Save Variable Button

```html
<button data-test="dashboard-variable-save-btn">
  Save
</button>
```

---

## 8. Variable Display on Dashboard

### Variable Container
```html
<div
  v-for="variable in visibleVariables"
  :key="variable.name"
  :data-test="`dashboard-variable-${variable.name}`"
  :data-state="variable.state"
>
  <!-- Variable dropdown content -->
  <label>{{ variable.name }}</label>
  <select v-model="variable.value">
    <!-- Options loaded from _values_stream API -->
  </select>
</div>
```

**Example:**
- Variable named `"namespace"` → `data-test="dashboard-variable-namespace"`
- Variable named `"container_var_12345"` → `data-test="dashboard-variable-container_var_12345"`

### Variable State Attribute
The `data-state` attribute should reflect the current loading state:
- `"loading"` - Variable is currently loading values
- `"loaded"` - Variable values loaded successfully
- `"error"` - Failed to load variable values
- `"partial"` - Some dependencies not yet loaded

### Variable Loading Indicator
```html
<div
  v-if="variable.isLoading"
  :data-test="`dashboard-variable-${variable.name}-loading`"
>
  <spinner />
</div>
```

### Variable Error Indicator
```html
<div
  v-if="variable.hasError"
  :data-test="`dashboard-variable-${variable.name}-error`"
  class="text-negative"
>
  Failed to load values
</div>
```

---

## 9. Refresh Buttons and Indicators

### Global Refresh Button
```html
<button
  data-test="dashboard-global-refresh-btn"
  :data-needs-refresh="hasUncommittedVariableChanges"
  @click="refreshAllPanels"
>
  <icon name="refresh" />
  Refresh Dashboard
</button>
```

**IMPORTANT:** The `data-needs-refresh` attribute should be:
- `"true"` when variables have changed but panels haven't been refreshed
- `"false"` or absent when no refresh needed

### Panel Refresh Button
```html
<button
  v-for="panel in panels"
  :key="panel.id"
  :data-test="`dashboard-panel-${panel.id}-refresh-btn`"
  :data-needs-refresh="panelNeedsRefresh(panel.id)"
  @click="refreshPanel(panel.id)"
>
  Refresh
</button>
```

### Panel Refresh Warning/Indicator
```html
<div
  v-for="panel in panels"
  :key="panel.id"
  v-if="panelNeedsRefresh(panel.id)"
  :data-test="`dashboard-panel-${panel.id}-refresh-warning`"
>
  ⚠️ Variable changed - click refresh to update
</div>
```

---

## 10. Error Handling

### Circular Dependency Error
```html
<div
  v-if="hasCircularDependency"
  data-test="dashboard-circular-dependency-error"
  class="error-message"
>
  ❌ Circular dependency detected! Variables cannot depend on each other in a loop.
</div>
```

This should appear when attempting to create a circular dependency chain like:
- Variable A depends on Variable B
- Variable B depends on Variable A

---

## 11. Deleted Tab/Panel Indicators

When a tab or panel is deleted but variables are still assigned to it, show a label:

### Deleted Tab Label
```html
<span
  v-if="isTabDeleted(tabId)"
  :data-test="`dashboard-variable-tabs-${tabId}-deleted`"
  class="text-grey"
>
  {{ tabName }} (deleted)
</span>
```

### Deleted Panel Label
```html
<span
  v-if="isPanelDeleted(panelId)"
  :data-test="`dashboard-variable-panels-${panelId}-deleted`"
  class="text-grey"
>
  {{ panelName }} (deleted)
</span>
```

---

## 12. Tab Navigation

### Tab Buttons
```html
<button
  v-for="tab in dashboard.tabs"
  :key="tab.id"
  :data-test="`dashboard-tab-${tab.id}`"
  @click="switchToTab(tab.id)"
  :class="{ active: currentTab === tab.id }"
>
  {{ tab.name }}
</button>
```

**Example:**
- Tab with id `"tab1"` → `data-test="dashboard-tab-tab1"`
- Tab with id `"overview"` → `data-test="dashboard-tab-overview"`

---

## 13. Panel Elements

### Panel Container
```html
<div
  v-for="panel in panels"
  :key="panel.id"
  :data-test="`dashboard-panel-${panel.id}`"
  :data-panel-id="panel.id"
  class="panel-container"
>
  <!-- Panel content (chart, table, etc) -->
</div>
```

**IMPORTANT:** Both `data-test` and `data-panel-id` attributes are needed.

---

## 14. Panel Edit Mode - Variable Availability

When editing a panel, show which variables are available:

```html
<div data-test="panel-edit-variables-section">
  <div
    v-for="variable in availableVariablesForPanel"
    :key="variable.name"
    :data-test="`panel-edit-variable-${variable.name}`"
  >
    <span>{{ variable.name }}</span>
    <badge>{{ variable.scope }}</badge>
  </div>
</div>
```

**Available Variables Logic:**
- **Global variables** - Always available
- **Tab variables** - Only from current tab
- **Panel variables** - Only assigned to this panel

---

## 15. Edit Variable in List

When showing the list of variables in settings:

```html
<div
  v-for="variable in variables"
  :key="variable.name"
  class="variable-list-item"
>
  <span>{{ variable.name }}</span>
  <button
    :data-test="`dashboard-variable-${variable.name}-edit`"
    @click="editVariable(variable)"
  >
    Edit
  </button>
</div>
```

---

## Quick Reference: Data-Test Attribute Patterns

### Static Attributes (same for all instances)
| Element | data-test value |
|---------|----------------|
| Variable settings tab | `dashboard-settings-variable-tab` |
| Add variable button | `dashboard-add-variable-btn` |
| Variable name input | `dashboard-variable-name` |
| Scope selector | `dashboard-variable-scope-select` |
| Stream type selector | `dashboard-variable-stream-type-select` |
| Stream selector | `dashboard-variable-stream-select` |
| Field selector | `dashboard-variable-field-select` |
| Add dependency button | `dashboard-variable-add-dependency-btn` |
| Dependency dropdown | `dashboard-variable-dependency-select` |
| Add filter button | `dashboard-add-filter-btn` |
| Filter name input | `dashboard-query-values-filter-name-selector` |
| Filter operator | `dashboard-query-values-filter-operator-selector` |
| Filter value autocomplete | `common-auto-complete` |
| Multi-select checkbox | `dashboard-query_values-show_multiple_values` |
| Custom value toggle | `dashboard-multi-select-default-value-toggle-custom` |
| Add custom value button | `dashboard-add-custom-value-btn` |
| Custom value input | `dashboard-variable-custom-value-0` |
| Hide on dashboard | `dashboard-variable-hide_on_dashboard` |
| Save button | `dashboard-variable-save-btn` |
| Global refresh button | `dashboard-global-refresh-btn` |
| Circular dependency error | `dashboard-circular-dependency-error` |

### Dynamic Attributes (use template strings)
| Element | Pattern | Example |
|---------|---------|---------|
| Tab assignment checkbox | `dashboard-variable-assign-tabs-${tabId}` | `dashboard-variable-assign-tabs-tab1` |
| Panel assignment checkbox | `dashboard-variable-assign-panels-${panelId}` | `dashboard-variable-assign-panels-panel_123` |
| Variable on dashboard | `dashboard-variable-${variableName}` | `dashboard-variable-namespace` |
| Variable loading indicator | `dashboard-variable-${variableName}-loading` | `dashboard-variable-namespace-loading` |
| Variable error indicator | `dashboard-variable-${variableName}-error` | `dashboard-variable-namespace-error` |
| Variable state | `dashboard-variable-${variableName}-state` | `dashboard-variable-namespace-state` |
| Tab button | `dashboard-tab-${tabId}` | `dashboard-tab-tab1` |
| Panel container | `dashboard-panel-${panelId}` | `dashboard-panel-panel_123` |
| Panel refresh button | `dashboard-panel-${panelId}-refresh-btn` | `dashboard-panel-panel_123-refresh-btn` |
| Panel refresh warning | `dashboard-panel-${panelId}-refresh-warning` | `dashboard-panel-panel_123-refresh-warning` |
| Deleted tab label | `dashboard-variable-tabs-${tabId}-deleted` | `dashboard-variable-tabs-tab1-deleted` |
| Deleted panel label | `dashboard-variable-panels-${panelId}-deleted` | `dashboard-variable-panels-panel_123-deleted` |
| Edit variable button | `dashboard-variable-${variableName}-edit` | `dashboard-variable-namespace-edit` |
| Panel edit variable | `panel-edit-variable-${variableName}` | `panel-edit-variable-namespace` |

---

## Implementation Notes

### 1. Scope Option Text
The scope dropdown options **must** use these exact strings:
- ✅ `"Global"`
- ✅ `"Selected Tabs"`
- ✅ `"Selected Panels"`

NOT:
- ❌ `"global"`, `"tabs"`, `"panels"`
- ❌ `"Tab"`, `"Panel"`
- ❌ `"Tab Level"`, `"Panel Level"`

### 2. Variable Visibility Rules
- **Global variables**: Always visible on all tabs and panels
- **Tab variables**: Only visible on assigned tabs
- **Panel variables**: Only visible for assigned panels

### 3. Lazy Loading
- **Tab variables**: Should NOT load until the tab becomes active
- **Panel variables**: Should NOT load until the panel is scrolled into view

### 4. Refresh Indicator Logic
```javascript
// Global refresh needed when:
hasUncommittedChanges = (liveVariableValues !== committedVariableValues)

// Panel refresh needed when:
panelNeedsRefresh(panelId) {
  return panelDependsOnVariable && variableValueChanged
}
```

### 5. URL Parameter Format
- Global: `v-{variableName}={value}`
- Tab: `v-{variableName}.t.{tabId}={value}`
- Panel: `v-{variableName}.p.{panelId}={value}`

Example: `v-namespace.t.tab1=production&v-container.p.panel_123=web-server`

---

## Testing the Implementation

Once you've added these `data-test` attributes, you can verify they work by running:

```bash
cd tests/ui-testing
npx playwright test playwright-tests/dashboards/dashboard-variables-*.spec.js --headed
```

Or test a specific file:
```bash
npx playwright test playwright-tests/dashboards/dashboard-variables-global.spec.js --headed
```

---

## Questions?

Refer to the test files for examples of how these attributes are used:
- `dashboard-variables-global.spec.js` - Global variable tests
- `dashboard-variables-tab-level.spec.js` - Tab-scoped variable tests
- `dashboard-variables-panel-level.spec.js` - Panel-scoped variable tests
- `dashboard-variables-creation-scopes.spec.js` - Dependency rules and scope restrictions

The page object model `dashboard-variables-scoped.js` shows how tests interact with these elements.

---

**Last Updated:** 2026-01-01
**Test Suite Version:** 1.0
**Total Required Attributes:** ~25 unique patterns
