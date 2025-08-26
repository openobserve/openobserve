# OpenObserve Logs Module Refactoring Requirements

## Project Overview
The current `useLogs.ts` composable has grown to **6,876 lines** of code, making it extremely difficult to maintain. This document outlines the comprehensive requirements and step-by-step plan for refactoring it into a modular, maintainable structure.

## Current State Analysis

### File Statistics
- **Current File**: `web/src/composables/useLogs.ts`
- **Lines of Code**: 6,876 lines
- **Functions Exported**: 67+ public functions
- **Internal Functions**: 100+ private functions
- **Dependencies**: Heavy reliance on Quasar, Vue 3 Composition API, Vuex, Vue Router

### Current Public API (Functions Returned by useLogs)
Based on analysis, the composable exports the following functions:

#### Core Functions
- `searchObj`, `searchAggData`
- `resetSearchObj`, `resetStreamData`
- `clearSearchObj`, `initialLogsState`

#### Stream Management
- `getStreams`, `getStreamList`, `loadStreamLists`
- `onStreamChange`, `updateStreams`, `setSelectedStreams`
- `getStream`

#### Query Operations
- `getQueryData`, `loadLogsData`, `handleQueryData`
- `handleRunQuery`, `buildSearch`, `cancelQuery`
- `fnParsedSQL`, `fnUnparsedSQL`
- `validateFilterForMultiStream`
- `isLimitQuery`, `isDistinctQuery`, `hasAggregation`

#### Field Operations
- `extractFields`, `extractFTSFields`
- `updatedLocalLogFilterField`, `fieldValues`
- `updateGridColumns`, `filterHitsColumns`
- `reorderSelectedFields`

#### Histogram & Visualization
- `generateHistogramData`, `getHistogramQueryData`
- `generateHistogramSkeleton`, `resetHistogramWithError`
- `loadVisualizeData`, `processHttpHistogramResults`
- `getVisualizationConfig`, `encodeVisualizationConfig`, `decodeVisualizationConfig`

#### Data Operations
- `refreshData`, `refreshPagination`, `refreshPartitionPagination`
- `refreshJobPagination`, `searchAroundData`
- `getJobData`, `loadJobData`

#### URL & Route Management
- `updateUrlQueryParams`, `restoreUrlQueryParams`
- `generateURLQuery`, `routeToSearchSchedule`

#### Functions & Actions
- `getFunctions`, `getActions`
- `isActionsEnabled`

#### WebSocket & Communication
- `buildWebSocketPayload`, `initializeSearchConnection`
- `sendCancelSearchMessage`, `setCommunicationMethod`

#### Utility Functions
- `extractTimestamps`, `extractValueQuery`
- `getFilterExpressionByFieldType`, `getSavedViews`
- `getRegionInfo`, `addTraceId`
- `enableRefreshInterval`

## Refactoring Goals

### 1. **Maintain Existing Functionality**
- **Zero Breaking Changes**: All existing functionality must work exactly as before
- **API Compatibility**: The way the rest of the app uses `useLogs` should remain identical
- **Test Coverage**: Ensure all existing tests pass after each refactoring step

### 2. **Gradual Refactoring**
- **One Function at a Time**: Refactor incrementally to minimize risk
- **Test-Driven**: Each step must be testable and verifiable
- **Rollback Capability**: Maintain ability to revert changes if issues arise

### 3. **Industry Standards & Clean Code**
- **Vue 3 + Composition API Best Practices**
- **Quasar Framework Patterns**
- **TypeScript Strong Typing**
- **Max 1000 LOC per file**
- **Single Responsibility Principle**

### 4. **Separation of Concerns**

#### Core Business Logic → Composables
- Stream management logic
- Query building and execution logic  
- State management
- Reactive data handling

#### Reusable Utilities → `web/src/utils/logs/`
- Data formatting functions
- Input validation
- String parsing and manipulation
- Date/time utilities
- Generic helper functions

#### API Communication → `web/src/services/logs/`
- HTTP requests to backend
- WebSocket connections
- Response processing
- Error handling

