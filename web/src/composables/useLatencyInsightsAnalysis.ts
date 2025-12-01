// Copyright 2025 OpenObserve Inc.
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

import { ref } from "vue";
import { useStore } from "vuex";
import searchService from "@/services/search";

export interface ValueDistribution {
  value: string | number;
  baselineCount: number;
  baselinePercent: number;
  selectedCount: number;
  selectedPercent: number;
}

export interface DimensionAnalysis {
  dimensionName: string;
  data: ValueDistribution[];
  baselinePopulation: number; // % of baseline events with this field populated
  selectedPopulation: number; // % of selected events with this field populated
  differenceScore: number; // Sum of absolute percentage differences
}

export interface LatencyInsightsConfig {
  streamName: string;
  streamType: string;
  orgIdentifier: string;
  selectedTimeRange: {
    startTime: number;
    endTime: number;
  };
  baselineTimeRange: {
    startTime: number;
    endTime: number;
  };
  durationFilter?: {
    start: number;
    end: number;
  };
  rateFilter?: {
    start: number;
    end: number;
  };
  errorFilter?: {
    start: number;
    end: number;
  };
  baseFilter?: string;
  dimensions: string[]; // List of dimension names to analyze
  analysisType?: "latency" | "volume" | "error"; // Type of analysis to perform
  percentile?: string; // Latency percentile value (e.g., "0.95" for P95)
}

