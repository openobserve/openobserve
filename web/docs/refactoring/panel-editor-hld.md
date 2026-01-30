# Panel Editor Component Refactoring - High Level Design

## 1. Executive Summary

This document outlines the refactoring plan to consolidate three similar Vue components into a unified, configurable parent component:

1. `AddPanel.vue` - Dashboard panel editor (full-featured)
2. `Index.vue` (Metrics) - Metrics visualization page
3. `VisualizeLogsQuery.vue` - Logs query visualization

**Goal**: Create a single `PanelEditor.vue` component that handles all three use cases through props-based configuration while maintaining 100% behavioral and UI/UX parity with the current implementation.

---

## 2. Current State Analysis

### 2.1 Common Components Used Across All Three

| Component | AddPanel | Metrics | VisualizeLogsQuery |
|-----------|----------|---------|-------------------|
| ChartSelection | ✅ | ✅ | ✅ |
| FieldList | ✅ | ✅ | ✅ |
| PanelSidebar | ✅ | ✅ | ✅ |
| ConfigPanel | ✅ | ✅ | ✅ |
| PanelSchemaRenderer | ✅ | ✅ | ✅ |
| DashboardErrorsComponent | ✅ | ✅ | ✅ |
| CustomHTMLEditor | ✅ | ✅ | ✅ |
| CustomMarkdownEditor | ✅ | ✅ | ✅ |
| CustomChartEditor | ✅ | ✅ | ✅ |
| ShowLegendsPopup | ✅ | ✅ | ✅ |
| q-splitter (field list) | ✅ | ✅ | ✅ |

### 2.2 Components Unique to Specific Pages

| Component | AddPanel | Metrics | VisualizeLogsQuery |
|-----------|----------|---------|-------------------|
| DashboardQueryBuilder | ✅ | ✅ | ❌ |
| DashboardQueryEditor | ✅ | ✅ | ❌ |
| DateTimePickerDashboard | ✅ | ✅ | ❌ (external) |
| VariablesValueSelector | ✅ | ❌ | ❌ |
| AddSettingVariable | ✅ | ❌ | ❌ |
| AutoRefreshInterval | ❌ | ✅ | ❌ |
| SyntaxGuideMetrics | ❌ | ✅ | ❌ |
| MetricLegends | ❌ | ✅ | ❌ |
| AddToDashboard | ❌ | ✅ | ✅ |
| QueryInspector | ✅ | ❌ | ❌ |
| RelativeTime | ✅ | ✅ | ❌ |

### 2.3 Behavioral Differences

#### Header Actions
| Feature | AddPanel | Metrics | VisualizeLogsQuery |
|---------|----------|---------|-------------------|
| Panel Name Input | ✅ | ❌ | ❌ |
| Tutorial Button | ✅ | ❌ | ❌ |
| Query Inspector | ✅ | ❌ | ❌ |
| Date Time Picker | ✅ | ✅ | ❌ |
| Discard Button | ✅ | ❌ | ❌ |
| Save Button | ✅ | ❌ | ❌ |
| Apply Button | ✅ | ✅ (Run Query) | ❌ |
| Cancel Button | ✅ (Enterprise) | ✅ (Enterprise) | ❌ |
| Auto Refresh | ❌ | ✅ | ❌ |
| Add to Dashboard | ❌ | ✅ | ✅ |

#### Content Area
| Feature | AddPanel | Metrics | VisualizeLogsQuery |
|---------|----------|---------|-------------------|
| Query Editor Section | ✅ | ✅ | ❌ |
| Variables Selector | ✅ | ❌ | ❌ |
| "Out of Date" Warning | ✅ | ✅ | ✅ |
| Last Refreshed Time | ✅ | ✅ | ❌ |
| Chart Height | calc(100vh-500px) | calc(100vh-500px) | calc(100%-36px) |

#### Data Flow
| Feature | AddPanel | Metrics | VisualizeLogsQuery |
|---------|----------|---------|-------------------|
| Uses Route Query | ✅ | ❌ | ❌ |
| Uses Vuex Store | ✅ | ✅ | ✅ |
| Receives Props | ❌ | ❌ | ✅ (visualizeChartData, searchResponse) |
| Emits Events | ❌ | ❌ | ✅ (handleChartApiError) |
| Dashboard Data Source | API fetch | None | None |
| Variables Manager | ✅ | ❌ | ❌ |

