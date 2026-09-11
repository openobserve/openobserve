// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

/**
 * PromQL Chunk Processor
 *
 * Handles efficient merging of streaming PromQL chunks with:
 * - O(1) metric lookup using Map-based signatures
 * - A render cap applied by point count, so arrival order never decides what survives
 * - Performance monitoring and logging
 */

export interface PromQLChunkProcessorOptions {
  maxSeries: number;
  enableLogging?: boolean;
}

export interface ProcessingStats {
  chunkCount: number;
  totalMetricsReceived: number;
  metricsStored: number;
  valuesAppended: number;
  startTime: number;
}

/**
 * Creates a PromQL chunk processor with optimized metric matching and series limiting
 */
export function createPromQLChunkProcessor(options: PromQLChunkProcessorOptions) {
  const { maxSeries, enableLogging = true } = options;

  // Partitions stream oldest-first, so a series born mid-window is absent from the
  // early chunks. Admitting by arrival order spends the cap on whatever existed
  // first — including series that died in partition 1 — so candidates are held here
  // and the cap is applied by point count once the whole window has been seen.
  const candidates = new Map<string, any>();

  /** The cap exists to bound what the chart renders; keep the series carrying the most data. */
  function selectWithinCap(): any[] {
    if (candidates.size <= maxSeries) return [...candidates.values()];
    return [...candidates.values()]
      .sort((a, b) => (b.values?.length ?? 0) - (a.values?.length ?? 0))
      .slice(0, maxSeries);
  }

  // Statistics tracking
  const stats: ProcessingStats = {
    chunkCount: 0,
    totalMetricsReceived: 0,
    metricsStored: 0,
    valuesAppended: 0,
    startTime: performance.now(),
  };

  /**
   * Generate a deterministic signature from metric labels for fast lookup
   * Example: {job: "api", instance: "host1"} → "instance=host1,job=api"
   */
  function getMetricSignature(metric: any): string {
    if (!metric) return "";
    const keys = Object.keys(metric).sort();
    return keys.map((k) => `${k}=${metric[k]}`).join(",");
  }

  /**
   * Process the first chunk - initialize data structure and build index
   */
  function processFirstChunk(newData: any): any {
    const startTime = performance.now();
    const metricsCount = newData?.result?.length || 0;
    stats.totalMetricsReceived += metricsCount;

    if (Array.isArray(newData?.result)) {
      for (const metric of newData.result) {
        candidates.set(getMetricSignature(metric.metric), metric);
      }
    }

    const selected = selectWithinCap();
    stats.metricsStored = selected.length;

    if (enableLogging) {
      if (metricsCount > maxSeries) {
        console.log(
          `[PromQL Chunk] ⚠️ First chunk limited from ${metricsCount} to ${selected.length} metrics`,
        );
      }
      console.log(
        `[PromQL Chunk] Built index for ${selected.length} metrics in ${(performance.now() - startTime).toFixed(1)}ms`,
      );
    }

    return {
      ...newData,
      result: selected,
    };
  }

  /**
   * Merge a subsequent chunk into existing results
   * - Appends values to existing metrics (O(1) lookup)
   * - Adds new metrics only if under series limit
   * - Skips metrics once limit is reached
   */
  function mergeChunk(currentResult: any, newData: any): any {
    const mergeStart = performance.now();
    const metricsCount = newData?.result?.length || 0;
    stats.totalMetricsReceived += metricsCount;

    if (
      !currentResult?.result ||
      !Array.isArray(currentResult.result) ||
      !newData?.result ||
      !Array.isArray(newData.result)
    ) {
      // Structure mismatch - replace
      return newData;
    }

    let newMetricsAdded = 0;
    let valuesAppended = 0;

    newData.result.forEach((newMetric: any) => {
      const signature = getMetricSignature(newMetric.metric);
      const existing = candidates.get(signature);

      if (existing) {
        if (Array.isArray(existing.values) && Array.isArray(newMetric.values)) {
          existing.values.push(...newMetric.values);
          valuesAppended += newMetric.values.length;
        }
      } else {
        // Held whole: a series is either kept with every point it reported or dropped.
        candidates.set(signature, newMetric);
        newMetricsAdded++;
      }
    });

    const selected = selectWithinCap();
    stats.valuesAppended += valuesAppended;
    stats.metricsStored = selected.length;

    if (enableLogging) {
      console.log(
        `[PromQL Chunk] Merged in ${(performance.now() - mergeStart).toFixed(1)}ms ` +
          `(${newMetricsAdded} new metrics, ${valuesAppended} values appended)`,
      );
    }

    return {
      ...newData,
      result: selected,
    };
  }

  /**
   * Process a chunk (first or subsequent)
   */
  function processChunk(currentResult: any, newData: any): any {
    const chunkStartTime = performance.now();
    stats.chunkCount++;

    const metricsCount = newData?.result?.length || 0;

    if (enableLogging) {
      console.log(`[PromQL Chunk] Chunk ${stats.chunkCount} received: ${metricsCount} metrics`);
    }

    const result = !currentResult ? processFirstChunk(newData) : mergeChunk(currentResult, newData);

    if (enableLogging) {
      console.log(
        `[PromQL Chunk] Total chunk processing: ${(performance.now() - chunkStartTime).toFixed(1)}ms`,
      );
    }

    return result;
  }

  /**
   * Get current processing statistics
   */
  function getStats(): ProcessingStats & { totalTime: number } {
    return {
      ...stats,
      totalTime: performance.now() - stats.startTime,
    };
  }

  /**
   * Log final statistics
   */
  function logFinalStats() {
    const finalStats = getStats();

    if (enableLogging) {
      console.log(
        `[PromQL Chunk] ✅ Processing complete! Total time: ${finalStats.totalTime.toFixed(0)}ms (${stats.chunkCount} chunks)`,
      );
      console.log(
        `[PromQL Chunk] Final metrics: ${stats.metricsStored} stored (${stats.totalMetricsReceived} received, ${stats.valuesAppended} values appended)`,
      );
    }
  }

  return {
    processChunk,
    getStats,
    logFinalStats,
  };
}
