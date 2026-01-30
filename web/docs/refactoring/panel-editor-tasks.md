# Panel Editor Refactoring - Detailed Task Breakdown

## Overview

This document breaks down the HLD into atomic, implementable tasks.

**Key Simplification**: `PanelEditor.vue` is a **SINGLE FILE** containing all common UI.
No sub-components - everything in one place for easier maintenance.

---

## Phase 1: Infrastructure Setup

### Task 1.1: Create Directory Structure
**Estimated: 5 minutes**
```
Create folders:
- src/components/dashboards/PanelEditor/
- src/components/dashboards/PanelEditor/composables/
- src/components/dashboards/PanelEditor/types/
```

### Task 1.2: Define TypeScript Interfaces
**File**: `types/panelEditor.ts`
**Estimated: 20 minutes**

Sub-tasks:
- 1.2.1: Define `PanelEditorPageType` type ('dashboard' | 'metrics' | 'logs')
- 1.2.2: Define `PanelEditorProps` interface (content area props only, NO header)
- 1.2.3: Define `PanelEditorEmits` type
- 1.2.4: Define `PanelEditorExpose` interface (methods exposed via ref)
- 1.2.5: Export all types

### Task 1.3: Define Preset Configurations
**File**: `types/panelEditor.ts` (continue)
**Estimated: 15 minutes**

Sub-tasks:
- 1.3.1: Define `DASHBOARD_PRESET` constant
- 1.3.2: Define `METRICS_PRESET` constant
- 1.3.3: Define `LOGS_PRESET` constant
- 1.3.4: Create `getPresetByPageType(pageType)` function

---

## Phase 2: Composable for Shared Logic

### Task 2.1: Create Combined Composable
**File**: `composables/usePanelEditor.ts`
**Estimated: 60 minutes**

This single composable handles all shared state and actions.

Sub-tasks:
- 2.1.1: Define function signature `usePanelEditor(pageType, config)`
- 2.1.2: Initialize `chartData` ref
- 2.1.3: Initialize `errorData` reactive object
- 2.1.4: Initialize `metaData` ref
- 2.1.5: Initialize `seriesData` ref
- 2.1.6: Initialize `lastTriggeredAt` ref
- 2.1.7: Initialize `showLegendsDialog` ref
- 2.1.8: Initialize `showAddToDashboardDialog` ref
- 2.1.9: Initialize warning refs (maxQueryRangeWarning, limitNumberOfSeriesWarningMessage, errorMessage)
- 2.1.10: Initialize loading state (disable, searchRequestTraceIds)

### Task 2.2: Add Action Functions
**File**: `composables/usePanelEditor.ts` (continue)
**Estimated: 45 minutes**

Sub-tasks:
- 2.2.1: Implement `runQuery(withoutCache)` - updates chartData
- 2.2.2: Implement `handleChartApiError(error)` - updates error state
- 2.2.3: Implement `handleLastTriggeredAtUpdate(data)` - updates timestamp
- 2.2.4: Implement `handleLimitNumberOfSeriesWarningMessage(msg)` - updates warning
- 2.2.5: Implement `handleResultMetadataUpdate(metadata)` - processes query metadata
- 2.2.6: Implement `collapseFieldList()` - toggles field list visibility
- 2.2.7: Implement `layoutSplitterUpdated()` - handles splitter changes
- 2.2.8: Implement `metaDataValue(metadata)` - updates metadata
- 2.2.9: Implement `seriesDataUpdate(data)` - updates series data
- 2.2.10: Implement `updateVrlFunctionFieldList(fieldList)` - updates VRL fields
- 2.2.11: Implement `onDataZoom(event)` - handles chart zoom (emits event for datetime update)

### Task 2.3: Add Computed Properties
**File**: `composables/usePanelEditor.ts` (continue)
**Estimated: 20 minutes**

Sub-tasks:
- 2.3.1: Implement `isOutDated` computed - compares chartData vs dashboardPanelData
- 2.3.2: Implement `isInitialDashboardPanelData` computed - checks if panel has data
- 2.3.3: Implement `currentPanelData` computed - for legends popup

### Task 2.4: Return All from Composable
**File**: `composables/usePanelEditor.ts` (continue)
**Estimated: 10 minutes**

Sub-tasks:
- 2.4.1: Return all state refs
- 2.4.2: Return all action functions
- 2.4.3: Return all computed properties

---

## Phase 3: Create PanelEditor.vue (Single File)