### 2.4 Default Values per Page

| Setting | AddPanel | Metrics | VisualizeLogsQuery |
|---------|----------|---------|-------------------|
| Default Chart Type | (preserved) | line | (preserved) |
| Query Type | sql | promql | sql |
| Stream Type | logs | metrics | logs |
| Custom Query | false | false | true |
| Show Query Bar | (preserved) | true | false |

---

## 3. Proposed Architecture

### 3.1 Component Structure

**Important Decisions**:
1. **Single File**: `PanelEditor.vue` is ONE file containing all common UI (no sub-components)
2. **Headers NOT included**: Each page keeps its own header (fundamentally different)
3. **Composables for logic**: Shared logic extracted to composables for reusability

```
src/components/dashboards/
├── PanelEditor/
│   ├── PanelEditor.vue              # Single file with all common UI
│   ├── composables/
│   │   └── usePanelEditor.ts        # Combined composable for state & actions
│   └── types/
│       └── panelEditor.ts           # TypeScript interfaces
```

**Why single file?**
- Easier to understand and maintain
- All conditional logic in one place
- No prop drilling between sub-components
- Direct access to all reactive state

**Visual Structure**:
```
┌─────────────────────────────────────────────────────────────┐
│  HEADER - Stays in wrapper (AddPanel/Metrics/Logs)          │
│  NOT part of PanelEditor                                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │     PanelEditor.vue (SINGLE FILE)                    │   │
│  │  ┌─────┬─────────────────────────────────────┬────┐ │   │
│  │  │Chart│  ┌────────┬────────────────────┐    │Conf│ │   │
│  │  │Types│  │ Field  │ Query Builder      │    │ig  │ │   │
│  │  │     │  │ List   ├────────────────────┤    │Side│ │   │
│  │  │     │  │        │ Variables (opt)    │    │bar │ │   │
│  │  │     │  │        ├────────────────────┤    │    │ │   │
│  │  │     │  │        │ Chart Area         │    │    │ │   │
│  │  │     │  │        ├────────────────────┤    │    │ │   │
│  │  │     │  │        │ Errors             │    │    │ │   │
│  │  │     │  │        ├────────────────────┤    │    │ │   │
│  │  │     │  │        │ Query Editor (opt) │    │    │ │   │
│  │  └─────┴──┴────────┴────────────────────┴────┴────┘ │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Props Interface

```typescript
interface PanelEditorProps {
  // Page identification
  pageType: 'dashboard' | 'metrics' | 'logs';

  // Content configuration (NO header props - headers stay in wrappers)
  showQueryEditor?: boolean;           // default: true
  showQueryBuilder?: boolean;          // default: true
  showVariablesSelector?: boolean;     // default: false
  showLastRefreshedTime?: boolean;     // default: true
  showOutdatedWarning?: boolean;       // default: true
  showAddToDashboardButton?: boolean;  // default: false (inside chart area)

  // Chart configuration
  allowedChartTypes?: string[];        // default: all types

  // Data props (for logs visualization)
  externalChartData?: object;          // For VisualizeLogsQuery
  searchResponse?: object;             // For VisualizeLogsQuery
  isUiHistogram?: boolean;             // default: false
  shouldRefreshWithoutCache?: boolean; // default: false

  // DateTime (passed from parent's DateTimePicker)
  selectedDateTime?: object;           // { start_time, end_time }

  // Variables data (passed from parent's VariablesSelector)
  variablesData?: object;              // For dashboard mode

  // Mode flags
  editMode?: boolean;                  // default: false

