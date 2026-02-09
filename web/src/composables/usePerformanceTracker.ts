// Copyright 2023 OpenObserve Inc.
// Performance tracking composable for measuring function execution times

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

    if (stats.length === 0) {
      console.log('No performance metrics recorded yet.');
      return [];
    }

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
    console.log('Performance metrics cleared.');
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
