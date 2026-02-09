# Performance Testing Guide

> **Last Updated:** 2026-02-09
> **Purpose:** Comprehensive guide for measuring performance in Vue 3 applications without relying on Vue DevTools

---

## Table of Contents

1. [Function & Async Performance](#1-function--async-performance)
2. [Re-render Detection & Root Cause Analysis](#2-re-render-detection--root-cause-analysis)
3. [Memory Consumption & Leak Detection](#3-memory-consumption--leak-detection)
4. [Quick Reference](#4-quick-reference)

---

## ⚠️ Critical: Avoiding the Observer Effect

**The tracking code itself can impact performance!** Follow these rules:

### **DO's ✅**
- ✅ Track **selectively** - only what you suspect is the problem
- ✅ Use **shallow comparisons** by default (reference equality)
- ✅ **Disable tracking** when not actively debugging
- ✅ Track **metadata** (length, keys) instead of full objects
- ✅ Use **sampling** (track every Nth render)
- ✅ **Wrap all tracking** in `import.meta.env.DEV` checks

### **DON'Ts ❌**
- ❌ Never deep watch large arrays (`{ deep: true }` on 1000+ items)
- ❌ Never `structuredClone` large objects on every change
- ❌ Never `console.log` massive objects (log summaries instead)
- ❌ Never track everything simultaneously
- ❌ Never leave tracking enabled in production

### **Safe Patterns:**

```typescript
// ❌ BAD: Deep watch on large array
watch(() => tableRows.value, handler, { deep: true })

// ✅ GOOD: Watch length only
watch(() => tableRows.value.length, handler)

// ✅ GOOD: Watch reference change
watch(() => tableRows.value, handler) // shallow

// ❌ BAD: Log entire object
console.log('Rows changed:', tableRows.value)

// ✅ GOOD: Log metadata
console.log('Rows changed:', { length: tableRows.value.length, firstId: tableRows.value[0]?.id })

// ❌ BAD: Clone on every change
const prev = structuredClone(toRaw(data))

// ✅ GOOD: Store reference or metadata only
const prev = { length: data.length, keys: Object.keys(data) }
```

---

## 1. Function & Async Performance

### 1.1 Basic Performance Tracking

**Use the native Performance API** - zero overhead, built into browsers.

```typescript
// composables/usePerformanceTracker.ts
import { ref } from 'vue';

export interface PerformanceMetric {
  name: string;
  avg: number;
  min: number;
  max: number;
  count: number;
  p95: number;
  total: number;
}

export function usePerformanceTracker() {
  const metrics = ref<Record<string, number[]>>({});
  const enabled = ref(import.meta.env.DEV);

  /**
   * Track synchronous function execution time
   */
  const track = <T>(name: string, fn: () => T): T => {
    if (!enabled.value) return fn();

    const start = performance.now();
    const result = fn();
    const duration = performance.now() - start;

    recordMetric(name, duration);
    return result;
  };

  /**
   * Track async function execution time
   */
  const trackAsync = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    if (!enabled.value) return await fn();

    const start = performance.now();
    try {
      const result = await fn();
      const duration = performance.now() - start;
      recordMetric(name, duration);
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      recordMetric(`${name}:error`, duration);
      throw error;
    }
  };

  /**
   * Start a manual timer (for complex flows)
   */
  const start = (name: string) => {
    performance.mark(`${name}:start`);
  };

  /**
   * End a manual timer
   */
  const end = (name: string) => {
    const startMark = `${name}:start`;
    const endMark = `${name}:end`;

    performance.mark(endMark);
    performance.measure(name, startMark, endMark);

    const measure = performance.getEntriesByName(name, 'measure')[0];
    if (measure) {
      recordMetric(name, measure.duration);
    }

    // Cleanup marks
    performance.clearMarks(startMark);
    performance.clearMarks(endMark);
    performance.clearMeasures(name);
  };

  const recordMetric = (name: string, duration: number) => {
    if (!metrics.value[name]) {
      metrics.value[name] = [];
    }
    metrics.value[name].push(duration);
  };

  /**
   * Get statistics for a specific metric
   */
  const getStats = (name: string): PerformanceMetric | null => {
    const times = metrics.value[name];
    if (!times || times.length === 0) return null;

    const sorted = [...times].sort((a, b) => a - b);
    const sum = times.reduce((a, b) => a + b, 0);

    return {
      name,
      avg: sum / times.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      count: times.length,
      p95: sorted[Math.floor(times.length * 0.95)] || sorted[sorted.length - 1],
      total: sum
    };
  };

  /**
   * Log all metrics to console
   */
  const logStats = () => {
    const stats = Object.keys(metrics.value)
      .map(name => getStats(name))
      .filter(Boolean) as PerformanceMetric[];

    console.group('📊 Performance Metrics');
    console.table(
      stats.map(s => ({
        Metric: s.name,
        'Avg (ms)': s.avg.toFixed(2),
        'Min (ms)': s.min.toFixed(2),
        'Max (ms)': s.max.toFixed(2),
        'P95 (ms)': s.p95.toFixed(2),
        Count: s.count,
        'Total (ms)': s.total.toFixed(2)
      }))
    );
    console.groupEnd();

    return stats;
  };

  /**
   * Clear all metrics
   */
  const clear = () => {
    metrics.value = {};
  };

  /**
   * Export metrics as JSON
   */
  const exportMetrics = () => {
    const stats = Object.keys(metrics.value).map(name => getStats(name));
    return JSON.stringify(stats, null, 2);
  };

  return {
    track,
    trackAsync,
    start,
    end,
    getStats,
    logStats,
    clear,
    exportMetrics,
    enabled
  };
}
```

### 1.2 Usage Examples

#### Track Async Function (e.g., useLogsHighlighter)

```typescript
// composables/useLogsHighlighter.ts
import { usePerformanceTracker } from './usePerformanceTracker';

export function useLogsHighlighter() {
  const { trackAsync, logStats } = usePerformanceTracker();
  const processedResults = ref({});

  const processHitsInChunks = async (
    rows: any[],
    columns: any[],
    clearCache: boolean,
    highlightQuery: string,
    chunkSize: number,
    ftsKeys: string[]
  ) => {
    return await trackAsync('highlighter:processHitsInChunks', async () => {
      if (clearCache) processedResults.value = {};

      // Your existing logic here...

      for (let i = 0; i < rows.length; i += chunkSize) {
        await trackAsync(`highlighter:chunk-${Math.floor(i / chunkSize)}`, async () => {
          // Process chunk
          const chunk = rows.slice(i, i + chunkSize);
          // ... processing logic
        });
      }
    });
  };

  // Expose for debugging in console
  if (import.meta.env.DEV) {
    (window as any).__logHighlighterStats = logStats;
  }

  return { processedResults, processHitsInChunks };
}
```

#### Track Synchronous Function

```typescript
const result = track('calculateTotals', () => {
  return items.reduce((sum, item) => sum + item.value, 0);
});
```

#### Track Complex Flow with Manual Timers

```typescript
// For complex async flows where you need fine-grained control
const handleSearch = async () => {
  const { start, end } = usePerformanceTracker();

  start('search:total');

  start('search:validation');
  validateInput();
  end('search:validation');

  start('search:api-call');
  const data = await fetchData();
  end('search:api-call');

  start('search:processing');
  processData(data);
  end('search:processing');

  end('search:total');
};
```

---

## 2. Re-render Detection & Root Cause Analysis

### 2.1 Understanding the Problem

Vue DevTools hangs with large datasets, making it impossible to debug re-renders. We need a **lightweight solution that tells us:**
- ✅ When a component re-renders
- ✅ **Which prop/data changed** that caused the re-render
- ✅ Time between re-renders
- ✅ Total re-render count

### 2.2 Component Re-render Tracker

```typescript
// composables/useRenderTracker.ts
import { onUpdated, getCurrentInstance, ref, watch } from 'vue';

interface RenderEvent {
  timestamp: number;
  renderNumber: number;
  timeSinceLastRender: number;
  changedProps: string[];
  changedData: string[];
}

export function useRenderTracker(componentName: string) {
  const instance = getCurrentInstance();
  const renderCount = ref(0);
  const renderEvents = ref<RenderEvent[]>([]);
  let lastRenderTime = performance.now();

  // Track previous prop values
  const previousProps = ref<Record<string, any>>({});
  const previousData = ref<Record<string, any>>({});

  onUpdated(() => {
    const now = performance.now();
    const timeSinceLastRender = now - lastRenderTime;
    renderCount.value++;

    // Detect which props changed
    const changedProps: string[] = [];
    const currentProps = instance?.props || {};

    Object.keys(currentProps).forEach(key => {
      if (!Object.is(previousProps.value[key], currentProps[key])) {
        changedProps.push(key);
        console.log(
          `[${componentName}] 🔄 Prop changed: "${key}"`,
          '\n  Previous:', previousProps.value[key],
          '\n  Current:', currentProps[key]
        );
      }
    });

    // Store current props for next comparison
    previousProps.value = { ...currentProps };

    // Record render event
    const event: RenderEvent = {
      timestamp: now,
      renderNumber: renderCount.value,
      timeSinceLastRender,
      changedProps,
      changedData: [] // Can be extended to track reactive data
    };

    renderEvents.value.push(event);
    lastRenderTime = now;

    console.log(
      `[${componentName}] 🎨 Re-render #${renderCount.value} (${timeSinceLastRender.toFixed(2)}ms since last)`
    );

    // Log if re-render seems excessive
    if (timeSinceLastRender < 16) {
      console.warn(
        `[${componentName}] ⚠️ Rapid re-render detected! Less than 16ms since last render.`
      );
    }
  });

  const logRenderStats = () => {
    console.group(`📊 Render Stats: ${componentName}`);
    console.log('Total Re-renders:', renderCount.value);

    if (renderEvents.value.length > 0) {
      const avgTime = renderEvents.value
        .slice(1) // Skip first render
        .reduce((sum, e) => sum + e.timeSinceLastRender, 0) / (renderEvents.value.length - 1);

      console.log('Avg Time Between Renders:', avgTime.toFixed(2) + 'ms');

      // Group by changed props
      const propChanges: Record<string, number> = {};
      renderEvents.value.forEach(event => {
        event.changedProps.forEach(prop => {
          propChanges[prop] = (propChanges[prop] || 0) + 1;
        });
      });

      console.log('Props That Triggered Re-renders:');
      console.table(propChanges);
    }

    console.groupEnd();
    return {
      renderCount: renderCount.value,
      events: renderEvents.value
    };
  };

  const clearStats = () => {
    renderCount.value = 0;
    renderEvents.value = [];
    lastRenderTime = performance.now();
  };

  // Expose to window for console access
  if (import.meta.env.DEV) {
    (window as any)[`__render_${componentName}`] = {
      logStats: logRenderStats,
      clear: clearStats,
      events: renderEvents
    };
  }

  return {
    renderCount,
    renderEvents,
    logRenderStats,
    clearStats
  };
}
```

### 2.3 Usage in TenstackTable.vue

```typescript
// In TenstackTable.vue <script setup>
import { useRenderTracker } from '@/composables/useRenderTracker';

