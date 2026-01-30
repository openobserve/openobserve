# PanelEditor Testing Checklist

This document lists all test cases based on the original behavior of the three refactored components:
- `AddPanel.vue` (Dashboard panel editor)
- `Metrics/Index.vue` (Metrics visualization)
- `VisualizeLogsQuery.vue` (Logs visualization)

---

## 1. Chart Type Selection

### 1.1 Dashboard (AddPanel)
- [x] All chart types are visible and selectable
- [x] Selecting a chart type updates the panel configuration
- [x] Selecting a chart type resets aggregation functions
- [x] HTML, Markdown, and Custom Chart types show their respective editors
- [x] Switching between chart types preserves query configuration where applicable

### 1.2 Metrics Page
- [x] All chart types are visible and selectable
- [x] Chart type change triggers appropriate UI updates
- [x] Chart type change automatically updates chartData (via watch)
- [x] Aggregation functions reset on chart type change

### 1.3 Logs Visualization
- [x] Only allowed chart types are visible: `area`, `bar`, `h-bar`, `line`, `scatter`, `table`
- [x] Other chart types (pie, donut, metric, gauge, html, markdown, etc.) are NOT shown
- [x] Chart type change automatically updates chartData (via watch)
- [x] SELECT * query shows error when trying to switch chart types (if quick_mode_enabled)
- [x] **Critical**: `allowedchartstype` prop correctly passed to ChartSelection (lowercase prop name)

---

## 2. Field List Panel

### 2.1 Visibility Toggle
- [x] Field list can be collapsed by clicking the chevron button
- [x] Field list can be expanded by clicking the collapsed "Fields" sidebar
- [x] Clicking collapse button sets splitter to 0 and hides field list
- [x] Clicking expand button sets splitter to 20 and shows field list
- [x] Splitter drag adjusts field list width
- [x] **Watch behavior**: When splitter > 0 and field list hidden, auto-shows field list
- [x] **Watch behavior**: When splitter = 0 and field list shown, auto-hides field list
- [x] **Chevron icon direction**: When field list is SHOWN, icon is `chevron_left`
- [x] **Chevron icon direction**: When field list is HIDDEN, icon is `chevron_right`
- [x] **Splitter icon class**: When shown, class is `splitter-icon-collapse`
- [x] **Splitter icon class**: When hidden, class is `splitter-icon-expand`

### 2.2 Field List Content
- [x] Stream type selector is visible
- [x] Stream selector is visible
- [x] Field search input works
- [x] Fields are listed with correct types (icons)
- [x] Fields can be dragged to X, Y, Z, Breakdown axes
- [x] VRL function fields are shown when applicable
- [x] **StreamFieldSelect**: Stream field autocomplete works
- [x] **CommonAutoComplete**: Autocomplete components work throughout
- [x] **BuildFieldPopUp**: Field builder popup opens when configuring derived fields

### 2.3 Page-Specific Behavior
- [x] **Dashboard**: Field list uses `contentHeight` for height calculation
- [x] **Metrics**: Field list uses `contentHeight` for height calculation
- [x] **Logs**: Field list uses `height: 100%` (fills available space)

---

## 3. Query Builder

### 3.1 Dashboard Only
- [x] Query builder is visible on dashboard page
- [x] X-axis field selection works
- [x] Y-axis field selection works
- [x] Z-axis field selection works (for supported charts)
- [x] Breakdown field selection works
- [x] Filter conditions can be added/removed
- [x] Multiple queries can be added (query tabs)
- [x] Query joins can be configured
- [x] **Geomap charts**: DashboardGeoMapsQueryBuilder is shown for geomap type
- [x] **Sankey charts**: DashboardSankeyChartBuilder is shown for sankey type
- [x] **Map charts**: DashboardMapsQueryBuilder is shown for map types
- [x] **PromQL mode**: Shows PromQL-specific query builder for promql queryType
- [x] QueryTypeSelector allows switching between SQL and PromQL

### 3.2 Metrics
- [x] Query builder IS visible on metrics page (METRICS_PRESET has showQueryBuilder: true)
- [x] X-axis, Y-axis, Z-axis, Breakdown field selection works (same as dashboard)

### 3.3 Logs
- [x] Query builder is NOT visible on logs visualization page (LOGS_PRESET has showQueryBuilder: false)

---

## 4. Variables Selector

