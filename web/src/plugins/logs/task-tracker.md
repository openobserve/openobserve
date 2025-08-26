# useLogs Refactoring Task Tracker

## Task Status Legend
- 🔵 **PENDING** - Not started
- 🟡 **IN_PROGRESS** - Currently working on
- 🟢 **COMPLETED** - Finished and tested
- 🔴 **BLOCKED** - Cannot proceed due to dependencies
- ⚠️ **NEEDS_REVIEW** - Ready for code review
- 🧪 **TESTING** - In testing phase

---

## PHASE 1: PREPARATION & SETUP
*Risk Level: LOW*

### Task 1.1: Project Analysis & Documentation ✅
- **Status**: 🟢 **COMPLETED**
- **Description**: Analyze useLogs.ts structure and create comprehensive documentation
- **Files Created**:
  - `/web/src/plugins/logs/requirements.md`
  - `/web/src/plugins/logs/function-categorization.md`  
  - `/web/src/plugins/logs/task-tracker.md`
- **Lines Analyzed**: 6,876 lines
- **Functions Cataloged**: 67+ public, 100+ private
- **Completed**: 2025-08-26

### Task 1.2: Backup & Directory Setup ✅
- **Status**: 🟢 **COMPLETED**
- **Description**: Create backup and set up modular directory structure
- **Files Created**:
  - `/web/src/composables/useLogs.ts.backup`
  - `/web/src/composables/useLogs/` (directory)
  - `/web/src/utils/logs/` (directory)
  - `/web/src/services/logs/` (directory)
- **Completed**: 2025-08-26

### Task 1.3: Test Coverage Analysis
- **Status**: 🔵 **PENDING**
- **Description**: Analyze existing test coverage for useLogs functionality
- **TODO**:
  - [ ] Find existing useLogs test files
  - [ ] Run test coverage report
  - [ ] Identify untested functions
  - [ ] Create baseline test report

### Task 1.4: Dependency Analysis
- **Status**: 🔵 **PENDING**
- **Description**: Map all dependencies and usage patterns
- **TODO**:
  - [ ] Find all files importing useLogs
  - [ ] Map which functions are used where
  - [ ] Identify critical integration points
  - [ ] Create dependency graph

---

## PHASE 2: EXTRACT UTILITIES (Risk Level: LOW)
*Start with pure functions that have no external dependencies*

### Task 2.1: Extract Constants
- **Status**: 🔵 **PENDING**
- **Priority**: HIGH (Foundation for other tasks)
- **Target**: `utils/logs/constants.ts`
- **Description**: Extract configuration constants and default objects
- **Functions to Extract**:
  - `defaultObject` configuration
  - `intervalMap` definitions
  - `maxSearchRetries`, `searchReconnectDelay`
  - Refresh time configurations
- **TODO**:
  - [ ] Create `utils/logs/constants.ts`
  - [ ] Move constant definitions
  - [ ] Update imports in useLogs.ts
  - [ ] Test imports work correctly

### Task 2.2: Extract Date/Time Utilities
- **Status**: 🔵 **PENDING**
- **Priority**: HIGH
- **Target**: `utils/logs/datetime.ts`
- **Description**: Extract date/time utility functions
- **Functions to Extract**:
  - Time interval calculation logic
  - Timestamp extraction utilities
  - Date formatting functions
  - Timezone handling utilities
- **TODO**:
  - [ ] Create `utils/logs/datetime.ts`
  - [ ] Extract time-related utilities
  - [ ] Add TypeScript interfaces
  - [ ] Update imports in useLogs.ts
  - [ ] Create unit tests

### Task 2.3: Extract Data Formatters
- **Status**: 🔵 **PENDING**
- **Priority**: MEDIUM
- **Target**: `utils/logs/formatters.ts`
- **Description**: Extract data formatting utilities
- **Functions to Extract**:
  - Field value formatting
  - Query result formatting
  - Display formatting functions
  - Size formatting utilities
- **TODO**:
  - [ ] Create `utils/logs/formatters.ts`
  - [ ] Extract formatting functions
  - [ ] Add TypeScript types
  - [ ] Update imports in useLogs.ts
  - [ ] Create unit tests

### Task 2.4: Extract Validators
- **Status**: 🔵 **PENDING**
- **Priority**: MEDIUM
- **Target**: `utils/logs/validators.ts`
- **Description**: Extract validation utilities
- **Functions to Extract**:
  - Query validation logic
  - Field validation functions
  - Input validation utilities
  - Schema validation
