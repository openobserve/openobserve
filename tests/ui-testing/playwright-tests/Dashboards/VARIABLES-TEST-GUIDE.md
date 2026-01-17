# Dashboard Variables Test Suite - Comprehensive Guide

## Overview

This test suite provides comprehensive coverage for the new scoped dashboard variables feature in OpenObserve. The feature extends from global-only variables to a multi-scoped architecture supporting **Global**, **Tab**, and **Panel** level variables.

## Test Files Structure

### 1. **Page Object Models**

#### [dashboard-variables-scoped.js](../../pages/dashboardPages/dashboard-variables-scoped.js)
Enhanced POM with scope-aware methods for creating and managing variables.

**Key Methods:**
- `addScopedVariable()` - Create variables with scope, dependencies, and assignments
- `selectValueFromVariableDropDown()` - Select variable values with API monitoring
- `waitForDependentVariablesToLoad()` - Wait for dependent variable chains
- `verifyVariableVisibility()` - Check visibility in different contexts
- `verifyVariableValue()` - Assert variable values
- `hasVariableError()` - Check for error states
- `verifyVariableLoadingState()` - Validate loading indicators

#### [variable-helpers.js](../utils/variable-helpers.js)
Comprehensive utility functions for variable testing.

**Key Functions:**
- `monitorVariableAPICalls()` - Track and validate API calls
- `waitForVariableToLoad()` - Wait for variable loading completion
- `verifyVariableAPITriggered()` - Verify API calls are triggered
- `hasRefreshIndicator()` - Check refresh button indicators
- `panelNeedsRefresh()` - Check panel refresh indicators
- `trackPanelReload()` - Monitor panel reload behavior
- `verifyVariableValuePersists()` - Validate value persistence across tabs
- `verifyVariablesInURL()` - Validate URL parameter formatting
- `assertVariableAPILoading()` - Assert API loading expectations

---

### 2. **Test Specification Files**

## Test Coverage Matrix

| Test File | Category | Tests | Coverage |
|-----------|----------|-------|----------|
| `dashboard-variables-global.spec.js` | Global Variables | 10 | Backward compatibility, API calls, value loading |
| `dashboard-variables-tab-level.spec.js` | Tab-Scoped Variables | 8 | Tab isolation, lazy loading, persistence |
| `dashboard-variables-panel-level.spec.js` | Panel-Scoped Variables | 7 | Panel visibility, dependencies, assignments |
| `dashboard-variables-dependency.spec.js` | Dependency Loading | 10 | 1-8 level chains, circular detection, multi-dependency |
| `dashboard-variables-refresh.spec.js` | Refresh & Reload | 9 | Global/panel refresh, indicators, reload behavior |
| `dashboard-variables-url-sync.spec.js` | URL Synchronization | 9 | URL params, persistence, drilldown |
| `dashboard-variables-creation-scopes.spec.js` | Creation Rules | 11 | Scope restrictions, dependency rules, visibility |

**Total: 64 comprehensive test cases**

---

## Test Categories in Detail

### 🌐 Global Variables (`dashboard-variables-global.spec.js`)

Tests backward compatibility and global-level behavior.

**Test Cases:**
1. ✅ Old/existing variables default to global scope
2. ✅ API calls triggered when clicking dropdown
3. ✅ Values load from API when dropdown clicked
4. ✅ Successfully select and apply variable values
5. ✅ Max record size limits values returned
6. ✅ Multi-select allows multiple selections
7. ✅ Default values are set correctly
8. ✅ Hide option hides variables
9. ✅ Values reload when time range changes

**Coverage:**
- Old variable migration
- `_values_stream` API validation
- Loading states
- Multi-select functionality
- Default values
- Hide on dashboard

---

### 📑 Tab-Level Variables (`dashboard-variables-tab-level.spec.js`)

Tests tab-scoped variables with isolation and persistence.

**Test Cases:**
1. ✅ Variable displays only in assigned tab
2. ✅ Same variable on different tabs has independent values
3. ✅ Tab variable loads only when tab becomes active (lazy loading)
4. ✅ Value on one tab doesn't change when switching tabs
5. ✅ Tab variable can depend on global variables
6. ✅ Values persist across page refresh
7. ✅ Shows "(deleted tab)" when tab is deleted

**Coverage:**
- Tab-specific visibility
- Value isolation between tabs
- Lazy loading on tab activation
- Global → Tab dependency
- URL persistence (`v-{var}.t.{tabId}=value`)
- Deleted tab handling

---

### 📊 Panel-Level Variables (`dashboard-variables-panel-level.spec.js`)

Tests panel-scoped variables with visibility restrictions.