### Task 3.1: Component Setup
**File**: `PanelEditor.vue`
**Estimated: 20 minutes**

Sub-tasks:
- 3.1.1: Create component file with `<script setup lang="ts">`
- 3.1.2: Import types and composables
- 3.1.3: Define props using `defineProps<PanelEditorProps>()`
- 3.1.4: Define emits using `defineEmits<PanelEditorEmits>()`
- 3.1.5: Use `usePanelEditor` composable
- 3.1.6: Use `useDashboardPanelData` composable
- 3.1.7: Provide `dashboardPanelDataPageKey` for child components
- 3.1.8: Define `expose` for parent component access (runQuery, chartData, etc.)

### Task 3.2: Template - Root Structure
**File**: `PanelEditor.vue` (continue)
**Estimated: 15 minutes**

Sub-tasks:
- 3.2.1: Add root div with row layout
- 3.2.2: Add ChartSelection sidebar (left side)
- 3.2.3: Add vertical separator
- 3.2.4: Add main content area container

### Task 3.3: Template - Field List with Splitter
**File**: `PanelEditor.vue` (continue)
**Estimated: 25 minutes**

Sub-tasks:
- 3.3.1: Add collapsed field list sidebar (when hidden)
- 3.3.2: Add q-splitter for field list
- 3.3.3: Add FieldList component in `#before` slot
- 3.3.4: Add splitter separator with collapse/expand button
- 3.3.5: Wire up collapse/expand handlers

### Task 3.4: Template - Query Builder Section (Conditional)
**File**: `PanelEditor.vue` (continue)
**Estimated: 15 minutes**

Sub-tasks:
- 3.4.1: Add DashboardQueryBuilder (v-if="config.showQueryBuilder")
- 3.4.2: Add separator
- 3.4.3: Bind dashboardData prop

### Task 3.5: Template - Variables Section (Conditional)
**File**: `PanelEditor.vue` (continue)
**Estimated: 20 minutes**

Sub-tasks:
- 3.5.1: Add VariablesValueSelector (v-if="config.showVariablesSelector")
- 3.5.2: Bind all required props from parent
- 3.5.3: Emit variablesData event to parent
- 3.5.4: Emit openAddVariable event to parent

### Task 3.6: Template - Outdated Warning
**File**: `PanelEditor.vue` (continue)
**Estimated: 10 minutes**

Sub-tasks:
- 3.6.1: Add warning container (v-if="config.showOutdatedWarning && isOutDated")
- 3.6.2: Style with theme-aware colors
- 3.6.3: Add warning text

### Task 3.7: Template - Chart Area
**File**: `PanelEditor.vue` (continue)
**Estimated: 30 minutes**

Sub-tasks:
- 3.7.1: Add container with proper height (varies by pageType)
- 3.7.2: Add warning icons row (error, max query range, series limit)
- 3.7.3: Add last refreshed time (v-if="config.showLastRefreshedTime")
- 3.7.4: Add PanelSchemaRenderer with all bindings
- 3.7.5: Add "Add to Dashboard" button (v-if="config.showAddToDashboardButton")
- 3.7.6: Bind all PanelSchemaRenderer events

### Task 3.8: Template - Errors Component
**File**: `PanelEditor.vue` (continue)
**Estimated: 10 minutes**

Sub-tasks:
- 3.8.1: Add DashboardErrorsComponent
- 3.8.2: Bind errors prop
- 3.8.3: Position correctly

### Task 3.9: Template - Query Editor Section (Conditional)
**File**: `PanelEditor.vue` (continue)
**Estimated: 15 minutes**

Sub-tasks:
- 3.9.1: Add DashboardQueryEditor (v-if="config.showQueryEditor")
- 3.9.2: Set proper container height
- 3.9.3: Handle show/hide based on layout state

### Task 3.10: Template - Config Panel Sidebar
**File**: `PanelEditor.vue` (continue)
**Estimated: 15 minutes**

Sub-tasks:
- 3.10.1: Add PanelSidebar component
- 3.10.2: Add ConfigPanel inside sidebar
- 3.10.3: Bind all required props
- 3.10.4: Handle open/close state

### Task 3.11: Template - HTML Editor Section
**File**: `PanelEditor.vue` (continue)
**Estimated: 15 minutes**

Sub-tasks:
- 3.11.1: Add section (v-if="dashboardPanelData.data.type === 'html'")
- 3.11.2: Add VariablesValueSelector (v-if="config.showVariablesSelector")
- 3.11.3: Add CustomHTMLEditor
- 3.11.4: Add DashboardErrorsComponent
- 3.11.5: Style container