### 4.1 Dashboard Only
- [x] Variables selector is visible when dashboard has variables
- [x] Variable values can be selected
- [x] Variable changes trigger chart update (if auto-apply)
- [x] "Add Variable" button is visible
- [x] Dynamic filters work when enabled

### 4.2 Metrics/Logs
- [x] Variables selector is NOT visible on metrics page
- [x] Variables selector is NOT visible on logs visualization page

---

## 5. Query Editor

### 5.1 Dashboard Only
- [x] Query editor toggle button works
- [x] Query editor can be expanded/collapsed
- [x] SQL query is editable
- [x] Custom query mode can be toggled
- [x] Query splitter adjusts editor height

### 5.2 Metrics
- [x] Query editor IS visible on metrics page (METRICS_PRESET has showQueryEditor: true)
- [x] Query splitter adjusts editor height

### 5.3 Logs
- [x] Query editor is NOT visible on logs visualization page (LOGS_PRESET has showQueryEditor: false)

---

## 6. Chart Rendering (PanelSchemaRenderer)

### 6.1 All Pages
- [x] Chart renders correctly with data
- [x] Chart updates when data changes
- [x] Chart shows loading state during query
- [x] Chart shows error state on query failure
- [x] Chart zoom (data zoom) works and emits events
- [x] Legends button shows legends popup
- [x] **searchType**: Dashboard uses "dashboards", Metrics/Logs use "ui"

### 6.2 Dashboard
- [x] Annotations can be added (when editMode=true)
- [x] **AddAnnotation** component opens when adding annotation
- [x] Annotation markers appear on chart after creation
- [x] Alert creation is NOT available (allowAlertCreation=false)

### 6.3 Metrics
- [x] Annotations cannot be added
- [x] Alert creation IS available

### 6.4 Logs
- [x] Annotations cannot be added
- [x] Alert creation is NOT available
- [x] External chart data (from logs search) is displayed

---

## 7. Config Panel (Right Sidebar)

### 7.1 Visibility Toggle
- [x] Config panel can be collapsed by clicking the chevron
- [x] Config panel can be expanded by clicking "Config" text
- [x] Panel width adjusts when config panel is toggled
- [x] Window resize event is triggered when config panel is toggled (chart resizes)

### 7.2 Config Options
- [x] Chart title can be edited
- [x] Chart description can be edited
- [x] Unit selection works
- [x] Custom unit input works
- [x] Axis configuration works (labels, scale, etc.)
- [x] Legend configuration works
- [x] Color/theme options work
- [x] Chart-specific options are shown based on chart type

### 7.4 Config Panel Nested Components
- [x] **ColorPaletteDropDown**: Color palette selection works
- [x] **ColorBySeries**: Series-specific colors can be configured
- [x] **ColorBySeriesPopUp**: Series color popup opens and saves
- [x] **BackGroundColorConfig**: Background color configuration works
- [x] **ValueMapping**: Value-to-text mapping configuration works
- [x] **ValueMappingPopUp**: Value mapping popup opens and saves
- [x] **MarkLineConfig**: Mark lines can be added/configured
- [x] **OverrideConfig**: Field overrides can be configured
- [x] **Drilldown**: Drilldown configuration works
- [x] **DrilldownPopUp**: Drilldown popup opens
- [x] **DrilldownUserGuide**: Drilldown help is accessible
- [x] **SortByBtnGrp**: Sort options work for table charts
- [x] **ColumnOrderPopUp**: Column ordering works for table charts
- [x] **HistogramIntervalDropDown**: Histogram interval selection works
- [x] **PromQLChartConfig**: PromQL-specific config shown for promql charts

### 7.3 Config Auto-Apply
- [x] Visual-only config changes (colors, labels, legend position) auto-apply immediately
- [x] Config changes requiring API call show "not up to date" warning
- [x] Clicking "Apply" updates the chart with pending changes

---

## 8. "Not Up To Date" Warning

### 8.1 All Pages
- [x] Warning appears when panel config differs from rendered chart
- [x] Warning shows appropriate message
- [x] Warning disappears after clicking "Run Query" / "Apply"
- [x] Window resize event is triggered when warning appears/disappears (chart resizes)

---

## 9. Error/Warning Display

### 9.1 Error Messages
- [x] API errors are displayed in error component
- [x] Query syntax errors are shown
- [x] Multiple errors can be displayed