  // Dashboard data (for query builder)
  dashboardData?: object;              // For dashboard mode
}
```

**Note**: Header-related props (save, discard, apply buttons, date picker, etc.) are NOT part of this interface.
Each wrapper component manages its own header UI and calls appropriate methods on PanelEditor via refs or events.

### 3.3 Preset Configurations

```typescript
// Configuration presets for each page type (content area only, NO header config)
const PANEL_EDITOR_PRESETS = {
  dashboard: {
    showQueryEditor: true,
    showQueryBuilder: true,
    showVariablesSelector: true,
    showLastRefreshedTime: true,
    showOutdatedWarning: true,
    showAddToDashboardButton: false,  // Dashboard has Save button instead
  },
  metrics: {
    showQueryEditor: true,
    showQueryBuilder: true,
    showVariablesSelector: false,
    showLastRefreshedTime: true,
    showOutdatedWarning: true,
    showAddToDashboardButton: true,   // Show inside chart area
  },
  logs: {
    showQueryEditor: false,           // No query editor in visualization
    showQueryBuilder: false,          // No query builder in visualization
    showVariablesSelector: false,
    showLastRefreshedTime: false,
    showOutdatedWarning: true,
    showAddToDashboardButton: true,   // Show inside chart area
  },
};
```

**Header configurations are NOT presets** - each wrapper component (AddPanel.vue, Metrics/Index.vue)
builds its own header with the specific components it needs.

---

## 4. Migration Strategy

**Simplified Approach**: Single `PanelEditor.vue` file (no sub-components).

### Phase 1: Infrastructure Setup
1. Create directory structure
2. Create type definitions
3. Create combined composable (`usePanelEditor.ts`)

### Phase 2: Create PanelEditor Component
4. Create single `PanelEditor.vue` with all common UI
5. Implement props-based conditional rendering
6. Add all template sections (chart types, field list, chart area, etc.)

### Phase 3: Integration
7. Update `AddPanel.vue` to use `PanelEditor.vue` (keep header)
8. Update `Metrics/Index.vue` to use `PanelEditor.vue` (keep header)
9. Update `VisualizeLogsQuery.vue` to use `PanelEditor.vue`

### Phase 4: Cleanup
10. Remove deprecated code from wrappers
11. Final testing and verification

---

## 5. Detailed Task Breakdown

**Note**: See `panel-editor-tasks.md` for full atomic task list.

### Task 1: Create Type Definitions
**File**: `src/components/dashboards/PanelEditor/types/panelEditor.ts`
- Define `PanelEditorProps` interface
- Define `PanelEditorEmits` type
- Define `PanelEditorExpose` interface
- Define preset constants

### Task 2: Create Combined Composable
**File**: `src/components/dashboards/PanelEditor/composables/usePanelEditor.ts`
- All shared state (chartData, errorData, metaData, seriesData, etc.)
- All action functions (runQuery, handleChartApiError, collapseFieldList, etc.)
- All computed properties (isOutDated, currentPanelData, etc.)

### Task 3: Create PanelEditor.vue (SINGLE FILE)
**File**: `src/components/dashboards/PanelEditor/PanelEditor.vue`
- ChartSelection sidebar
- Field list with splitter
- Query builder section (conditional)
- Variables selector (conditional)
- Outdated warning
- Chart area with PanelSchemaRenderer
- Warning icons and last refreshed time
- Error display
- Query editor section (conditional)
- Config panel sidebar
- HTML/Markdown/CustomChart editor sections
- Dialogs (legends, add to dashboard)

### Task 4: Update AddPanel.vue
- Keep header (panel name, tutorial, query inspector, date picker, save/discard/apply)
- Replace content area with `<PanelEditor pageType="dashboard" ... />`
- Keep dashboard-specific logic (route, variables, save)
- Use ref to access PanelEditor methods

### Task 5: Update Metrics/Index.vue
- Keep header (title, syntax guide, metric legends, date picker, auto refresh, run query)
- Replace content area with `<PanelEditor pageType="metrics" ... />`
- Keep metrics-specific logic (promql defaults, auto refresh)

### Task 6: Update VisualizeLogsQuery.vue
- Replace content with `<PanelEditor pageType="logs" ... />`
- Pass external data props
- Keep logs-specific logic (chart type validation, histogram conversion)

### Task 7: Clean Up and Testing
- Remove any dead code from wrapper files
- Update all imports
- Comprehensive testing of all three pages
- Verify no regressions

---

## 6. Risk Mitigation

### 6.1 Behavioral Parity Verification Checklist

For each page (AddPanel, Metrics, VisualizeLogsQuery):

- [ ] Chart types render correctly
- [ ] Field list expand/collapse works
- [ ] Config panel opens/closes correctly
- [ ] Query builder functions properly
- [ ] Query editor shows/hides correctly
- [ ] Date time picker works
- [ ] Apply/Run Query triggers correctly
- [ ] Error handling works
- [ ] Variables work (AddPanel only)
- [ ] Save/Discard work (AddPanel only)
- [ ] Add to Dashboard works (Metrics, Logs)
- [ ] Auto refresh works (Metrics only)
- [ ] Custom chart editor works
- [ ] HTML editor works
- [ ] Markdown editor works
- [ ] Splitter resize triggers chart resize
- [ ] Out-of-date warning shows correctly
- [ ] Cancel query works (Enterprise)
- [ ] Legends popup works

### 6.2 Rollback Strategy

Keep original files intact during development:
1. Create new components in new directory
2. Use feature flag or route-based switching during testing
3. Only remove original files after verification

---

## 7. File Changes Summary

### New Files to Create (4 files only)
1. `src/components/dashboards/PanelEditor/types/panelEditor.ts` - Type definitions
2. `src/components/dashboards/PanelEditor/composables/usePanelEditor.ts` - Combined composable
3. `src/components/dashboards/PanelEditor/PanelEditor.vue` - **SINGLE FILE** with all common UI
4. `src/components/dashboards/PanelEditor/index.ts` - Exports

### Files to Modify
1. `src/views/Dashboards/addPanel/AddPanel.vue` - Use PanelEditor, keep header
2. `src/plugins/metrics/Index.vue` - Use PanelEditor, keep header
3. `src/plugins/logs/VisualizeLogsQuery.vue` - Use PanelEditor

### Files NOT Created (simplified approach)
- ~~PanelEditorHeader.vue~~ - Headers stay in wrapper components
- ~~PanelEditorChart.vue~~ - Part of PanelEditor.vue
- ~~PanelEditorContent.vue~~ - Part of PanelEditor.vue
- ~~usePanelEditorConfig.ts~~ - Merged into usePanelEditor.ts
- ~~usePanelEditorState.ts~~ - Merged into usePanelEditor.ts
- ~~usePanelEditorActions.ts~~ - Merged into usePanelEditor.ts

---

## 8. Testing Strategy

### Unit Tests
- Test each composable function independently
- Test configuration merging
- Test prop validation

### Integration Tests
- Test PanelEditor with each preset
- Verify component rendering based on props

### E2E Tests (Manual/Automated)
- Full workflow test for AddPanel
- Full workflow test for Metrics
- Full workflow test for Logs Visualization

---

## 9. Implementation Order

```
Phase 1: Tasks 1-2 (Infrastructure - types & composable) - ~2 hours
Phase 2: Task 3 (PanelEditor.vue - single file) - ~4-5 hours
Phase 3: Tasks 4-6 (Integration - one page at a time) - ~4-5 hours
Phase 4: Task 7 (Cleanup & testing) - ~3-4 hours

