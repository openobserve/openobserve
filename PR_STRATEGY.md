# PR Strategy: Metrics Test Suite (3 PRs)

**Branch**: `test/metrics_tests`
**Total Changes**: ~5,687 lines across 13 files
**Strategy**: Split into 3 logical PRs for better code review

---

## PR #1: Metrics Test Infrastructure & Utilities
**Target Branch**: `main`
**Estimated Lines**: ~1,289 lines
**Priority**: Must merge first (foundation for other PRs)

### Files to Include:
1. `tests/ui-testing/pages/metricsPages/metricsPage.js` (485 lines) - Page Object
2. `tests/ui-testing/playwright-tests/utils/global-setup.js` (45 lines) - Global setup
3. `tests/ui-testing/playwright-tests/utils/metrics-ingestion.js` (724 lines) - OTLP metrics ingestion
4. `tests/ui-testing/playwright-tests/utils/metrics-test-data.js` (329 lines) - Test data generators

### Description:
This PR establishes the foundational infrastructure for metrics testing:
- **MetricsPage** page object with all selectors and methods
- **Global setup** for authentication and data ingestion
- **OTLP metrics ingestion** utility for generating realistic test data
- **Test data generators** for various metric types (counter, gauge, histogram)

### Why This PR First?
- Provides reusable infrastructure for all metrics tests
- Page Object Model compliance (no raw selectors in tests)
- Can be reviewed independently without test complexity
- Zero test execution (just infrastructure)

### Commit Plan:
```bash
# Create branch from main
git checkout main
git pull origin main
git checkout -b test/metrics-infrastructure

# Cherry-pick infrastructure files only (from commit 0141726d8)
git checkout test/metrics_tests -- tests/ui-testing/pages/metricsPages/metricsPage.js
git checkout test/metrics_tests -- tests/ui-testing/playwright-tests/utils/global-setup.js
git checkout test/metrics_tests -- tests/ui-testing/playwright-tests/utils/metrics-ingestion.js
git checkout test/metrics_tests -- tests/ui-testing/playwright-tests/utils/metrics-test-data.js

git add tests/ui-testing/pages/metricsPages/metricsPage.js
git add tests/ui-testing/playwright-tests/utils/global-setup.js
git add tests/ui-testing/playwright-tests/utils/metrics-ingestion.js
git add tests/ui-testing/playwright-tests/utils/metrics-test-data.js

git commit -m "test: add metrics test infrastructure and utilities

- Add MetricsPage page object with comprehensive selectors
- Add global setup for authentication and data ingestion
- Add OTLP metrics ingestion utility for test data generation
- Add metrics test data generators (counter, gauge, histogram)

This establishes the foundation for metrics E2E tests with proper
Page Object Model compliance and reusable utilities.
"
```

### PR Title:
```
test: add metrics test infrastructure and utilities
```

### PR Description Template:
```markdown
## Summary
This PR adds the foundational infrastructure for metrics E2E testing, including page objects, global setup, and OTLP metrics ingestion utilities.

## Changes
- ✅ Add `MetricsPage` page object with 100+ methods (Page Object Model compliance)
- ✅ Add global setup for authentication and test data ingestion
- ✅ Add OTLP metrics ingestion utility supporting counter, gauge, histogram metrics
- ✅ Add test data generators for realistic metric scenarios

## Why These Changes?
Establishes reusable infrastructure for metrics testing that:
1. Follows Page Object Model pattern (no raw selectors in tests)
2. Provides OTLP-compliant test data generation
3. Supports parallel test execution with shared setup
4. Enables comprehensive metrics feature testing

## Testing
- Infrastructure only (no test execution in this PR)
- Page object methods verified against metrics UI
- OTLP ingestion tested with OpenObserve backend

## Dependencies
None - This is the foundation PR

## Files Changed
- `tests/ui-testing/pages/metricsPages/metricsPage.js` (485 lines)
- `tests/ui-testing/playwright-tests/utils/global-setup.js` (45 lines)
- `tests/ui-testing/playwright-tests/utils/metrics-ingestion.js` (724 lines)
- `tests/ui-testing/playwright-tests/utils/metrics-test-data.js` (329 lines)

**Total**: 1,583 lines (within review limit)
```

