# 🔥 Logs Module Refactoring Plan

## 📊 Current State Analysis

### Critical Issues Identified
- **useLogs.ts**: 6,819 lines (CRITICAL - should be ~1,000)
- **SearchBar.vue**: 4,516 lines (CRITICAL - should be ~500) 
- **Index.vue**: 2,555 lines (SEVERE - should be ~800)
- **IndexList.vue**: 2,336 lines (SEVERE - should be ~600)
- **Total Module Size**: ~17,000 lines across all components
- **Extreme coupling**: Components importing 15-30 functions from useLogs

### Component Analysis

| Component | Current Lines | Target Lines | Priority | Issues |
|-----------|--------------|--------------|----------|---------|
| useLogs.ts | 6,819 | 1,000 | 🔥 CRITICAL | Massive monolith with all business logic |
| SearchBar.vue | 4,516 | 500 | 🔥 CRITICAL | Query editor, datetime, streams, controls |
| Index.vue | 2,555 | 800 | 🚨 SEVERE | Main container with heavy orchestration |
| IndexList.vue | 2,336 | 400 | 🚨 SEVERE | Fields management with complex logic |
| SearchResult.vue | 1,058 | 600 | ⚠️ MEDIUM | Results display and pagination |
| TenstackTable.vue | 972 | 972 | ✅ OK | Well-structured, no changes needed |
| JsonPreview.vue | 660 | 660 | ✅ OK | Reasonable size, minor optimizations |
| DetailTable.vue | 584 | 584 | ✅ OK | Good structure, no changes needed |

## 🎯 Target Architecture

### New Composable Structure

```
composables/logs/
├── core/
│   ├── useLogs.ts                    # Main orchestrator (1,000 lines)
│   └── shared/
│       ├── logsState.ts              # Central state (200 lines)
│       ├── logsEvents.ts             # Event bus (100 lines)
│       └── logsTypes.ts              # Type definitions (100 lines)
├── features/
│   ├── useLogsSearch.ts              # Search & query execution (800 lines)
│   ├── useLogsSQL.ts                 # SQL parsing & streams (600 lines)  
│   ├── useLogsFields.ts              # Field management (500 lines)
│   ├── useLogsDateTime.ts            # Date/time operations (300 lines)
│   ├── useLogsHistogram.ts           # Histogram & aggregation (400 lines)
│   ├── useLogsStreaming.ts           # WebSocket & real-time (600 lines)
│   ├── useLogsGrid.ts                # Table & pagination (400 lines)
│   └── useLogsStorage.ts             # Local storage & persistence (300 lines)
└── utils/
    ├── queryUtils.ts                 # Pure SQL utilities (200 lines)
    ├── dateUtils.ts                  # Date formatting utilities (150 lines)
    └── fieldUtils.ts                 # Field processing utilities (200 lines)
```

### New Component Structure

```
plugins/logs/
├── Index.vue                         # Main container (800 lines)
├── search/
│   ├── SearchBar/
│   │   ├── SearchBar.vue             # Main search component (500 lines)
│   │   ├── QueryEditor.vue           # Monaco editor wrapper (300 lines)
│   │   ├── DateTimePicker.vue        # Date/time controls (400 lines)
│   │   ├── StreamSelector.vue        # Stream selection (250 lines)
│   │   └── QueryControls.vue         # Buttons & toggles (200 lines)
│   ├── SearchResult.vue              # Results display (600 lines)
│   └── SearchHistory.vue             # Query history (unchanged)
├── fields/
│   ├── FieldsList/
│   │   ├── FieldsList.vue            # Main fields component (400 lines)
│   │   ├── FieldSearch.vue           # Field search/filter (200 lines)
│   │   ├── FieldItem.vue             # Individual field (150 lines)
│   │   └── InterestingFields.vue     # Interesting fields mgmt (250 lines)
│   └── FieldActions.vue              # Field action handlers (200 lines)
├── table/
│   ├── TenstackTable.vue             # High-perf table (unchanged)
│   ├── DetailTable.vue               # Detail dialog (unchanged)
│   └── JsonPreview.vue               # JSON preview (unchanged)
└── visualization/
    └── LogsChart.vue                 # Chart visualization (400 lines)
```

## 📋 Implementation Phases

### **PHASE 1: Composable Splitting** (Most Critical - 4-6 weeks)

#### **1A: Shared Foundation** (Week 1)
**Files to Create:**
- `composables/logs/shared/logsState.ts`
- `composables/logs/shared/logsEvents.ts` 
- `composables/logs/shared/logsTypes.ts`

