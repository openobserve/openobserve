# Dashboard Variables - Implementation Validation Checklist

Use this checklist to validate that your scoped variables implementation is working correctly. Each item corresponds to test cases in the suite.

## ✅ Global Variables

### Backward Compatibility
- [ ] Old variables without scope attribute default to global
- [ ] Existing dashboards with variables continue to work
- [ ] Variables show in settings with "global" scope selected

### API Calls
- [ ] Clicking variable dropdown triggers `_values_stream` API
- [ ] API returns `data: [[DONE]]` completion marker
- [ ] Values populate in dropdown after API completes
- [ ] API call includes correct stream, field, and time range

### Value Selection
- [ ] Can select value from dropdown
- [ ] Selected value displays in input field
- [ ] Multi-select allows multiple values
- [ ] Max record size limits dropdown options correctly

### Special Features
- [ ] Default value is pre-populated when dashboard loads
- [ ] Hide on dashboard option hides variable from view
- [ ] Changing time range reloads variable values on next click

---

## ✅ Tab-Level Variables

### Visibility & Assignment
- [ ] Variable shows only in assigned tabs
- [ ] Variable hidden in non-assigned tabs
- [ ] Can assign same variable to multiple tabs
- [ ] Each tab instance has independent value

### Lazy Loading
- [ ] Tab variable doesn't load until tab becomes active
- [ ] Switching to tab triggers `_values_stream` API
- [ ] Loading indicator shown while variable loads
- [ ] No unnecessary API calls for inactive tabs

### Value Isolation
- [ ] Setting value on Tab1 doesn't affect Tab2
- [ ] Switching between tabs preserves individual values
- [ ] Values persist after page refresh (from URL)
- [ ] Each tab-variable combo has unique URL parameter format: `v-{var}.t.{tabId}={value}`

### Dependencies
- [ ] Tab variable can depend on global variables
- [ ] Changing global variable triggers tab variable reload
- [ ] Tab variable CANNOT depend on panel variables (not in dropdown)
- [ ] Tab variable CANNOT depend on other tab's variables (not in dropdown)

---

## ✅ Panel-Level Variables

### Visibility & Assignment
- [ ] Variable shows only for assigned panels
- [ ] Variable hidden for non-assigned panels
- [ ] Can assign same variable to multiple panels
- [ ] Panel context shows correct variables

### Lazy Loading
- [ ] Panel variable doesn't load until panel is visible
- [ ] Scrolling panel into view triggers API call
- [ ] Loading indicator shown while loading
- [ ] No API calls for off-screen panels

### Dependencies
- [ ] Panel variable can depend on global variables
- [ ] Panel variable can depend on current tab's variables
- [ ] Panel variable CANNOT depend on other panels (not in dropdown)
- [ ] Panel variable CANNOT depend on other tab's variables (not in dropdown)

### Query Integration
- [ ] Variable value used in panel query (`$variableName`)
- [ ] Changing variable updates query with new value
- [ ] Panel refreshes with updated variable
- [ ] URL contains panel variable: `v-{var}.p.{panelId}={value}`

---

## ✅ Dependency Loading

### Simple Dependencies
- [ ] **1-level**: A → B works
- [ ] Changing A triggers B to reload
- [ ] B receives updated value from A

### Multi-Level Chains
- [ ] **2-level**: A → B → C triggers 2 API calls
- [ ] **3-level**: A → B → C → D triggers 3 API calls
- [ ] **5-level**: Chain loads correctly (5 API calls)
- [ ] **8-level**: Stress test completes (8 API calls)

### Multi-Parent Dependencies
- [ ] Variable C depends on both A and B
- [ ] Changing A triggers C reload
- [ ] Changing B triggers C reload
- [ ] C waits for both parents before loading

### Circular Detection
- [ ] Creating A → B → A shows error
- [ ] Error prevents saving
- [ ] Error message explains circular dependency
- [ ] Red box or validation message visible

### Parallel Loading
- [ ] Independent variables (no dependencies) load in parallel
- [ ] Multiple API calls happen simultaneously
- [ ] No blocking between independent variables

### Error Handling
- [ ] Variable with invalid config shows error state (red box)
- [ ] Error doesn't break other variables
- [ ] Dependent variables show partially loaded state if parent fails

---

## ✅ Refresh Indicators & Panel Reload

### Global Refresh Button
- [ ] Button highlights when variable changes
- [ ] Indicator shows "needs refresh" state
- [ ] Icon or color change visible
- [ ] Clicking button clears indicator

### Panel Refresh Button
- [ ] Panel button highlights when dependent variable changes
- [ ] Warning icon (⚠️) appears on panel
- [ ] Panel-specific indicator (not global)
- [ ] Clicking panel button clears that panel's indicator

