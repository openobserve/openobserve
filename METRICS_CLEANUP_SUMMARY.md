# Metrics Streams Cleanup - Implementation Summary

**Date**: 2026-01-13
**Branch**: `test/metrics_tests`
**Status**: ✅ Completed

---

## What Was Added

### 1. New Methods in `apiCleanup.js`

Added **3 new methods** for metrics stream management:

#### `fetchMetricsStreams()`
- Fetches all metrics streams via API (`/api/{org}/streams?type=metrics`)
- Returns array of metrics stream objects
- Similar to existing `fetchStreams()` but for metrics type

#### `deleteMetricsStream(streamName)`
- Deletes a single metrics stream by name
- Uses API endpoint: `DELETE /api/{org}/streams/{streamName}?type=metrics`
- Returns deletion result with status code

#### `cleanupMetricsStreams(patterns, protectedStreams)`
- Main cleanup method for metrics streams
- Accepts regex patterns to match stream names
- Protects specified streams from deletion (default: `['default']`)
- Similar pattern to existing `cleanupStreams()` but simpler (no wait logic needed)

---

## 2. Updated `cleanup.spec.js`

Added metrics cleanup call in the pre-test cleanup workflow:

```javascript
// Clean up metrics streams matching test patterns
await pm.apiCleanup.cleanupMetricsStreams(
  [
    /^test_.*_metrics$/,       // test_*_metrics streams
    /^e2e_metrics_/,           // e2e_metrics_* (E2E test streams)
    /^otlp_test_/,             // otlp_test_* (OTLP ingestion test streams)
    /^metrics_test_/,          // metrics_test_* (Metrics-specific test streams)
    /^prom_test_/,             // prom_test_* (Prometheus test streams)
    /^temp_metrics_/           // temp_metrics_* (Temporary test streams)
  ],
  ['default']  // Protected - primary metrics stream used by tests
);
```

---

## Why This Was Needed

### Problem:
- Metrics tests use OTLP ingestion to create test data
- Test metrics accumulate in streams over time
- No cleanup mechanism existed for metrics (only logs had cleanup)
- Can cause:
  - Increased storage usage
  - Slower test execution
  - Potential conflicts between test runs

### Solution:
- Add metrics-specific cleanup methods
- Clean up test metrics streams between runs
- Protect important streams (like `default`)
- Follow same pattern as logs cleanup

---

## Metrics Streams Cleaned Up

The cleanup targets test-specific metrics streams:

| Pattern | Description | Example |
|---------|-------------|---------|
| `^test_.*_metrics$` | General test streams | `test_foo_metrics` |
| `^e2e_metrics_` | E2E test streams | `e2e_metrics_chart_types` |
| `^otlp_test_` | OTLP ingestion tests | `otlp_test_batch_001` |
| `^metrics_test_` | Metrics-specific tests | `metrics_test_aggregations` |
| `^prom_test_` | Prometheus tests | `prom_test_query_builder` |
| `^temp_metrics_` | Temporary test streams | `temp_metrics_12345` |

---

## Protected Streams

The following metrics streams are **NEVER deleted**:

- `default` - Primary metrics stream used by most tests

**Why protect `default`?**
- The `default` stream is used by standard OTLP metrics ingestion
- Most metrics tests query from this stream
- Contains baseline test data needed for test execution
- Deleting it would break most metrics tests

---

## How It Works

### Execution Flow:

1. **Pre-test cleanup runs** (via `cleanup.spec.js`)
2. **Fetch all metrics streams** from OpenObserve API
3. **Filter streams** matching cleanup patterns
4. **Exclude protected streams** (e.g., `default`)
5. **Delete matching streams** one by one
6. **Log results** (deleted count, failed count)

### API Endpoints Used:

```bash
# Fetch metrics streams
GET /api/{org}/streams?type=metrics

# Delete metrics stream
DELETE /api/{org}/streams/{streamName}?type=metrics
```

---

## Files Modified

### 1. `tests/ui-testing/pages/apiCleanup.js`
- **Lines Added**: 109 lines (3 new methods)
- **Location**: Lines 978-1086
- **Methods**:
  - `fetchMetricsStreams()` (lines 982-1003)
  - `deleteMetricsStream()` (lines 1010-1031)
  - `cleanupMetricsStreams()` (lines 1038-1086)

### 2. `tests/ui-testing/playwright-tests/cleanup.spec.js`
- **Lines Added**: 16 lines
- **Location**: Lines 199-212
- **Change**: Added metrics cleanup call before final note

