// Copyright 2023 OpenObserve Inc.
// Memory profiler for tracking heap usage and detecting memory leaks

import { ref, onBeforeUnmount } from 'vue';

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
      console.warn('Performance.memory not supported in this browser (requires Chromium-based browser)');
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
    if (!import.meta.env.DEV) return;

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
    } else {
      console.log(`✅ [${componentName}] No memory leak detected.`);
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