**Tasks:**
- Extract reactive state from useLogs into shared state
- Create event bus for component communication
- Define TypeScript interfaces for all data structures
- Create singleton state instance

**Code Example:**
```typescript
// composables/logs/shared/logsState.ts
export const createLogsState = () => ({
  data: reactive({
    query: "",
    queryResults: { hits: [], total: 0 },
    selectedStreams: [],
    stream: {
      selectedStream: [],
      selectedFields: [],
      interestingFieldList: [],
      // ... all stream configuration
    },
    tempFunctionContent: "",
    parsedQuery: {},
    // ... all reactive data from current searchObj
  }),
  meta: reactive({
    loading: false,
    loadingHistogram: false,
    sqlMode: false,
    showHistogram: true,
    refreshInterval: 0,
    // ... all metadata from current searchObj
  }),
  config: reactive({
    splitterModel: 20,
    fnSplitterModel: 60,
    // ... all configuration
  })
})

export const logsState = createLogsState()
```

#### **1B: SQL Operations Extraction** (Week 1-2)
**File to Create:** `composables/logs/features/useLogsSQL.ts`

**Functions to Extract from useLogs:**
- `fnParsedSQL()` - SQL parsing with AST
- `setSelectedStreams()` - Stream extraction from queries (including your recent circular dependency fix!)
- `extractValueQuery()` - Query value extraction  
- `hasAggregation()` - Aggregation detection
- `isLimitQuery()` - Limit clause detection
- `isDistinctQuery()` - Distinct query detection
- SQL transformation utilities

**Dependencies:** Only uses logsState, no circular dependencies

#### **1C: Search Operations Extraction** (Week 2)
**File to Create:** `composables/logs/features/useLogsSearch.ts`

**Functions to Extract:**
- `searchData()` - Main search orchestration
- `getPaginatedData()` - Pagination handling
- `buildWebSocketPayload()` - WebSocket payload construction
- `loadJobData()` - Job data loading
- `refreshPagination()` - Pagination refresh
- HTTP/WebSocket request handling
- Search result processing

**Dependencies:** Uses logsState + useLogsSQL

#### **1D: Fields Management Extraction** (Week 2-3)
**File to Create:** `composables/logs/features/useLogsFields.ts`

**Functions to Extract:**
- Field processing and filtering logic
- `getInterestingFields()` - Interesting fields management
- Field schema handling and caching
- Field value operations and fetching
- Stream field extraction
- User-defined schema operations

#### **1E: DateTime Operations Extraction** (Week 3)
**File to Create:** `composables/logs/features/useLogsDateTime.ts`

**Functions to Extract:**
- Date/time range validation and processing
- Timezone handling and conversion
- Timestamp formatting and parsing
- Relative time calculations
- Date picker integration logic

#### **1F: Histogram Extraction** (Week 3-4)
**File to Create:** `composables/logs/features/useLogsHistogram.ts`

**Functions to Extract:**
- `generateHistogram()` - Histogram generation
- `processHistogramResults()` - Result processing
- `getHistogramQueryData()` - Query data preparation
- `processHttpHistogramResults()` - HTTP result processing
- Chart data transformation and aggregation

#### **1G: Streaming Operations Extraction** (Week 4)
**File to Create:** `composables/logs/features/useLogsStreaming.ts`

**Functions to Extract:**
- All WebSocket handlers and management
- Real-time data processing
- Streaming response handling
- Connection management and reconnection
- Live data updates and notifications

#### **1H: Grid/Table Operations Extraction** (Week 4-5)
**File to Create:** `composables/logs/features/useLogsGrid.ts`

**Functions to Extract:**
- Column management and reordering
- Table pagination logic
- Row expansion and detail handling
- Data grid formatting and processing
- Export functionality

#### **1I: Storage Operations Extraction** (Week 5)
**File to Create:** `composables/logs/features/useLogsStorage.ts`

**Functions to Extract:**
- Local storage management
- Saved views persistence
- Query history storage
- User preferences storage
- Cache management

#### **1J: Main useLogs Orchestrator Refactor** (Week 5-6)
**Refactor:** `composables/useLogs.ts`