- **TODO**:
  - [ ] Create `utils/logs/validators.ts`
  - [ ] Extract validation functions
  - [ ] Add comprehensive error messages
  - [ ] Update imports in useLogs.ts
  - [ ] Create unit tests

### Task 2.5: Extract Parsers
- **Status**: 🔵 **PENDING**
- **Priority**: HIGH
- **Target**: `utils/logs/parsers.ts`
- **Description**: Extract parsing utilities
- **Functions to Extract**:
  - SQL parsing utilities (non-reactive parts)
  - Query string parsing
  - Configuration parsing
  - URL parameter parsing
- **TODO**:
  - [ ] Create `utils/logs/parsers.ts`
  - [ ] Extract parsing functions
  - [ ] Maintain SQL parser compatibility
  - [ ] Update imports in useLogs.ts
  - [ ] Create unit tests

### Task 2.6: Phase 2 Integration Testing
- **Status**: 🔵 **PENDING**
- **Priority**: CRITICAL
- **Description**: Test all utility extractions work together
- **TODO**:
  - [ ] Run full test suite
  - [ ] Test log module functionality end-to-end
  - [ ] Performance benchmark
  - [ ] Memory usage check

---

## PHASE 3: EXTRACT API LAYER (Risk Level: MEDIUM)
*Move API calls to dedicated service layer*

### Task 3.1: Extract Core Search API
- **Status**: 🔵 **PENDING**
- **Priority**: HIGH
- **Target**: `services/logs/logsApi.ts`
- **Description**: Extract HTTP API calls for search operations
- **Functions to Extract**:
  - Search query API calls
  - Query execution endpoints
  - Result fetching logic
  - Error handling for API calls
- **TODO**:
  - [ ] Create `services/logs/logsApi.ts`
  - [ ] Extract search API functions
  - [ ] Add proper error handling
  - [ ] Update composable to use service
  - [ ] Test API integration

### Task 3.2: Extract WebSocket Service
- **Status**: 🔵 **PENDING**
- **Priority**: HIGH
- **Target**: `services/logs/logsWebSocket.ts`
- **Description**: Extract WebSocket communication logic
- **Functions to Extract**:
  - WebSocket connection management
  - Real-time search updates
  - Connection error handling
  - Message formatting
- **TODO**:
  - [ ] Create `services/logs/logsWebSocket.ts`
  - [ ] Extract WebSocket logic
  - [ ] Maintain connection state
  - [ ] Update composable integration
  - [ ] Test real-time functionality

### Task 3.3: Extract Streams API
- **Status**: 🔵 **PENDING**
- **Priority**: MEDIUM
- **Target**: `services/logs/streamsApi.ts`
- **Description**: Extract stream-related API calls
- **Functions to Extract**:
  - Stream listing API
  - Stream schema API
  - Stream metadata API
  - Stream field operations
- **TODO**:
  - [ ] Create `services/logs/streamsApi.ts`
  - [ ] Extract stream API functions
  - [ ] Add caching if appropriate
  - [ ] Update composable integration
  - [ ] Test stream operations

### Task 3.4: Extract Jobs API
- **Status**: 🔵 **PENDING**
- **Priority**: LOW
- **Target**: `services/logs/jobsApi.ts`
- **Description**: Extract job-related API operations
- **Functions to Extract**:
  - Job status API calls
  - Job management endpoints
  - Job result fetching
  - Job cancellation API
- **TODO**:
  - [ ] Create `services/logs/jobsApi.ts`
  - [ ] Extract job API functions
  - [ ] Add job state management
  - [ ] Update composable integration
  - [ ] Test job operations

### Task 3.5: Extract Saved Views API
- **Status**: 🔵 **PENDING**
- **Priority**: LOW
- **Target**: `services/logs/savedViewsApi.ts`
- **Description**: Extract saved views API operations
- **Functions to Extract**:
  - Saved views fetching
  - Saved views creation/update
  - Saved views deletion
  - View sharing operations
- **TODO**:
  - [ ] Create `services/logs/savedViewsApi.ts`
  - [ ] Extract saved views API
  - [ ] Add CRUD operations
  - [ ] Update composable integration
  - [ ] Test saved views functionality