// Track component re-renders and which props changed
const { renderCount, logRenderStats } = useRenderTracker('TenstackTable');

// Expose stats to console
if (import.meta.env.DEV) {
  (window as any).__tenstackTableRenderStats = logRenderStats;
}
```

### 2.4 Watcher-Level Tracking

Track which **watcher** is triggering updates:

```typescript
// Add to each critical watch statement
watch(
  () => props.rows,
  async (newVal, oldVal) => {
    console.group('👀 [WATCH] props.rows triggered');
    console.log('Previous length:', oldVal?.length);
    console.log('New length:', newVal?.length);
    console.log('Reference changed:', newVal !== oldVal);
    console.trace('Called from:');
    console.groupEnd();

    performance.mark('rows-watch-start');

    // Your existing logic...
    tableRows.value = [...newVal];
    await nextTick();

    if (props.columns?.length && tableRows.value?.length) {
      await processHitsInChunks(
        tableRows.value,
        props.columns,
        false,
        props.highlightQuery,
        100,
        selectedStreamFtsKeys.value,
      );
    }

    performance.mark('rows-watch-end');
    performance.measure('rows-watch-duration', 'rows-watch-start', 'rows-watch-end');

    const measure = performance.getEntriesByName('rows-watch-duration')[0];
    console.log(`⏱️  [WATCH] props.rows completed in ${measure.duration.toFixed(2)}ms`);
  },
  { deep: true }
);