**New Structure:**
```typescript
// composables/useLogs.ts - Main orchestrator (1,000 lines)
export function useLogs() {
  // Import all feature composables
  const sql = useLogsSQL()
  const search = useLogsSearch(sql)
  const fields = useLogsFields()
  const datetime = useLogsDateTime()
  const histogram = useLogsHistogram(search)
  const streaming = useLogsStreaming(search)
  const grid = useLogsGrid()
  const storage = useLogsStorage()

  // Cross-feature coordination and watchers
  watch(() => logsState.data.query, (newQuery) => {
    sql.setSelectedStreams(newQuery)
    fields.resetInterestingFields()
  })

  watch(() => logsState.data.queryResults, () => {
    if (logsState.meta.showHistogram) {
      histogram.generateHistogram()
    }
  })

  // Return unified API for components
  return {
    // State access
    searchObj: logsState,
    
    // Search operations
    searchData: search.searchData,
    getPaginatedData: search.getPaginatedData,
    
    // SQL operations
    setSelectedStreams: sql.setSelectedStreams,
    fnParsedSQL: sql.fnParsedSQL,
    
    // Field operations
    getInterestingFields: fields.getInterestingFields,
    
    // ... expose only what components need
  }
}
```

### **PHASE 2: Component Splitting** (3-4 weeks)

#### **2A: SearchBar Component Decomposition** (Week 7-8)
**Current:** SearchBar.vue (4,516 lines)
**Target:** SearchBar.vue (500 lines) + 4 sub-components

**Components to Create:**

1. **QueryEditor.vue** (300 lines)
   - Monaco editor integration
   - Syntax highlighting and validation
   - Autocomplete and suggestions
   - Query formatting

2. **DateTimePicker.vue** (400 lines)
   - Date range selection
   - Relative time options
   - Timezone handling
   - Quick time selections

3. **StreamSelector.vue** (250 lines)
   - Multi-stream selection
   - Stream search and filtering
   - Stream validation

4. **QueryControls.vue** (200 lines)
   - Search/refresh buttons
   - SQL mode toggle
   - Query execution controls
   - Auto-refresh settings

**Refactored SearchBar.vue:**
```vue
<template>
  <div class="search-bar-container">
    <div class="search-controls">
      <QueryEditor 
        v-model:query="searchObj.data.query"
        :suggestions="suggestions"
        :keywords="keywords"
      />
      <StreamSelector 
        v-model:streams="searchObj.data.selectedStreams"
        :available-streams="availableStreams"
      />
    </div>
    
    <div class="time-controls">
      <DateTimePicker 
        v-model:datetime="searchObj.meta.dateTime"
        @change="handleDateTimeChange"
      />
      <QueryControls 
        :loading="searchObj.meta.loading"
        :sql-mode="searchObj.meta.sqlMode"
        @search="handleSearch"
        @toggle-sql="toggleSQLMode"
      />
    </div>
  </div>
</template>

<script setup>
// Only imports main composable
const { 
  searchObj, 
  searchData, 
  toggleSQLMode,
  getSuggestions,
  getAvailableStreams 
} = useLogs()

// Component-specific logic only
const suggestions = computed(() => getSuggestions())
const availableStreams = computed(() => getAvailableStreams())

const handleSearch = () => searchData()
const handleDateTimeChange = (datetime) => {
  // Handle datetime change
}
</script>
```

#### **2B: IndexList Fields Component Decomposition** (Week 8-9)
**Current:** IndexList.vue (2,336 lines)  
**Target:** FieldsList.vue (400 lines) + 4 sub-components

**Components to Create:**

1. **FieldsList.vue** (400 lines) - Main container
2. **FieldSearch.vue** (200 lines) - Search and filtering
3. **FieldItem.vue** (150 lines) - Individual field display  
4. **InterestingFields.vue** (250 lines) - Interesting fields management

#### **2C: Index.vue Main Container Refactor** (Week 9-10)
**Current:** Index.vue (2,555 lines)
**Target:** Index.vue (800 lines)

**Extraction Strategy:**
- Move visualization logic to separate composable
- Extract schema caching to service
- Simplify orchestration logic
- Remove duplicate state management

### **PHASE 3: Integration & Testing** (2 weeks)

#### **3A: Component Integration** (Week 11)
- Update all component imports to use only `useLogs`
- Remove direct feature composable imports
- Ensure proper prop passing and event handling
- Update component registration and routing

#### **3B: Testing Implementation** (Week 11-12)
- Unit tests for each composable in isolation
- Integration tests for component interactions  
- Performance testing for large datasets
- Memory leak testing for streaming operations
- E2E test updates for new component structure

### **PHASE 4: Validation & Optimization** (1 week)

#### **4A: Performance Validation** (Week 12)
- Bundle size analysis and optimization
- Runtime performance testing
- Memory usage profiling
- Tree shaking validation

#### **4B: Documentation & Cleanup** (Week 12)
- Update component documentation
- Create development guidelines
- Clean up unused code and imports
- Update type definitions

## 🎯 Success Metrics

