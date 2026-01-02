# Auto SQL Query Builder - Design Document

## Executive Summary

This document outlines the design for adding an "Auto SQL Query Builder" feature to the OpenObserve logs page. This feature will provide a visual, drag-and-drop interface for users to construct SQL queries without writing code, making data visualization more accessible to non-technical users.

## Table of Contents

1. [Background](#background)
2. [Goals and Non-Goals](#goals-and-non-goals)
3. [User Experience](#user-experience)
4. [UI/UX Design](#uiux-design)
5. [Component Architecture](#component-architecture)
6. [Data Flow](#data-flow)
7. [Technical Requirements](#technical-requirements)
8. [Open Questions](#open-questions)

---

## Background

### Current State

OpenObserve's logs page currently has three main views:
1. **Logs** - Traditional log search results in table format
2. **Visualize** - Limited visualization with preset chart types
3. **Patterns** - Pattern extraction from log data

The dashboard feature already has a sophisticated query builder in `AddPanel.vue` that allows users to:
- Select fields from a stream
- Drag fields to different axes (X, Y, Z, Breakdown)
- Apply aggregation functions
- Set filters
- Auto-generate SQL queries from visual configuration

### Problem Statement

Users working with logs want the same powerful query building capabilities available in dashboards without having to:
- Write complex SQL manually
- Navigate away from the logs page
- Understand SQL syntax for aggregations, joins, and filtering

### Opportunity

By reusing the existing dashboard query builder components and adapting them for the logs page context, we can provide a consistent, powerful visual query building experience across the platform.

---

## Goals and Non-Goals

### Goals

1. **Provide Visual Query Building** - Enable users to construct queries by selecting fields and dragging them to axes
2. **Reuse Existing Components** - Leverage battle-tested components from `AddPanel.vue` to ensure consistency
3. **Auto-Generate SQL** - Automatically generate optimized SQL queries as users configure fields
4. **Seamless Integration** - Add as a 4th tab on logs page with minimal disruption to existing workflows
5. **Maintain Context** - Preserve log search context (stream, time range, filters) when switching to Build mode
6. **Bidirectional Sync** - Allow users to switch between manual SQL and visual builder
7. **Preview Results** - Show chart preview as users configure the visualization

### Non-Goals

1. **Custom SQL Editing in Build Tab** - Users should use the SQL mode for custom queries; Build tab is for visual construction only
2. **Advanced Features Initially** - Complex features like joins, subqueries can be added in future iterations
3. **Replacing Existing Tabs** - Build tab supplements, doesn't replace existing Logs/Visualize/Patterns views
4. **PromQL Support** - Focus on SQL query building; PromQL is out of scope

---

## User Experience

### User Personas

**Persona 1: Sarah - Operations Engineer**
- **Background:** Monitors application logs, understands log structure but not SQL
- **Need:** Wants to create charts showing error rates by service without learning SQL
- **Journey:**
  1. Searches logs for errors in last 24 hours
  2. Clicks "Build" tab
  3. Drags "service_name" to X-axis
  4. Drags "level" to Y-axis with COUNT aggregation
  5. Adds filter: level = "error"
  6. Sees bar chart automatically generated
  7. Clicks "Add to Dashboard" to save

**Persona 2: Mike - Platform Engineer**
- **Background:** Experienced with SQL, wants quick visualization
- **Need:** Needs to visualize API response times grouped by endpoint
- **Journey:**
  1. Searches logs from API gateway
  2. Clicks "Build" tab
  3. Drags "endpoint" to X-axis
  4. Drags "response_time" to Y-axis with AVG aggregation
  5. Drags "method" to Breakdown
  6. Switches chart type to line chart
  7. Exports query to use in alerts

### User Workflows

#### Workflow 1: Create Visualization from Scratch

```
[Logs Page] → Search logs → [Build Tab] → Select Fields → Drag to Axes
→ Apply Aggregations → Set Filters → [Preview Updates] → Add to Dashboard
```

#### Workflow 2: Modify Existing Log Query

```
[Logs Page] → SQL Query → [Build Tab] → Parse Query → Visual Editor
→ Modify Fields → [Auto-generate SQL] → Run Query → View Results
```

#### Workflow 3: Switch Between Modes

```
[Build Tab] → Configure visually → [Switch to Logs/SQL] → See generated query
→ Manually edit → [Back to Build] → Parse changes → Continue editing
```

---

## UI/UX Design

### Layout Structure

```
┌─────────────────────────────────────────────────────────────────┐
│ OpenObserve Header                                              │
├─────────────────────────────────────────────────────────────────┤
│ Search Bar: [Stream] [Date/Time Range] [Run Query]            │
├─────────────────────────────────────────────────────────────────┤
│ Tabs: [Logs] [Visualize] [Patterns] [Build] ◄── NEW TAB       │
├─────┬───────────────────────────────────────────────────┬───────┤
│     │                                                   │       │
│  C  │              Query Builder Area                  │   C   │
│  h  │  ┌─────────────────────────────────────────────┐ │   o   │
│  a  │  │ X-Axis: [timestamp (histogram)] [+]         │ │   n   │
│  r  │  ├─────────────────────────────────────────────┤ │   f   │
│  t  │  │ Y-Axis: [count(*)] [SUM ▼] [+]             │ │   i   │
│     │  ├─────────────────────────────────────────────┤ │   g   │
│  T  │  │ Breakdown: [service_name] [+]               │ │       │
│  y  │  ├─────────────────────────────────────────────┤ │   P   │
│  p  │  │ Filters: [level = 'error'] [+]              │ │   a   │
│  e  │  └─────────────────────────────────────────────┘ │   n   │
│  s  │                                                   │   e   │
│     │  ┌─────────────────────────────────────────────┐ │   l   │
│  L  │  │                                             │ │       │
│  i  │  │          Chart Preview                      │ │       │
│  s  │  │                                             │ │       │
│  t  │  │         [Chart Visualization]               │ │       │
│     │  │                                             │ │       │
│     │  └─────────────────────────────────────────────┘ │       │
│     │                                                   │       │
│  F  │  [Generated SQL Query] ───────────────────────  │       │
│  i  │  SELECT histogram(_timestamp) as x_axis_1,      │       │
│  e  │         COUNT(*) as y_axis_1,                   │       │
│  l  │         service_name as breakdown_1             │       │
│  d  │  FROM logs WHERE level = 'error'                │       │
│  s  │  GROUP BY x_axis_1, breakdown_1                 │       │
│     │  ORDER BY x_axis_1                              │       │
└─────┴───────────────────────────────────────────────────┴───────┘
```

### Detailed Component Layout

#### 1. Chart Type Selection (Left Sidebar - Collapsible)
```
┌──────────────┐
│ Chart Types  │
├──────────────┤
│  [≡] Table   │
│  [📊] Bar     │  ◄── Selected
│  [📈] Line    │
│  [◆] Area    │
│  [○] Scatter │
│  [⊕] Pie     │
│  [🗺️] Geo Map │
│  etc...      │
└──────────────┘
```

#### 2. Fields List (Left Sidebar - Collapsible)
```
┌─────────────────────────┐
│ Fields                  │
├─────────────────────────┤
│ 🔍 [Search fields...]   │
├─────────────────────────┤
│ Stream: logs_service    │ ◄── Read-only (from search context)
├─────────────────────────┤
│ ⏱️ Time Fields          │
│   • _timestamp          │ ◄── Draggable
│                         │
│ 📝 String Fields        │
│   • service_name        │
│   • level               │
│   • endpoint            │
│                         │
│ 🔢 Numeric Fields       │
│   • response_time       │
│   • status_code         │
│   • bytes_sent          │
│                         │
│ 🏷️ Other Fields         │
│   • user_id             │
│   • request_id          │
└─────────────────────────┘
```

#### 3. Query Builder (Main Area)
```
┌───────────────────────────────────────────────────────────────┐
│ X-Axis (Time/Category)                            [? Help]   │
├───────────────────────────────────────────────────────────────┤
│ [_timestamp] [histogram ▼] [1 hour ▼] [⚙️] [×]              │
│ [+ Add Field]                                                 │
├───────────────────────────────────────────────────────────────┤
│ Y-Axis (Metrics)                                  [? Help]   │
├───────────────────────────────────────────────────────────────┤
│ [Count] [COUNT ▼] [⚙️] [×]                                   │
│ [+ Add Field]                                                 │
├───────────────────────────────────────────────────────────────┤
│ Breakdown (Grouping)                              [? Help]   │
├───────────────────────────────────────────────────────────────┤
│ [service_name] [⚙️] [×]                                      │
│ [+ Add Field]                                                 │
├───────────────────────────────────────────────────────────────┤
│ Filters                                           [? Help]   │
├───────────────────────────────────────────────────────────────┤
│ Group: [AND ▼]                                                │
│   [level] [=] ['error'] [×]                                  │
│   [+ Add Condition]                                           │
└───────────────────────────────────────────────────────────────┘
```

#### 4. Chart Preview
```
┌───────────────────────────────────────────────────────────────┐
│                       Chart Preview                          │
│  ⚠️ Warning indicators    [🔄 Refresh] [⚙️] [📊 Show Legends]│
├───────────────────────────────────────────────────────────────┤
│                                                               │
│            [Chart renders here using ECharts]                │
│                                                               │
│  ┌─────────────────────────────────────────────────┐        │
│  │                                                 │        │
│  │         Visualization updates in real-time      │        │
│  │         as user modifies query builder          │        │
│  │                                                 │        │
│  └─────────────────────────────────────────────────┘        │
│                                                               │
│ [Add to Dashboard] [Export Query] [Create Alert]            │
└───────────────────────────────────────────────────────────────┘
```

#### 5. Config Panel (Right Sidebar - Collapsible)
```
┌────────────────────────┐
│ Chart Configuration    │
├────────────────────────┤
│ Chart Settings         │
│  • Show Legend: ☑      │
│  • Show Axis Label: ☑  │
│  • Stacked: ☐          │
│                        │
│ Axis Configuration     │
│  X-Axis:               │
│    • Label: [Auto]     │
│    • Rotation: [0°]    │
│  Y-Axis:               │
│    • Label: [Count]    │
│    • Scale: [Linear ▼] │
│                        │
│ Colors                 │
│  • Color Scheme: [▼]   │
│  • Custom Colors: [+]  │
│                        │
│ Data Limits            │
│  • Max Results: [1000] │
│  • Series Limit: [20]  │
└────────────────────────┘
```

### Interaction Patterns

#### Drag and Drop
1. **From Field List to Axis**
   - User drags field from left sidebar
   - Drop zones highlight when hovering
   - Field automatically gets appropriate aggregation based on type:
     - Numeric → AVG, SUM, MIN, MAX, COUNT
     - String → COUNT, COUNT DISTINCT
     - Timestamp → histogram function

2. **Reordering Fields**
   - User can drag fields within same axis to reorder
   - Changes affect GROUP BY and ORDER BY clauses

3. **Between Axes**
   - User can move field from one axis to another
   - Aggregation function may change based on new context

#### Field Configuration
1. **Click field chip** → Opens configuration popover:
   ```
   ┌─────────────────────────────┐
   │ Configure: response_time    │
   ├─────────────────────────────┤
   │ Aggregation:                │
   │ • AVG       ◉               │
   │ • SUM       ○               │
   │ • MIN       ○               │
   │ • MAX       ○               │
   │ • COUNT     ○               │
   ├─────────────────────────────┤
   │ Alias: [avg_response_time]  │
   ├─────────────────────────────┤
   │ Custom Function:            │
   │ [VRL Editor...]             │
   ├─────────────────────────────┤
   │ [Cancel] [Apply]            │
   └─────────────────────────────┘
   ```

#### Auto-Save and Preview
- **Debounced Updates:** Chart preview updates 500ms after user stops making changes
- **Loading States:** Show spinner on chart area while query executes
- **Error States:** Display inline errors with helpful messages
- **Warnings:** Show warning icons for:
  - Query exceeds time range limits
  - Too many series (performance impact)
  - Missing required fields for selected chart type

### Visual States

#### Empty State
```
┌───────────────────────────────────────────────┐
│                                               │
│            📊 Build Your Visualization        │
│                                               │
│   1. Select a chart type from the left       │
│   2. Drag fields to X and Y axes             │
│   3. Add breakdowns for grouping (optional)  │
│   4. Apply filters to narrow results         │
│                                               │
│   [Watch Tutorial] [View Examples]           │
│                                               │
└───────────────────────────────────────────────┘
```

#### Loading State
```
┌───────────────────────────────────────────────┐
│                                               │
│              ⏳ Executing Query...            │
│                                               │
│         [Progress bar or spinner]            │
│                                               │
│    Querying 1.2M records from logs_service   │
│                                               │
└───────────────────────────────────────────────┘
```

#### Error State
```
┌───────────────────────────────────────────────┐
│                                               │
│         ⚠️ Query Execution Failed             │
│                                               │
│  Error: Field 'response_time' not found      │
│                                               │
│  Suggestions:                                │
│  • Check if field exists in selected stream  │
│  • Verify field name spelling                │
│  • Refresh field list                        │
│                                               │
│  [View Details] [Contact Support]            │
│                                               │
└───────────────────────────────────────────────┘
```

---

## Component Architecture

### High-Level Component Tree

```
BuildQueryTab.vue (NEW - Main Component)
├── ChartSelection.vue (REUSED)
│   └── Chart type icons and selection logic
│
├── q-splitter (LEFT SIDEBAR)
│   └── FieldList.vue (REUSED)
│       ├── Stream selector (read-only for logs)
│       ├── Field search/filter
│       ├── Grouped field display
│       └── Drag source for fields
│
├── q-splitter (MAIN AREA)
│   ├── QueryBuilderArea.vue (NEW - Wrapper)
│   │   ├── DashboardQueryBuilder.vue (REUSED)
│   │   │   ├── AxisFieldContainer (X-axis fields)
│   │   │   ├── AxisFieldContainer (Y-axis fields)
│   │   │   ├── AxisFieldContainer (Z-axis fields)
│   │   │   ├── AxisFieldContainer (Breakdown fields)
│   │   │   └── FilterBuilder
│   │   │
│   │   └── ChartPreviewArea.vue (NEW)
│   │       ├── PanelSchemaRenderer.vue (REUSED)
│   │       │   └── ChartRenderer.vue (echarts)
│   │       ├── ErrorDisplay
│   │       ├── WarningDisplay
│   │       └── ActionButtons
│   │           ├── Add to Dashboard
│   │           ├── Export Query
│   │           └── Create Alert
│   │
│   └── GeneratedQueryDisplay.vue (NEW)
│       └── SQL syntax highlighted display
│
└── q-splitter (RIGHT SIDEBAR)
    └── PanelSidebar.vue (REUSED)
        └── ConfigPanel.vue (REUSED)
            ├── Chart settings
            ├── Axis configuration
            ├── Colors
            └── Data limits
```

### Component Responsibilities

#### BuildQueryTab.vue (NEW)
**Purpose:** Main container for the Build tab, orchestrates all child components

**Responsibilities:**
- Initialize `dashboardPanelData` from current log search context
- Manage tab lifecycle (mount, unmount, activation)
- Provide context to child components via `provide/inject`
- Handle mode switching (visual ↔ SQL)
- Coordinate state between query builder and chart preview
- Manage splitter states for collapsible sidebars

**Key Data:**
```typescript
{
  chartData: ref({}),              // Current visualization config
  errorData: reactive({ errors: [] }),
  showFieldList: ref(true),
  showConfigPanel: ref(true),
  splitterModel: ref(20),
  isOutdated: computed(() => ...),  // Config changed but not applied
}
```

**Key Methods:**
- `initializeFromLogsContext()` - Parse current log query into visual builder
- `runQuery()` - Execute query and update preview
- `exportToSQL()` - Generate SQL from visual config
- `addToDashboard()` - Save visualization to dashboard
- `collapseFieldList()` - Toggle field list visibility
- `syncWithLogsPage()` - Keep stream/time context in sync

#### QueryBuilderArea.vue (NEW)
**Purpose:** Wrapper for query builder and chart preview sections

**Responsibilities:**
- Layout management for builder and preview
- Coordinate "Apply" action between builder and preview
- Show outdated warning when config doesn't match preview
- Handle responsive resizing

#### ChartPreviewArea.vue (NEW)
**Purpose:** Display chart preview with controls and status indicators

**Responsibilities:**
- Render chart using PanelSchemaRenderer
- Display error/warning/info messages
- Show action buttons (Add to Dashboard, Export, etc.)
- Handle loading states during query execution
- Manage hover states and tooltips

**Props:**
```typescript
{
  chartData: Object,           // Visualization configuration
  searchResponse: Object,      // Query results
  errorData: Object,          // Error tracking
  showActions: Boolean,       // Show action buttons
}
```

**Events:**
```typescript
{
  'add-to-dashboard': () => void,
  'export-query': () => void,
  'create-alert': () => void,
  'chart-error': (error: any) => void,
}
```

#### GeneratedQueryDisplay.vue (NEW)
**Purpose:** Show auto-generated SQL query with syntax highlighting

**Responsibilities:**
- Display SQL query in readable format
- Syntax highlighting
- Copy to clipboard functionality
- Toggle expand/collapse
- Show "Edit in SQL mode" link

**Features:**
- Read-only display
- Automatic formatting
- Line numbers
- Copy button
- Expand/collapse sections (SELECT, FROM, WHERE, GROUP BY)

### Component Reuse Strategy

#### Existing Components Used As-Is

1. **ChartSelection.vue**
   - ✅ No modifications needed
   - Usage: `<ChartSelection v-model:selectedChartType="dashboardPanelData.data.type" />`

2. **FieldList.vue**
   - ✅ No modifications needed
   - Props: `editMode: true`, `hideAllFieldsSelection: false`
   - Stream selection locked to current log search stream

3. **DashboardQueryBuilder.vue**
   - ✅ No modifications needed
   - Handles all axis configuration
   - Drag-and-drop built-in

4. **PanelSchemaRenderer.vue**
   - ✅ No modifications needed
   - Renders charts based on panelSchema
   - Emits events for errors/metadata

5. **ConfigPanel.vue**
   - ✅ No modifications needed
   - Chart configuration sidebar
   - All settings work out of the box

6. **PanelSidebar.vue**
   - ✅ No modifications needed
   - Collapsible sidebar wrapper

#### New Components Required

1. **BuildQueryTab.vue** - Main container (300-400 lines)
2. **QueryBuilderArea.vue** - Builder + Preview layout (100-150 lines)
3. **ChartPreviewArea.vue** - Preview with actions (200-250 lines)
4. **GeneratedQueryDisplay.vue** - SQL display (150-200 lines)

**Total New Code:** ~750-1000 lines across 4 components

---

## Data Flow

### Initialization Flow

```
User clicks "Build" tab
    ↓
BuildQueryTab.vue mounts
    ↓
initializeFromLogsContext()
    ↓
Extract from searchObj:
  - selectedStream
  - time range
  - existing SQL query (if any)
    ↓
Initialize dashboardPanelData
    ↓
Parse SQL query into field selections (if possible)
  OR
Set default timestamp histogram on X-axis
    ↓
Render FieldList, QueryBuilder, ChartPreview
    ↓
Auto-execute initial query
    ↓
Display chart preview
```

### Field Selection Flow

```
User drags field from FieldList
    ↓
Drop on axis container (X/Y/Z/Breakdown)
    ↓
addXAxisItem() / addYAxisItem() / etc.
    ↓
Update dashboardPanelData.data.queries[0].fields.x
    ↓
Watcher detects field change
    ↓
Trigger makeAutoSQLQuery()
    ↓
buildSQLChartQuery() generates SQL
    ↓
Update dashboardPanelData.data.queries[0].query
    ↓
Set isOutdated = true
    ↓
User clicks "Apply" or auto-apply after debounce
    ↓
runQuery()
    ↓
PanelSchemaRenderer executes query
    ↓
Chart updates with new results
    ↓
Set isOutdated = false
```

### State Management Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    useDashboardPanel                        │
│                  (Composable - Source of Truth)             │
│                                                             │
│  dashboardPanelData = {                                     │
│    data: {                                                  │
│      queries: [{ fields: { x, y, z, breakdown, filter } }] │
│    },                                                       │
│    layout: { splitter, showFieldList, ... }                │
│    meta: { stream, dateTime, ... }                         │
│  }                                                          │
└─────────────────────────────────────────────────────────────┘
          ↓                    ↓                    ↓
    ┌──────────┐         ┌──────────┐        ┌──────────┐
    │FieldList │         │ Builder  │        │ Preview  │
    │          │ ───────→│          │───────→│          │
    │ (Read)   │  Drag   │(Read/Mod)│ Apply  │  (Read)  │
    └──────────┘         └──────────┘        └──────────┘
```

### Query Generation Flow

```
User modifies visualization config
    ↓
dashboardPanelData.data.queries[0].fields updated
    ↓
makeAutoSQLQuery() triggered
    ↓
Check chart type:
  - geomap → geoMapChart()
  - sankey → sankeyChartQuery()
  - standard → buildSQLChartQuery()
    ↓
buildSQLChartQuery():
  1. Build SELECT with aggregations
  2. Build FROM clause
  3. Build WHERE from filters
  4. Build GROUP BY from breakdown
  5. Build ORDER BY
  6. Add LIMIT
    ↓
Return generated SQL string
    ↓
Store in dashboardPanelData.data.queries[0].query
    ↓
Display in GeneratedQueryDisplay
    ↓
Ready for execution
```

### Sync with Logs Page

```
┌──────────────┐                    ┌────────────────┐
│  Logs Page   │                    │   Build Tab    │
│  (Index.vue) │                    │(BuildQueryTab) │
└──────┬───────┘                    └────────┬───────┘
       │                                     │
       │  searchObj.data.stream             │
       │  searchObj.meta.dateTime           │
       ├────────────────────────────────────→│
       │                                     │
       │                                     │ User configures
       │                                     │ visualization
       │                                     │
       │  Generated SQL query               │
       │←────────────────────────────────────┤
       │                                     │
       │  User switches back to Logs        │
       │  Query available in SQL editor     │
       │                                     │
```

---

## Technical Requirements

### Browser Compatibility
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

### Performance Requirements
- **Initial Load:** < 1 second to render Build tab UI
- **Field Drag:** < 50ms response time
- **Query Generation:** < 100ms to generate SQL from config
- **Chart Update:** < 2 seconds for queries returning < 10k records
- **Debounce Delay:** 500ms after user stops interacting before auto-update

### Data Constraints
- **Max Fields per Axis:**
  - X-axis: 5 fields
  - Y-axis: 20 fields
  - Z-axis: 1 field
  - Breakdown: 5 fields
- **Max Filters:** 50 conditions
- **Max Series in Chart:** 100 series (configurable warning)
- **Query Result Limit:** Default 1000 rows, max 10000

### Accessibility Requirements
- Keyboard navigation for all interactive elements
- ARIA labels for drag-and-drop operations
- Screen reader announcements for state changes
- High contrast mode support
- Focus indicators for all focusable elements

### Error Handling
- **Network Errors:** Retry with exponential backoff
- **Query Errors:** Display user-friendly messages with suggestions
- **Validation Errors:** Inline error messages on invalid configurations
- **Timeout Errors:** Show timeout message after 30 seconds

---

## Open Questions

### Technical Questions

1. **Q:** Should we support parsing custom SQL queries back into the visual builder?
   **A:** Phase 1 - No, only support auto-generated queries. Phase 2 - Add SQL parser for simple queries.

2. **Q:** How do we handle when user switches between Build tab and Logs tab with unsaved changes?
   **A:** Show confirmation dialog: "You have unsaved visualization changes. Discard or save to dashboard?"

3. **Q:** Should generated queries be automatically executed or require explicit "Apply" action?
   **A:** For logs page, use explicit "Apply" to avoid overwhelming API. Add auto-refresh toggle for advanced users.

4. **Q:** How do we handle fields that exist in the current query but not in the selected stream schema?
   **A:** Show warning icon, allow user to keep or remove. Useful for VRL-generated fields.

5. **Q:** Should we share the same `dashboardPanelData` instance between Visualize and Build tabs?
   **A:** Yes, use same instance with `dashboardPanelDataPageKey = "logs"` to maintain state consistency.

### UX Questions

1. **Q:** Should chart type selection be in the main area or left sidebar?
   **A:** Keep in left sidebar for consistency with AddPanel.vue. It's easily accessible and doesn't clutter main workspace.

2. **Q:** How do we indicate that the preview is "outdated" after config changes?
   **A:** Show yellow warning banner above chart: "Configuration changed. Click Apply to update chart."

3. **Q:** Should we show the generated SQL query by default or collapsed?
   **A:** Collapsed by default with "Show SQL" button. Advanced users can expand to see/copy query.

4. **Q:** What happens when user switches away from Build tab with pending changes?
   **A:** Save state in memory, restore when returning to Build tab. Show "outdated" indicator in tab label.

5. **Q:** Should we support templates/presets for common visualizations?
   **A:** Phase 2 feature. Start with empty state and examples link.

### Product Questions

1. **Q:** Should Build tab be available in OSS or Enterprise only?
   **A:** OSS - Full feature parity with dashboard query builder.

2. **Q:** Do we need usage analytics for the Build tab?
   **A:** Yes, track: tab opens, fields added, charts created, dashboards saved, errors encountered.

3. **Q:** Should there be limits on query complexity for performance?
   **A:** Yes, enforce limits: max 5 breakdown fields, max 20 Y-axis fields, max 100 series. Show warnings.

4. **Q:** How do we educate users about this new feature?
   **A:**
   - Tooltip on Build tab: "Visual query builder - create charts without SQL"
   - Empty state with tutorial link
   - Documentation page with examples
   - In-app tutorial (optional)

5. **Q:** Should we migrate existing Visualize tab functionality to Build tab?
   **A:** No, keep both. Visualize is simpler/faster for quick charts. Build is for complex visualizations.

---

## Appendix

### Related Documents
- [High-Level Design Document](./auto-sql-query-builder-hld.md) - Technical implementation details
- [API Documentation] - Query execution endpoints
- [Dashboard Query Builder] - Reference implementation

### References
- AddPanel.vue: `web/src/views/Dashboards/addPanel/AddPanel.vue`
- VisualizeLogsQuery.vue: `web/src/plugins/logs/VisualizeLogsQuery.vue`
- useDashboardPanel: `web/src/composables/useDashboardPanel.ts`
- DashboardQueryBuilder: `web/src/components/dashboards/addPanel/DashboardQueryBuilder.vue`

### Glossary
- **Auto SQL:** Automatically generated SQL query from visual configuration
- **Axis:** Dimension of data visualization (X, Y, Z axes)
- **Breakdown:** Grouping dimension that creates separate series in charts
- **Field:** Column in the log stream schema
- **Stream:** Log data source/table
- **VRL:** Vector Remap Language - for field transformations