watch(
  () => props.columns,
  async (newVal, oldVal) => {
    console.group('👀 [WATCH] props.columns triggered');
    console.log('Previous columns:', oldVal?.map((c: any) => c.id));
    console.log('New columns:', newVal?.map((c: any) => c.id));
    console.trace('Called from:');
    console.groupEnd();

    // Your logic...
  },
  { deep: true, immediate: true }
);
```

---

## 3. Memory Consumption & Leak Detection

### 3.1 Memory Profiler Composable

```typescript
// composables/useMemoryProfiler.ts
import { ref, onMounted, onBeforeUnmount } from 'vue';

interface MemorySnapshot {
  timestamp: number;
  usedHeapSize: number;
  totalHeapSize: number;
  heapLimit: number;
}

export function useMemoryProfiler(componentName: string) {
  const snapshots = ref<MemorySnapshot[]>([]);
  const isSupported = 'memory' in performance;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  const takeSnapshot = (): MemorySnapshot | null => {
    if (!isSupported) {
      console.warn('Performance.memory not supported in this browser');
      return null;
    }

    const memory = (performance as any).memory;
    return {
      timestamp: Date.now(),
      usedHeapSize: memory.usedJSHeapSize,
      totalHeapSize: memory.totalJSHeapSize,
      heapLimit: memory.jsHeapSizeLimit
    };
  };

  const startTracking = (intervalMs: number = 1000) => {
    if (!isSupported) return;

    // Take initial snapshot
    const initial = takeSnapshot();
    if (initial) snapshots.value.push(initial);

    intervalId = setInterval(() => {
      const snapshot = takeSnapshot();
      if (snapshot) snapshots.value.push(snapshot);
    }, intervalMs);

    console.log(`🧠 [${componentName}] Memory tracking started (interval: ${intervalMs}ms)`);
  };

  const stopTracking = () => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
      console.log(`🧠 [${componentName}] Memory tracking stopped`);
    }
  };

  const getMemoryStats = () => {
    if (snapshots.value.length === 0) return null;

    const first = snapshots.value[0];
    const last = snapshots.value[snapshots.value.length - 1];
    const peak = Math.max(...snapshots.value.map(s => s.usedHeapSize));

    const growth = last.usedHeapSize - first.usedHeapSize;
    const growthMB = growth / (1024 * 1024);
    const durationSeconds = (last.timestamp - first.timestamp) / 1000;

    return {
      initialMB: first.usedHeapSize / (1024 * 1024),
      currentMB: last.usedHeapSize / (1024 * 1024),
      peakMB: peak / (1024 * 1024),
      growthMB,
      growthRate: growthMB / durationSeconds, // MB per second
      durationSeconds,
      snapshotCount: snapshots.value.length,
      limitMB: last.heapLimit / (1024 * 1024)
    };
  };

  const logMemoryStats = () => {
    const stats = getMemoryStats();
    if (!stats) {
      console.log('No memory data available');
      return;
    }

    console.group(`🧠 Memory Stats: ${componentName}`);
    console.log(`Initial: ${stats.initialMB.toFixed(2)} MB`);
    console.log(`Current: ${stats.currentMB.toFixed(2)} MB`);
    console.log(`Peak: ${stats.peakMB.toFixed(2)} MB`);
    console.log(`Growth: ${stats.growthMB.toFixed(2)} MB over ${stats.durationSeconds.toFixed(1)}s`);
    console.log(`Growth Rate: ${stats.growthRate.toFixed(3)} MB/s`);
    console.log(`Heap Limit: ${stats.limitMB.toFixed(2)} MB`);

    // Warning if memory is growing rapidly
    if (stats.growthRate > 1) {
      console.warn('⚠️ High memory growth rate detected! Possible memory leak.');
    }

    if (stats.currentMB > stats.limitMB * 0.8) {
      console.warn('⚠️ Memory usage is above 80% of heap limit!');
    }

    console.groupEnd();
    return stats;
  };

  const detectLeak = (): boolean => {
    const stats = getMemoryStats();
    if (!stats) return false;

    // Simple leak detection: consistent growth over time
    if (snapshots.value.length < 10) {
      console.log('Not enough data to detect leak (need at least 10 snapshots)');
      return false;
    }

    // Check if memory is consistently growing (all increases)
    let increasingCount = 0;
    for (let i = 1; i < snapshots.value.length; i++) {
      if (snapshots.value[i].usedHeapSize > snapshots.value[i - 1].usedHeapSize) {
        increasingCount++;
      }
    }

    const increasingPercentage = increasingCount / (snapshots.value.length - 1);
    const isLeak = increasingPercentage > 0.7 && stats.growthRate > 0.5;

    if (isLeak) {
      console.error(`🔴 [${componentName}] MEMORY LEAK DETECTED!`);
      console.log(`  - ${(increasingPercentage * 100).toFixed(1)}% of samples show growth`);
      console.log(`  - Growth rate: ${stats.growthRate.toFixed(3)} MB/s`);
      console.log(`  - Total growth: ${stats.growthMB.toFixed(2)} MB`);
    }

    return isLeak;
  };

  const exportData = () => {
    return JSON.stringify(snapshots.value, null, 2);
  };

  onBeforeUnmount(() => {
    stopTracking();
  });

  // Expose to window for console access
  if (import.meta.env.DEV) {
    (window as any)[`__memory_${componentName}`] = {
      logStats: logMemoryStats,
      detectLeak,
      snapshots: snapshots.value,
      exportData
    };
  }

  return {
    startTracking,
    stopTracking,
    takeSnapshot,
    getMemoryStats,
    logMemoryStats,
    detectLeak,
    exportData,
    snapshots,
    isSupported
  };
}
```

### 3.2 Detect Specific Object Memory Leaks

```typescript
// composables/useObjectMemoryTracker.ts
import { onBeforeUnmount, watch, ref } from 'vue';