### 9.2 Warning Icons
- [x] Error warning icon appears with tooltip
- [x] Max query range warning appears when applicable
- [x] Limit number of series warning appears when applicable

### 9.3 Last Refreshed Time
- [x] **Dashboard**: Last refreshed time is shown
- [x] **Metrics**: Last refreshed time is shown
- [x] **Logs**: Last refreshed time is NOT shown (uses external trigger)

---

## 10. Add To Dashboard Button

### 10.1 Metrics Page
- [x] "Add To Dashboard" button is visible
- [x] Clicking opens the Add To Dashboard dialog
- [x] Panel validation runs before opening dialog
- [x] Validation errors prevent dialog from opening

### 10.2 Logs Visualization
- [x] "Add To Dashboard" button is visible
- [x] Clicking opens the Add To Dashboard dialog
- [x] Panel validation runs before opening dialog
- [x] Histogram query conversion works for UI histogram

### 10.3 Dashboard
- [x] "Add To Dashboard" button is NOT visible (already in dashboard context)

---

## 11. Run Query Button

### 11.1 Dashboard
- [x] "Run Query" button triggers query execution
- [x] Dropdown shows "Run Query" and "Run Query (no cache)" options
- [x] Query execution updates chart data

### 11.2 Metrics
- [x] "Run Query" button triggers query execution
- [x] Query execution updates chart data

### 11.3 Logs
- [x] Run query is triggered externally (from logs search page)
- [x] No explicit run query button in visualization component

---

## 12. Legends Popup

### 12.1 All Pages
- [x] Legends button appears on chart
- [x] Clicking opens legends popup dialog
- [x] Legends show series names and colors
- [x] Series can be toggled on/off
- [x] Dialog can be closed

---

## 13. HTML/Markdown/Custom Chart Editors

### 13.1 HTML Editor (Dashboard Only)
- [x] HTML editor is shown when chart type is "html"
- [x] HTML content can be edited
- [x] Preview updates as content changes
- [x] Variables selector is shown above editor

### 13.2 Markdown Editor (Dashboard Only)
- [x] Markdown editor is shown when chart type is "markdown"
- [x] Markdown content can be edited
- [x] Preview updates as content changes
- [x] Variables selector is shown above editor

### 13.3 Custom Chart Editor (Dashboard Only)
- [x] Custom chart editor is shown when chart type is "custom_chart"
- [x] Template selector allows choosing predefined templates
- [x] JavaScript code can be edited
- [x] Chart preview updates

---

## 14. Layout and Styling

### 14.1 Dashboard/Metrics Layout
- [x] Row has `overflow-y: auto`
- [x] Main content uses horizontal flex layout (`display: flex; flexDirection: row`)
- [x] Splitter limits are `[0, 20]`
- [x] **Dashboard** content height: `calc(100vh - 110px)`
- [x] **Metrics** content height: `calc(100vh - 106px)`
- [x] Chart area class: `tw:h-[calc(100vh-500px)] tw:min-h-[140px] tw:mt-[40px]`
- [x] After slot inner class: `col scroll` (with overflow)
- [x] Field list wrapper has padding-bottom
- [x] Padding/margins are consistent

### 14.2 Logs Layout
- [x] Row has `height: 100%`
- [x] Main content uses vertical flex layout (`col flex column`)
- [x] Main content has `width: 100%; height: 100%`
- [x] Splitter limits are `[0, 100]`
- [x] Splitter has `width: 100%; height: 100%`
- [x] **afterSlotStyle**: When field list is shown, width is `100%`
- [x] **afterSlotStyle**: When field list is hidden, width is `calc(100% - 58px)`
- [x] Chart area class: `tw:h-[calc(100%-36px)] tw:min-h-[140px]` (no margin-top)
- [x] After slot inner class: `col` (NOT `col scroll`)
- [x] After slot inner style: `height: 100%` (NOT contentHeight with overflow)
- [x] Layout panel container style: `height: 100%`
- [x] All inner containers have `height: 100%`
- [x] No padding-bottom on field list wrapper
- [x] Field list inner div: `width: 100%; height: 100%`
- [x] Card container background is applied correctly

---

## 15. Keyboard/Interaction

### 15.1 All Pages
- [x] Splitter drag works smoothly
- [x] Click events on buttons work
- [x] Tooltips appear on hover
- [x] Dialog close on escape key

---

## 16. Data Flow