### Task 3.12: Template - Markdown Editor Section
**File**: `PanelEditor.vue` (continue)
**Estimated: 15 minutes**

Sub-tasks:
- 3.12.1: Add section (v-if="dashboardPanelData.data.type === 'markdown'")
- 3.12.2: Add VariablesValueSelector (v-if="config.showVariablesSelector")
- 3.12.3: Add CustomMarkdownEditor
- 3.12.4: Add DashboardErrorsComponent
- 3.12.5: Style container

### Task 3.13: Template - Custom Chart Editor Section
**File**: `PanelEditor.vue` (continue)
**Estimated: 25 minutes**

Sub-tasks:
- 3.13.1: Add section (v-if="dashboardPanelData.data.type === 'custom_chart'")
- 3.13.2: Add field list with splitter (same as regular charts)
- 3.13.3: Add q-splitter for editor/preview
- 3.13.4: Add CustomChartEditor in left
- 3.13.5: Add PanelSchemaRenderer in right
- 3.13.6: Add "Example Charts" button (v-if="pageType === 'dashboard'")
- 3.13.7: Add CustomChartTypeSelector dialog
- 3.13.8: Add query editor (v-if="config.showQueryEditor")
- 3.13.9: Add config panel sidebar

### Task 3.14: Template - Dialogs
**File**: `PanelEditor.vue` (continue)
**Estimated: 15 minutes**

Sub-tasks:
- 3.14.1: Add ShowLegendsPopup dialog
- 3.14.2: Add AddToDashboard dialog (v-if="config.showAddToDashboardButton")

### Task 3.15: Add Styles
**File**: `PanelEditor.vue` (continue)
**Estimated: 20 minutes**

Sub-tasks:
- 3.15.1: Copy common styles from AddPanel.vue
- 3.15.2: Add scoped styles
- 3.15.3: Ensure dark/light theme support

### Task 3.16: Add Watchers
**File**: `PanelEditor.vue` (continue)
**Estimated: 20 minutes**

Sub-tasks:
- 3.16.1: Watch chartType - update chartData on change
- 3.16.2: Watch config panel open/close - dispatch resize
- 3.16.3: Watch isOutDated - dispatch resize
- 3.16.4: Watch external chartData prop (logs mode) - sync to internal state
- 3.16.5: Watch loading state - update disable ref

### Task 3.17: Create Index Export
**File**: `PanelEditor/index.ts`
**Estimated: 5 minutes**

Sub-tasks:
- 3.17.1: Export PanelEditor component as default
- 3.17.2: Export types
- 3.17.3: Export composable

---

## Phase 4: Integration - Dashboard (AddPanel.vue)

### Task 4.1: Update AddPanel.vue - Imports
**File**: `views/Dashboards/addPanel/AddPanel.vue`
**Estimated: 15 minutes**

Sub-tasks:
- 4.1.1: Import PanelEditor component
- 4.1.2: Remove imports now handled by PanelEditor
- 4.1.3: Keep dashboard-specific imports (router, variables manager, etc.)

### Task 4.2: Update AddPanel.vue - Template
**File**: `views/Dashboards/addPanel/AddPanel.vue`
**Estimated: 30 minutes**

Sub-tasks:
- 4.2.1: Keep header section as-is (NOT part of PanelEditor)
- 4.2.2: Replace main content with `<PanelEditor ... />`
- 4.2.3: Pass pageType="dashboard"
- 4.2.4: Pass dashboard-specific props (dashboardData, variablesData, selectedDateTime)
- 4.2.5: Bind events (@variablesData, @openAddVariable, @dataZoom)
- 4.2.6: Get ref to PanelEditor for runQuery access
- 4.2.7: Keep AddSettingVariable drawer (outside PanelEditor)
- 4.2.8: Keep QueryInspector dialog (outside PanelEditor, uses metadata from ref)

### Task 4.3: Update AddPanel.vue - Script
**File**: `views/Dashboards/addPanel/AddPanel.vue`
**Estimated: 45 minutes**

Sub-tasks:
- 4.3.1: Keep route handling logic
- 4.3.2: Keep dashboard data fetching (loadDashboard)
- 4.3.3: Keep variables manager initialization
- 4.3.4: Keep save/discard functions (call panelEditorRef.value.chartData for saving)
- 4.3.5: Keep beforeUnload/beforeRouteLeave handlers
- 4.3.6: Keep AI chat handler registration
- 4.3.7: Keep context provider setup
- 4.3.8: Update runQuery to call panelEditorRef.value.runQuery()
- 4.3.9: Update Apply button to use panelEditorRef
- 4.3.10: Remove logic now handled by PanelEditor

