# Logs Query Builder - High Level Design (Revised)

## 1. Overview

### 1.1 Feature Summary

Add a **full-page visual query builder** to the Logs page that allows users to construct SQL queries through a drag-and-drop UI, similar to the Dashboard's Add Panel page.

**Key User Flow:**
1. User is on Logs page with search results
2. User clicks "Build" toggle button (next to Logs/Visualize/Patterns)
3. User sees a **full query builder interface** (like Add Panel):
   - Field list on the left sidebar
   - X-axis, Y-axis, Breakdown drop zones in the center
   - Aggregation function selectors
   - Generated SQL display at the bottom
4. User builds query by dragging fields
5. User clicks "Apply to Search" → returns to Logs view with generated query

### 1.2 Visual Reference

**Current Add Panel page (what we want to replicate):**
```
┌─────────────────────────────────────────────────────────────────────────┐
│ [Chart Types Sidebar] │ Fields │ Query Builder                  │Config │
│                       │ ─────  │ ┌─────────────────────────────┐│      │
│  [Area] [Bar] [Line]  │ Search │ │ X-Axis:  [_timestamp ▼]    ││      │
│  [Pie]  [Table] ...   │ ─────  │ │ Y-Axis:  [COUNT(*) ▼]      ││      │
│                       │ _time  │ │ Breakdown: [level ▼]        ││      │
│                       │ level  │ └─────────────────────────────┘│      │
│                       │ host   │                                │      │
│                       │ ...    │ Generated SQL:                 │      │
│                       │        │ ┌─────────────────────────────┐│      │
│                       │        │ │ SELECT histogram(_timestamp)││      │
│                       │        │ │ COUNT(*), level             ││      │
│                       │        │ │ FROM "default"              ││      │
│                       │        │ │ GROUP BY _timestamp, level  ││      │
│                       │        │ └─────────────────────────────┘│      │
│                       │        │                                │      │
│                       │        │ [Apply to Search]  [Cancel]    │      │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Key Requirements

1. **Full Page Builder**: Show a full-page query builder interface (not a small embedded panel)
2. **Reuse PanelEditor**: Leverage the existing PanelEditor component used in Dashboard
3. **Auto/Custom Mode**: Support both visual builder mode and raw SQL mode
4. **Bidirectional**: Parse existing SQL into builder fields OR generate SQL from builder
5. **Apply to Search**: Apply the built query back to the Logs search

---

## 2. Architecture

### 2.1 Page Structure

When user clicks "Build", the entire main area (where logs table or histogram appears) is replaced with the query builder interface.

```
Logs Page Layout:
┌─────────────────────────────────────────────────────────────────────────┐
│ SearchBar: [🔍 Logs] [📊 Visualize] [🔨 Build*] [📊 Patterns]           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  When toggle = 'logs':     Shows SearchResult (logs table + histogram) │
│  When toggle = 'visualize': Shows VisualizeLogsQuery (chart)           │
│  When toggle = 'build':     Shows BuildQueryPage (full query builder)  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Component Hierarchy

```
Logs Page (Index.vue)
├── SearchBar.vue
│   └── Toggle buttons: [Logs] [Visualize] [Build] [Patterns]
│
├── v-show="toggle === 'logs'"
│   └── SearchResult (existing logs table + histogram)
│
├── v-show="toggle === 'visualize'"
│   └── VisualizeLogsQuery (existing visualization)
│
└── v-show="toggle === 'build'"      ← NEW
    └── BuildQueryPage.vue
        ├── Header: [Builder/Custom toggle] [Apply to Search] [Cancel]
        └── PanelEditor (reused from dashboard)
            ├── ChartSelection (hidden or simplified for query building)
            ├── FieldList (shows fields from selected stream)
            ├── DashboardQueryBuilder (X/Y/Breakdown drop zones)
            ├── QueryTypeSelector (Builder/Custom toggle)
            └── GeneratedQueryDisplay (shows generated SQL)
```

