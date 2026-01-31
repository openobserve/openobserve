# Logs Query Builder - Implementation Tasks (Revised)

## Overview

This feature adds a **full-page visual query builder** to the Logs page, identical to the Add Panel page in Dashboard. Users can build SQL queries by dragging fields to X/Y/Breakdown areas instead of writing raw SQL.

**Key Principle: REUSE COMMON COMPONENTS**
- We MUST reuse the existing PanelEditor component from Dashboard
- The UI should look exactly like Add Panel page
- No need to create new query builder components - use existing ones

---

## Visual Reference

**The Build page should look EXACTLY like this (Add Panel in Dashboard):**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ [Build Query Header]                           [Cancel] [Apply to Search]   │
├──────┬──────────┬───────────────────────────────────────────────┬──────────┤
│Chart │ Fields   │  Query Builder Area                           │ Config   │
│Types │ ──────── │  ┌──────────────────────────────────────────┐ │ ──────── │
│      │ Search   │  │ SQL/PromQL Toggle  |  Builder/Custom     │ │          │
│[Area]│ ──────── │  └──────────────────────────────────────────┘ │ [Axis]   │
│[Bar] │ _time    │  ┌──────────────────────────────────────────┐ │ [Legend] │
│[Line]│ level    │  │ X-Axis:    [_timestamp ▼] [histogram ▼]  │ │ [Colors] │
│[Pie] │ host     │  │ Y-Axis:    [* ▼] [count ▼]               │ │          │
│...   │ body     │  │ Breakdown: [level ▼]                      │ │          │
│      │ ...      │  │ Filters:   [+ Add filter]                 │ │          │
│      │          │  └──────────────────────────────────────────┘ │          │
│      │          │                                               │          │
│      │          │  ┌──────────────────────────────────────────┐ │          │
│      │          │  │ Generated SQL:                           │ │          │
│      │          │  │ SELECT histogram(_timestamp), COUNT(*),  │ │          │
│      │          │  │ level FROM "default" GROUP BY ...        │ │          │
│      │          │  └──────────────────────────────────────────┘ │          │
└──────┴──────────┴───────────────────────────────────────────────┴──────────┘
```

**Components to REUSE (already exist in codebase):**
- `ChartSelection.vue` - Chart type sidebar
- `FieldList.vue` - Field list with search
- `DashboardQueryBuilder.vue` - X/Y/Breakdown drop zones
- `QueryTypeSelector.vue` - SQL/PromQL and Builder/Custom toggles
- `ConfigPanel.vue` - Right sidebar config
- `PanelSidebar.vue` - Collapsible sidebar wrapper
- `PanelEditor.vue` - Main orchestrator component

---

## Implementation Tasks

### Phase 1: PanelEditor Configuration (~2 hours)

#### Task 1.1: Add new page type "build"
**File:** `src/components/dashboards/PanelEditor/types/panelEditor.ts`
```typescript
// Line ~28: Add 'build' to PanelEditorPageType
export type PanelEditorPageType = "dashboard" | "metrics" | "logs" | "build";
```

#### Task 1.2: Add new config options to PanelEditorConfig
**File:** `src/components/dashboards/PanelEditor/types/panelEditor.ts`
```typescript
// Add to PanelEditorConfig interface (~line 440):
export interface PanelEditorConfig {
  // ... existing options
  showQueryTypeSelector: boolean;
  showGeneratedQueryDisplay: boolean;
  hideChartPreview: boolean;
}
```

#### Task 1.3: Create BUILD_PRESET
**File:** `src/components/dashboards/PanelEditor/types/panelEditor.ts`
```typescript
// Add after LOGS_PRESET (~line 500):
export const BUILD_PRESET: PanelEditorConfig = {
  showQueryEditor: false,
  showQueryBuilder: true,
  showVariablesSelector: false,
  showLastRefreshedTime: false,
  showOutdatedWarning: false,
  showAddToDashboardButton: false,
  showQueryTypeSelector: true,
  showGeneratedQueryDisplay: true,
  hideChartPreview: true,
};
```

#### Task 1.4: Update getPresetByPageType
**File:** `src/components/dashboards/PanelEditor/types/panelEditor.ts`
```typescript
// Add case for 'build' in switch statement:
case "build":
  return BUILD_PRESET;