### Global Refresh Behavior
- [ ] Clicking global refresh reloads ALL panels
- [ ] All panels receive updated variable values
- [ ] All panels receive updated time range
- [ ] URL updates with new variable values
- [ ] Removes panel-specific overrides (`currentVariablesDataRef.__global`)

### Panel Refresh Behavior
- [ ] Clicking panel refresh reloads ONLY that panel
- [ ] Other panels don't reload
- [ ] Panel receives current variable values
- [ ] Creates panel-specific entry (`currentVariablesDataRef[panelId]`)
- [ ] Global refresh indicator remains (only panel indicator clears)

### Refresh Indicator Clearing
- [ ] Global indicator clears after global refresh completes
- [ ] Panel indicator clears after panel refresh completes
- [ ] Indicators don't clear if refresh fails
- [ ] Multiple panels can have indicators simultaneously

---

## ✅ URL Synchronization

### URL Parameter Formats
- [ ] **Global**: `v-{variableName}={value}`
- [ ] **Tab**: `v-{variableName}.t.{tabId}={value}`
- [ ] **Panel**: `v-{variableName}.p.{panelId}={value}`
- [ ] Values are URL-encoded properly
- [ ] Multiple variables appear as separate parameters

### URL Updates
- [ ] Clicking global refresh updates URL
- [ ] Clicking panel refresh updates URL
- [ ] All variable values included in URL
- [ ] URL updates without page reload

### URL Restoration
- [ ] Refreshing page restores variable values from URL
- [ ] Values pre-populate without API calls
- [ ] No loading indicators shown (values already available)
- [ ] Panels load with correct values immediately

### Copy & Share
- [ ] Copying URL and opening in new tab works
- [ ] New tab shows same variable values
- [ ] New tab doesn't re-trigger unnecessary API calls
- [ ] All scopes (global, tab, panel) preserved

### Drilldown
- [ ] Drilldown links include variable parameters
- [ ] Clicking drilldown passes variables to target dashboard
- [ ] Variables expand and load in target
- [ ] Variable names match between source and target

---

## ✅ Variable Creation & Scope Rules

### Scope Selection
- [ ] Can create global variable
- [ ] Can create tab variable with tab assignment
- [ ] Can create panel variable with panel assignment
- [ ] Scope selector has all three options

### Dependency Restrictions - Tab Variables
- [ ] Tab variable dependency dropdown shows global variables ✅
- [ ] Tab variable dependency dropdown does NOT show panel variables ❌
- [ ] Tab variable dependency dropdown does NOT show other tabs' variables ❌
- [ ] Selecting global variable works

### Dependency Restrictions - Panel Variables
- [ ] Panel variable dependency dropdown shows global variables ✅
- [ ] Panel variable dependency dropdown shows current tab's variables ✅
- [ ] Panel variable dependency dropdown does NOT show other panel variables ❌
- [ ] Panel variable dependency dropdown does NOT show other tabs' variables ❌

### Multi-Assignment
- [ ] Can assign tab variable to multiple tabs (checkboxes)
- [ ] Can assign panel variable to multiple panels (checkboxes)
- [ ] All assigned tabs show the variable
- [ ] All assigned panels show the variable

### Independent Creation
- [ ] Can create tab variable without any global variables
- [ ] Can create panel variable without any global variables
- [ ] Scoped variables work independently

### Deleted Scopes
- [ ] Deleting tab doesn't delete variable
- [ ] Variable settings show "(deleted tab)" label
- [ ] Deleting panel doesn't delete variable
- [ ] Variable settings show "(deleted panel)" label
- [ ] No errors thrown when scope deleted

---

## ✅ Add Panel & Edit Panel

### Variable Availability in Panel Edit
- [ ] Add panel shows global variables
- [ ] Add panel in Tab1 shows Tab1 variables
- [ ] Add panel in Tab1 does NOT show Tab2 variables
- [ ] Add panel shows panel variables (if editing existing)

### Variable Filters
- [ ] Can add filter using variable: `$variableName`
- [ ] Variable syntax highlighted or autocompleted
- [ ] Filter dropdown shows available variables only
- [ ] Syntax: `field = $variableName` works

### Panel Save & Back
- [ ] Saving panel passes current variable values in URL
- [ ] Returning to dashboard doesn't reload unnecessarily
- [ ] Panel renders with correct variable values
- [ ] Other panels don't reload when saving one panel

---

## 🔍 Edge Cases & Gotchas

### Edge Case: Variable with No Values
- [ ] Variable with empty result set shows "No values"
- [ ] Doesn't break panel query
- [ ] Panel query replaces variable with `_o2_all_` placeholder

