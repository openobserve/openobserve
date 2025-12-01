// Copyright 2023 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import http from "./http";

export interface InsightsParams {
  start_time?: number;
  end_time?: number;
  alert_name?: string;
}

export interface FrequencyParams extends InsightsParams {
  min_fires_per_hour?: number;
}

export interface CorrelationParams extends InsightsParams {
  correlation_window_seconds?: number;
  storm_threshold?: number;
}

export interface SummaryInsights {
  total_alerts: number;
  success_rate: number;
  avg_execution_time_us: number;
  failed_count: number;
  status_distribution: Record<string, number>;
  time_range: {
    start_time: number;
    end_time: number;
  };
}

export interface TimeSeriesInsights {
  volume: Array<{
    time_bucket: string;
    total_alerts: number;
    successful_alerts: number;
    failed_alerts: number;
    avg_duration_us: number;
    total_retries: number;
  }>;
  success_rate: Array<{
    time_bucket: string;
    success_rate: number;
  }>;
}

export interface FrequencyInsights {
  top_alerts: Array<{
    alert_name: string;
    fire_count: number;
    fires_per_hour: number;
  }>;
  dedup_candidates: Array<{
    alert_name: string;
    total_fires: number;
    fires_per_hour: number;
    potential_dedup_savings: number;
    savings_percent: number;
  }>;
  hourly_pattern: Array<{
    alert_name: string;
    hour: number;
    count: number;
  }>;
}

export interface CorrelationInsights {
  correlations: Array<{
    alert_1: string;
    alert_2: string;
    correlation_count: number;
    avg_time_diff_ms: number;
  }>;
  storms: Array<{
    storm_time: string;
    alert_count: number;
    unique_alerts: number;
    alerts_involved: string[];
  }>;
  error_patterns: Array<{
    error_message: string;
    occurrence_count: number;
    affected_alerts: number;
    alert_names: string[];
  }>;
}

export interface QualityInsights {
  effectiveness: Array<{
    alert_name: string;
    total_fires: number;
    successful: number;
    failed: number;
    silenced: number;
    success_rate: number;
    avg_duration_us: number;
  }>;
  retry_analysis: Array<{
    alert_name: string;
    avg_retries: number;
    max_retries: number;
    total_with_retries: number;
  }>;
  slow_alerts: Array<{
    alert_name: string;
    avg_duration_us: number;
    max_duration_us: number;
    fire_count: number;
  }>;
}

const alertInsights = {
  /**
   * Get summary insights (high-level metrics)
   */
  getSummary: (
    org_identifier: string,
    params: InsightsParams
  ): Promise<{ data: SummaryInsights }> => {
    return http().get(`/api/${org_identifier}/alerts/insights/summary`, {
      params,
    });
  },

  /**
   * Get time series data for trends
   */
  getTimeseries: (
    org_identifier: string,
    params: InsightsParams
  ): Promise<{ data: TimeSeriesInsights }> => {
    return http().get(`/api/${org_identifier}/alerts/insights/timeseries`, {
      params,
    });
  },

  /**
   * Get frequency analysis and dedup candidates
   */
  getFrequency: (
    org_identifier: string,
    params: FrequencyParams
  ): Promise<{ data: FrequencyInsights }> => {
    return http().get(`/api/${org_identifier}/alerts/insights/frequency`, {
      params,
    });
  },

  /**
   * Get correlation analysis, alert storms, and error patterns
   */
  getCorrelation: (
    org_identifier: string,
    params: CorrelationParams
  ): Promise<{ data: CorrelationInsights }> => {
    return http().get(`/api/${org_identifier}/alerts/insights/correlation`, {
      params,
    });
  },

  /**
   * Get quality metrics (effectiveness, retries, slow alerts)
   */
  getQuality: (
    org_identifier: string,
    params: InsightsParams
  ): Promise<{ data: QualityInsights }> => {
    return http().get(`/api/${org_identifier}/alerts/insights/quality`, {
      params,
    });
  },

  /**
   * Fetch all insights in parallel
   */
  getAllInsights: async (
    org_identifier: string,
    params: InsightsParams & FrequencyParams & CorrelationParams
  ) => {
    const [summary, timeseries, frequency, correlation, quality] =
      await Promise.all([
        alertInsights.getSummary(org_identifier, params),
        alertInsights.getTimeseries(org_identifier, params),
        alertInsights.getFrequency(org_identifier, params),
        alertInsights.getCorrelation(org_identifier, params),
        alertInsights.getQuality(org_identifier, params),
      ]);

    return {
      summary: summary.data,
      timeseries: timeseries.data,
      frequency: frequency.data,
      correlation: correlation.data,
      quality: quality.data,
    };
  },
};

export default alertInsights;