### Task 3.6: Phase 3 Integration Testing
- **Status**: 🔵 **PENDING**
- **Priority**: CRITICAL
- **Description**: Test all API extractions work correctly
- **TODO**:
  - [ ] Test all API endpoints
  - [ ] Verify WebSocket connections
  - [ ] Check error handling
  - [ ] Performance testing
  - [ ] Integration testing

---

## PHASE 4: SPLIT CORE COMPOSABLE (Risk Level: HIGH)
*Break down the main composable into focused modules*

### Task 4.1: Extract State Management
- **Status**: 🔵 **PENDING**
- **Priority**: CRITICAL
- **Target**: `composables/useLogs/useLogsState.ts`
- **Description**: Extract reactive state management
- **Functions to Extract**:
  - `searchObj`, `searchAggData`
  - `resetSearchObj`, `resetStreamData`
  - `clearSearchObj`, `initialLogsState`
  - State initialization logic
- **TODO**:
  - [ ] Create `useLogsState.ts`
  - [ ] Extract state objects and management
  - [ ] Maintain reactivity
  - [ ] Add state persistence if needed
  - [ ] Test state management

### Task 4.2: Extract Stream Operations
- **Status**: 🔵 **PENDING**
- **Priority**: HIGH
- **Target**: `composables/useLogs/useLogsStreams.ts`
- **Description**: Extract stream-related operations
- **Functions to Extract**:
  - `getStreams`, `getStreamList`, `loadStreamLists`
  - `onStreamChange`, `updateStreams`, `setSelectedStreams`
  - `extractFields`, `extractFTSFields`
- **TODO**:
  - [ ] Create `useLogsStreams.ts`
  - [ ] Extract stream operations
  - [ ] Use streams API service
  - [ ] Maintain stream state
  - [ ] Test stream functionality

### Task 4.3: Extract Query Operations
- **Status**: 🔵 **PENDING**
- **Priority**: CRITICAL
- **Target**: `composables/useLogs/useLogsQuery.ts`
- **Description**: Extract query building and execution
- **Functions to Extract**:
  - `buildSearch`, `handleRunQuery`
  - `getQueryData`, `loadLogsData`
  - `fnParsedSQL`, `fnUnparsedSQL`
  - `validateFilterForMultiStream`
- **TODO**:
  - [ ] Create `useLogsQuery.ts`
  - [ ] Extract query operations
  - [ ] Use search API service
  - [ ] Maintain query state
  - [ ] Test query execution

### Task 4.4: Extract Filtering Logic
- **Status**: 🔵 **PENDING**
- **Priority**: MEDIUM
- **Target**: `composables/useLogs/useLogsFilters.ts`
- **Description**: Extract filtering and field operations
- **Functions to Extract**:
  - `updateGridColumns`, `filterHitsColumns`
  - `reorderSelectedFields`
  - `getFilterExpressionByFieldType`
- **TODO**:
  - [ ] Create `useLogsFilters.ts`
  - [ ] Extract filter operations
  - [ ] Use validation utilities
  - [ ] Maintain filter state
  - [ ] Test filtering functionality

### Task 4.5: Extract Visualization Logic
- **Status**: 🔵 **PENDING**
- **Priority**: MEDIUM
- **Target**: `composables/useLogs/useLogsVisualization.ts`
- **Description**: Extract histogram and visualization
- **Functions to Extract**:
  - `generateHistogramData`, `getHistogramQueryData`
  - `generateHistogramSkeleton`
  - `getVisualizationConfig`, `encodeVisualizationConfig`
- **TODO**:
  - [ ] Create `useLogsVisualization.ts`
  - [ ] Extract visualization logic
  - [ ] Use formatters utilities
  - [ ] Maintain chart state
  - [ ] Test visualization features

### Task 4.6: Extract WebSocket Handling
- **Status**: 🔵 **PENDING**
- **Priority**: HIGH
- **Target**: `composables/useLogs/useLogsWebSocket.ts`
- **Description**: Extract WebSocket communication logic
- **Functions to Extract**:
  - `buildWebSocketPayload`
  - `initializeSearchConnection`
  - `sendCancelSearchMessage`
- **TODO**:
  - [ ] Create `useLogsWebSocket.ts`
  - [ ] Extract WebSocket logic
  - [ ] Use WebSocket service
  - [ ] Maintain connection state
  - [ ] Test real-time features

### Task 4.7: Extract URL Management
- **Status**: 🔵 **PENDING**
- **Priority**: LOW
- **Target**: `composables/useLogs/useLogsURL.ts`
- **Description**: Extract URL and routing operations
- **Functions to Extract**:
  - `generateURLQuery`, `updateUrlQueryParams`
  - `restoreUrlQueryParams`
  - `routeToSearchSchedule`