```

#### Task 1.5: Update resolveConfig
**File:** `src/components/dashboards/PanelEditor/types/panelEditor.ts`
```typescript
// Add new options to resolveConfig:
showQueryTypeSelector: props.showQueryTypeSelector ?? preset.showQueryTypeSelector,
showGeneratedQueryDisplay: props.showGeneratedQueryDisplay ?? preset.showGeneratedQueryDisplay,
hideChartPreview: props.hideChartPreview ?? preset.hideChartPreview,
```

#### Task 1.6: Export BUILD_PRESET
**File:** `src/components/dashboards/PanelEditor/index.ts`
```typescript
export { BUILD_PRESET } from "./types/panelEditor";
```

---

### Phase 2: GeneratedQueryDisplay Component (~1.5 hours)

#### Task 2.1: Create GeneratedQueryDisplay.vue
**File:** `src/components/dashboards/PanelEditor/GeneratedQueryDisplay.vue`

**Purpose:** Displays the generated SQL query with copy button. Read-only in builder mode, editable in custom mode.

**Props:**
- `query: string` - The SQL query to display
- `isCustomMode: boolean` - Whether in custom edit mode

**Emits:**
- `update:query` - When query is edited in custom mode

**Template Structure:**
```vue
<template>
  <div class="generated-query-display">
    <div class="query-header" @click="toggleExpand">
      <q-icon :name="isExpanded ? 'expand_less' : 'expand_more'" />
      <span>{{ isCustomMode ? 'Custom SQL' : 'Generated SQL' }}</span>
      <q-btn flat icon="content_copy" @click.stop="copyQuery" />
    </div>
    <div v-show="isExpanded" class="query-content">
      <pre v-if="!isCustomMode">{{ query }}</pre>
      <textarea v-else v-model="editableQuery" @input="onQueryChange" />
    </div>
  </div>
</template>
```

---

### Phase 3: PanelEditor Template Updates (~1.5 hours)

#### Task 3.1: Import GeneratedQueryDisplay
**File:** `src/components/dashboards/PanelEditor/PanelEditor.vue`
```typescript
// Add async import:
const GeneratedQueryDisplay = defineAsyncComponent(
  () => import("./GeneratedQueryDisplay.vue"),
);
```

#### Task 3.2: Add QueryTypeSelector to template
**File:** `src/components/dashboards/PanelEditor/PanelEditor.vue`
```vue
<!-- Before DashboardQueryBuilder (~line 126) -->
<QueryTypeSelector v-if="resolvedConfig.showQueryTypeSelector" />
```

#### Task 3.3: Add GeneratedQueryDisplay to template
**File:** `src/components/dashboards/PanelEditor/PanelEditor.vue`
```vue
<!-- After DashboardQueryBuilder, before chart area -->
<GeneratedQueryDisplay
  v-if="resolvedConfig.showGeneratedQueryDisplay"
  :query="dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]?.query"
  :isCustomMode="dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex]?.customQuery"
  @update:query="onGeneratedQueryUpdate"
/>
```

#### Task 3.4: Add hideChartPreview condition
**File:** `src/components/dashboards/PanelEditor/PanelEditor.vue`
```vue
<!-- Wrap chart area with v-if -->
<div v-if="!resolvedConfig.hideChartPreview" class="chart-area">
  <PanelSchemaRenderer ... />
</div>
```

#### Task 3.5: Add handler function
**File:** `src/components/dashboards/PanelEditor/PanelEditor.vue`
```typescript
const onGeneratedQueryUpdate = (newQuery: string) => {
  dashboardPanelData.data.queries[
    dashboardPanelData.layout.currentQueryIndex
  ].query = newQuery;
};
```

---

### Phase 4: SQL Query Parser (~3 hours)

#### Task 4.1: Create parser file
**File:** `src/utils/query/sqlQueryParser.ts`

#### Task 4.2: Define interfaces
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
```

#### Task 4.3: Implement isQueryParseable()
Detect complex patterns that cannot be parsed:
- Subqueries
- CASE/WHEN statements
- UNION/INTERSECT/EXCEPT
- Window functions (OVER, PARTITION BY)
- 3+ JOINs

#### Task 4.4: Implement parseSQL()
Extract fields from simple queries:
- SELECT fields with aggregations
- FROM clause (stream name)
- WHERE conditions
- GROUP BY fields

#### Task 4.5: Write unit tests
**File:** `src/utils/query/sqlQueryParser.spec.ts`
- Test isQueryParseable for various patterns
- Test parseSQL for simple queries
- Test edge cases

---

### Phase 5: BuildQueryPage Component (~2 hours)

#### Task 5.1: Create BuildQueryPage.vue
**File:** `src/plugins/logs/BuildQueryPage.vue`

**Purpose:** Full-page wrapper that hosts PanelEditor with BUILD_PRESET configuration.

**Template:**
```vue
<template>
  <div class="build-query-page">
    <!-- Header with Apply/Cancel buttons -->
    <div class="build-query-header">
      <h3>Build Query</h3>
      <div class="header-actions">
        <q-btn flat label="Cancel" @click="onCancel" />
        <q-btn color="primary" label="Apply to Search" @click="onApply" />
      </div>
    </div>

    <!-- PanelEditor with BUILD_PRESET -->
    <div class="build-query-content">
      <PanelEditor
        ref="panelEditorRef"
        pageType="build"
      />
    </div>
  </div>
</template>
```