### **Code Size Reduction Goals:**
| Component | Before | After | Reduction |
|-----------|--------|-------|-----------|
| useLogs.ts | 6,819 lines | 1,000 lines | 85% ↓ |
| SearchBar.vue | 4,516 lines | 500 lines | 89% ↓ |
| Index.vue | 2,555 lines | 800 lines | 69% ↓ |
| IndexList.vue | 2,336 lines | 400 lines | 83% ↓ |
| **Total Module** | **~17,000 lines** | **~8,000 lines** | **53% ↓** |

### **Architecture Improvements:**
- ✅ **Single Responsibility**: Each composable has one clear purpose
- ✅ **Reduced Coupling**: Components import max 5 functions instead of 30+
- ✅ **Better Testing**: Isolated composables can be unit tested
- ✅ **Improved Performance**: Smaller bundles and better tree shaking
- ✅ **Developer Experience**: Easier navigation and maintenance
- ✅ **Maintainability**: Clear separation of concerns

### **Dependency Management:**
```
Before: 
Components → useLogs (6,819 lines with everything)

After:
Components → useLogs (1,000 lines orchestrator) 
           ↓
Feature Composables (8 focused modules)
           ↓  
Shared State & Utils
```

## 🚀 Implementation Guidelines

### **Development Principles**
1. **No Circular Dependencies**: Follow strict hierarchy
   - Level 1: Utils & Types (no dependencies)
   - Level 2: Shared State (utils only)
   - Level 3: Feature Composables (state + utils)
   - Level 4: Main useLogs (all levels)

2. **Component Import Rules**: 
   - ✅ Components can ONLY import `useLogs`
   - ❌ Components CANNOT import feature composables directly
   - ✅ Feature composables can import shared state and utils
   - ❌ Feature composables CANNOT import each other

3. **State Management**:
   - All reactive state lives in `logsState`
   - Feature composables modify shared state
   - Components read from shared state via useLogs
   - Use events for cross-feature communication

### **Testing Strategy**
- **Unit Tests**: Each composable tested in isolation with mocked dependencies
- **Integration Tests**: Test composable interactions through useLogs
- **Component Tests**: Test UI components with mocked useLogs
- **E2E Tests**: Test complete user workflows

### **Migration Strategy**
1. **Feature Flags**: Implement toggles for gradual rollout
2. **Backward Compatibility**: Keep original useLogs during transition
3. **Incremental Migration**: Migrate one feature at a time
4. **Comprehensive Testing**: Test at each migration step

## 🚨 Risk Mitigation

### **Potential Risks & Solutions**

1. **Breaking Changes**: 
   - Keep original files as backup
   - Implement comprehensive test coverage
   - Use feature flags for gradual rollout

2. **Performance Regression**:
   - Benchmark before and after changes
   - Profile memory usage and bundle size
   - Optimize critical paths

3. **State Management Issues**:
   - Careful event system design
   - Clear state ownership rules  
   - Thorough integration testing

4. **Developer Adoption**:
   - Comprehensive documentation
   - Code examples and migration guides
   - Team training and support

## 📅 Timeline Summary

| Phase | Duration | Key Deliverables |
|-------|----------|------------------|
| Phase 1A-C | 2 weeks | Foundation + SQL + Search composables |
| Phase 1D-F | 2 weeks | Fields + DateTime + Histogram composables |
| Phase 1G-J | 2 weeks | Streaming + Grid + Storage + Main orchestrator |
| Phase 2A | 1 week | SearchBar component split |
| Phase 2B-C | 2 weeks | FieldsList + Index component refactor |
| Phase 3 | 2 weeks | Integration + Testing |
| Phase 4 | 1 week | Validation + Documentation |

**Total Estimated Timeline: 12 weeks**

## 💡 Long-term Benefits

### **Maintainability**
- Easier to onboard new developers
- Clear code organization and structure
- Reduced cognitive load when working on features
- Better code reusability across components

### **Performance**
- Smaller bundle sizes through better tree shaking
- Reduced memory usage with focused composables
- Improved runtime performance with optimized state management
- Better caching and memoization opportunities

### **Developer Experience**
- Faster development cycles
- Easier debugging and troubleshooting
- Better TypeScript support and IntelliSense
- Simplified testing and mocking

### **Scalability**
- Easy to add new features without affecting existing code
- Clear patterns for future development
- Simplified integration with other modules
- Better support for micro-frontend architecture

---

**This refactoring will transform the logs module from an unmaintainable monolith into a clean, testable, and scalable architecture! 🎉**

---

## 📞 Support & Questions

For questions about this refactoring plan:
- Create an issue in the project repository
- Discuss in team architecture reviews
- Refer to Vue.js Composition API best practices
- Follow established coding standards and conventions