export function useLatencyInsightsAnalysis() {
  const store = useStore();
  const loading = ref(false);
  const error = ref<string | null>(null);

  /**
   * Build SQL query to get distribution for a dimension
   * @param applyDurationFilter - If true, applies duration filter (for selected). If false, gets all traces (for baseline).
   */
  const buildDistributionQuery = (
    dimensionName: string,
    streamName: string,
    timeRange: { startTime: number; endTime: number },
    durationFilter: { start: number; end: number } | null,
    baseFilter?: string,
    applyDurationFilter: boolean = true
  ) => {
    const filters: string[] = [];

    // IMPORTANT: Time range filter is handled by the search API via start_time/end_time params
    // We don't add it to the WHERE clause

    // Add duration filter ONLY if requested (for selected queries, not baseline)
    if (applyDurationFilter && durationFilter) {
      filters.push(
        `duration >= ${durationFilter.start} AND duration <= ${durationFilter.end}`
      );
    }

    // Add base filter if provided
    if (baseFilter?.trim().length) {
      filters.push(baseFilter.trim());
    }

    const whereClause = filters.length > 0 ? "WHERE " + filters.join(" AND ") : "";

    // Query to get value distribution
    // We use COALESCE to handle null values as "(no value)"
    // Note: GROUP BY must use the full expression, not the alias
    const valueExpression = `COALESCE(CAST(${dimensionName} AS VARCHAR), '(no value)')`;
    const query = `
      SELECT
        ${valueExpression} AS value,
        COUNT(*) AS count
      FROM "${streamName}"
      ${whereClause}
      GROUP BY ${valueExpression}
      ORDER BY count DESC
      LIMIT 100
    `.trim();

    return query;
  };

  /**
   * Build SQL query to get total count and population percentage for a dimension
   * @param applyDurationFilter - If true, applies duration filter (for selected). If false, gets all traces (for baseline).
   */
  const buildPopulationQuery = (
    dimensionName: string,
    streamName: string,
    timeRange: { startTime: number; endTime: number },
    durationFilter: { start: number; end: number } | null,
    baseFilter?: string,
    applyDurationFilter: boolean = true
  ) => {
    const filters: string[] = [];

    // Add duration filter ONLY if requested (for selected queries, not baseline)
    if (applyDurationFilter && durationFilter) {
      filters.push(
        `duration >= ${durationFilter.start} AND duration <= ${durationFilter.end}`
      );
    }

    // Add base filter if provided
    if (baseFilter?.trim().length) {
      filters.push(baseFilter.trim());
    }

    const whereClause = filters.length > 0 ? "WHERE " + filters.join(" AND ") : "";

    // Query to get total count and populated count
    const query = `
      SELECT
        COUNT(*) AS total_count,
        COUNT(${dimensionName}) AS populated_count
      FROM "${streamName}"
      ${whereClause}
    `.trim();

    return query;
  };

  /**
   * Execute search query and return results
   */
  const executeQuery = async (
    query: string,
    streamName: string,
    streamType: string,
    orgIdentifier: string,
    timeRange: { startTime: number; endTime: number }
  ) => {
    try {
      const payload = {
        query: {
          sql: query,
          start_time: timeRange.startTime,
          end_time: timeRange.endTime,
          from: 0,
          size: 1000,
          quick_mode: false,
          sql_mode: "full",
        },
      };

      const response = await searchService.search(
        {
          org_identifier: orgIdentifier,
          query: payload,
          page_type: streamType,
        },
        "ui" // search_type parameter
      );

      return response.data;
    } catch (err: any) {
      console.error("Error executing query:", err);
      throw err;
    }
  };

  /**
   * Calculate percentage distribution from counts
   */
  const calculateDistribution = (
    data: any[],
    totalCount: number
  ): Map<string | number, { count: number; percent: number }> => {
    const distribution = new Map();

    data.forEach((row: any) => {
      const value = row.value || "(no value)";
      const count = parseInt(row.count) || 0;
      const percent = totalCount > 0 ? (count / totalCount) * 100 : 0;

      distribution.set(value, { count, percent });
    });

    return distribution;
  };

  /**
   * Merge baseline and selected distributions into comparison data
   */
  const mergeDistributions = (
    baselineDistribution: Map<string | number, { count: number; percent: number }>,
    selectedDistribution: Map<string | number, { count: number; percent: number }>
  ): ValueDistribution[] => {
    // Get all unique values from both distributions
    const allValues = new Set([
      ...baselineDistribution.keys(),
      ...selectedDistribution.keys(),
    ]);

    const merged: ValueDistribution[] = [];

    allValues.forEach((value) => {
      const baseline = baselineDistribution.get(value) || { count: 0, percent: 0 };
      const selected = selectedDistribution.get(value) || { count: 0, percent: 0 };

      merged.push({
        value,
        baselineCount: baseline.count,
        baselinePercent: baseline.percent,
        selectedCount: selected.count,
        selectedPercent: selected.percent,
      });
    });

    // Sort by maximum presence in either distribution
    merged.sort((a, b) => {
      const aMax = Math.max(a.baselinePercent, a.selectedPercent);
      const bMax = Math.max(b.baselinePercent, b.selectedPercent);
      return bMax - aMax;
    });

    return merged;
  };

  /**
   * Calculate difference score for ranking dimensions by impact
   */
  const calculateDifferenceScore = (data: ValueDistribution[]): number => {
    return data.reduce((sum, item) => {
      return sum + Math.abs(item.selectedPercent - item.baselinePercent);
    }, 0);
  };

  /**
   * Analyze a single dimension
   */
  const analyzeDimension = async (
    dimensionName: string,
    config: LatencyInsightsConfig
  ): Promise<DimensionAnalysis> => {
    try {
      // Get baseline distribution (WITHOUT duration filter - all traces)
      const baselineDistQuery = buildDistributionQuery(
        dimensionName,
        config.streamName,
        config.baselineTimeRange,
        config.durationFilter,
        config.baseFilter,
        false // DON'T apply duration filter for baseline
      );

      const baselineDistResult = await executeQuery(
        baselineDistQuery,
        config.streamName,
        config.streamType,
        config.orgIdentifier,
        config.baselineTimeRange
      );

      // Get selected distribution (WITH duration filter - only slow traces)
      const selectedDistQuery = buildDistributionQuery(
        dimensionName,
        config.streamName,
        config.selectedTimeRange,
        config.durationFilter,
        config.baseFilter,
        true // DO apply duration filter for selected
      );

      const selectedDistResult = await executeQuery(
        selectedDistQuery,
        config.streamName,
        config.streamType,
        config.orgIdentifier,
        config.selectedTimeRange
      );

      // Get baseline population stats (WITHOUT duration filter)
      const baselinePopQuery = buildPopulationQuery(
        dimensionName,
        config.streamName,
        config.baselineTimeRange,
        config.durationFilter,
        config.baseFilter,
        false // DON'T apply duration filter for baseline
      );

      const baselinePopResult = await executeQuery(
        baselinePopQuery,
        config.streamName,
        config.streamType,
        config.orgIdentifier,
        config.baselineTimeRange
      );

      // Get selected population stats (WITH duration filter)
      const selectedPopQuery = buildPopulationQuery(
        dimensionName,
        config.streamName,
        config.selectedTimeRange,
        config.durationFilter,
        config.baseFilter,
        true // DO apply duration filter for selected
      );

      const selectedPopResult = await executeQuery(
        selectedPopQuery,
        config.streamName,
        config.streamType,
        config.orgIdentifier,
        config.selectedTimeRange
      );

      // Calculate distributions
      const baselineTotalCount = baselinePopResult.hits?.[0]?.total_count || 0;
      const selectedTotalCount = selectedPopResult.hits?.[0]?.total_count || 0;

      const baselineDistribution = calculateDistribution(
        baselineDistResult.hits || [],
        baselineTotalCount
      );

      const selectedDistribution = calculateDistribution(
        selectedDistResult.hits || [],
        selectedTotalCount
      );

      // Merge distributions
      const data = mergeDistributions(baselineDistribution, selectedDistribution);

      // Calculate population percentages
      const baselinePopulatedCount = baselinePopResult.hits?.[0]?.populated_count || 0;
      const selectedPopulatedCount = selectedPopResult.hits?.[0]?.populated_count || 0;

      const baselinePopulation =
        baselineTotalCount > 0 ? baselinePopulatedCount / baselineTotalCount : 0;
      const selectedPopulation =
        selectedTotalCount > 0 ? selectedPopulatedCount / selectedTotalCount : 0;

      // Calculate difference score for ranking
      const differenceScore = calculateDifferenceScore(data);

      return {
        dimensionName,
        data,
        baselinePopulation,
        selectedPopulation,
        differenceScore,
      };
    } catch (err: any) {
      console.error(`Error analyzing dimension ${dimensionName}:`, err);
      throw err;
    }
  };

  /**
   * Analyze all dimensions and return ranked results
   */
  const analyzeAllDimensions = async (
    config: LatencyInsightsConfig
  ): Promise<DimensionAnalysis[]> => {
    try {
      loading.value = true;
      error.value = null;

      const analyses: DimensionAnalysis[] = [];

      // Analyze each dimension
      for (const dimensionName of config.dimensions) {
        try {
          const analysis = await analyzeDimension(dimensionName, config);
          analyses.push(analysis);
        } catch (err: any) {
          console.error(`Failed to analyze dimension ${dimensionName}:`, err);
          // Continue with other dimensions even if one fails
        }
      }

      // Rank by difference score (highest first)
      analyses.sort((a, b) => b.differenceScore - a.differenceScore);

      loading.value = false;
      return analyses;
    } catch (err: any) {
      loading.value = false;
      error.value = err.message || "Failed to analyze dimensions";
      throw err;
    }
  };

  return {
    loading,
    error,
    analyzeDimension,
    analyzeAllDimensions,
  };
}