export function useObjectMemoryTracker(label: string) {
  const trackedObjects = new WeakMap<object, string>();
  const registry = new FinalizationRegistry((heldValue: string) => {
    console.log(`♻️ [${label}] Object garbage collected:`, heldValue);
  });

  const track = (obj: object, identifier: string) => {
    trackedObjects.set(obj, identifier);
    registry.register(obj, identifier);
    console.log(`👁️ [${label}] Now tracking:`, identifier);
  };

  const checkLeaks = () => {
    // Force garbage collection if available (Chrome with --js-flags=--expose-gc)
    if ((global as any).gc) {
      console.log('Running garbage collection...');
      (global as any).gc();
    } else {
      console.warn('GC not available. Run Chrome with --js-flags=--expose-gc');
    }
  };

  return { track, checkLeaks };
}
```

### 3.3 Usage Example

```typescript
// In TenstackTable.vue
import { useMemoryProfiler } from '@/composables/useMemoryProfiler';
import { useObjectMemoryTracker } from '@/composables/useObjectMemoryTracker';

const { startTracking, stopTracking, logMemoryStats, detectLeak } =
  useMemoryProfiler('TenstackTable');

const { track: trackObject } = useObjectMemoryTracker('TenstackTable');

onMounted(() => {
  // Start memory tracking
  if (import.meta.env.DEV) {
    startTracking(2000); // Every 2 seconds

    // Track large objects
    trackObject(tableRows.value, 'tableRows');
    trackObject(processedResults.value, 'processedResults');
  }
});