#### Task 5.2: Implement initialization logic
```typescript
const initializeFromQuery = async (query: string, stream: string) => {
  resetDashboardPanelData();

  // Set stream
  dashboardPanelData.data.queries[0].fields.stream = stream;
  dashboardPanelData.data.queries[0].fields.stream_type = 'logs';

  if (!query) {
    dashboardPanelData.data.queries[0].customQuery = false;
    return;
  }

  // Try to parse
  const parsed = parseSQL(query);
  if (parsed && !parsed.customQuery) {
    applyParsedFields(parsed);
    dashboardPanelData.data.queries[0].customQuery = false;
  } else {
    dashboardPanelData.data.queries[0].query = query;
    dashboardPanelData.data.queries[0].customQuery = true;
  }
};
```

#### Task 5.3: Implement apply/cancel handlers
```typescript
const onApply = () => {
  const query = dashboardPanelData.data.queries[0].query;
  emit('apply', query);
};

const onCancel = () => {
  emit('cancel');
};
```

---

### Phase 6: Logs Page Integration (~2 hours)

#### Task 6.1: Add Build button to SearchBar
**File:** `src/plugins/logs/SearchBar.vue`
```vue
<!-- After Visualize button -->
<q-btn
  data-test="logs-build-toggle"
  :class="searchObj.meta.logsVisualizeToggle === 'build' ? 'selected' : ''"
  @click="onLogsVisualizeToggleUpdate('build')"
  :disable="isBuildDisabled"
  icon="construction"
>
  <q-tooltip>{{ t("search.buildQuery") }}</q-tooltip>
</q-btn>
```

#### Task 6.2: Add isBuildDisabled computed
**File:** `src/plugins/logs/SearchBar.vue`
```typescript
const isBuildDisabled = computed(() => {
  return !searchObj.meta.sqlMode ||
         searchObj.data.stream.selectedStream.length !== 1;
});
```

#### Task 6.3: Add BuildQueryPage to Index.vue
**File:** `src/plugins/logs/Index.vue`
```vue
<!-- After visualize-container -->
<div
  v-show="searchObj.meta.logsVisualizeToggle == 'build'"
  class="build-container"
>
  <BuildQueryPage
    ref="buildQueryPageRef"
    :searchQuery="searchObj.data.query"
    :selectedStream="searchObj.data.stream.selectedStream[0]"
    @apply="onBuildApply"
    @cancel="onBuildCancel"
  />
</div>
```

#### Task 6.4: Import BuildQueryPage
**File:** `src/plugins/logs/Index.vue`
```typescript
const BuildQueryPage = defineAsyncComponent(
  () => import("./BuildQueryPage.vue"),
);
```

#### Task 6.5: Add handlers
**File:** `src/plugins/logs/Index.vue`
```typescript
const onBuildApply = (query: string) => {
  searchObj.data.query = query;
  searchObj.meta.logsVisualizeToggle = 'logs';
  handleRunQueryFn();
};

const onBuildCancel = () => {
  searchObj.meta.logsVisualizeToggle = 'logs';
};
```

---

### Phase 7: Translations (~30 min)

#### Task 7.1: Add English translations
**File:** `src/locales/languages/en.json`
```json
{
  "search": {
    "buildQuery": "Build",
    "enableSqlModeForBuild": "Enable SQL mode to use query builder",
    "generatedSql": "Generated SQL",
    "customSql": "Custom SQL",
    "applyToSearch": "Apply to Search",
    "complexQueryDetected": "Complex query detected. Using custom mode."
  }
}
```

---

### Phase 8: Styling (~1 hour)

#### Task 8.1: Add build-query-page styles
**File:** `src/plugins/logs/BuildQueryPage.vue` (scoped style)
```scss
.build-query-page {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.build-query-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--q-separator);
}

.build-query-content {
  flex: 1;
  overflow: hidden;
}
```

#### Task 8.2: Add build-container styles
**File:** `src/plugins/logs/Index.vue` or logs-page.scss
```scss
.build-container {
  height: 100%;
  width: 100%;
}
```

---

## Summary

**Total Estimated Time:** ~13-14 hours

**Components Reused (NO new creation needed):**
- PanelEditor.vue
- ChartSelection.vue
- FieldList.vue
- DashboardQueryBuilder.vue
- QueryTypeSelector.vue
- ConfigPanel.vue
- PanelSidebar.vue

**New Components:**
- BuildQueryPage.vue (~150 lines) - thin wrapper
- GeneratedQueryDisplay.vue (~100 lines) - SQL display

**New Utilities:**
- sqlQueryParser.ts (~400 lines) - SQL parsing

**Key Principle:** The Build page should look EXACTLY like Add Panel page. We are simply reusing PanelEditor with `pageType="build"` configuration.