### 2.3 Data Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           User clicks "Build"                           │
│                                  │                                      │
│                                  ▼                                      │
│                    ┌─────────────────────────────┐                      │
│                    │   Initialize BuildQueryPage │                      │
│                    │   with current query        │                      │
│                    └─────────────────────────────┘                      │
│                                  │                                      │
│                                  ▼                                      │
│                    ┌─────────────────────────────┐                      │
│                    │   Try to parse SQL query    │                      │
│                    │   using SQLQueryParser      │                      │
│                    └─────────────────────────────┘                      │
│                                  │                                      │
│              ┌───────────────────┴───────────────────┐                  │
│              ▼                                       ▼                  │
│     ┌──────────────────┐                   ┌──────────────────┐        │
│     │  Parse Success   │                   │  Parse Failed    │        │
│     │  (Simple Query)  │                   │  (Complex Query) │        │
│     └──────────────────┘                   └──────────────────┘        │
│              │                                       │                  │
│              ▼                                       ▼                  │
│     ┌──────────────────┐                   ┌──────────────────┐        │
│     │  Builder Mode    │                   │  Custom Mode     │        │
│     │  customQuery=false│                  │  customQuery=true │        │
│     │  Fields populated │                  │  Raw SQL shown   │        │
│     └──────────────────┘                   └──────────────────┘        │
│              │                                       │                  │
│              └───────────────────┬───────────────────┘                  │
│                                  ▼                                      │
│                    ┌─────────────────────────────┐                      │
│                    │   User modifies query       │                      │
│                    │   (via builder or editor)   │                      │
│                    └─────────────────────────────┘                      │
│                                  │                                      │
│                                  ▼                                      │
│                    ┌─────────────────────────────┐                      │
│                    │   Clicks "Apply to Search"  │                      │
│                    └─────────────────────────────┘                      │
│                                  │                                      │
│                                  ▼                                      │
│                    ┌─────────────────────────────┐                      │
│                    │   Switch to Logs tab        │                      │
│                    │   Update searchObj.query    │                      │
│                    │   Execute search            │                      │
│                    └─────────────────────────────┘                      │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. New Components

### 3.1 BuildQueryPage.vue

**Location**: `web/src/plugins/logs/BuildQueryPage.vue`

**Purpose**: Full-page query builder wrapper that uses PanelEditor.

**Key Features**:
- Wraps PanelEditor component with logs-specific configuration
- Shows only query building UI (no chart preview needed)
- Has "Apply to Search" and "Cancel" buttons
- Initializes from current search query
- Syncs generated query back to logs search

**Template Structure**:
```vue
<template>
  <div class="build-query-page">
    <!-- Header -->
    <div class="build-query-header">
      <div class="header-left">
        <h3>Build Query</h3>
        <span class="stream-name">Stream: {{ selectedStream }}</span>
      </div>
      <div class="header-right">
        <q-btn flat label="Cancel" @click="onCancel" />
        <q-btn color="primary" label="Apply to Search" @click="onApply" />
      </div>
    </div>

    <!-- Query Builder Content -->
    <div class="build-query-content">
      <PanelEditor
        ref="panelEditorRef"
        pageType="build"
        :showQueryEditor="false"
        :showQueryBuilder="true"
        :showVariablesSelector="false"
        :showLastRefreshedTime="false"
        :showOutdatedWarning="false"
        :showAddToDashboardButton="false"
        :showQueryTypeSelector="true"
        :showGeneratedQueryDisplay="true"
        :hideChartPreview="true"
      />
    </div>
  </div>
</template>
```

**Script Logic**:
```typescript
// Key methods
const initializeFromQuery = async (query: string, stream: string) => {
  // Reset panel data
  resetDashboardPanelData();

  // Set stream
  dashboardPanelData.data.queries[0].fields.stream = stream;
  dashboardPanelData.data.queries[0].fields.stream_type = 'logs';

  if (!query || query.trim() === '') {
    // Empty query - start fresh in builder mode
    dashboardPanelData.data.queries[0].customQuery = false;
    return;
  }

  // Try to parse existing query
  const parsed = parseSQL(query);

  if (parsed && !parsed.customQuery) {
    // Successfully parsed - populate builder fields
    applyParsedFields(parsed);
    dashboardPanelData.data.queries[0].customQuery = false;
  } else {
    // Complex query - use custom mode
    dashboardPanelData.data.queries[0].query = query;
    dashboardPanelData.data.queries[0].customQuery = true;
  }
};

const onApply = () => {
  const generatedQuery = dashboardPanelData.data.queries[0].query;
  emit('apply', generatedQuery);
};

const onCancel = () => {
  emit('cancel');
};
```

### 3.2 GeneratedQueryDisplay.vue