### 16.1 Dashboard
- [x] `dashboardPanelData` is shared via composable (keyed by "dashboard")
- [x] Changes in panel data are reactive
- [x] Parent component can access exposed methods/properties

### 16.2 Metrics
- [x] `dashboardPanelData` is shared via composable (keyed by "metrics")
- [x] Changes in panel data are reactive
- [x] Parent component can access exposed methods/properties

### 16.3 Logs
- [x] `dashboardPanelData` is shared via composable (keyed by "logs")
- [x] External chart data prop syncs to internal chartData state (via watch)
- [x] Watch fires immediately when externalChartData is set (`immediate: true`)
- [x] Changes in panel data are reactive
- [x] isOutDated returns false when externalChartData is provided (no comparison)
- [x] Parent component can access exposed methods/properties (metaData, etc.)

---

## 17. Exposed Properties/Methods

### 17.1 All Pages (via ref)
- [x] `metaData` - Query metadata is accessible
- [x] `runQuery()` - Can trigger query execution
- [x] `resetErrors()` - Can reset error state
- [x] `collapseFieldList()` - Can toggle field list visibility
- [x] `updateDateTime()` - Can update datetime for queries
- [x] `cancelRunningQuery()` - Can cancel running queries
- [x] `chartData` - Current chart data is accessible
- [x] `errorData` - Error state is accessible
- [x] `seriesData` - Series data from chart is accessible
- [x] `lastTriggeredAt` - Timestamp of last query execution is accessible
- [x] `dashboardPanelData` - Panel data object is accessible
- [x] `isOutDated` - Out of date status is accessible
- [x] `isLoading` - Loading state is accessible
- [x] `searchRequestTraceIds` - Array of request trace IDs for cancel
- [x] `maxQueryRangeWarning` - Warning message is accessible
- [x] `limitNumberOfSeriesWarningMessage` - Warning message is accessible
- [x] `errorMessage` - Error message is accessible

---

## 18. Edge Cases

### 18.1 Empty State
- [x] No data shows appropriate empty state
- [x] No stream selected shows appropriate message

### 18.2 Loading State
- [x] Loading indicator appears during query
- [x] UI is not interactive during loading (where appropriate)

### 18.3 Error Recovery
- [x] After error, can modify query and retry
- [x] Error clears when new successful query runs

---

## 19. Preset Configurations Reference

### 19.1 Dashboard Preset (DASHBOARD_PRESET)
- [x] showQueryEditor: `true`
- [x] showQueryBuilder: `true`
- [x] showVariablesSelector: `true`
- [x] showLastRefreshedTime: `true`
- [x] showOutdatedWarning: `true`
- [x] showAddToDashboardButton: `false` (uses Save button instead)

### 19.2 Metrics Preset (METRICS_PRESET)
- [x] showQueryEditor: `true`
- [x] showQueryBuilder: `true`
- [x] showVariablesSelector: `false`
- [x] showLastRefreshedTime: `true`
- [x] showOutdatedWarning: `true`
- [x] showAddToDashboardButton: `true`

### 19.3 Logs Preset (LOGS_PRESET)
- [x] showQueryEditor: `false`
- [x] showQueryBuilder: `false`
- [x] showVariablesSelector: `false`
- [x] showLastRefreshedTime: `false`
- [x] showOutdatedWarning: `true`
- [x] showAddToDashboardButton: `true`

---

## 20. Computed Styles Per Page Type

### 20.1 Content Height
- [x] Dashboard: `calc(100vh - 110px)`
- [x] Metrics: `calc(100vh - 106px)`
- [x] Logs: `calc(100% - 36px)`

### 20.2 Row Style
- [x] Dashboard/Metrics: `overflow-y: auto`
- [x] Logs: `height: 100%`

### 20.3 Main Content Container Class
- [x] Dashboard/Metrics: `col tw:mr-[0.625rem]` (horizontal flex)
- [x] Logs: `col flex column` (vertical flex)

### 20.4 Main Content Container Style
- [x] Dashboard/Metrics: `display: flex; flexDirection: row; overflowX: hidden`
- [x] Logs: `width: 100%; height: 100%`

### 20.5 Splitter Limits
- [x] Dashboard/Metrics: `[0, 20]`
- [x] Logs: `[0, 100]`