---

## Testing

### Syntax Validation:
```bash
✅ node -c pages/apiCleanup.js
✅ node -c playwright-tests/cleanup.spec.js
```

### Manual Testing:
To test manually (requires OpenObserve running):
```bash
cd tests/ui-testing
npx playwright test cleanup.spec.js --headed
```

### Expected Behavior:
1. Cleanup test runs before all other tests
2. Logs will show:
   ```
   📝 Starting metrics streams cleanup
   📝 Fetched metrics streams | {"total": X}
   📝 Found metrics streams matching cleanup patterns | {"count": Y}
   📝 Deleted metrics stream | {"name": "test_foo_metrics"}
   📝 Metrics streams cleanup completed | {"total": Y, "deleted": Z, "failed": 0}
   ```

---

## Comparison: Logs vs Metrics Cleanup

| Aspect | Logs Cleanup | Metrics Cleanup |
|--------|-------------|-----------------|
| **Fetch Method** | `fetchStreams()` | `fetchMetricsStreams()` |
| **Delete Method** | `deleteStream()` | `deleteMetricsStream()` |
| **Cleanup Method** | `cleanupStreams()` | `cleanupMetricsStreams()` |
| **API Endpoint** | `?type=logs` | `?type=metrics` |
| **Wait Logic** | Yes (complex deletion waiting) | No (simpler, immediate) |
| **Protected Streams** | Many (default, sensitive, etc.) | Minimal (`default` only) |
| **Complexity** | High (170 lines) | Low (48 lines) |

**Why simpler for metrics?**
- Metrics streams delete immediately (no file system locking)
- No deletion waiting needed
- Fewer protected streams required
- Smaller scope of test streams

---

## Benefits

### ✅ Clean Test Environment
- Each test run starts with clean metrics data
- No leftover test streams

### ✅ Better Performance
- Reduced storage usage
- Faster test execution
- No accumulation of old data

### ✅ Consistency
- Follows same pattern as logs cleanup
- Easy to understand and maintain
- Predictable behavior

### ✅ Safety
- Protected streams prevent accidental deletion
- Regex patterns prevent over-deletion
- Logging provides visibility

---

## Future Enhancements

### Potential Improvements:

1. **Add more stream patterns** as new tests are added
2. **Add traces cleanup** (similar pattern for traces type)
3. **Add cleanup metrics** (count deleted streams, time taken)
4. **Add dry-run mode** (show what would be deleted without deleting)

### Example Future Pattern:
```javascript
// Future: Add cleanup for test-run-specific streams
/^metrics_\d{13}$/  // metrics_1736823451234 (timestamp-based)
/^worker_\d+_metrics$/  // worker_0_metrics, worker_1_metrics (parallel execution)
```

---

## Integration with PRs

This cleanup improvement should be included in **PR #1** (Infrastructure PR):

### PR #1: Metrics Test Infrastructure
- **Already includes**: MetricsPage, global-setup, metrics-ingestion, test-data
- **Should add**: Metrics cleanup (this work)
- **Reason**: Cleanup is infrastructure, not test code

### Updated PR #1 Files:
```
tests/ui-testing/pages/metricsPages/metricsPage.js
tests/ui-testing/pages/apiCleanup.js  ← ADD THIS
tests/ui-testing/playwright-tests/utils/global-setup.js
tests/ui-testing/playwright-tests/utils/metrics-ingestion.js
tests/ui-testing/playwright-tests/utils/metrics-test-data.js
tests/ui-testing/playwright-tests/cleanup.spec.js  ← ADD THIS
```

**Line count impact**: +125 lines (still under 2000 limit)

---

## Commit Information

**Commit**: `322dac964`
**Message**: `test: add metrics streams cleanup to pre-test cleanup`
**Files Changed**: 2
**Lines Added**: +125

---

## Documentation

### For Test Writers:

If you create a new metrics test stream, add its pattern to cleanup.spec.js:

```javascript
await pm.apiCleanup.cleanupMetricsStreams(
  [
    // ... existing patterns ...
    /^your_new_pattern_/  // your_new_pattern_* (description)
  ],
  ['default']
);
```

### For Reviewers:

When reviewing metrics tests:
1. Check if new streams are created
2. Verify cleanup patterns cover them
3. Ensure important streams are protected

---

**Status**: ✅ Ready for PR
**Next Step**: Include in PR #1 (Infrastructure)
**Documentation**: Complete

---

*Generated: 2026-01-13*
*Author: Claude Code*