### Task 4.4: Test AddPanel Integration
**Estimated: 60 minutes**

Sub-tasks:
- 4.4.1: Test panel creation (new panel)
- 4.4.2: Test panel editing (existing panel)
- 4.4.3: Test save functionality
- 4.4.4: Test discard functionality
- 4.4.5: Test all chart types
- 4.4.6: Test query builder drag-drop
- 4.4.7: Test query editor
- 4.4.8: Test variables
- 4.4.9: Test config panel
- 4.4.10: Test cancel query (enterprise)

---

## Phase 5: Integration - Metrics (Index.vue)

### Task 5.1: Update Metrics Index.vue - Imports
**File**: `plugins/metrics/Index.vue`
**Estimated: 10 minutes**

Sub-tasks:
- 5.1.1: Import PanelEditor component
- 5.1.2: Remove imports now handled by PanelEditor
- 5.1.3: Keep metrics-specific imports (SyntaxGuide, MetricLegends, AutoRefresh)

### Task 5.2: Update Metrics Index.vue - Template
**File**: `plugins/metrics/Index.vue`
**Estimated: 25 minutes**

Sub-tasks:
- 5.2.1: Keep header section as-is (with SyntaxGuide, MetricLegends, AutoRefresh)
- 5.2.2: Replace main content with `<PanelEditor ... />`
- 5.2.3: Pass pageType="metrics"
- 5.2.4: Pass empty variablesData ({})
- 5.2.5: Pass selectedDateTime from local date picker
- 5.2.6: Bind @addToDashboard event
- 5.2.7: Get ref to PanelEditor for runQuery access
- 5.2.8: Keep AddToDashboard dialog (triggered by event from PanelEditor)

### Task 5.3: Update Metrics Index.vue - Script
**File**: `plugins/metrics/Index.vue`
**Estimated: 30 minutes**

Sub-tasks:
- 5.3.1: Keep promql defaults setup in onMounted
- 5.3.2: Keep date picker state and handlers
- 5.3.3: Keep auto refresh interval state
- 5.3.4: Update runQuery to call panelEditorRef.value.runQuery()
- 5.3.5: Keep add to dashboard handler
- 5.3.6: Remove logic now handled by PanelEditor

### Task 5.4: Test Metrics Integration
**Estimated: 45 minutes**

Sub-tasks:
- 5.4.1: Test promql query mode
- 5.4.2: Test run query
- 5.4.3: Test auto refresh
- 5.4.4: Test add to dashboard
- 5.4.5: Test all chart types
- 5.4.6: Test config panel
- 5.4.7: Test cancel query (enterprise)

---

## Phase 6: Integration - Logs Visualization

### Task 6.1: Update VisualizeLogsQuery.vue - Imports
**File**: `plugins/logs/VisualizeLogsQuery.vue`
**Estimated: 10 minutes**

Sub-tasks:
- 6.1.1: Import PanelEditor component
- 6.1.2: Remove imports now handled by PanelEditor
- 6.1.3: Keep logs-specific imports

### Task 6.2: Update VisualizeLogsQuery.vue - Template
**File**: `plugins/logs/VisualizeLogsQuery.vue`
**Estimated: 20 minutes**

Sub-tasks:
- 6.2.1: Replace main content with `<PanelEditor ... />`
- 6.2.2: Pass pageType="logs"
- 6.2.3: Pass externalChartData prop (visualizeChartData)
- 6.2.4: Pass searchResponse prop
- 6.2.5: Pass isUiHistogram prop
- 6.2.6: Pass shouldRefreshWithoutCache prop
- 6.2.7: Pass allowedChartTypes array
- 6.2.8: Bind @chartApiError event (forward to parent)
- 6.2.9: Bind @addToDashboard event

### Task 6.3: Update VisualizeLogsQuery.vue - Script
**File**: `plugins/logs/VisualizeLogsQuery.vue`
**Estimated: 25 minutes**

Sub-tasks:
- 6.3.1: Keep props definitions
- 6.3.2: Keep chart type validation logic (SELECT * check)
- 6.3.3: Keep histogram query conversion for addToDashboard
- 6.3.4: Forward chartApiError to parent emit
- 6.3.5: Remove logic now handled by PanelEditor