**Location**: `web/src/components/dashboards/PanelEditor/GeneratedQueryDisplay.vue`

**Purpose**: Display the generated SQL query with syntax highlighting.

**Features**:
- Collapsible SQL display panel
- Read-only in builder mode
- Editable in custom mode
- Copy to clipboard button
- Syntax highlighting

```vue
<template>
  <div class="generated-query-display">
    <div class="query-header" @click="toggleExpand">
      <q-icon :name="isExpanded ? 'expand_less' : 'expand_more'" />
      <span class="query-title">
        {{ isCustomMode ? 'Custom SQL' : 'Generated SQL' }}
      </span>
      <q-btn flat dense icon="content_copy" @click.stop="copyQuery" />
    </div>

    <div v-show="isExpanded" class="query-content">
      <!-- Read-only display in builder mode -->
      <pre v-if="!isCustomMode" class="query-display">{{ query }}</pre>

      <!-- Editable textarea in custom mode -->
      <textarea
        v-else
        v-model="editableQuery"
        class="query-editor"
        @input="onQueryChange"
      />
    </div>
  </div>
</template>
```

### 3.3 SQLQueryParser.ts

**Location**: `web/src/utils/query/sqlQueryParser.ts`

**Purpose**: Parse SQL queries into structured panel objects for the visual builder.

**Key Features**:
- Detect complex queries that cannot be visually built
- Extract SELECT fields with aggregations
- Parse FROM clause (stream name)
- Extract WHERE conditions
- Parse GROUP BY fields
- Map to X/Y/Breakdown axes

**Complex Query Detection** (fallback to custom mode):
- Subqueries in SELECT, FROM, or WHERE
- CASE/WHEN/SWITCH statements
- Nested JOINs (more than 2 tables)
- UNION/INTERSECT/EXCEPT
- Window functions (OVER, PARTITION BY)

```typescript
export interface ParsedQuery {
  stream: string;
  streamType: string;
  xFields: ParsedField[];
  yFields: ParsedField[];
  breakdownFields: ParsedField[];
  filters: ParsedFilter[];
  groupBy: string[];
  customQuery: boolean;
  rawQuery: string;
  parseError?: string;
}

export function parseSQL(query: string): ParsedQuery;
export function isQueryParseable(query: string): boolean;
export function getUnparseableReason(query: string): string | null;
```

---

## 4. PanelEditor Modifications

### 4.1 New Config Options

Add to `PanelEditorConfig` interface:

```typescript
interface PanelEditorConfig {
  // ... existing options

  /** Whether to show the Builder/Custom mode toggle */
  showQueryTypeSelector: boolean;

  /** Whether to show the generated SQL query display */
  showGeneratedQueryDisplay: boolean;

  /** Whether to hide the chart preview area */
  hideChartPreview: boolean;
}
```

### 4.2 BUILD_PRESET

Add new preset for query builder mode:

```typescript
export const BUILD_PRESET: PanelEditorConfig = {
  showQueryEditor: false,      // No code editor at bottom
  showQueryBuilder: true,      // Show X/Y/Breakdown builder
  showVariablesSelector: false,
  showLastRefreshedTime: false,
  showOutdatedWarning: false,
  showAddToDashboardButton: false,
  showQueryTypeSelector: true, // Show Builder/Custom toggle
  showGeneratedQueryDisplay: true, // Show generated SQL
  hideChartPreview: true,      // No chart needed
};
```

### 4.3 Template Changes

In `PanelEditor.vue`, add:

1. **QueryTypeSelector** (before DashboardQueryBuilder):
```vue
<QueryTypeSelector v-if="resolvedConfig.showQueryTypeSelector" />
```

2. **GeneratedQueryDisplay** (after DashboardQueryBuilder):
```vue
<GeneratedQueryDisplay
  v-if="resolvedConfig.showGeneratedQueryDisplay"
  :query="currentQuery"
  :isCustomMode="isCustomMode"
  @update:query="onQueryUpdate"
/>
```

3. **Conditional chart area**:
```vue
<div v-if="!resolvedConfig.hideChartPreview" class="chart-area">
  <PanelSchemaRenderer ... />
</div>
```

---

## 5. File Changes Summary

### 5.1 New Files