### Edge Case: Variable Loading Timeout
- [ ] Timeout shows error indicator
- [ ] Doesn't block other variables
- [ ] Can retry by clicking dropdown again

### Edge Case: Rapid Tab Switching
- [ ] Switching tabs rapidly doesn't cause duplicate API calls
- [ ] Previous tab's API calls cancelled or ignored
- [ ] New tab's variables load correctly

### Edge Case: Time Range Change During Variable Load
- [ ] In-progress load cancelled
- [ ] New load starts with updated time range
- [ ] No stale data shown

### Edge Case: Dashboard with 10+ Variables
- [ ] All variables load successfully
- [ ] Performance acceptable (<5s total load time)
- [ ] No memory leaks
- [ ] URL doesn't become too long (browser limit)

### Edge Case: Special Characters in Values
- [ ] Values with spaces work
- [ ] Values with quotes work
- [ ] Values with special chars (`&`, `=`, etc.) URL-encoded
- [ ] Unicode characters work

---

## 🚀 Performance Checks

- [ ] **Initial Load**: Global variables load within 2s
- [ ] **Tab Switch**: Tab variables load within 1s
- [ ] **Dependency Chain**: 5-level chain completes within 5s
- [ ] **Panel Refresh**: Single panel refreshes within 2s
- [ ] **Global Refresh**: All panels refresh within 5s
- [ ] **URL Update**: URL updates within 100ms
- [ ] **Page Refresh**: Restoration within 1s

---

## 🐛 Bug Indicators

If any of these occur, there's likely a bug:

❌ **Variable shows in wrong tab/panel**
❌ **API called multiple times for same action**
❌ **Variable value doesn't persist across tab switches**
❌ **Circular dependency allowed to be saved**
❌ **Panel variable can depend on another panel**
❌ **URL doesn't update after refresh**
❌ **Page refresh loses variable values**
❌ **Deleted tab/panel causes error instead of showing "(deleted)"**
❌ **Dependent variable doesn't reload when parent changes**
❌ **Refresh indicator doesn't show when variable changes**
❌ **Global refresh reloads only some panels**
❌ **Panel refresh reloads other panels**

---

## 📊 Testing Checklist Progress

### Priority 1 (Critical) - Must Pass
- [ ] Global variable backward compatibility
- [ ] Tab variable isolation
- [ ] Panel variable visibility
- [ ] Dependency chain loading (1-3 levels)
- [ ] URL synchronization
- [ ] Global refresh reloads all panels
- [ ] Panel refresh reloads single panel

### Priority 2 (Important) - Should Pass
- [ ] Lazy loading for tabs/panels
- [ ] Multi-level dependencies (4-8 levels)
- [ ] Circular dependency detection
- [ ] Refresh indicators
- [ ] Scope restriction rules
- [ ] Deleted scope handling

### Priority 3 (Nice to Have) - Good if Pass
- [ ] Multi-parent dependencies
- [ ] Performance optimizations
- [ ] Edge case handling
- [ ] Error recovery

---

## 📝 Manual Testing Script

For manual verification before automation:

1. **Create Dashboard with Global Variable**
   - Add variable
   - Verify defaults to global
   - Select value
   - Click global refresh
   - Verify URL updated

2. **Add Tab with Tab Variable**
   - Create Tab1, Tab2
   - Add tab variable to Tab1
   - Set value on Tab1
   - Switch to Tab2 (should NOT see variable)
   - Back to Tab1 (value should persist)

3. **Add Panel with Panel Variable**
   - Add panel
   - Create panel variable for that panel
   - Add filter: `field = $panelVariable`
   - Set value
   - Click panel refresh
   - Verify panel query updated

4. **Test Dependency Chain**
   - Create A (independent)
   - Create B (depends on A)
   - Create C (depends on B)
   - Change A
   - Verify B and C reload (watch network tab)

5. **Test URL Persistence**
   - Set all variable values
   - Click global refresh
   - Copy URL
   - Refresh page
   - Verify all values restored

6. **Test Refresh Indicators**
   - Change variable value
   - Verify global refresh button highlights
   - Verify panel warning icon appears
   - Click global refresh
   - Verify indicator clears

---

## 🎯 Success Criteria

All tests pass if:
✅ **64/64 test cases pass**
✅ **No console errors** during test execution
✅ **API calls complete** within timeout (15s)
✅ **URL parameters correct** for all scopes
✅ **Refresh indicators work** as expected
✅ **Dependency chains load** up to 8 levels
✅ **Scope restrictions enforced** correctly
✅ **No memory leaks** after 1000 variable updates

---

**Date Prepared**: 2026-01-01
**Test Suite Version**: 1.0
**Total Scenarios**: 64 automated + ~20 manual checks