#### UI State → Composables (minimal)
- Component-specific reactive state
- UI interaction handlers

## Target File Structure

```
web/src/composables/
  useLogs/
    index.ts              # Main entry point, exports all public functions
    useLogsCore.ts        # Core composable with main state and lifecycle
    useLogsState.ts       # Reactive state management
    useLogsStreams.ts     # Stream-related operations
    useLogsQuery.ts       # Query building and execution
    useLogsFilters.ts     # Filtering and search logic
    useLogsActions.ts     # Actions and functions management
    useLogsVisualization.ts # Histogram and visualization logic
    useLogsWebSocket.ts   # WebSocket communication
    useLogsURL.ts         # URL and route management

web/src/utils/logs/
    formatters.ts         # Data formatting utilities
    validators.ts         # Input validation functions
    parsers.ts            # Query and data parsing
    datetime.ts           # Date/time utilities
    transformers.ts       # Data transformation helpers
    constants.ts          # Logs-specific constants

web/src/services/logs/
    logsApi.ts            # HTTP API calls
    logsWebSocket.ts      # WebSocket service
    logsJobs.ts           # Job-related API calls
    savedViewsApi.ts      # Saved views API operations

web/src/plugins/logs/     # Keep existing Vue components
    [existing files...]
```

## Function Categorization

### Category 1: State Management (→ useLogsState.ts)
- `searchObj`, `searchAggData`
- `resetSearchObj`, `resetStreamData`
- `clearSearchObj`, `initialLogsState`
- `fieldValues`

### Category 2: Stream Operations (→ useLogsStreams.ts)
- `getStreams`, `getStreamList`, `loadStreamLists`
- `onStreamChange`, `updateStreams`, `setSelectedStreams`
- `getStream`

### Category 3: Query Operations (→ useLogsQuery.ts)
- `getQueryData`, `loadLogsData`, `handleQueryData`
- `handleRunQuery`, `buildSearch`, `cancelQuery`
- `fnParsedSQL`, `fnUnparsedSQL`
- `validateFilterForMultiStream`
- `isLimitQuery`, `isDistinctQuery`, `hasAggregation`

### Category 4: Field Operations (→ useLogsFilters.ts)
- `extractFields`, `extractFTSFields`
- `updatedLocalLogFilterField`
- `updateGridColumns`, `filterHitsColumns`
- `reorderSelectedFields`
- `getFilterExpressionByFieldType`

### Category 5: API Calls (→ services/logs/)
- Direct API calls within functions
- WebSocket communication logic
- HTTP request handling

### Category 6: Utility Functions (→ utils/logs/)
- `extractTimestamps`, `extractValueQuery`
- Data formatting functions
- Validation functions
- Parsing functions

## Refactoring Implementation Plan

### Phase 1: Preparation & Analysis
- [x] **Task 1.1**: Analyze current structure and catalog functions ✅
- [x] **Task 1.2**: Create backup copy of original useLogs.ts ✅
- [x] **Task 1.3**: Set up new directory structure ✅
- [x] **Task 1.4**: Categorize all functions by responsibility ✅
- [x] **Task 1.5**: Create initial test coverage report ✅

### Phase 2: Extract Utilities (Low Risk)
- [x] **Task 2.1**: Extract constants to `utils/logs/constants.ts` ✅
- [x] **Task 2.2**: Extract date/time utility functions → `utils/logs/datetime.ts` ✅
- [x] **Task 2.3**: Extract data formatting functions → `utils/logs/formatters.ts` ✅
- [x] **Task 2.4**: Extract validation functions → `utils/logs/validators.ts` ✅
- [x] **Task 2.5**: Extract parsing functions → `utils/logs/parsers.ts` ✅
- [x] **Task 2.6**: Extract transformation helpers → `utils/logs/transformers.ts` ✅
- [x] **Task 2.7**: Test utility functions in isolation ✅