| File | Purpose |
|------|---------|
| `web/src/plugins/logs/BuildQueryPage.vue` | Full-page query builder |
| `web/src/components/dashboards/PanelEditor/GeneratedQueryDisplay.vue` | SQL display component |
| `web/src/utils/query/sqlQueryParser.ts` | SQL parser |
| `web/src/utils/query/sqlQueryParser.spec.ts` | Parser unit tests |

### 5.2 Modified Files

| File | Changes |
|------|---------|
| `web/src/plugins/logs/SearchBar.vue` | Add "Build" toggle button |
| `web/src/plugins/logs/Index.vue` | Add BuildQueryPage, handle toggle |
| `web/src/components/dashboards/PanelEditor/PanelEditor.vue` | Add new config options |
| `web/src/components/dashboards/PanelEditor/types/panelEditor.ts` | Add BUILD_PRESET |
| `web/src/components/dashboards/PanelEditor/index.ts` | Export BUILD_PRESET |
| `web/src/locales/languages/en.json` | Add translations |

---

## 6. Implementation Tasks

### Phase 1: SQL Query Parser
1. Create `sqlQueryParser.ts` with interfaces
2. Implement `isQueryParseable()` - detect complex patterns
3. Implement `parseSQL()` - extract fields/filters
4. Write unit tests (121+ test cases)

### Phase 2: PanelEditor Updates
1. Add new config options to types
2. Create BUILD_PRESET
3. Add QueryTypeSelector integration
4. Create GeneratedQueryDisplay component
5. Add hideChartPreview support

### Phase 3: BuildQueryPage
1. Create BuildQueryPage.vue wrapper
2. Implement initialization from query
3. Implement apply/cancel handlers
4. Style to match existing UI

### Phase 4: Logs Page Integration
1. Add "Build" button to SearchBar
2. Add isBuildDisabled computed
3. Add BuildQueryPage to Index.vue
4. Handle toggle state transitions
5. Sync query between components

### Phase 5: Testing & Polish
1. Test all query parsing scenarios
2. Test mode switching (builder ↔ custom)
3. Test apply flow
4. Add translations
5. Fix edge cases

---

## 7. UI/UX Considerations

### 7.1 When to Disable Build

Build should be disabled when:
- SQL mode is OFF (quick mode doesn't generate SQL)
- Multiple streams are selected (can't map to single stream)

### 7.2 Mode Switching

- **Builder → Custom**: Preserve generated SQL, allow manual editing
- **Custom → Builder**: Try to parse SQL, show warning if complex

### 7.3 Error Handling

When parsing fails:
- Switch to custom mode automatically
- Show info message: "Complex query detected. Using custom mode."
- Display the unparseable reason on hover

---

## 8. Example User Flows

### Flow 1: Build Simple Query from Scratch

1. User on Logs page with empty query
2. Click "Build"
3. Select stream from dropdown
4. Drag `_timestamp` to X-axis
5. Drag `level` to Breakdown
6. Select `COUNT(*)` for Y-axis
7. See generated SQL: `SELECT histogram(_timestamp), COUNT(*), level FROM "default" GROUP BY _timestamp, level`
8. Click "Apply to Search"
9. Returns to Logs view, query executed

### Flow 2: Edit Existing Query

1. User has query: `SELECT * FROM "logs" WHERE level='error'`
2. Click "Build"
3. Parser detects simple query, populates builder:
   - Stream: logs
   - Filters: level = 'error'
4. User adds Y-axis: COUNT(*)
5. User adds Breakdown: host
6. Generated SQL updates in real-time
7. Click "Apply to Search"

### Flow 3: Complex Query (Custom Mode)

1. User has query with CASE statement
2. Click "Build"
3. Parser detects complex pattern
4. Switches to Custom mode automatically
5. Shows message: "Complex query detected. Using custom mode."
6. User can edit SQL directly
7. Click "Apply to Search"

---

## 9. Open Questions

1. **Chart Preview**: Should we show a small chart preview in build mode, or just the query?
   - Recommendation: No preview (simpler, faster)

2. **Stream Selection**: Should build mode allow changing the stream?
   - Recommendation: Yes, show stream dropdown in builder

3. **Save Query**: Should users be able to save built queries as templates?
   - Recommendation: Future enhancement, not in v1

4. **Keyboard Shortcuts**: Should there be keyboard shortcuts for apply/cancel?
   - Recommendation: Ctrl+Enter to apply, Escape to cancel