### Task 6.4: Test Logs Visualization Integration
**Estimated: 30 minutes**

Sub-tasks:
- 6.4.1: Test with search response data
- 6.4.2: Test chart type switching
- 6.4.3: Test chart type validation (SELECT *)
- 6.4.4: Test add to dashboard
- 6.4.5: Test config panel
- 6.4.6: Test field list

---

## Phase 7: Final Cleanup and Testing

### Task 7.1: Remove Dead Code
**Estimated: 30 minutes**

Sub-tasks:
- 7.1.1: Remove unused imports from AddPanel.vue
- 7.1.2: Remove unused imports from Metrics Index.vue
- 7.1.3: Remove unused imports from VisualizeLogsQuery.vue
- 7.1.4: Run ESLint to catch unused variables
- 7.1.5: Remove any orphaned helper functions

### Task 7.2: Style Consolidation
**Estimated: 20 minutes**

Sub-tasks:
- 7.2.1: Verify PanelEditor has all needed styles
- 7.2.2: Remove duplicate styles from wrapper files
- 7.2.3: Verify dark/light theme works on all pages
- 7.2.4: Verify responsive behavior

### Task 7.3: Documentation
**Estimated: 30 minutes**

Sub-tasks:
- 7.3.1: Add JSDoc comments to composable
- 7.3.2: Add component documentation header
- 7.3.3: Add usage examples in comments
- 7.3.4: Update this HLD with final implementation notes

### Task 7.4: Comprehensive E2E Testing
**Estimated: 90 minutes**

Sub-tasks:
- 7.4.1: Full AddPanel workflow (create, edit, save, discard)
- 7.4.2: Full Metrics workflow
- 7.4.3: Full Logs Visualization workflow
- 7.4.4: Test all chart types in all three modes
- 7.4.5: Test enterprise features (cancel query)
- 7.4.6: Test error scenarios
- 7.4.7: Test edge cases (empty data, large data)
- 7.4.8: Cross-browser testing

---

## Summary

### Total Tasks: ~55 atomic tasks (reduced from 115+)
### Estimated Total Time: ~15-18 hours (reduced from 25-30)

### New Files to Create:
1. `src/components/dashboards/PanelEditor/types/panelEditor.ts`
2. `src/components/dashboards/PanelEditor/composables/usePanelEditor.ts`
3. `src/components/dashboards/PanelEditor/PanelEditor.vue`
4. `src/components/dashboards/PanelEditor/index.ts`

### Files to Modify:
1. `src/views/Dashboards/addPanel/AddPanel.vue`
2. `src/plugins/metrics/Index.vue`
3. `src/plugins/logs/VisualizeLogsQuery.vue`

### Implementation Order:
1. Phase 1 (Infrastructure) - Types and structure
2. Phase 2 (Composable) - Shared logic
3. Phase 3 (PanelEditor.vue) - Single component file
4. Phase 4-6 (Integration) - One page at a time
5. Phase 7 (Cleanup) - Polish and testing

---

## Quick Reference

### Props (PanelEditor.vue)
```typescript
interface PanelEditorProps {
  pageType: 'dashboard' | 'metrics' | 'logs';

  // Content config
  showQueryEditor?: boolean;           // default: true
  showQueryBuilder?: boolean;          // default: true
  showVariablesSelector?: boolean;     // default: false
  showLastRefreshedTime?: boolean;     // default: true
  showOutdatedWarning?: boolean;       // default: true
  showAddToDashboardButton?: boolean;  // default: false

  // Chart config
  allowedChartTypes?: string[];        // default: all

  // External data (logs mode)
  externalChartData?: object;
  searchResponse?: object;
  isUiHistogram?: boolean;
  shouldRefreshWithoutCache?: boolean;

  // Dashboard mode
  selectedDateTime?: object;
  variablesData?: object;
  dashboardData?: object;

  // Mode
  editMode?: boolean;
}
```

### Exposed Methods (via ref)
```typescript
interface PanelEditorExpose {
  runQuery: (withoutCache?: boolean) => void;
  chartData: Ref<object>;
  errorData: Ref<{ errors: string[] }>;
  metaData: Ref<object>;
  dashboardPanelData: object;  // From useDashboardPanelData
}
```

### Events
```
@variablesData - When variables are updated (dashboard mode)
@openAddVariable - When "Add Variable" is clicked (dashboard mode)
@addToDashboard - When "Add to Dashboard" is clicked
@chartApiError - When chart API returns error
@dataZoom - When user zooms on chart (for datetime update)
```