### Phase 3: Extract API Layer (Medium Risk)
- [ ] **Task 3.1**: Extract HTTP API calls → `services/logs/logsApi.ts`
- [ ] **Task 3.2**: Extract WebSocket logic → `services/logs/logsWebSocket.ts`
- [ ] **Task 3.3**: Extract job-related APIs → `services/logs/logsJobs.ts`
- [ ] **Task 3.4**: Extract saved views APIs → `services/logs/savedViewsApi.ts`
- [ ] **Task 3.5**: Update composable to use new API services
- [ ] **Task 3.6**: Test API integration

### Phase 4: Split Core Composable (High Risk)
- [ ] **Task 4.1**: Create `useLogsState.ts` with reactive state
- [ ] **Task 4.2**: Create `useLogsStreams.ts` with stream operations
- [ ] **Task 4.3**: Create `useLogsQuery.ts` with query logic
- [ ] **Task 4.4**: Create `useLogsFilters.ts` with filtering logic
- [ ] **Task 4.5**: Create `useLogsActions.ts` with actions management
- [ ] **Task 4.6**: Create `useLogsVisualization.ts` with histogram logic
- [ ] **Task 4.7**: Create `useLogsWebSocket.ts` with WebSocket handling
- [ ] **Task 4.8**: Create `useLogsURL.ts` with URL management

### Phase 5: Integration & Testing
- [ ] **Task 5.1**: Create `useLogs/index.ts` as main entry point
- [ ] **Task 5.2**: Update imports across the application
- [ ] **Task 5.3**: Run comprehensive test suite
- [ ] **Task 5.4**: Performance testing and optimization
- [ ] **Task 5.5**: Code review and documentation

### Phase 6: Documentation & Team Adoption
- [ ] **Task 6.1**: Create migration guide
- [ ] **Task 6.2**: Update developer documentation
- [ ] **Task 6.3**: Team training and knowledge transfer
- [ ] **Task 6.4**: Monitor production deployment

## Quality Assurance Requirements

### Testing Strategy
1. **Unit Tests**: Each extracted module must have comprehensive unit tests
2. **Integration Tests**: Verify modules work together correctly
3. **E2E Tests**: Ensure UI functionality remains intact
4. **Performance Tests**: Verify no performance regression

### Code Quality Standards
1. **TypeScript**: Maintain strong typing throughout
2. **ESLint**: Follow existing linting rules
3. **Code Coverage**: Maintain or improve current coverage
4. **Documentation**: JSDoc comments for all public functions

### Backup & Rollback Plan
1. **Version Control**: Each step committed separately
2. **Feature Branches**: Use feature branches for major changes  
3. **Backup Files**: Keep original files as `.backup` until complete
4. **Rollback Procedure**: Document rollback steps for each phase

## Risk Assessment

### Low Risk
- Extracting pure utility functions
- Moving constants and type definitions
- Adding documentation

### Medium Risk
- Extracting API calls
- Splitting reactive state
- Updating imports

### High Risk
- Changing core composable structure
- Modifying component integrations
- WebSocket connection handling

## Success Metrics

### Code Quality
- **Lines per file**: < 1000 LOC
- **Cyclomatic complexity**: < 10 per function
- **Code coverage**: Maintain current levels
- **Build time**: No significant increase

### Functionality
- **Zero breaking changes**: All existing features work
- **Performance**: No regression in load times
- **Memory usage**: No increase in memory footprint
- **Bundle size**: Maintain or reduce overall size

## Task Tracking

### Task Status Legend
- 🔵 **Pending**: Not started
- 🟡 **In Progress**: Currently working on
- 🟢 **Completed**: Finished and tested
- 🔴 **Blocked**: Cannot proceed due to dependencies
- ⚠️ **Needs Review**: Ready for code review

### Current Status: PHASE 1 - PREPARATION & ANALYSIS

#### Next Immediate Actions
1. Create backup copy of useLogs.ts
2. Set up directory structure for new modules
3. Begin categorizing functions by responsibility
4. Start with lowest-risk utility function extraction

---

**Last Updated**: 2025-08-26  
**Document Version**: 1.0  
**Status**: Requirements Complete - Ready for Implementation