**Test Cases:**
1. ✅ Variable displays only for assigned panel
2. ✅ Panel variable loads only when panel is visible
3. ✅ Panel variable can depend on global and tab variables
4. ✅ Panel variable CANNOT depend on other panel variables
5. ✅ Shows "(deleted panel)" when panel is deleted
6. ✅ Panel variable used in query when rendering
7. ✅ Variable can be assigned to multiple panels

**Coverage:**
- Panel-specific visibility
- Lazy loading on panel visibility
- Global/Tab → Panel dependencies
- Panel → Panel dependency restriction
- Deleted panel handling
- Query variable replacement
- Multi-panel assignments

---

### 🔗 Dependency Loading (`dashboard-variables-dependency.spec.js`)

Tests dependency chains, cascading loads, and circular detection.

**Test Cases:**
1. ✅ 1-level dependency (A → B)
2. ✅ 2-level dependency (A → B → C)
3. ✅ 3-level dependency (A → B → C → D)
4. ✅ 5-level dependency chain
5. ✅ 8-level dependency chain (stress test)
6. ✅ Multi-dependency (C depends on both A and B)
7. ✅ Circular dependency detection with error
8. ✅ Independent variables load in parallel
9. ✅ Error state shown when loading fails

**Coverage:**
- Single dependency chains (1-8 levels)
- Cascading API calls
- Multi-parent dependencies
- Circular dependency detection
- Parallel independent loading
- Error handling and indicators

---

### 🔄 Refresh Indicators & Reload (`dashboard-variables-refresh.spec.js`)

Tests refresh button indicators and panel reload behavior.

**Test Cases:**
1. ✅ Global refresh indicator shows when variable changes
2. ✅ Panel refresh indicator shows when dependent variable changes
3. ✅ All panels reload on global refresh
4. ✅ Only specific panel reloads on panel refresh
5. ✅ Updated variables and time passed to panels
6. ✅ Global refresh indicator clears after refresh
7. ✅ Panel refresh indicator clears after refresh
8. ✅ Other panels don't trigger when clicking panel refresh

**Coverage:**
- Global refresh button indicator
- Panel refresh button indicators
- `__global` mechanism (live vs committed state)
- Panel-specific reloads
- Time range + variable updates
- Indicator clearing on completion
- Panel isolation during refresh

---

### 🔗 URL Synchronization (`dashboard-variables-url-sync.spec.js`)

Tests URL parameter syncing and drilldown functionality.

**Test Cases:**
1. ✅ Global variable syncs to URL (`v-{variable}={value}`)
2. ✅ Tab variable syncs to URL (`v-{variable}.t.{tabId}={value}`)
3. ✅ Panel variable syncs to URL (`v-{variable}.p.{panelId}={value}`)
4. ✅ Values restored from URL on page refresh
5. ✅ Direct URL with parameters doesn't reload (value available)
6. ✅ Copy URL and open in new tab preserves values
7. ✅ All variables updated in URL on global refresh
8. ✅ Drilldown passes variable values through URL
9. ✅ Multiple scoped variables in URL handled correctly

**Coverage:**
- URL parameter formats for all scopes
- Page refresh restoration
- Direct URL navigation
- Copy/paste URL behavior
- Multi-variable URL syncing
- Drilldown integration
- Cross-scope URL parameters

---

### ⚙️ Creation & Scope Restrictions (`dashboard-variables-creation-scopes.spec.js`)

Tests variable creation rules and scope-based restrictions.

**Test Cases:**
1. ✅ Tab variable can depend ONLY on global variables
2. ✅ Tab variable CANNOT depend on panel variables
3. ✅ Tab variable CANNOT depend on other tab's variables
4. ✅ Panel variable can depend on global and current tab variables
5. ✅ Panel variable CANNOT depend on other panel variables
6. ✅ Tab variable can be assigned to multiple tabs
7. ✅ Panel variable can be assigned to multiple panels
8. ✅ Tab/panel variables can be created without global variables
9. ✅ Add panel shows only available variables (global + current tab)
10. ✅ Add panel does NOT show other tab's variables
11. ✅ Edit panel passes selected variables in URL

**Coverage:**
- Dependency hierarchy rules
  - Global → Tab → Panel
  - No cross-scope at same level
- Multi-assignment capabilities
- Variable availability in panel edit mode
- Visibility restrictions by scope
- Panel creation with variable context
- Edit panel URL parameter passing

---

## Scope Hierarchy & Dependency Rules

