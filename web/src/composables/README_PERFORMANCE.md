# Performance Tracking Composables - Testing Guide

Created: 2026-02-09

## Quick Test

### 1. Add Test Route (Temporary)

Add this to your router temporarily:

```typescript
// In your router file
{
  path: '/perf-test',
  component: () => import('@/test/PerformanceTest.vue')
}
```

### 2. Navigate & Test

1. Go to `/perf-test` in your browser
2. Open DevTools Console
3. Click the test buttons
4. Run the console commands shown

### 3. What to Look For

#### ✅ Performance Tracker Works If:
- Console shows: `📊 Performance Metrics` table
- Table has columns: Metric, Avg (ms), Min (ms), Max (ms), P95 (ms), Count
- Running `__perfTrackerTest()` displays metrics

#### ✅ Render Tracker Works If:
- Console shows: `🔄 Prop changed: "renderTrigger"`
- Console shows: `🎨 Re-render #X (Yms since last)`
- Running `__render_PerformanceTest.logStats()` shows render count and prop changes

#### ✅ Memory Profiler Works If:
- Console shows: `🧠 Memory tracking started`
- After allocating memory, `__memory_PerformanceTest.logStats()` shows:
  - Initial MB
  - Current MB
  - Growth MB
  - Growth Rate
- `__memory_PerformanceTest.detectLeak()` runs without errors

## Manual Testing Without Test Component

You can test composables directly in any existing component:

```typescript
import { usePerformanceTracker } from '@/composables/usePerformanceTracker';

const { track, logStats } = usePerformanceTracker();

// Test it
track('test-operation', () => {
  console.log('Testing!');
});

// Check results
logStats();
```

## Expected Console Output Examples

### Performance Tracker:
```
📊 Performance Metrics
┌─────────┬──────────────────────┬───────────┬───────────┬───────────┬───────────┬───────┬────────────┐
│ (index) │ Metric               │ Avg (ms)  │ Min (ms)  │ Max (ms)  │ P95 (ms)  │ Count │ Total (ms) │
├─────────┼──────────────────────┼───────────┼───────────┼───────────┼───────────┼───────┼────────────┤
│ 0       │ 'sync-operation'     │ '15.20'   │ '14.80'   │ '16.40'   │ '16.20'   │ 5     │ '76.00'    │
│ 1       │ 'async-operation'    │ '102.45'  │ '100.30'  │ '105.20'  │ '104.80'  │ 3     │ '307.35'   │
└─────────┴──────────────────────┴───────────┴───────────┴───────────┴───────────┴───────┴────────────┘
```

### Render Tracker:
```
[PerformanceTest] 🔄 Prop changed: "renderTrigger"
  Previous: 0
  Current: 1
[PerformanceTest] 🎨 Re-render #2 (45.20ms since last)

📊 Render Stats: PerformanceTest
Total Re-renders: 5
Avg Time Between Renders: 52.30ms
Props That Triggered Re-renders:
┌─────────┬──────────────────┬────────┐
│ (index) │ Prop             │ Count  │
├─────────┼──────────────────┼────────┤
│ 0       │ 'renderTrigger'  │ 5      │
└─────────┴──────────────────┴────────┘
```

### Memory Profiler:
```
🧠 Memory Stats: PerformanceTest
Initial: 45.23 MB
Current: 58.67 MB
Peak: 59.12 MB
Growth: 13.44 MB over 30.5s
Growth Rate: 0.441 MB/s
Heap Limit: 2048.00 MB
```

## Troubleshooting

### Memory API Not Available
**Error:** `Performance.memory not supported in this browser`
**Solution:** Use Chrome/Edge. Firefox/Safari don't support `performance.memory`

### No Console Output
**Check:**
1. Are you in DEV mode? (`import.meta.env.DEV` should be true)
2. Is DevTools Console open?
3. Did you click the test buttons?

### Window Functions Not Found
**Error:** `__perfTrackerTest is not defined`
**Solution:**
1. Make sure you're on the `/perf-test` page
2. Make sure DEV mode is enabled
3. Try refreshing the page

## Integration Checklist

Before integrating into real components:

- [ ] All 3 test buttons work without errors
- [ ] Console commands return expected output
- [ ] Performance metrics show reasonable numbers (not NaN)
- [ ] Render tracker detects prop changes
- [ ] Memory profiler shows memory growth
- [ ] No TypeScript errors in composables files
- [ ] No console errors or warnings

## Next Steps

Once all tests pass:
1. Remove test route
2. Delete `/test/PerformanceTest.vue`
3. Integrate into actual components (e.g., TenstackTable.vue)
4. Follow the guide in `/docs/PERFORMANCE_TESTING.md`

## Files Created

```
src/composables/
  ├── usePerformanceTracker.ts    ✅ Function/async performance
  ├── useRenderTracker.ts         ✅ Re-render detection
  ├── useMemoryProfiler.ts        ✅ Memory profiling
  ├── useObjectMemoryTracker.ts   ✅ Object GC tracking
  └── README_PERFORMANCE.md       📖 This file

src/test/
  └── PerformanceTest.vue         🧪 Test component

docs/
  └── PERFORMANCE_TESTING.md      📚 Full documentation
```