// Check for leaks after significant operations
watch(() => props.rows, async (newVal) => {
  // ... your logic

  if (import.meta.env.DEV) {
    await nextTick();
    setTimeout(() => {
      detectLeak();
    }, 3000);
  }
});

onBeforeUnmount(() => {
  if (import.meta.env.DEV) {
    logMemoryStats();
    stopTracking();
  }
});
```

### 3.4 Chrome DevTools Memory Workflow

When you need deeper analysis (but not continuous monitoring):

#### Step 1: Take Heap Snapshots

```typescript
// Add buttons in your dev UI
const takeHeapSnapshot = () => {
  console.log('📸 Take a heap snapshot now in DevTools > Memory > Take snapshot');
  console.log('Current component state:', {
    rows: tableRows.value.length,
    columns: columnOrder.value.length,
    expanded: expandedRowIndices.value.size
  });
};

// Usage: Call before and after a suspected leak operation
```

#### Step 2: Compare Snapshots

1. Open DevTools → Memory tab
2. Take **Snapshot 1** (before operation)
3. Perform the operation (e.g., load logs, expand rows)
4. Take **Snapshot 2** (after operation)
5. Select Snapshot 2, change view to "Comparison"
6. Look for objects with high "Delta" values
7. Inspect allocation stack traces

#### Step 3: Record Allocation Timeline

1. DevTools → Memory → Allocation instrumentation on timeline
2. Click **Start**
3. Perform your operations
4. Click **Stop**
5. Blue bars = allocations still in memory (potential leaks)
6. Gray bars = allocations that were garbage collected (good)

---

## 4. Quick Reference

### 4.1 Console Commands

After implementing the composables above, use these commands in the browser console:

```javascript
// Performance metrics
__logHighlighterStats()