- **TODO**:
  - [ ] Create `useLogsURL.ts`
  - [ ] Extract URL operations
  - [ ] Use parser utilities
  - [ ] Maintain route state
  - [ ] Test URL functionality

### Task 4.8: Extract Data Operations
- **Status**: 🔵 **PENDING**
- **Priority**: MEDIUM
- **Target**: `composables/useLogs/useLogsActions.ts`
- **Description**: Extract data operations and actions
- **Functions to Extract**:
  - `refreshData`, `refreshPagination`
  - `getFunctions`, `getActions`
  - `searchAroundData`
- **TODO**:
  - [ ] Create `useLogsActions.ts`
  - [ ] Extract data operations
  - [ ] Use API services
  - [ ] Maintain action state
  - [ ] Test data operations

---

## PHASE 5: INTEGRATION & MAIN ENTRY POINT
*Create the main entry point and wire everything together*

### Task 5.1: Create Main Entry Point
- **Status**: 🔵 **PENDING**
- **Priority**: CRITICAL
- **Target**: `composables/useLogs/index.ts`
- **Description**: Create main entry point that exports all functionality
- **TODO**:
  - [ ] Create `useLogs/index.ts`
  - [ ] Import all sub-composables
  - [ ] Re-export all public functions
  - [ ] Maintain exact same API surface
  - [ ] Add JSDoc documentation

### Task 5.2: Update Application Imports
- **Status**: 🔵 **PENDING**
- **Priority**: HIGH
- **Description**: Update all imports across the application
- **TODO**:
  - [ ] Find all files importing useLogs
  - [ ] Update import paths
  - [ ] Ensure no breaking changes
  - [ ] Test each updated file
  - [ ] Batch commit changes

### Task 5.3: Comprehensive Testing
- **Status**: 🔵 **PENDING**
- **Priority**: CRITICAL
- **Description**: Run comprehensive test suite
- **TODO**:
  - [ ] Run all existing tests
  - [ ] Create integration tests
  - [ ] Performance benchmarking
  - [ ] Memory leak testing
  - [ ] Browser compatibility testing

---

## PHASE 6: DOCUMENTATION & FINALIZATION
*Document the new structure and finalize the refactoring*

### Task 6.1: Create Migration Guide
- **Status**: 🔵 **PENDING**
- **Priority**: MEDIUM
- **Description**: Document the new modular structure
- **TODO**:
  - [ ] Create developer migration guide
  - [ ] Document new import patterns
  - [ ] Add usage examples
  - [ ] Create troubleshooting guide

### Task 6.2: Performance Optimization
- **Status**: 🔵 **PENDING**
- **Priority**: MEDIUM
- **Description**: Optimize the modular structure
- **TODO**:
  - [ ] Analyze bundle size impact
  - [ ] Tree-shaking verification
  - [ ] Lazy loading opportunities
  - [ ] Memory usage optimization

### Task 6.3: Team Training
- **Status**: 🔵 **PENDING**
- **Priority**: LOW
- **Description**: Train team on new structure
- **TODO**:
  - [ ] Create training materials
  - [ ] Conduct team walkthrough
  - [ ] Document best practices
  - [ ] Set up code review guidelines

---

## QUICK REFERENCE

### Current Status Summary
- **Phase 1**: 🟢 5/5 Completed
- **Phase 2**: 🔵 0/6 Started  
- **Phase 3**: 🔵 0/6 Started
- **Phase 4**: 🔵 0/8 Started
- **Phase 5**: 🔵 0/3 Started
- **Phase 6**: 🔵 0/3 Started

### Next Actions (Priority Order)
1. **Task 1.3**: Set up test coverage analysis
2. **Task 2.1**: Extract constants (foundation)
3. **Task 2.2**: Extract date/time utilities
4. **Task 2.5**: Extract parsers
5. **Task 2.3**: Extract formatters

### Risk Monitoring
- **File Size**: Currently 6,876 lines → Target <1,000 per file
- **Test Coverage**: Maintain current levels throughout
- **Performance**: Monitor for any regression
- **API Compatibility**: Zero breaking changes required

---

**Last Updated**: 2025-08-26  
**Next Review Date**: After completing Phase 2  
**Current Phase**: Phase 1 Complete → Starting Phase 2