### 20.6 Chart Area Class
- [x] Dashboard/Metrics: `tw:h-[calc(100vh-500px)] tw:min-h-[140px] tw:mt-[40px]`
- [x] Logs: `tw:h-[calc(100%-36px)] tw:min-h-[140px]` (no margin-top)

### 20.7 After Slot Style (width)
- [x] Dashboard/Metrics: Default (no explicit width)
- [x] Logs: When field list shown: `100%`; When hidden: `calc(100% - 58px)`

### 20.8 Search Type (for PanelSchemaRenderer)
- [x] Dashboard: `"dashboards"`
- [x] Metrics/Logs: `"ui"`

---

## 21. Header Components (Wrapper-Specific)

### 21.1 Dashboard Header (AddPanel.vue)
- [x] Panel name input is visible and editable
- [x] "Dashboard Tutorial" button opens tutorial link
- [x] "Query Inspector" button opens query metadata dialog (not visible for html/markdown/custom_chart)
- [x] DateTimePicker is visible and functional
- [x] "Discard" button navigates back to dashboard view
- [x] "Save" button saves panel to dashboard
- [x] "Apply" button triggers query execution
- [x] "Refresh Cache & Apply" dropdown option is visible (Enterprise only)
- [x] Cancel button appears when query is running (Enterprise only)
- [x] Loading state shown on Apply button during query execution

### 21.2 Metrics Header (Metrics/Index.vue)
- [x] "Metrics" title is displayed
- [x] SyntaxGuideMetrics button is visible
- [x] MetricLegends button is visible
- [x] DateTimePicker is visible and functional
- [x] AutoRefreshInterval control is visible
- [x] "Run Query" button triggers query execution
- [x] Cancel button appears when query is running (Enterprise only)

### 21.3 Logs Header
- [x] No header within VisualizeLogsQuery (header is in parent Logs page)
- [x] Component fills 100% height/width of container

---

## 22. Query Inspector (Dashboard Only)

### 22.1 Functionality
- [x] Query Inspector button visible in header (not for html/markdown/custom_chart)
- [x] Clicking opens QueryInspector dialog
- [x] Displays query metadata
- [x] Shows panel title
- [x] Dialog can be closed

---

## 23. Add Variable (Dashboard Only)

### 23.1 Functionality
- [x] "Add Variable" button visible in VariablesValueSelector
- [x] Clicking opens AddSettingVariable drawer
- [x] Variables created during session are tracked
- [x] Variables with "current_panel" scope work correctly
- [x] On Save: Variable is added to dashboard and becomes available
- [x] On Discard: Variables created in session are cleaned up
- [x] Variable changes reflected in VariablesValueSelector

---

## 24. Component Import Verification

### 24.1 PanelEditor Direct Imports
- [x] ChartSelection - Chart type sidebar
- [x] FieldList - Field selection panel
- [x] PanelSidebar - Collapsible sidebar wrapper
- [x] DashboardQueryBuilder - X/Y/Z/Breakdown field builder
- [x] DashboardErrorsComponent - Error display
- [x] PanelSchemaRenderer - Chart renderer
- [x] RelativeTime - Last refreshed timestamp

### 24.2 PanelEditor Async Imports
- [x] ConfigPanel - Right sidebar configuration
- [x] ShowLegendsPopup - Legends dialog
- [x] VariablesValueSelector - Variables UI
- [x] DashboardQueryEditor - SQL editor
- [x] CustomHTMLEditor - HTML content editor
- [x] CustomMarkdownEditor - Markdown content editor
- [x] CustomChartEditor - Custom JS chart editor
- [x] CustomChartTypeSelector - Template selector dialog

### 24.3 Wrapper-Specific Imports
- [x] **Dashboard**: DateTimePickerDashboard, AddSettingVariable, QueryInspector
- [x] **Metrics**: DateTimePickerDashboard, SyntaxGuideMetrics, MetricLegends, AutoRefreshInterval, AddToDashboard
- [x] **Logs**: AddToDashboard

---

## Test Execution Notes

When testing each case:
1. Note the page being tested (Dashboard/Metrics/Logs)
2. Record pass/fail status
3. Note any behavioral differences from original
4. Screenshot if visual issue found

### Priority Order
1. **Critical**: Chart rendering, data flow, query execution
2. **High**: Config panel, field list, chart type selection
3. **Medium**: Layout/styling, warnings, tooltips
4. **Low**: Edge cases, keyboard interaction