// Render statistics
__render_TenstackTable.logStats()
__render_TenstackTable.clear()

// Memory stats
__memory_TenstackTable.logStats()
__memory_TenstackTable.detectLeak()

// Component state (if you added this)
__tenstackTableStats.renders()
```

### 4.2 Performance Testing Checklist

Before committing changes that might affect performance:

- [ ] Add performance tracking to modified functions
- [ ] Monitor re-render count in affected components
- [ ] Check memory growth over 30 seconds of usage
- [ ] Compare metrics before/after your changes
- [ ] Look for console warnings about rapid re-renders
- [ ] Verify no memory leaks detected
- [ ] Check that P95 latency is acceptable

### 4.3 Metric Targets

| Metric | Target | Warning | Critical |
|--------|--------|---------|----------|
| Function execution | <50ms | 50-200ms | >200ms |
| Re-renders per second | <2 | 2-5 | >5 |
| Memory growth rate | <0.1 MB/s | 0.1-1 MB/s | >1 MB/s |
| Time to interactive | <1000ms | 1000-3000ms | >3000ms |

### 4.4 Common Performance Patterns

#### Pattern 1: Unnecessary Re-renders from Prop Changes

**Problem:** Parent passing new object/array references every render

```typescript
// ❌ BAD: Creates new array every render
<TenstackTable :columns="rows.map(r => r.column)" />

// ✅ GOOD: Memoize the array
const columns = computed(() => rows.value.map(r => r.column));
<TenstackTable :columns="columns" />
```

#### Pattern 2: Deep Watch Causing Cascading Updates

**Problem:** Deep watch on large objects

```typescript
// ❌ BAD: Watches entire object deeply
watch(() => props.rows, handler, { deep: true })

// ✅ GOOD: Watch specific property or use shallow
watch(() => props.rows.length, handler)
```

#### Pattern 3: Memory Leak from Event Listeners

**Problem:** Not cleaning up event listeners

```typescript
// ❌ BAD
onMounted(() => {
  window.addEventListener('resize', handler);
});

// ✅ GOOD
onMounted(() => {
  window.addEventListener('resize', handler);
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', handler);
});
```

---

## 5. Automated Performance Testing

### 5.1 Vitest Benchmark

```typescript
// __tests__/highlighter.bench.ts
import { bench, describe } from 'vitest';
import { useLogsHighlighter } from '@/composables/useLogsHighlighter';

describe('Highlighter Performance Benchmarks', () => {
  const { processHitsInChunks } = useLogsHighlighter();

  const mockRows = Array.from({ length: 1000 }, (_, i) => ({
    _timestamp: Date.now() + i,
    message: `Log message ${i} with some error text`,
    level: 'error'
  }));

  const mockColumns = [
    { id: '_timestamp' },
    { id: 'message' },
    { id: 'level' }
  ];

  bench('process 1000 rows with highlighting', async () => {
    await processHitsInChunks(
      mockRows,
      mockColumns,
      true,
      'error',
      100,
      ['message']
    );
  }, {
    time: 5000, // Run for 5 seconds
    iterations: 100 // Or fixed iterations
  });

  bench('process 1000 rows without highlighting', async () => {
    await processHitsInChunks(
      mockRows,
      mockColumns,
      true,
      '',
      100,
      []
    );
  }, {
    time: 5000
  });
});
```

Run: `npm run test:bench`

### 5.2 Add to package.json

```json
{
  "scripts": {
    "test:bench": "vitest bench",
    "test:bench:ui": "vitest bench --ui"
  }
}
```

---

## 6. Production Monitoring (Optional)

For production performance monitoring, consider:

### 6.1 Web Vitals

```typescript
// utils/webVitals.ts
import { onCLS, onFID, onLCP, onFCP, onTTFB } from 'web-vitals';