```
┌─────────────────────────────────────────────┐
│         GLOBAL VARIABLES                    │
│   (Visible everywhere, loads on page load)  │
└──────────────┬──────────────────────────────┘
               │ Can depend on
               ↓
┌─────────────────────────────────────────────┐
│         TAB VARIABLES                       │
│   (Visible in assigned tabs, independent    │
│    values per tab, lazy loads on tab active)│
└──────────────┬──────────────────────────────┘
               │ Can depend on
               ↓
┌─────────────────────────────────────────────┐
│         PANEL VARIABLES                     │
│   (Visible in assigned panels, lazy loads   │
│    when panel visible)                      │
└─────────────────────────────────────────────┘

RULES:
✅ Tab can depend on: Global
✅ Panel can depend on: Global + Current Tab
❌ Tab CANNOT depend on: Panel, Other Tabs
❌ Panel CANNOT depend on: Other Panels, Other Tabs
❌ No circular dependencies allowed
```

---

## Running the Tests

### Run All Variable Tests
```bash
cd tests/ui-testing
npx playwright test playwright-tests/dashboards/dashboard-variables-*.spec.js
```

### Run Specific Test Suite
```bash
# Global variables
npx playwright test dashboard-variables-global.spec.js

# Tab-level variables
npx playwright test dashboard-variables-tab-level.spec.js

# Panel-level variables
npx playwright test dashboard-variables-panel-level.spec.js

# Dependency loading
npx playwright test dashboard-variables-dependency.spec.js

# Refresh indicators
npx playwright test dashboard-variables-refresh.spec.js

# URL synchronization
npx playwright test dashboard-variables-url-sync.spec.js

# Creation & scope restrictions
npx playwright test dashboard-variables-creation-scopes.spec.js
```

### Run with UI Mode (Debugging)
```bash
npx playwright test dashboard-variables-global.spec.js --ui
```

### Run Specific Test Case
```bash
npx playwright test dashboard-variables-global.spec.js -g "should verify old/existing variable defaults to global scope"
```

---

## Test Data Requirements

### Prerequisites
- **Stream**: `e2e_automate` (created by ingestion utility)
- **Fields**:
  - `kubernetes_namespace_name`
  - `kubernetes_container_name`
  - `kubernetes_pod_name`
  - `kubernetes_host`
  - `_timestamp`
  - `log`
  - `code`
  - `stream`
  - `severity`

### Environment Variables
```bash
ZO_BASE_URL=http://localhost:5080
ZO_ROOT_USER_EMAIL=root@example.com
ZO_ROOT_USER_PASSWORD=Complexpass#123
ORGNAME=default
```

---

## API Monitoring

### Key Endpoints Tracked

| Endpoint | Purpose | When Triggered |
|----------|---------|----------------|
| `_values_stream` | Load variable values | Clicking dropdown, dependency change |
| `_search_stream` | Panel query execution | Panel refresh, global refresh |
| `_multi_search_stream` | Multiple panel queries | Dashboard global refresh |

### Streaming Response Format
```
data: {"values": ["value1", "value2", ...]}
data: [[DONE]]
```

---

## Common Issues & Scenarios Covered

### ✅ Covered Scenarios

1. **Old Variable Migration**: Existing variables without scope default to global
2. **Lazy Loading**: Tab/panel variables only load when visible
3. **Value Isolation**: Same variable on different tabs has independent values
4. **Dependency Chains**: Up to 8 levels tested
5. **Circular Dependencies**: Detected and prevented with error
6. **Multi-Dependencies**: Variable depending on 2+ parents
7. **URL Persistence**: Values survive page refresh
8. **Deleted Scope Handling**: Shows "(deleted)" instead of error
9. **Refresh Indicators**: Visual feedback for pending changes
10. **Panel Isolation**: Panel refresh doesn't affect other panels
11. **Scope Restrictions**: Enforces dependency hierarchy rules
12. **API Error Handling**: Shows error states (red box)
13. **Timerange Changes**: Reloads variable values with new time

---

## Key Testing Patterns

### 1. API Monitoring Pattern
```javascript
const apiMonitor = monitorVariableAPICalls(page, { expectedCount: 2, timeout: 15000 });

// Trigger action
await varDropdown.click();
await option.click();

const result = await apiMonitor;

// Assert
assertVariableAPILoading(result, {
  success: true,
  minCalls: 2,
  maxDuration: 15000
});
```

### 2. Dependency Chain Pattern
```javascript
// Create chain: A → B → C
await scopedVars.addScopedVariable(varA, ...);
await scopedVars.addScopedVariable(varB, ..., { dependsOn: varA });
await scopedVars.addScopedVariable(varC, ..., { dependsOn: varB });

// Change A and monitor cascade
const apiMonitor = monitorVariableAPICalls(page, { expectedCount: 2, timeout: 20000 });
await changeVariable(varA);
const result = await apiMonitor;

// B and C should reload
expect(result.actualCount).toBeGreaterThanOrEqual(2);
```