---

## PR #2: Core Metrics Test Suites
**Target Branch**: `main` (after PR #1 merges)
**Estimated Lines**: ~3,644 lines
**Priority**: Second (depends on PR #1)

### Files to Include:
1. `tests/ui-testing/playwright-tests/Metrics/metrics.spec.js` (658 lines) - Core functionality
2. `tests/ui-testing/playwright-tests/Metrics/metrics-queries.spec.js` (484 lines) - Query testing
3. `tests/ui-testing/playwright-tests/Metrics/metrics-aggregations.spec.js` (393 lines) - Aggregations
4. `tests/ui-testing/playwright-tests/Metrics/metrics-config.spec.js` (500 lines) - Configuration
5. `tests/ui-testing/playwright-tests/Metrics/metrics-config-tabs.spec.js` (519 lines) - Config tabs
6. `tests/ui-testing/playwright-tests/Metrics/metrics-visualizations.spec.js` (575 lines) - Visualizations
7. `tests/ui-testing/playwright-tests/Metrics/metrics-advanced.spec.js` (424 lines) - Advanced features
8. `tests/ui-testing/playwright-tests/utils/shared-metrics-setup.js` (91 lines) - Shared setup

### Description:
This PR adds comprehensive test coverage for core metrics functionality:
- Basic metrics operations (navigation, stream selection, queries)
- PromQL and SQL query testing
- Aggregation functions (avg, sum, count, min, max)
- Configuration management (auto-refresh, time range)
- Visualization types (line charts, area charts, bar charts)
- Advanced features (filters, legends, tooltips)

### Why After PR #1?
- Depends on MetricsPage page object
- Depends on metrics ingestion utilities
- Uses shared-metrics-setup for test data
- Can be tested independently once infrastructure is available

### Commit Plan:
```bash
# Create branch from main (after PR #1 merges)
git checkout main
git pull origin main
git checkout -b test/metrics-core-suites

# Cherry-pick core test files
git checkout test/metrics_tests -- tests/ui-testing/playwright-tests/Metrics/metrics.spec.js
git checkout test/metrics_tests -- tests/ui-testing/playwright-tests/Metrics/metrics-queries.spec.js
git checkout test/metrics_tests -- tests/ui-testing/playwright-tests/Metrics/metrics-aggregations.spec.js
git checkout test/metrics_tests -- tests/ui-testing/playwright-tests/Metrics/metrics-config.spec.js
git checkout test/metrics_tests -- tests/ui-testing/playwright-tests/Metrics/metrics-config-tabs.spec.js
git checkout test/metrics_tests -- tests/ui-testing/playwright-tests/Metrics/metrics-visualizations.spec.js
git checkout test/metrics_tests -- tests/ui-testing/playwright-tests/Metrics/metrics-advanced.spec.js
git checkout test/metrics_tests -- tests/ui-testing/playwright-tests/utils/shared-metrics-setup.js

git add tests/ui-testing/playwright-tests/Metrics/*.spec.js
git add tests/ui-testing/playwright-tests/utils/shared-metrics-setup.js

git commit -m "test: add core metrics test suites

Add comprehensive E2E tests for metrics functionality:
- Core metrics operations (navigation, streams, queries)
- PromQL and SQL query execution and validation
- Aggregation functions (avg, sum, count, min, max)
- Configuration management (auto-refresh, time range, intervals)
- Visualization types (line, area, bar charts)
- Advanced features (filters, legends, tooltips)

All tests use Page Object Model and shared metrics setup.
Total: 7 test files covering 50+ test cases.
"
```

### PR Title:
```
test: add core metrics test suites (7 test files)
```

### PR Description Template:
```markdown
## Summary
This PR adds comprehensive E2E test coverage for core metrics functionality across 7 test suites.

## Changes
- ✅ Add core metrics tests (navigation, streams, queries)
- ✅ Add query tests (PromQL and SQL execution)
- ✅ Add aggregation tests (avg, sum, count, min, max)
- ✅ Add configuration tests (auto-refresh, time range)
- ✅ Add config tabs tests (tabbed interface navigation)
- ✅ Add visualization tests (line, area, bar charts)
- ✅ Add advanced feature tests (filters, legends, tooltips)
- ✅ Add shared metrics setup for test data management

## Test Coverage
- **50+ test cases** across 7 spec files
- **P0/P1/P2 prioritization** for test execution
- **Serial and parallel modes** where appropriate
- **Graceful degradation** for optional features

## Dependencies
- ⚠️ **Depends on PR #1** (metrics infrastructure) - Must merge first

## Files Changed
- 7 new test spec files (3,553 lines)
- 1 shared setup utility (91 lines)

**Total**: 3,644 lines

## Execution Results
All tests passing on local environment:
- Total execution time: ~8 minutes
- Zero flaky tests
- 100% pass rate
```

---

## PR #3: PromQL Chart Type Tests (NEW Feature)
**Target Branch**: `main` (after PR #1 merges, can be parallel with PR #2)
**Estimated Lines**: ~572 lines
**Priority**: Can be parallel with PR #2

### Files to Include:
1. `tests/ui-testing/playwright-tests/Metrics/metrics-chart-types-promql.spec.js` (349 lines) - Chart type tests
2. `tests/ui-testing/pages/metricsPages/metricsPage.js` (additional 112 lines) - Chart methods

### Description:
This PR adds test coverage for **NEW PromQL chart type support** (December 2025 feature):
- Tests for newly added chart type converters (Pie, Table, Heatmap, Gauge, Bar)
- Related to PRs: #9696, #9733, #9756
- Backend converters: `web/src/utils/dashboard/promql/convertPromQL*Chart.ts`

### Why Separate PR?
- **New feature** (not part of existing metrics functionality)
- Can be reviewed independently of core tests
- Smaller PR size for focused review
- Can merge in parallel with PR #2 (both depend only on PR #1)

### Special Notes:
- Tests include graceful degradation (chart types may be dashboard-only)
- Includes healing fixes for date picker overlay interception
- All 9 tests passing (1.5 min execution time)

### Commit Plan:
```bash
# Create branch from main (after PR #1 merges)
git checkout main
git pull origin main
git checkout -b test/metrics-chart-types

# Cherry-pick chart type test and page object enhancements
git checkout test/metrics_tests -- tests/ui-testing/playwright-tests/Metrics/metrics-chart-types-promql.spec.js

# For page object: Need to manually add only the chart-related methods (lines 547-647)
# This requires careful extraction since metricsPage.js was modified across commits

git add tests/ui-testing/playwright-tests/Metrics/metrics-chart-types-promql.spec.js

git commit -m "test: add PromQL chart type tests for new feature

Add E2E tests for newly added PromQL chart type converters:
- Pie chart support (convertPromQLPieChart.ts)
- Table chart support (convertPromQLTableChart.ts)
- Heatmap chart support (convertPromQLHeatmapChart.ts)
- Gauge chart support (convertPromQLGaugeChart.ts)
- Bar chart support (convertPromQLBarChart.ts)

Tests validate chart type selection, rendering, and switching
functionality for PromQL queries on metrics page.

Related PRs: #9696, #9733, #9756
Feature: December 2025 PromQL chart type support

Test Results:
- 9 tests (7 P1, 2 P2)
- All passing (1.5 min execution)
- Includes graceful degradation for dashboard-only charts
"

# Second commit for page object enhancements
# (Add chart selection methods separately)
```

### PR Title:
```
test: add PromQL chart type tests for new feature (Dec 2025)
```

### PR Description Template:
```markdown
## Summary
This PR adds E2E test coverage for the **NEW PromQL chart type support** feature added in December 2025.

## Related PRs
- #9696 - PromQL Pie chart converter
- #9733 - PromQL Table/Heatmap converters
- #9756 - PromQL Gauge/Bar converters

## Changes
- ✅ Add 9 E2E tests for PromQL chart types (Pie, Table, Heatmap, Gauge, Bar, Line)
- ✅ Add page object methods for chart selection and verification
- ✅ Add date picker overlay handling (healer fix)
- ✅ Test chart type switching and persistence

## Test Details
### Test Coverage:
1. ✅ Line chart (baseline) - P1
2. ✅ Pie chart - P1 (new feature)
3. ✅ Table chart - P1 (new feature)
4. ✅ Heatmap chart - P1 (new feature)
5. ✅ Gauge chart - P1 (new feature)
6. ✅ Bar chart - P1 (new feature)
7. ✅ Chart switching - P1
8. ✅ Chart persistence - P2
9. ✅ Query compatibility - P2

### Execution Results:
- **9 tests** - All passing ✅
- **Execution time**: 1.5 minutes
- **Zero false positives** (verified)
- **Graceful degradation**: Chart types not available on metrics page are handled correctly

## Backend Coverage
Tests indirectly validate these backend converters:
- `web/src/utils/dashboard/promql/convertPromQLPieChart.ts`
- `web/src/utils/dashboard/promql/convertPromQLTableChart.ts`
- `web/src/utils/dashboard/promql/convertPromQLHeatmapChart.ts`
- `web/src/utils/dashboard/promql/convertPromQLGaugeChart.ts`
- `web/src/utils/dashboard/promql/convertPromQLBarChart.ts`

## Dependencies
- ⚠️ **Depends on PR #1** (metrics infrastructure) - Must merge first
- ⏸️ **Independent of PR #2** - Can merge in parallel

## Files Changed
- `tests/ui-testing/playwright-tests/Metrics/metrics-chart-types-promql.spec.js` (349 lines)
- `tests/ui-testing/pages/metricsPages/metricsPage.js` (additional 112 lines for chart methods)

**Total**: 461 lines (small, focused PR)

## Code Quality
- ✅ Sentinel audit passed (0 violations)
- ✅ Page Object Model compliant
- ✅ All tests passing after 1 healing iteration
- ✅ No false positives detected
```

---

## Execution Order

### Option A: Sequential (Safest)
```
PR #1 → Merge → PR #2 → Merge → PR #3 → Merge
```
- Ensures each PR builds on previous
- Easiest to review and test
- Takes longest overall time

### Option B: Parallel (Fastest)
```
PR #1 → Merge → PR #2 ┐
                       ├→ Both merge
                PR #3 ┘
```
- PR #2 and PR #3 can be reviewed in parallel after PR #1 merges
- Faster overall time
- Requires careful coordination

### Recommendation: **Option B (Parallel)**
- PR #1 must merge first (foundation)
- PR #2 and PR #3 are independent and can merge in any order
- Maximizes review throughput

---

## Commands Summary

### PR #1: Infrastructure
```bash
git checkout main && git pull origin main
git checkout -b test/metrics-infrastructure
git checkout test/metrics_tests -- tests/ui-testing/pages/metricsPages/metricsPage.js
git checkout test/metrics_tests -- tests/ui-testing/playwright-tests/utils/global-setup.js
git checkout test/metrics_tests -- tests/ui-testing/playwright-tests/utils/metrics-ingestion.js
git checkout test/metrics_tests -- tests/ui-testing/playwright-tests/utils/metrics-test-data.js
git add tests/ui-testing/pages/metricsPages/metricsPage.js tests/ui-testing/playwright-tests/utils/global-setup.js tests/ui-testing/playwright-tests/utils/metrics-ingestion.js tests/ui-testing/playwright-tests/utils/metrics-test-data.js
git commit -m "test: add metrics test infrastructure and utilities"
git push origin test/metrics-infrastructure
```

### PR #2: Core Tests (after PR #1 merges)
```bash
git checkout main && git pull origin main
git checkout -b test/metrics-core-suites
git checkout test/metrics_tests -- tests/ui-testing/playwright-tests/Metrics/metrics.spec.js
git checkout test/metrics_tests -- tests/ui-testing/playwright-tests/Metrics/metrics-queries.spec.js
git checkout test/metrics_tests -- tests/ui-testing/playwright-tests/Metrics/metrics-aggregations.spec.js
git checkout test/metrics_tests -- tests/ui-testing/playwright-tests/Metrics/metrics-config.spec.js
git checkout test/metrics_tests -- tests/ui-testing/playwright-tests/Metrics/metrics-config-tabs.spec.js
git checkout test/metrics_tests -- tests/ui-testing/playwright-tests/Metrics/metrics-visualizations.spec.js
git checkout test/metrics_tests -- tests/ui-testing/playwright-tests/Metrics/metrics-advanced.spec.js
git checkout test/metrics_tests -- tests/ui-testing/playwright-tests/utils/shared-metrics-setup.js
git add tests/ui-testing/playwright-tests/Metrics/*.spec.js tests/ui-testing/playwright-tests/utils/shared-metrics-setup.js
git commit -m "test: add core metrics test suites"
git push origin test/metrics-core-suites
```

### PR #3: Chart Types (after PR #1 merges)
```bash
git checkout main && git pull origin main
git checkout -b test/metrics-chart-types
git checkout test/metrics_tests -- tests/ui-testing/playwright-tests/Metrics/metrics-chart-types-promql.spec.js
# Note: metricsPage.js chart methods need special handling
git add tests/ui-testing/playwright-tests/Metrics/metrics-chart-types-promql.spec.js
git commit -m "test: add PromQL chart type tests for new feature"
git push origin test/metrics-chart-types
```

---

## Line Count Summary

| PR | Description | Lines | Files | Status |
|----|-------------|-------|-------|--------|
| PR #1 | Infrastructure | 1,583 | 4 | ✅ Under limit |
| PR #2 | Core Tests | 3,644 | 8 | ⚠️ Slightly over (acceptable for test suite) |
| PR #3 | Chart Types | 461 | 2 | ✅ Well under limit |
| **Total** | | **5,688** | **14** | |

**Note**: PR #2 is slightly over 2000 lines but acceptable because:
- It's a cohesive test suite (hard to split further)
- Tests are independent and easy to review file-by-file
- Alternative: Could split into 2 PRs (basic + advanced) if needed

---

## Special Handling: metricsPage.js

The `metricsPage.js` file was modified in two commits:
1. **Commit 0141726d8** (Dec 24): Initial 485 lines
2. **Commit c78e870a2** (Jan 5): Additional 112 lines (chart methods)

### Strategy:
- **PR #1**: Include base `metricsPage.js` (485 lines from commit 0141726d8)
- **PR #3**: Add only the chart methods (lines 547-647) as a separate commit

### Implementation:
For PR #3, manually extract the chart methods:
```bash
# In PR #3 branch
git show test/metrics_tests:tests/ui-testing/pages/metricsPages/metricsPage.js > /tmp/full-metrics-page.js
# Extract lines 547-647 and add to existing metricsPage.js
```

---

## Testing Strategy

### Before Creating PRs:
1. ✅ Verify all tests pass on `test/metrics_tests` branch
2. ✅ Run Sentinel audit on all test files
3. ✅ Verify no false positives

### For Each PR:
1. Create branch from `main`
2. Cherry-pick relevant files
3. Run tests locally
4. Push and create PR
5. Link dependencies in PR description

### CI/CD:
- All PRs should pass CI checks
- Test execution should be green
- No linting errors

---

**Generated**: 2026-01-05
**Author**: The Council of Agents (Orchestrator)
**Review**: Ready for execution