export function initWebVitals() {
  onCLS(console.log); // Cumulative Layout Shift
  onFID(console.log); // First Input Delay
  onLCP(console.log); // Largest Contentful Paint
  onFCP(console.log); // First Contentful Paint
  onTTFB(console.log); // Time to First Byte
}

// In main.ts (production only)
if (import.meta.env.PROD) {
  initWebVitals();
}
```

### 6.2 Error Tracking with Performance Context

```typescript
// When logging errors, include performance context
const logErrorWithPerf = (error: Error) => {
  const perfData = {
    memory: (performance as any).memory?.usedJSHeapSize,
    navigation: performance.getEntriesByType('navigation')[0],
    resources: performance.getEntriesByType('resource').length
  };

  // Send to your error tracking service (Sentry, etc.)
  console.error(error, { performance: perfData });
};
```

---

## 7. Practical Example: Measuring useLogsHighlighter Impact

Here's a complete, step-by-step guide to measure the performance impact of `useLogsHighlighter`:

### Step 1: Instrument the Highlighter

```typescript
// composables/useLogsHighlighter.ts
import { usePerformanceTracker } from './usePerformanceTracker';

export function useLogsHighlighter() {
  const { trackAsync, logStats } = usePerformanceTracker();
  const processedResults = ref({});

  const processHitsInChunks = async (...args) => {
    // ✅ SAFE: Track async function
    return await trackAsync('highlighter:total', async () => {
      // Your existing logic...

      for (let i = 0; i < rows.length; i += chunkSize) {
        await trackAsync(`highlighter:chunk`, async () => {
          // Process chunk
        });
      }
    });
  };

  // Expose for console
  if (import.meta.env.DEV) {
    (window as any).__logHighlighterStats = logStats;
  }

  return { processedResults, processHitsInChunks };
}
```

### Step 2: Track What Triggers Re-renders in TenstackTable

```typescript
// TenstackTable.vue
import { useRenderTracker } from '@/composables/useRenderTracker';

// ✅ Track which props trigger re-renders
const { renderCount } = useRenderTracker('TenstackTable');

// Expose to console
if (import.meta.env.DEV) {
  (window as any).__tenstackTableRenderStats = () => {
    console.log('Current render count:', renderCount.value);
  };
}
```

### Step 3: Add Lightweight Watcher Logging

```typescript
// TenstackTable.vue - Update existing watchers
watch(
  () => props.rows,
  async (newVal) => {
    if (!import.meta.env.DEV) {
      // Production: no logging
      tableRows.value = [...newVal];
      await nextTick();
      if (props.columns?.length && tableRows.value?.length) {
        await processHitsInChunks(...);
      }
      return;
    }

    // ✅ DEV: Lightweight logging
    console.group('👀 [WATCH] props.rows');
    console.log('Length:', newVal?.length);
    console.log('Reference changed:', newVal !== tableRows.value);
    console.groupEnd();

    performance.mark('rows-update-start');

    tableRows.value = [...newVal];
    await nextTick();

    if (props.columns?.length && tableRows.value?.length) {
      performance.mark('highlighting-start');

      await processHitsInChunks(
        tableRows.value,
        props.columns,
        false,
        props.highlightQuery,
        100,
        selectedStreamFtsKeys.value,
      );

      performance.mark('highlighting-end');
      performance.measure('highlighting', 'highlighting-start', 'highlighting-end');

      const measure = performance.getEntriesByName('highlighting')[0];
      console.log(`✨ Highlighting: ${measure.duration.toFixed(2)}ms`);
    }

    performance.mark('rows-update-end');
    performance.measure('total-rows-update', 'rows-update-start', 'rows-update-end');

    const total = performance.getEntriesByName('total-rows-update')[0];
    console.log(`📊 Total row update: ${total.duration.toFixed(2)}ms`);
  },
  { deep: true }
);
```

### Step 4: Measure Memory Impact

```typescript
// TenstackTable.vue
import { useMemoryProfiler } from '@/composables/useMemoryProfiler';

