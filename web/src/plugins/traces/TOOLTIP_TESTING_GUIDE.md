# Trace Graph Tooltip Testing Guide

## Overview

This guide provides comprehensive testing procedures for the trace graph tooltip functionality implemented in TraceDetails.vue. The tooltip system displays duration metrics and percentiles for trace patterns.

## Test Infrastructure

### Integration Test File
- **Location**: `src/plugins/traces/TraceDetails.tooltip-integration.spec.ts`
- **Purpose**: Comprehensive end-to-end testing of tooltip functionality
- **Coverage**: Component integration, content generation, error handling, accessibility

### Manual Verification Script
- **Location**: `src/plugins/traces/tooltip-manual-verification.js`
- **Purpose**: Browser-based manual testing
- **Usage**: Load in browser console on trace details page

## Test Scenarios

### 1. Tooltip Content Generation

#### Test Cases:
✅ **Pattern with complete metadata**
- Input: Pattern with all metrics (count, avg, min, max, percentiles, errorRate)
- Expected: All fields displayed with correct formatting

✅ **Pattern with missing metadata**
- Input: Pattern with null/undefined metadata
- Expected: Default values (Unknown Pattern, 1 call, 0.0ms metrics)

✅ **Single span patterns**
- Input: Pattern with count=1, identical min/max/percentiles
- Expected: Consistent display of identical values

✅ **High error rate patterns**
- Input: Pattern with >50% error rate
- Expected: Error rate displayed accurately

✅ **Zero duration patterns**
- Input: Pattern with 0ms durations
- Expected: 0.0ms values displayed correctly

### 2. Component Integration

#### Test Cases:
✅ **Tab switching**
- Actions: Switch Timeline → Map → Pattern view
- Expected: Tooltips setup when entering Pattern view

✅ **View mode switching**
- Actions: Switch Span → Pattern → Service view
- Expected: Tooltips only active in Pattern view

✅ **Tooltip cleanup**
- Actions: Switch away from Pattern view
- Expected: Event listeners removed, no memory leaks

✅ **Chart integration**
- Actions: Verify chart engine receives tooltip configuration
- Expected: setupTraceNodeTooltips called with correct data

### 3. Error Handling

#### Test Cases:
✅ **Missing chart instance**
- Scenario: Chart not yet initialized
- Expected: No errors, graceful handling

✅ **Invalid pattern data**
- Scenario: Malformed pattern tree data
- Expected: Default tooltip content generated

✅ **Rapid view switching**
- Scenario: Quick successive tab changes
- Expected: No race conditions or errors

### 4. Performance Testing

#### Test Cases:
✅ **Large datasets**
- Scenario: >100 pattern nodes
- Expected: Smooth tooltip interactions, no lag

✅ **Memory management**
- Scenario: Repeated setup/cleanup cycles
- Expected: No memory leaks, stable memory usage

✅ **Tooltip positioning**
- Scenario: Tooltips near viewport edges
- Expected: Proper positioning, no cutoff

### 5. Accessibility

#### Test Cases:
✅ **Screen reader compatibility**
- Check: Tooltip content structure
- Expected: No script/style tags, clear labels

✅ **Keyboard navigation**
- Check: Focus management with keyboard navigation
- Expected: Tooltips accessible via keyboard

✅ **Content readability**
- Check: Text contrast, font sizing
- Expected: Meets WCAG guidelines

## Manual Testing Procedures

### Setup
1. Start the development server: `npm run dev`
2. Navigate to a trace with multiple services
3. Open browser developer tools

### Testing Steps

#### Phase 1: Basic Functionality
1. Load manual verification script:
   ```javascript
   // Copy content of tooltip-manual-verification.js to console
   runTooltipVerification()
   ```

2. Verify output for each test scenario
3. Note any failures or warnings

#### Phase 2: Interactive Testing
1. Switch to Map tab
2. Toggle to Pattern view
3. Hover over pattern nodes
4. Verify tooltip content matches expected format:
   ```
   Pattern Name
   Calls: X
   Average: X.Xms
   Minimum: X.Xms
   Maximum: X.Xms
   P75: X.Xms
   P95: X.Xms
   P99: X.Xms
   Error Rate: X.X%
   ```

#### Phase 3: Edge Case Testing
1. Test with traces containing:
   - Single span patterns
   - High error rates (>50%)
   - Zero duration spans
   - Very long operation names

2. Verify tooltip positioning at:
   - Viewport edges
   - Overlapping nodes
   - Zoomed chart states

#### Phase 4: Performance Testing
1. Load trace with >50 spans
2. Switch views multiple times
3. Monitor browser memory usage
4. Check for console errors

## Automated Test Execution

### Run Integration Tests
```bash
cd web
npm run test:unit -- src/plugins/traces/TraceDetails.tooltip-integration.spec.ts
```

### Expected Results
- All test suites pass
- No memory leaks detected
- Coverage >95% for tooltip-related code

## Test Data Requirements

### Minimal Test Trace
```json
{
  "traceId": "test-trace-123",
  "spans": [
    {
      "spanId": "span-1",
      "operationName": "frontend.request",
      "serviceName": "frontend",
      "duration": 1000000000,
      "startTime": 1640000000000000000
    },
    {
      "spanId": "span-2", 
      "operationName": "backend.process",
      "serviceName": "backend",
      "duration": 500000000,
      "startTime": 1640000000100000000,
      "parentSpanId": "span-1"
    }
  ]
}
```

### Expected Pattern Data
```javascript
[
  {
    id: "pattern-1",
    name: "frontend → backend",
    value: 100,
    metadata: {
      pathSignature: "frontend → backend",
      count: 5,
      avg: 125.5,
      min: 50.2,
      max: 200.8,
      p75: 145.3,
      p95: 185.1,
      p99: 195.7,
      errorRate: 10.0
    }
  }
]
```

## Success Criteria

### ✅ All tests must pass:
1. **Functionality**: Tooltips display correct metrics
2. **Integration**: Seamless integration with TraceDetails component
3. **Performance**: No performance degradation
4. **Accessibility**: Screen reader compatible
5. **Error Handling**: Graceful handling of edge cases
6. **Memory**: No memory leaks on repeated use

### ⚠️ Known Limitations:
- Tooltips only available in Pattern view
- Requires ECharts chart engine
- Limited to pattern-level aggregation

## Troubleshooting

### Common Issues:
1. **Tooltips not appearing**: Check if in Pattern view mode
2. **Incorrect content**: Verify pattern metadata structure
3. **Performance issues**: Check for large datasets, consider data sampling
4. **Positioning problems**: Verify chart container dimensions

### Debug Commands:
```javascript
// Check current view state
console.log(this.activeTab, this.mapViewMode)

// Inspect pattern data
console.log(this.patternTreeData)

// Check tooltip setup
console.log('Tooltip cleanup function:', this.tooltipCleanup)
```

## Maintenance

### Regular Testing:
- Run integration tests before each release
- Manual testing with production data monthly
- Performance benchmarking quarterly

### Updates Required When:
- TraceDetails component structure changes
- Pattern detection algorithm updates
- Chart engine upgrades
- New tooltip content requirements