Total: ~15-18 hours
```

---

## 10. Appendix: CSS/Style Considerations

All three components share similar styling. The new components should:
1. Use existing SCSS variables
2. Maintain current class naming where possible
3. Keep responsive behaviors identical
4. Preserve dark/light theme support

Key CSS classes to preserve:
- `.card-container`
- `.layout-panel-container`
- `.field-list-sidebar-header-collapsed`
- `.splitter-vertical`, `.splitter-enabled`
- `.splitter-icon-expand`, `.splitter-icon-collapse`
- `.lastRefreshedAt`, `.lastRefreshedAtIcon`
- `.warning` (for error icons)

---

## 11. Design Decisions Made

1. **Q**: Should we create a common header component?
   **A**: NO - Headers are fundamentally different (AddPanel has save/discard, Metrics has auto-refresh, Logs has no header). Each wrapper keeps its own header.

2. **Q**: Should we split into multiple sub-components?
   **A**: NO - Single `PanelEditor.vue` file is simpler to maintain. All conditional logic in one place.

3. **Q**: How to handle page-specific watchers (e.g., route watchers in AddPanel)?
   **A**: Keep in wrapper components; only common watchers in PanelEditor.

4. **Q**: How do wrappers communicate with PanelEditor?
   **A**: Via `ref` - PanelEditor exposes `runQuery()`, `chartData`, `dashboardPanelData`, etc.

---

## 12. Success Criteria

1. Zero visual/UX differences from current implementation
2. Zero behavioral differences from current implementation
3. Reduced code duplication (target: ~60% reduction)
4. Easier maintenance for future features
5. All existing tests pass
6. No performance regression