const { startTracking, logMemoryStats, detectLeak } = useMemoryProfiler('TenstackTable');

onMounted(() => {
  if (import.meta.env.DEV) {
    startTracking(3000); // Every 3 seconds
  }
});

// Check memory after highlighting completes
watch(() => processedResults, () => {
  if (import.meta.env.DEV) {
    setTimeout(() => {
      const stats = logMemoryStats();
      if (stats && stats.growthRate > 0.5) {
        console.warn('⚠️ High memory growth from highlighting!');
      }
    }, 1000);
  }
}, { deep: false }); // Shallow watch on ref
```

### Step 5: Testing Workflow

#### A. Baseline (With Highlighter)
1. Open logs page
2. Load 1000 rows
3. Open console and run:
   ```javascript
   __logHighlighterStats()
   __render_TenstackTable.logStats()
   __memory_TenstackTable.logStats()
   ```
4. Record the numbers:
   - Highlighting avg: `X ms`
   - Re-renders: `Y times`
   - Memory growth: `Z MB`

#### B. Test Without Highlighter
1. Comment out `processHitsInChunks` call temporarily
2. Reload page, load same 1000 rows
3. Run same console commands
4. Record numbers

#### C. Compare Results
```
| Metric                  | With Highlighter | Without | Diff     |
|-------------------------|------------------|---------|----------|
| Avg highlighting time   | 245ms            | 0ms     | +245ms   |
| Total render time       | 380ms            | 135ms   | +245ms   |
| Re-renders              | 4                | 2       | +2       |
| Memory growth           | 12MB             | 8MB     | +4MB     |
| P95 latency             | 380ms            | 160ms   | +220ms   |
```

### Step 6: Identify Bottlenecks

Based on your measurements:

**If highlighting takes >200ms:**
- Problem: Processing too many rows at once
- Solution: Reduce chunk size or virtualize processing

**If re-renders are high (>5):**
- Problem: `processedResults` updates triggering re-renders
- Solution: Debounce updates or batch them

**If memory growth is high (>10MB):**
- Problem: Caching too much highlighted HTML
- Solution: Implement LRU cache or clear old entries

### Step 7: Optimization Example

```typescript
// Optimize with throttling
import { throttle } from 'lodash-es';

const processHitsInChunksThrottled = throttle(
  processHitsInChunks,
  100,
  { leading: true, trailing: true }
);

// Use in watcher
watch(() => props.rows, async (newVal) => {
  await processHitsInChunksThrottled(...);
});
```

Then re-measure to verify improvement!

---

## 8. Summary

| Testing Goal | Tool/Approach | Console Command |
|--------------|---------------|-----------------|
| **Function performance** | `usePerformanceTracker` | `__logHighlighterStats()` |
| **Re-render detection** | `useRenderTracker` | `__render_TenstackTable.logStats()` |
| **Memory usage** | `useMemoryProfiler` | `__memory_TenstackTable.logStats()` |
| **Memory leaks** | `detectLeak()` | `__memory_TenstackTable.detectLeak()` |
| **Heap analysis** | Chrome DevTools | Manual snapshot comparison |
| **Automated benchmarks** | Vitest bench | `npm run test:bench` |

---

**Pro Tips:**

1. **Start simple**: Add `useRenderTracker` first to understand re-render patterns
2. **Be surgical**: Don't track everything - focus on suspected problem areas
3. **Avoid the Observer Effect**: Never deep watch large arrays (`{ deep: true }` on 1000+ items)
4. **Use console.trace()**: Add to watchers to see call stacks (but remove after debugging)
5. **Compare before/after**: Always measure baseline before optimizing
6. **Disable in production**: All tracking code is wrapped in `import.meta.env.DEV` checks
7. **Turn off when not debugging**: Comment out trackers when not actively investigating
8. **Log metadata, not data**: Log `.length`, `.keys`, `.size` instead of full objects

---

*Last updated: 2026-02-09*