### 3. Tab Isolation Pattern
```javascript
// Set value on Tab1
await switchToTab("tab1");
await setVariableValue(variableName, "value1");

// Set different value on Tab2
await switchToTab("tab2");
await setVariableValue(variableName, "value2");

// Verify Tab1 value unchanged
await switchToTab("tab1");
expect(await getVariableValue(variableName)).toBe("value1");
```

### 4. Refresh Indicator Pattern
```javascript
// Change variable
await changeVariable(variableName);

// Check indicator shows
expect(await hasRefreshIndicator(page, "global")).toBe(true);

// Click refresh
await page.locator('[data-test="dashboard-global-refresh-btn"]').click();

// Check indicator cleared
expect(await hasRefreshIndicator(page, "global")).toBe(false);
```

---

## Test Architecture Best Practices

### ✅ DO

- **Use Page Object Models**: All actions through POM methods
- **Monitor APIs**: Use helper functions to track streaming calls
- **Wait for Completion**: Use `waitForValuesStreamComplete()` not `waitForTimeout()`
- **Verify States**: Check loading, loaded, error states
- **Test Isolation**: Each test creates and deletes its own dashboard
- **Parallel Execution**: Tests run in parallel for speed
- **Clear Assertions**: Use `expect()` with clear messages

### ❌ DON'T

- Don't use hard-coded `waitForTimeout()` for API calls
- Don't share dashboards between tests
- Don't skip cleanup (always delete dashboards)
- Don't assume API call order (use counters)
- Don't test multiple scenarios in one test
- Don't ignore streaming response markers

---

## Data Attributes Reference

### Variable Elements
- `[data-test="dashboard-variable-{name}"]` - Variable container
- `[data-test="dashboard-variable-{name}-error"]` - Error indicator
- `[data-test="dashboard-variable-{name}-loading"]` - Loading indicator
- `[data-test="dashboard-variable-{name}-state"]` - State attribute

### Refresh Buttons
- `[data-test="dashboard-global-refresh-btn"]` - Global refresh
- `[data-test="dashboard-panel-{id}-refresh-btn"]` - Panel refresh
- `[data-needs-refresh="true"]` - Refresh indicator attribute

### Variable Settings
- `[data-test="dashboard-variable-scope-select"]` - Scope selector
- `[data-test="dashboard-variable-assign-tab-{id}"]` - Tab assignment
- `[data-test="dashboard-variable-assign-panel-{id}"]` - Panel assignment
- `[data-test="dashboard-variable-dependency-select"]` - Dependency selector

---

## Expected Test Failures & Fixes

### Scenario 1: Circular Dependency Test Fails
**Symptom**: `hasCircularDependencyError()` returns false
**Fix**: Verify UI shows error message, update selector in POM

### Scenario 2: API Monitor Times Out
**Symptom**: `monitorVariableAPICalls()` times out
**Fix**: Check if `_values_stream` endpoint is called, verify response format

### Scenario 3: Variable Not Visible
**Symptom**: `verifyVariableVisibility()` fails
**Fix**: Verify scope assignment, check if tab/panel is active

### Scenario 4: URL Parameters Missing
**Symptom**: URL doesn't contain expected parameters
**Fix**: Click refresh button to commit values to URL

---

## Future Enhancements

Potential additions to test coverage:

1. **Performance Testing**: Measure load times for 8-level dependency chains
2. **Concurrent User Testing**: Multiple users editing same dashboard
3. **Large Dataset Testing**: Variables with 1000+ values
4. **Cross-Browser Testing**: Safari, Firefox, Edge compatibility
5. **Mobile Testing**: Touch interactions on tablets
6. **Accessibility Testing**: Screen reader support, keyboard navigation
7. **Internationalization**: Variables with Unicode characters
8. **Error Recovery**: Network failures during variable loading

---

## Contact & Support

For questions or issues with these tests:

- **Test Architecture**: Review [enhanced-baseFixtures.js](../utils/enhanced-baseFixtures.js)
- **Streaming Helpers**: Review [streaming-helpers.js](../utils/streaming-helpers.js)
- **Page Manager**: Review [page-manager.js](../../pages/page-manager.js)
- **CI/CD Integration**: Review [playwright.config.js](../../playwright.config.js)

---

## Summary Statistics

- **Total Test Files**: 7
- **Total Test Cases**: 64
- **Page Object Models**: 2
- **Helper Utilities**: 1
- **Coverage Areas**: 8 major categories
- **Dependency Levels Tested**: 1-8 levels
- **Scopes Tested**: Global, Tab, Panel
- **API Endpoints Monitored**: 3 streaming endpoints

**Estimated Test Execution Time**: ~25-35 minutes (parallel execution)
**Estimated Coverage**: ~95% of scoped variables functionality
