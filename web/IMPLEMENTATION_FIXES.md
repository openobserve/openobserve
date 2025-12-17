# Dashboard Variables - Critical Fixes Implementation

## Summary of Issues

Based on analysis of main branch vs feature branch, three critical issues need fixing:

### Issue 1: `<blank>` Value Set Incorrectly
**Current Behavior**: `<blank>` is being set during initialization
**Expected Behavior**: Only show `<blank>` for empty strings from API response
**Fix Location**: `VariablesValueSelector.vue` handleSearchResponse function

### Issue 2: Premature API Calls
**Current Behavior**: Variables trigger API calls immediately when changed or dropdown opened
**Expected Behavior**: Variables should only reload panels when user clicks "Refresh" button
**Root Cause**: Missing two-tier state mechanism (live vs committed)

**Main Branch `__global` Mechanism:**
```typescript
// ViewDashboard.vue
currentTimeObjPerPanel.value = {
  __global: {  // Committed state - used by panels
    start_time: new Date(date.startTime),
    end_time: new Date(date.endTime),
  },
};

// RenderDashboardCharts.vue
watch(
  () => props?.currentTimeObj?.__global,  // Only triggers on refresh click
  () => {
    currentVariablesDataRef.value = {
      __global: JSON.parse(JSON.stringify(variablesData.value)),  // Commit live to __global
    };
  },
);
```

**Current Implementation Problem:**
- No separation between "what user is changing" (live) and "what panels use" (committed)
- Variables update `currentVariablesDataRef` immediately
- Panels reload on every change instead of waiting for explicit refresh

### Issue 3: URL Not Setting Properly
**Current Behavior**: URL updates on every variable change
**Expected Behavior**: URL should only update when user clicks refresh
**Root Cause**: URL sync not tied to the `__global` commit mechanism

## Solution Architecture

### Two-Tier State for All Scopes

Extend the `__global` mechanism to all scope levels:

```typescript
// In useVariablesManager.ts
interface ScopedVariableState {
  live: VariableRuntimeState[];      // Updates immediately on user change
  committed: VariableRuntimeState[]; // Updates only on refresh click
}

const variablesState = reactive<{
  global: ScopedVariableState;
  tabs: Record<string, ScopedVariableState>;
  panels: Record<string, ScopedVariableState>;
}>({
  global: { live: [], committed: [] },
  tabs: {},
  panels: {},
});
```

### Flow Diagram

```
User Changes Variable (e.g., region: "US" → "EU")
         ↓
Update LIVE state immediately
         ↓
variablesState.global.live[0].value = "EU"  ✓ Updated
variablesState.global.committed[0].value = "US"  ✗ NOT updated
         ↓
Visual Indicators:
  • Refresh button highlighted (yellow)
  • Panel warning icons ⚠️
  • Tooltip: "Refresh to apply latest variable changes"
         ↓
    User Clicks Refresh Button
         ↓
Trigger: currentTimeObj.__global changes
         ↓
Commit live → committed for all scopes:
  - global: copy live → committed
  - tabs: copy live → committed (for active tab)
  - panels: copy live → committed (for visible panels)
         ↓
Update URL with committed values
         ↓
Panels reload with new committed values
```

### Key Implementation Points

1. **Manager State** (`useVariablesManager.ts`):
   - Add `committedVariablesData` structure mirroring `variablesData`
   - Add `hasUncommittedChanges` computed property
   - Add `commitAll()` method to copy live → committed
   - Add `getCommittedVariablesForPanel()` method

2. **RenderDashboardCharts** (pass committed state to panels):
   ```typescript
   const getMergedVariablesForPanel = (panelId: string) => {
     if (variablesManager) {
       // Use COMMITTED state, not live state
       return variablesManager.getCommittedVariablesForPanel(panelId, selectedTabId.value);
     }
     // Legacy fallback
     return currentVariablesDataRef.value?.[panelId] || currentVariablesDataRef.value['__global'];
   };
   ```

3. **ViewDashboard** (trigger commit on refresh):
   ```typescript
   watch(
     () => currentTimeObjPerPanel.value?.__global,
     () => {
       if (variablesManager) {
         variablesManager.commitAll(); // Commit all live changes
         variablesManager.syncToUrl(router, route); // Update URL
       }
     }
   );
   ```

4. **Change Detection** (yellow icon):
   ```typescript
   const isVariablesChanged = computed(() => {
     return variablesManager?.hasUncommittedChanges.value || false;
   });
   ```

## Implementation Steps

### Step 1: Add Two-Tier State to Manager
- [ ] Add `committedVariablesData` to state
- [ ] Add `hasUncommittedChanges` computed
- [ ] Add `commitAll()` method
- [ ] Add `commitScope(scope, id?)` method
- [ ] Add `getCommittedVariablesForPanel()` method

### Step 2: Update VariablesValueSelector
- [ ] Remove premature API calls on value change
- [ ] Only update live state when user changes value
- [ ] Fix `<blank>` to only show from API response

### Step 3: Update RenderDashboardCharts
- [ ] Use committed state for panels
- [ ] Pass live state for comparison (change detection)

### Step 4: Update ViewDashboard
- [ ] Watch `__global` to trigger commit
- [ ] Add yellow icon when `hasUncommittedChanges`
- [ ] Update URL only on commit

### Step 5: Update Design Document
- [ ] Document two-tier state architecture
- [ ] Add flow diagrams
- [ ] Update API documentation

## Testing Checklist

- [ ] Variable change doesn't trigger panel reload
- [ ] Refresh button shows yellow when variables changed
- [ ] Click refresh commits changes and reloads panels
- [ ] URL updates only on refresh, not on variable change
- [ ] `<blank>` only shows for empty strings from API
- [ ] Tab switch doesn't lose uncommitted changes
- [ ] Panel refresh commits only that panel's variables
- [ ] Dashboard refresh commits all variables

## Rollback Plan

If issues arise, the legacy mode (without manager) still works:
```typescript
// In RenderDashboardCharts.vue
if (!variablesManager) {
  // Use legacy currentVariablesDataRef.__global mechanism
}
```
